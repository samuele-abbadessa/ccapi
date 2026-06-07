import Fastify, { type FastifyInstance } from "fastify";
import type { Orchestrator } from "../orchestrator/orchestrator.js";
import type { Repository } from "../registry/repository.js";
import { registerMessageRoutes } from "./routes/messages.js";
import { registerSessionRoutes } from "./routes/sessions.js";
import { MAX_PROMPT_BYTES } from "./schemas.js";

/**
 * Limite del body HTTP: il prompt può arrivare a MAX_PROMPT_BYTES (10 MB), più
 * 1 MB di margine per l'overhead del wrapper JSON. Così i prompt entro il limite
 * raggiungono il route handler (che valida con MAX_PROMPT_BYTES → 400), mentre
 * body oltre soglia vengono rifiutati da Fastify con 413.
 */
const BODY_LIMIT = MAX_PROMPT_BYTES + 1024 * 1024;

export interface ServerDeps {
  repo: Repository;
  orchestrator: Orchestrator;
  detachedCwdBase: string | null;
  defaultCwd: string;
  now?: () => number;
}

export function buildServer(deps: ServerDeps): FastifyInstance {
  const app = Fastify({ logger: true, bodyLimit: BODY_LIMIT });
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
