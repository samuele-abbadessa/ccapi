import { resolve } from "node:path";
import { parseArgs } from "node:util";

export interface Config {
  port: number;
  host: string;
  claudeBin: string;
  dbPath: string;
  /** Radice consentita per le cwd di sessione (path assoluto), oppure null se la feature è disabilitata. */
  detachedCwdBase: string | null;
}

export const DEFAULT_CONFIG: Config = {
  port: 4096,
  host: "127.0.0.1",
  claudeBin: "claude",
  dbPath: ".ccapi/ccapi.db",
  detachedCwdBase: null,
};

/**
 * Estrae `--detached-cwd` (a valore opzionale) da argv, perché parseArgs non
 * supporta valori opzionali. Ritorna gli altri argomenti, se il flag è presente
 * e il suo eventuale valore.
 */
function extractDetachedCwd(argv: string[]): {
  rest: string[];
  present: boolean;
  value: string | undefined;
} {
  const rest: string[] = [];
  let present = false;
  let value: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === undefined) continue;
    if (a === "--detached-cwd") {
      present = true;
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("-")) {
        value = next;
        i++; // consuma il valore
      }
    } else if (a.startsWith("--detached-cwd=")) {
      present = true;
      const v = a.slice("--detached-cwd=".length);
      value = v === "" ? undefined : v;
    } else {
      rest.push(a);
    }
  }
  return { rest, present, value };
}

/** Risolve la radice consentita (path assoluto) o null se disabilitata. CLI > env. */
function resolveDetachedCwdBase(
  cliPresent: boolean,
  cliValue: string | undefined,
  env: NodeJS.ProcessEnv,
): string | null {
  if (cliPresent) {
    return cliValue !== undefined ? resolve(cliValue) : resolve();
  }
  const envVal = env.CCAPI_DETACHED_CWD;
  if (envVal !== undefined) {
    return envVal !== "" ? resolve(envVal) : resolve();
  }
  return null;
}

/**
 * Risolve la configurazione con precedenza: CLI flag > env > default.
 * @param argv argomenti (default: process.argv.slice(2))
 * @param env  ambiente (default: process.env)
 */
export function resolveConfig(
  argv: string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
): Config {
  const { rest, present, value } = extractDetachedCwd(argv);
  const { values } = parseArgs({
    args: rest,
    options: {
      port: { type: "string" },
      host: { type: "string" },
      "claude-bin": { type: "string" },
      db: { type: "string" },
    },
    allowPositionals: false,
    strict: true,
  });

  const port = pickNumber(values.port, env.CCAPI_PORT, DEFAULT_CONFIG.port, "port");
  const host = values.host ?? env.CCAPI_HOST ?? DEFAULT_CONFIG.host;
  const claudeBin = values["claude-bin"] ?? env.CCAPI_CLAUDE_BIN ?? DEFAULT_CONFIG.claudeBin;
  const dbPath = values.db ?? env.CCAPI_DB ?? DEFAULT_CONFIG.dbPath;
  const detachedCwdBase = resolveDetachedCwdBase(present, value, env);

  return { port, host, claudeBin, dbPath, detachedCwdBase };
}

function pickNumber(
  cli: string | undefined,
  envVal: string | undefined,
  fallback: number,
  name: string,
): number {
  const raw = cli ?? envVal;
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`Valore non valido per ${name}: "${raw}"`);
  }
  return n;
}
