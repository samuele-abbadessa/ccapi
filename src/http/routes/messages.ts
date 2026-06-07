import type { FastifyInstance } from "fastify";
import { AbortedError, ProcessError } from "../../orchestrator/errors.js";
import type { Orchestrator } from "../../orchestrator/orchestrator.js";
import type { Repository } from "../../registry/repository.js";
import type { MessageOptions } from "../../types.js";
import { MAX_PROMPT_BYTES, messageInfo, messageSchema } from "../schemas.js";

interface Deps {
  repo: Repository;
  orchestrator: Orchestrator;
  now: () => number;
  defaultCwd: string;
}

export function registerMessageRoutes(app: FastifyInstance, deps: Deps): void {
  const { repo, orchestrator, now, defaultCwd } = deps;

  app.get<{ Params: { id: string } }>("/sessions/:id/messages", async (req, reply) => {
    if (!repo.getSession(req.params.id)) {
      return reply
        .code(404)
        .send({ error: { code: "not_found", message: "Sessione inesistente" } });
    }
    return repo.listMessages(req.params.id).map((m) => ({ info: messageInfo(m), parts: m.parts }));
  });

  app.get<{ Params: { id: string; msgId: string } }>(
    "/sessions/:id/messages/:msgId",
    async (req, reply) => {
      const msg = repo.getMessage(req.params.msgId);
      if (!msg || msg.sessionId !== req.params.id) {
        return reply
          .code(404)
          .send({ error: { code: "not_found", message: "Messaggio inesistente" } });
      }
      return { info: messageInfo(msg), parts: msg.parts };
    },
  );

  app.post<{ Params: { id: string } }>("/sessions/:id/messages", async (req, reply) => {
    const session = repo.getSession(req.params.id);
    if (!session) {
      return reply
        .code(404)
        .send({ error: { code: "not_found", message: "Sessione inesistente" } });
    }

    const parsed = messageSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: { code: "invalid_body", message: parsed.error.message } });
    }
    const body = parsed.data;

    if (Buffer.byteLength(body.prompt, "utf8") > MAX_PROMPT_BYTES) {
      return reply
        .code(400)
        .send({ error: { code: "prompt_too_large", message: "Prompt oltre il limite di 10 MB" } });
    }

    repo.addMessage(
      { sessionId: session.id, role: "user", parts: [{ type: "text", text: body.prompt }] },
      now(),
    );

    const options: MessageOptions = {
      prompt: body.prompt,
      model: body.model,
      effort: body.effort,
      outputFormat: body.outputFormat,
      jsonSchema: body.jsonSchema,
    };

    try {
      const cwd = session.cwd ?? defaultCwd;
      const result = await orchestrator.submit(session.id, options, cwd);
      const assistant = repo.addMessage(
        {
          sessionId: session.id,
          role: "assistant",
          parts: result.parts,
          status: "completed",
          model: result.model ?? null,
          costUsd: result.costUsd ?? null,
          usage: result.usage ?? null,
        },
        now(),
      );
      repo.touchSession(session.id, now());
      return { info: messageInfo(assistant), parts: assistant.parts };
    } catch (err) {
      if (err instanceof AbortedError) {
        repo.addMessage(
          {
            sessionId: session.id,
            role: "assistant",
            parts: [],
            status: "aborted",
            error: err.message,
          },
          now(),
        );
        return reply.code(409).send({ error: { code: "aborted", message: err.message } });
      }
      if (err instanceof ProcessError) {
        repo.addMessage(
          {
            sessionId: session.id,
            role: "assistant",
            parts: [],
            status: "failed",
            error: err.message,
          },
          now(),
        );
        return reply.code(502).send({ error: { code: "process_error", message: err.message } });
      }
      // Errore inatteso (né AbortedError né ProcessError): persisti comunque un
      // assistant 'failed' per non lasciare il messaggio user orfano.
      const message = err instanceof Error ? err.message : String(err);
      repo.addMessage(
        {
          sessionId: session.id,
          role: "assistant",
          parts: [],
          status: "failed",
          error: message,
        },
        now(),
      );
      return reply.code(500).send({ error: { code: "internal", message: "Errore interno" } });
    }
  });
}
