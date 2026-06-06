import { spawn } from "node:child_process";
import type { MessageOptions, Part, RunResult, TokenUsage } from "../types.js";
import { ProcessError } from "./errors.js";

/** Tempo di grazia tra SIGTERM e SIGKILL all'abort (ms). */
const KILL_GRACE_MS = 2000;

/** Costruisce gli argomenti CLI per `claude -p`. */
export function buildArgs(sessionId: string, opts: MessageOptions, resume: boolean): string[] {
  const args = ["-p"];
  if (resume) args.push("--resume", sessionId);
  else args.push("--session-id", sessionId);
  if (opts.model) args.push("--model", opts.model);
  if (opts.effort) args.push("--effort", opts.effort);
  if (opts.outputFormat === "json") {
    args.push("--output-format", "json");
    if (opts.jsonSchema !== undefined && opts.jsonSchema !== null) {
      args.push("--json-schema", JSON.stringify(opts.jsonSchema));
    }
  }
  return args;
}

/** Parsa lo stdout del processo in un RunResult, in base al formato richiesto. */
export function parseOutput(stdout: string, opts: MessageOptions): RunResult {
  if (opts.outputFormat === "json") {
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(stdout) as Record<string, unknown>;
    } catch {
      // Output non-JSON inatteso: lo trattiamo come testo grezzo.
      return { parts: [{ type: "text", text: stdout.trim() }], raw: stdout };
    }
    const parts: Part[] = [];
    if (json.structured_output !== undefined) {
      parts.push({ type: "structured", data: json.structured_output });
    } else if (typeof json.result === "string") {
      parts.push({ type: "text", text: json.result });
    }
    return {
      parts,
      model: typeof json.model === "string" ? json.model : undefined,
      costUsd: typeof json.total_cost_usd === "number" ? json.total_cost_usd : undefined,
      usage: parseUsage(json.usage),
      raw: stdout,
    };
  }
  return { parts: [{ type: "text", text: stdout.trim() }], raw: stdout };
}

function parseUsage(raw: unknown): TokenUsage | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const u = raw as Record<string, unknown>;
  const input = typeof u.input_tokens === "number" ? u.input_tokens : undefined;
  const output = typeof u.output_tokens === "number" ? u.output_tokens : undefined;
  if (input === undefined && output === undefined) return undefined;
  return { inputTokens: input ?? 0, outputTokens: output ?? 0 };
}

/** Handle di un processo in esecuzione. */
export interface RunHandle {
  promise: Promise<RunResult>;
  kill: () => void;
}

/**
 * Spawna `claude -p`, scrive il prompt su STDIN e raccoglie l'output.
 * Risolve con RunResult su exit 0, rigetta con ProcessError altrimenti.
 */
export function runClaude(
  claudeBin: string,
  cwd: string,
  sessionId: string,
  opts: MessageOptions,
  resume: boolean,
): RunHandle {
  const child = spawn(claudeBin, buildArgs(sessionId, opts, resume), { cwd });

  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (d: string) => (stdout += d));
  child.stderr.on("data", (d: string) => (stderr += d));

  child.stdin.on("error", () => {
    // Ignora EPIPE se il processo si chiude prima di leggere stdin.
  });
  child.stdin.write(opts.prompt);
  child.stdin.end();

  let killTimer: NodeJS.Timeout | undefined;

  const promise = new Promise<RunResult>((resolve, reject) => {
    child.on("error", (err) => {
      if (killTimer) clearTimeout(killTimer);
      reject(new ProcessError(null, err.message));
    });
    child.on("close", (code) => {
      if (killTimer) clearTimeout(killTimer);
      if (code === 0) resolve(parseOutput(stdout, opts));
      else reject(new ProcessError(code, stderr));
    });
  });

  const kill = (): void => {
    if (child.killed) return;
    child.kill("SIGTERM");
    killTimer = setTimeout(() => {
      if (!child.killed) child.kill("SIGKILL");
    }, KILL_GRACE_MS);
  };

  return { promise, kill };
}
