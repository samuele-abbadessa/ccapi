import type { FastifyInstance } from "fastify";
import type { Orchestrator } from "../../orchestrator/orchestrator.js";
import type { Repository } from "../../registry/repository.js";
import type { Session } from "../../types.js";
import { resolveSessionCwd } from "../cwd.js";
import { createSessionSchema, updateSessionSchema } from "../schemas.js";

interface Deps {
  repo: Repository;
  orchestrator: Orchestrator;
  now: () => number;
  detachedCwdBase: string | null;
  defaultCwd: string;
}

function sessionView(s: Session, busy: boolean): Record<string, unknown> {
  return {
    id: s.id,
    title: s.title,
    status: busy ? "busy" : "idle",
    cwd: s.cwd,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}

export function registerSessionRoutes(app: FastifyInstance, deps: Deps): void {
  const { repo, orchestrator, now, detachedCwdBase, defaultCwd } = deps;

  app.post("/sessions", async (req, reply) => {
    const parsed = createSessionSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: { code: "invalid_body", message: parsed.error.message } });
    }
    const { title, cwd } = parsed.data;

    let cwdToSave: string;
    if (detachedCwdBase === null) {
      if (cwd !== undefined) {
        return reply.code(400).send({
          error: {
            code: "detached_cwd_disabled",
            message: "La feature detached-cwd non è abilitata",
          },
        });
      }
      cwdToSave = defaultCwd;
    } else if (cwd === undefined) {
      cwdToSave = detachedCwdBase;
    } else {
      const res = resolveSessionCwd(detachedCwdBase, cwd);
      if (!res.ok) {
        const message =
          res.code === "invalid_cwd"
            ? "cwd inesistente o non è una directory"
            : "cwd fuori dalla radice consentita";
        return reply.code(400).send({ error: { code: res.code, message } });
      }
      cwdToSave = res.path;
    }

    const session = repo.createSession(title ?? null, cwdToSave, now());
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
