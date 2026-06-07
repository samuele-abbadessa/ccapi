import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildArgs, parseOutput } from "../src/orchestrator/claude.js";
import { AbortedError } from "../src/orchestrator/errors.js";
import { Orchestrator } from "../src/orchestrator/orchestrator.js";

const FAKE_CLAUDE = fileURLToPath(new URL("./fixtures/fake-claude.sh", import.meta.url));
const SLOW_CLAUDE = fileURLToPath(new URL("./fixtures/slow-claude.sh", import.meta.url));
const ECHO_ARGS = fileURLToPath(new URL("./fixtures/echo-args.sh", import.meta.url));
const ECHO_CWD = fileURLToPath(new URL("./fixtures/echo-cwd.sh", import.meta.url));
const SLEEP_CLAUDE = fileURLToPath(new URL("./fixtures/sleep-claude.sh", import.meta.url));

describe("buildArgs", () => {
  it("include session-id e flag opzionali", () => {
    const args = buildArgs(
      "sess-1",
      {
        prompt: "x",
        model: "opus",
        effort: "high",
        outputFormat: "json",
        jsonSchema: { type: "object" },
      },
      false,
    );
    expect(args).toEqual([
      "-p",
      "--session-id",
      "sess-1",
      "--model",
      "opus",
      "--effort",
      "high",
      "--output-format",
      "json",
      "--json-schema",
      '{"type":"object"}',
    ]);
  });

  it("omette i flag non forniti", () => {
    expect(buildArgs("s", { prompt: "x" }, false)).toEqual(["-p", "--session-id", "s"]);
  });

  it("usa --resume quando resume=true", () => {
    expect(buildArgs("s", { prompt: "x" }, true)).toEqual(["-p", "--resume", "s"]);
  });
});

describe("parseOutput", () => {
  it("text mode: ritorna una part text", () => {
    const r = parseOutput("  ciao  ", { prompt: "x" });
    expect(r.parts).toEqual([{ type: "text", text: "ciao" }]);
  });

  it("json mode: estrae structured_output, model, cost, usage", () => {
    const stdout = JSON.stringify({
      result: "ignored",
      structured_output: { ok: true },
      model: "claude-opus-4-8",
      total_cost_usd: 0.01,
      usage: { input_tokens: 100, output_tokens: 20 },
    });
    const r = parseOutput(stdout, { prompt: "x", outputFormat: "json" });
    expect(r.parts).toEqual([{ type: "structured", data: { ok: true } }]);
    expect(r.model).toBe("claude-opus-4-8");
    expect(r.costUsd).toBe(0.01);
    expect(r.usage).toEqual({ inputTokens: 100, outputTokens: 20 });
  });

  it("json mode senza structured_output: usa result come text", () => {
    const r = parseOutput(JSON.stringify({ result: "risposta" }), {
      prompt: "x",
      outputFormat: "json",
    });
    expect(r.parts).toEqual([{ type: "text", text: "risposta" }]);
  });
});

describe("Orchestrator serializzazione", () => {
  it("usa il fixture fake-claude e serializza due messaggi sulla stessa sessione", async () => {
    // fake-claude.sh ignora gli argomenti, ecoa stdin, exit 0.
    const started = new Set<string>();
    const orch = new Orchestrator({
      claudeBin: FAKE_CLAUDE,
      isStarted: (id) => started.has(id),
      markStarted: (id) => started.add(id),
    });
    const [a, b] = await Promise.all([
      orch.submit("s1", { prompt: "primo" }, process.cwd()),
      orch.submit("s1", { prompt: "secondo" }, process.cwd()),
    ]);
    expect(a.parts).toEqual([{ type: "text", text: "primo" }]);
    expect(b.parts).toEqual([{ type: "text", text: "secondo" }]);
    expect(orch.isBusy("s1")).toBe(false);
  });
});

describe("Orchestrator abort", () => {
  it("abort del messaggio in corso lo rigetta con AbortedError", async () => {
    // slow-claude resta vivo ~2s: c'è tempo di chiamare abort mentre è attivo.
    const started = new Set<string>();
    const orch = new Orchestrator({
      claudeBin: SLOW_CLAUDE,
      isStarted: (id) => started.has(id),
      markStarted: (id) => started.add(id),
    });
    const pending = orch.submit("s1", { prompt: "x" }, process.cwd());
    // Attacca subito l'handler di rejection (evita unhandled rejection).
    const assertion = expect(pending).rejects.toBeInstanceOf(AbortedError);
    // Lascia partire il processo, poi interrompi.
    await new Promise((r) => setTimeout(r, 150));
    expect(orch.isBusy("s1")).toBe(true);
    orch.abort("s1");
    await assertion;
    expect(orch.isBusy("s1")).toBe(false);
  });

  it("abort rigetta con AbortedError anche i messaggi in coda", async () => {
    const started = new Set<string>();
    const orch = new Orchestrator({
      claudeBin: SLOW_CLAUDE,
      isStarted: (id) => started.has(id),
      markStarted: (id) => started.add(id),
    });
    const first = orch.submit("s1", { prompt: "primo" }, process.cwd());
    const queued = orch.submit("s1", { prompt: "secondo" }, process.cwd());
    // Attacca subito gli handler: abort rigetta la coda in modo sincrono.
    const assertions = Promise.all([
      expect(first).rejects.toBeInstanceOf(AbortedError),
      expect(queued).rejects.toBeInstanceOf(AbortedError),
    ]);
    await new Promise((r) => setTimeout(r, 150));
    orch.abort("s1");
    await assertions;
  });
});

describe("Orchestrator resume", () => {
  it("prima invocazione usa --session-id, la successiva --resume", async () => {
    const started = new Set<string>();
    const orch = new Orchestrator({
      claudeBin: ECHO_ARGS,
      isStarted: (id) => started.has(id),
      markStarted: (id) => started.add(id),
    });
    const r1 = await orch.submit("s1", { prompt: "x" }, process.cwd());
    expect((r1.parts[0] as { text: string }).text).toContain("--session-id");
    const r2 = await orch.submit("s1", { prompt: "x" }, process.cwd());
    expect((r2.parts[0] as { text: string }).text).toContain("--resume");
  });
});

describe("Orchestrator cwd", () => {
  it("spawna il processo nella cwd passata al submit", async () => {
    const started = new Set<string>();
    const orch = new Orchestrator({
      claudeBin: ECHO_CWD,
      isStarted: (id) => started.has(id),
      markStarted: (id) => started.add(id),
    });
    const r = await orch.submit("s1", { prompt: "x" }, "/tmp");
    expect((r.parts[0] as { text: string }).text).toBe("/tmp");
  });
});

describe("Orchestrator serializzazione temporale", () => {
  function makeOrch() {
    const started = new Set<string>();
    return new Orchestrator({
      claudeBin: SLEEP_CLAUDE,
      isStarted: (id) => started.has(id),
      markStarted: (id) => started.add(id),
    });
  }

  it("stessa sessione: due messaggi sono serializzati (durata ≈ somma)", async () => {
    const orch = makeOrch();
    const t0 = Date.now();
    await Promise.all([
      orch.submit("s1", { prompt: "a" }, process.cwd()),
      orch.submit("s1", { prompt: "b" }, process.cwd()),
    ]);
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeGreaterThan(700); // ~0.4s * 2 serializzati, con margine
  });

  it("sessioni diverse: due messaggi girano in parallelo (durata ≈ singolo)", async () => {
    const orch = makeOrch();
    const t0 = Date.now();
    await Promise.all([
      orch.submit("sa", { prompt: "a" }, process.cwd()),
      orch.submit("sb", { prompt: "b" }, process.cwd()),
    ]);
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeLessThan(700); // ~0.4s in parallelo, non sommato
  });
});
