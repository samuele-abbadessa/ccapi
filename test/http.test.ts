import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildServer } from "../src/http/server.js";
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
