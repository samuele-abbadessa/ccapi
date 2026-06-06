import { parseArgs } from "node:util";

export interface Config {
  port: number;
  host: string;
  claudeBin: string;
  dbPath: string;
}

export const DEFAULT_CONFIG: Config = {
  port: 4096,
  host: "127.0.0.1",
  claudeBin: "claude",
  dbPath: ".ccapi/ccapi.db",
};

/**
 * Risolve la configurazione con precedenza: CLI flag > env > default.
 * @param argv argomenti (default: process.argv.slice(2))
 * @param env  ambiente (default: process.env)
 */
export function resolveConfig(
  argv: string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
): Config {
  const { values } = parseArgs({
    args: argv,
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

  return { port, host, claudeBin, dbPath };
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
