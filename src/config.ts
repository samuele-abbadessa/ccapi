import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { parseArgs } from "node:util";

export interface Config {
  port: number;
  host: string;
  claudeBin: string;
  /** Directory base di ccapi (path assoluto): contiene il db e gli eventuali file di stato. */
  dataDir: string;
  /** Path assoluto del database SQLite. */
  dbPath: string;
  /** Radice consentita per le cwd di sessione (path assoluto), oppure null se la feature è disabilitata. */
  detachedCwdBase: string | null;
}

/** Default non risolti (prima dell'espansione di `~` e della risoluzione assoluta). */
export const DEFAULTS = {
  port: 4096,
  host: "127.0.0.1",
  claudeBin: "claude",
  dataDir: "~/.ccapi",
  dbFilename: "ccapi.db",
} as const;

/** Espande un eventuale `~`/`~/…` iniziale nella home dell'utente. */
function expandHome(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/") || p.startsWith("~\\")) return join(homedir(), p.slice(2));
  return p;
}

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

/** Risolve il path del db. `--db` assoluto è usato così com'è; se relativo è risolto su dataDir. */
function resolveDbPath(raw: string | undefined, dataDir: string): string {
  if (raw === undefined) return join(dataDir, DEFAULTS.dbFilename);
  const expanded = expandHome(raw);
  return isAbsolute(expanded) ? expanded : resolve(dataDir, expanded);
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
      "data-dir": { type: "string" },
      db: { type: "string" },
    },
    allowPositionals: false,
    strict: true,
  });

  const port = pickNumber(values.port, env.CCAPI_PORT, DEFAULTS.port, "port");
  const host = values.host ?? env.CCAPI_HOST ?? DEFAULTS.host;
  const claudeBin = values["claude-bin"] ?? env.CCAPI_CLAUDE_BIN ?? DEFAULTS.claudeBin;
  const dataDir = resolve(expandHome(values["data-dir"] ?? env.CCAPI_DATA_DIR ?? DEFAULTS.dataDir));
  const dbPath = resolveDbPath(values.db ?? env.CCAPI_DB, dataDir);
  const detachedCwdBase = resolveDetachedCwdBase(present, value, env);

  return { port, host, claudeBin, dataDir, dbPath, detachedCwdBase };
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
