export type OutputFormat = "text" | "json";

export type MessageRole = "user" | "assistant";

export type MessageStatus = "completed" | "failed" | "aborted";

/** Opzioni di un singolo messaggio, dal body della richiesta HTTP. */
export interface MessageOptions {
  prompt: string;
  model?: string;
  effort?: string;
  outputFormat?: OutputFormat;
  jsonSchema?: unknown;
}

/** Part di un messaggio (union discriminata, predisposta per estensioni future). */
export type Part = { type: "text"; text: string } | { type: "structured"; data: unknown };

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

/** Esito dell'esecuzione di un processo `claude -p`. */
export interface RunResult {
  parts: Part[];
  model?: string;
  costUsd?: number;
  usage?: TokenUsage;
  /** stdout grezzo, per debug/persistenza. */
  raw: string;
}

export interface Session {
  id: string;
  title: string | null;
  started: boolean;
  /** Working directory della sessione (path assoluto). null solo per sessioni legacy pre-feature. */
  cwd: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface Message {
  id: string;
  sessionId: string;
  role: MessageRole;
  parts: Part[];
  status: MessageStatus | null;
  model: string | null;
  costUsd: number | null;
  usage: TokenUsage | null;
  error: string | null;
  createdAt: number;
}
