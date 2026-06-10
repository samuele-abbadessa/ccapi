import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildServer } from "../src/http/server.js";
import { AbortedError, ProcessError } from "../src/orchestrator/errors.js";
import { Orchestrator } from "../src/orchestrator/orchestrator.js";
import { openDatabase } from "../src/registry/db.js";
import { Repository } from "../src/registry/repository.js";

const FAKE_CLAUDE = fileURLToPath(new URL("./fixtures/fake-claude.sh", import.meta.url));

describe("HTTP API", () => {
  let app: FastifyInstance;
  let repo: Repository;

  beforeEach(async () => {
    repo = new Repository(openDatabase(":memory:"));
    // fixture fake-claude: riemette il prompt da stdin (vedi test orchestrator).
    const orchestrator = new Orchestrator({
      claudeBin: FAKE_CLAUDE,
      isStarted: (id) => repo.isStarted(id),
      markStarted: (id) => repo.markStarted(id),
    });
    app = buildServer({
      repo,
      orchestrator,
      now: () => 1000,
      detachedCwdBase: null,
      defaultCwd: process.cwd(),
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it("crea una sessione", async () => {
    const res = await app.inject({ method: "POST", url: "/sessions", payload: { title: "t" } });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ title: "t", status: "idle" });
  });

  it("crea una sessione con envVars coerciati e li espone in round-trip", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/sessions",
      payload: { envVars: { A: "x", N: 7, ARR: [1, 2, 3], OBJ: { a: 1, b: 2 } } },
    });
    expect(res.statusCode).toBe(201);
    const coerced = { A: "x", N: "7", ARR: "1,2,3", OBJ: "a;1,b;2" };
    expect(res.json().envVars).toEqual(coerced);
    // Persistenza + round-trip JSON: GET espone gli stessi envVars coerciati.
    const id = res.json().id as string;
    const got = await app.inject({ method: "GET", url: `/sessions/${id}` });
    expect(got.json().envVars).toEqual(coerced);
  });

  it("sessione senza envVars espone envVars null", async () => {
    const res = await app.inject({ method: "POST", url: "/sessions", payload: {} });
    expect(res.statusCode).toBe(201);
    expect(res.json().envVars).toBeNull();
  });

  it("404 su sessione inesistente", async () => {
    const res = await app.inject({ method: "GET", url: "/sessions/nope" });
    expect(res.statusCode).toBe(404);
  });

  it("invia un messaggio ed eco del prompt", async () => {
    const created = await app.inject({ method: "POST", url: "/sessions", payload: {} });
    const id = created.json().id as string;
    const res = await app.inject({
      method: "POST",
      url: `/sessions/${id}/messages`,
      payload: { prompt: "ciao mondo" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().parts).toEqual([{ type: "text", text: "ciao mondo" }]);
    const list = await app.inject({ method: "GET", url: `/sessions/${id}/messages` });
    expect(list.json()).toHaveLength(2);
  });

  it("400 se jsonSchema senza outputFormat json", async () => {
    const created = await app.inject({ method: "POST", url: "/sessions", payload: {} });
    const id = created.json().id as string;
    const res = await app.inject({
      method: "POST",
      url: `/sessions/${id}/messages`,
      payload: { prompt: "x", jsonSchema: { type: "object" } },
    });
    expect(res.statusCode).toBe(400);
  });
});

function buildAppWithBase(base: string): { app: FastifyInstance; repo: Repository } {
  const r = new Repository(openDatabase(":memory:"));
  const orchestrator = new Orchestrator({
    claudeBin: FAKE_CLAUDE,
    isStarted: (id) => r.isStarted(id),
    markStarted: (id) => r.markStarted(id),
  });
  const a = buildServer({
    repo: r,
    orchestrator,
    now: () => 1000,
    detachedCwdBase: base,
    defaultCwd: process.cwd(),
  });
  return { app: a, repo: r };
}

describe("HTTP API — detached cwd", () => {
  let app: FastifyInstance;
  let repo: Repository;

  beforeEach(async () => {
    repo = new Repository(openDatabase(":memory:"));
    const orchestrator = new Orchestrator({
      claudeBin: FAKE_CLAUDE,
      isStarted: (id) => repo.isStarted(id),
      markStarted: (id) => repo.markStarted(id),
    });
    app = buildServer({
      repo,
      orchestrator,
      now: () => 1000,
      detachedCwdBase: null,
      defaultCwd: process.cwd(),
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  const base = realpathSync(process.cwd());

  it("feature spenta + cwd nel body → 400 detached_cwd_disabled", async () => {
    const res = await app.inject({ method: "POST", url: "/sessions", payload: { cwd: "src" } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("detached_cwd_disabled");
  });

  it("feature accesa + cwd valida dentro base → 201 con cwd risolta", async () => {
    const { app: a } = buildAppWithBase(base);
    await a.ready();
    const res = await a.inject({ method: "POST", url: "/sessions", payload: { cwd: "src" } });
    expect(res.statusCode).toBe(201);
    expect(res.json().cwd).toBe(realpathSync(`${base}/src`));
    await a.close();
  });

  it("feature accesa senza cwd → usa la base", async () => {
    const { app: a } = buildAppWithBase(base);
    await a.ready();
    const res = await a.inject({ method: "POST", url: "/sessions", payload: {} });
    expect(res.statusCode).toBe(201);
    expect(res.json().cwd).toBe(base);
    await a.close();
  });

  it("feature accesa + cwd inesistente → 400 invalid_cwd", async () => {
    const { app: a } = buildAppWithBase(base);
    await a.ready();
    const res = await a.inject({
      method: "POST",
      url: "/sessions",
      payload: { cwd: "cartella-che-non-esiste-xyz" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("invalid_cwd");
    await a.close();
  });

  it("feature accesa + cwd fuori base (..) → 400 cwd_outside_base", async () => {
    const { app: a } = buildAppWithBase(base);
    await a.ready();
    const res = await a.inject({ method: "POST", url: "/sessions", payload: { cwd: ".." } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("cwd_outside_base");
    await a.close();
  });
});

describe("HTTP API — edge cases", () => {
  let app: FastifyInstance;
  let repo: Repository;

  beforeEach(async () => {
    repo = new Repository(openDatabase(":memory:"));
    const orchestrator = new Orchestrator({
      claudeBin: FAKE_CLAUDE,
      isStarted: (id) => repo.isStarted(id),
      markStarted: (id) => repo.markStarted(id),
    });
    app = buildServer({
      repo,
      orchestrator,
      now: () => 1000,
      detachedCwdBase: null,
      defaultCwd: process.cwd(),
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  // Costruisce un'app con un orchestrator fasullo che rigetta col dato errore.
  function buildAppRejecting(err: Error): { app: FastifyInstance; repo: Repository } {
    const r = new Repository(openDatabase(":memory:"));
    const orchestrator = {
      submit: () => Promise.reject(err),
      isBusy: () => false,
      abort: () => {},
      shutdown: () => {},
    } as unknown as Orchestrator;
    const a = buildServer({
      repo: r,
      orchestrator,
      now: () => 1000,
      detachedCwdBase: null,
      defaultCwd: process.cwd(),
    });
    return { app: a, repo: r };
  }

  it("PATCH su sessione inesistente → 404", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/sessions/non-esiste",
      payload: { title: "x" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("GET messaggio di un'altra sessione → 404 (cross-session)", async () => {
    const s1 = (await app.inject({ method: "POST", url: "/sessions", payload: {} })).json();
    const s2 = (await app.inject({ method: "POST", url: "/sessions", payload: {} })).json();
    // crea un messaggio in s1 inviandone uno (FAKE_CLAUDE ecoa)
    await app.inject({
      method: "POST",
      url: `/sessions/${s1.id}/messages`,
      payload: { prompt: "ciao" },
    });
    const msgs = (await app.inject({ method: "GET", url: `/sessions/${s1.id}/messages` })).json();
    const msgId = msgs[0].info.id as string;
    // stesso msgId ma sotto s2 → 404
    const res = await app.inject({ method: "GET", url: `/sessions/${s2.id}/messages/${msgId}` });
    expect(res.statusCode).toBe(404);
  });

  it("prompt oltre 10 MB → 400 prompt_too_large", async () => {
    const s = (await app.inject({ method: "POST", url: "/sessions", payload: {} })).json();
    const bigPrompt = "a".repeat(10 * 1024 * 1024 + 1);
    const res = await app.inject({
      method: "POST",
      url: `/sessions/${s.id}/messages`,
      payload: { prompt: bigPrompt },
    });
    // Il bodyLimit (10 MB + 1 MB margine) lascia passare il body al route handler,
    // che valida il prompt con MAX_PROMPT_BYTES e risponde 400 prompt_too_large.
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("prompt_too_large");
  });

  it("abort durante un messaggio → 409 aborted + assistant 'aborted' persistito", async () => {
    const { app: a, repo: r } = buildAppRejecting(new AbortedError());
    await a.ready();
    const s = (await a.inject({ method: "POST", url: "/sessions", payload: {} })).json();
    const res = await a.inject({
      method: "POST",
      url: `/sessions/${s.id}/messages`,
      payload: { prompt: "x" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("aborted");
    const msgs = r.listMessages(s.id);
    expect(msgs.at(-1)?.status).toBe("aborted");
    await a.close();
  });

  it("errore processo claude → 502 + assistant 'failed'", async () => {
    const { app: a, repo: r } = buildAppRejecting(new ProcessError(1, "boom"));
    await a.ready();
    const s = (await a.inject({ method: "POST", url: "/sessions", payload: {} })).json();
    const res = await a.inject({
      method: "POST",
      url: `/sessions/${s.id}/messages`,
      payload: { prompt: "x" },
    });
    expect(res.statusCode).toBe(502);
    expect(res.json().error.code).toBe("process_error");
    expect(r.listMessages(s.id).at(-1)?.status).toBe("failed");
    await a.close();
  });

  it("errore inatteso → 500 + assistant 'failed' (no messaggio user orfano)", async () => {
    const { app: a, repo: r } = buildAppRejecting(new Error("boom inatteso"));
    await a.ready();
    const s = (await a.inject({ method: "POST", url: "/sessions", payload: {} })).json();
    const res = await a.inject({
      method: "POST",
      url: `/sessions/${s.id}/messages`,
      payload: { prompt: "x" },
    });
    expect(res.statusCode).toBe(500);
    const msgs = r.listMessages(s.id);
    // user + assistant(failed): la history NON resta con il solo user
    expect(msgs).toHaveLength(2);
    expect(msgs[0]?.role).toBe("user");
    expect(msgs[1]?.status).toBe("failed");
    await a.close();
  });
});
