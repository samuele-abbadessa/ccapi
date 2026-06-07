import { realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

export type CwdResolution =
  | { ok: true; path: string }
  | { ok: false; code: "invalid_cwd" | "cwd_outside_base" };

/**
 * Risolve e valida la cwd richiesta per una sessione rispetto alla radice `base`.
 * Requisiti: la directory deve esistere ed essere contenuta in `base`
 * (anti-traversal via realpath, neutralizza `..` e symlink). Ritorna il realpath assoluto.
 */
export function resolveSessionCwd(base: string, requested: string): CwdResolution {
  const resolved = resolve(base, requested);
  let realResolved: string;
  let realBase: string;
  try {
    realResolved = realpathSync(resolved);
    realBase = realpathSync(base);
  } catch {
    return { ok: false, code: "invalid_cwd" };
  }
  try {
    if (!statSync(realResolved).isDirectory()) {
      return { ok: false, code: "invalid_cwd" };
    }
  } catch {
    return { ok: false, code: "invalid_cwd" };
  }
  const rel = relative(realBase, realResolved);
  if (rel === "") return { ok: true, path: realResolved }; // la base stessa
  if (rel.startsWith("..") || isAbsolute(rel)) {
    return { ok: false, code: "cwd_outside_base" };
  }
  return { ok: true, path: realResolved };
}

/**
 * Valida la radice consentita all'avvio del server: deve esistere ed essere una directory.
 * Ritorna il realpath assoluto. Lancia un Error (fail-fast) se non valida.
 */
export function assertBaseDir(base: string): string {
  let real: string;
  try {
    real = realpathSync(base);
  } catch {
    throw new Error(`--detached-cwd: la radice "${base}" non esiste`);
  }
  if (!statSync(real).isDirectory()) {
    throw new Error(`--detached-cwd: la radice "${base}" non è una directory`);
  }
  if (real === "/") {
    throw new Error(`--detached-cwd: la radice "/" non è ammessa (disattiverebbe la sandbox)`);
  }
  return real;
}
