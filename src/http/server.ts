import Fastify, { type FastifyInstance } from "fastify";
import type { Orchestrator } from "../orchestrator/orchestrator.js";
import type { Repository } from "../registry/repository.js";
import { registerMessageRoutes } from "./routes/messages.js";
import { registerSessionRoutes } from "./routes/sessions.js";

export interface ServerDeps {
  repo: Repository;
  orchestrator: Orchestrator;
  detachedCwdBase: string | null;
  defaultCwd: string;
  now?: () => number;
}

export function buildServer(deps: ServerDeps): FastifyInstance {
  const app = Fastify({ logger: true });
  const now = deps.now ?? (() => Date.now());

  app.get("/health", async () => ({ status: "ok" }));

  registerSessionRoutes(app, {
    repo: deps.repo,
    orchestrator: deps.orchestrator,
    now,
    detachedCwdBase: deps.detachedCwdBase,
    defaultCwd: deps.defaultCwd,
  });
  registerMessageRoutes(app, {
    repo: deps.repo,
    orchestrator: deps.orchestrator,
    now,
    defaultCwd: deps.defaultCwd,
  });

  return app;
}
