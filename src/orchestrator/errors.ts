/** Il processo `claude -p` è terminato con exit code ≠ 0. */
export class ProcessError extends Error {
  constructor(
    readonly exitCode: number | null,
    readonly stderr: string,
  ) {
    super(`claude terminato con exit code ${exitCode}: ${stderr.trim() || "(nessun stderr)"}`);
    this.name = "ProcessError";
  }
}

/** L'elaborazione è stata interrotta da un abort dell'utente. */
export class AbortedError extends Error {
  constructor() {
    super("Elaborazione interrotta (abort)");
    this.name = "AbortedError";
  }
}
