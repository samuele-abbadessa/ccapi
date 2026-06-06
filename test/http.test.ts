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
    const orchestrator = new Orchestrator({ claudeBin: FAKE_CLAUDE, cwd: process.cwd() });
    app = buildServer({ repo, orchestrator, now: () => 1000 });
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
