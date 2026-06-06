import type { FastifyInstance } from "fastify";
import type { Orchestrator } from "../../orchestrator/orchestrator.js";
import type { Repository } from "../../registry/repository.js";
import type { Session } from "../../types.js";
import { createSessionSchema, updateSessionSchema } from "../schemas.js";

interface Deps {
  repo: Repository;
  orchestrator: Orchestrator;
  now: () => number;
}

function sessionView(s: Session, busy: boolean): Record<string, unknown> {
  return {
    id: s.id,
    title: s.title,
    status: busy ? "busy" : "idle",
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}

export function registerSessionRoutes(app: FastifyInstance, deps: Deps): void {
  const { repo, orchestrator, now } = deps;

  app.post("/sessions", async (req, reply) => {
    const parsed = createSessionSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: { code: "invalid_body", message: parsed.error.message } });
    }
    const session = repo.createSession(parsed.data.title ?? null, now());
    return reply.code(201).send(sessionView(session, false));
  });

  app.get("/sessions", async () => {
    return repo.listSessions().map((s) => sessionView(s, orchestrator.isBusy(s.id)));
  });

  app.get<{ Params: { id: string } }>("/sessions/:id", async (req, reply) => {
    const session = repo.getSession(req.params.id);
    if (!session) {
      return reply
        .code(404)
        .send({ error: { code: "not_found", message: "Sessione inesistente" } });
    }
    return sessionView(session, orchestrator.isBusy(session.id));
  });

  app.patch<{ Params: { id: string } }>("/sessions/:id", async (req, reply) => {
    const parsed = updateSessionSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: { code: "invalid_body", message: parsed.error.message } });
    }
    const updated = repo.updateSessionTitle(req.params.id, parsed.data.title, now());
    if (!updated) {
      return reply
        .code(404)
        .send({ error: { code: "not_found", message: "Sessione inesistente" } });
    }
    return sessionView(updated, orchestrator.isBusy(updated.id));
  });

  app.delete<{ Params: { id: string } }>("/sessions/:id", async (req, reply) => {
    const deleted = repo.deleteSession(req.params.id);
    if (!deleted) {
      return reply
        .code(404)
        .send({ error: { code: "not_found", message: "Sessione inesistente" } });
    }
    return reply.code(204).send();
  });

  app.post<{ Params: { id: string } }>("/sessions/:id/abort", async (req, reply) => {
    const session = repo.getSession(req.params.id);
    if (!session) {
      return reply
        .code(404)
        .send({ error: { code: "not_found", message: "Sessione inesistente" } });
    }
    orchestrator.abort(session.id);
    return { id: session.id, status: "idle" };
  });
}
