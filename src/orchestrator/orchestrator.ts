import type { MessageOptions, RunResult } from "../types.js";
import { type RunHandle, runClaude } from "./claude.js";
import { AbortedError } from "./errors.js";

interface QueueItem {
  opts: MessageOptions;
  cwd: string;
  resolve: (r: RunResult) => void;
  reject: (e: Error) => void;
}

export interface OrchestratorOptions {
  claudeBin: string;
  isStarted: (sessionId: string) => boolean;
  markStarted: (sessionId: string) => void;
}

/**
 * Serializza i messaggi per sessione (coda FIFO) e spawna processi
 * `claude -p` effimeri. Sessioni diverse procedono in parallelo.
 */
export class Orchestrator {
  private readonly queues = new Map<string, QueueItem[]>();
  private readonly active = new Map<string, RunHandle>();
  /** Sessioni il cui processo attivo è stato interrotto da un abort. */
  private readonly aborting = new Set<string>();

  constructor(private readonly opts: OrchestratorOptions) {}

  /** Accoda un messaggio per la sessione; risolve quando elaborato. */
  submit(sessionId: string, message: MessageOptions, cwd: string): Promise<RunResult> {
    return new Promise<RunResult>((resolve, reject) => {
      const queue = this.queues.get(sessionId) ?? [];
      queue.push({ opts: message, cwd, resolve, reject });
      this.queues.set(sessionId, queue);
      this.tryNext(sessionId);
    });
  }

  /** true se la sessione ha un processo in corso o messaggi in coda. */
  isBusy(sessionId: string): boolean {
    return this.active.has(sessionId) || (this.queues.get(sessionId)?.length ?? 0) > 0;
  }

  /** Interrompe il processo in corso e svuota la coda della sessione. */
  abort(sessionId: string): void {
    const handle = this.active.get(sessionId);
    if (handle) {
      // Marca la sessione così il reject del processo killato diventa AbortedError
      // (altrimenti il caller riceverebbe il ProcessError generato dal SIGTERM).
      this.aborting.add(sessionId);
      handle.kill();
    }
    const queue = this.queues.get(sessionId);
    if (queue) {
      for (const item of queue) item.reject(new AbortedError());
      queue.length = 0;
    }
  }

  /** Killa tutti i processi attivi (graceful shutdown). */
  shutdown(): void {
    for (const handle of this.active.values()) handle.kill();
    for (const queue of this.queues.values()) {
      for (const item of queue) item.reject(new AbortedError());
      queue.length = 0;
    }
  }

  private tryNext(sessionId: string): void {
    if (this.active.has(sessionId)) return; // già occupata
    const queue = this.queues.get(sessionId);
    const item = queue?.shift();
    if (!item) return;

    const resume = this.opts.isStarted(sessionId);
    const handle = runClaude(this.opts.claudeBin, item.cwd, sessionId, item.opts, resume);
    this.active.set(sessionId, handle);

    handle.promise.then(
      (result) => {
        this.active.delete(sessionId);
        this.aborting.delete(sessionId);
        this.opts.markStarted(sessionId); // transcript creato: le prossime usano --resume
        item.resolve(result);
        this.tryNext(sessionId);
      },
      (err: Error) => {
        this.active.delete(sessionId);
        const aborted = this.aborting.delete(sessionId);
        item.reject(aborted ? new AbortedError() : err);
        this.tryNext(sessionId);
      },
    );
  }
}
