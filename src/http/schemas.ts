import { z } from "zod";
import type { Message } from "../types.js";

export const createSessionSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  cwd: z.string().min(1).optional(),
});

export const updateSessionSchema = z.object({
  title: z.string().min(1).max(200).nullable(),
});

export const messageSchema = z
  .object({
    prompt: z.string().min(1),
    model: z.string().min(1).optional(),
    effort: z.enum(["low", "medium", "high", "xhigh", "max"]).optional(),
    outputFormat: z.enum(["text", "json"]).optional(),
    jsonSchema: z.unknown().optional(),
  })
  .refine((v) => v.jsonSchema === undefined || v.outputFormat === "json", {
    message: "jsonSchema è valido solo con outputFormat: 'json'",
    path: ["jsonSchema"],
  });

/** Limite STDIN della CLI (10 MB). */
export const MAX_PROMPT_BYTES = 10 * 1024 * 1024;

/** Serializza la parte `info` della response di un messaggio. */
export function messageInfo(m: Message): Record<string, unknown> {
  return {
    id: m.id,
    sessionId: m.sessionId,
    role: m.role,
    status: m.status,
    model: m.model,
    costUsd: m.costUsd,
    usage: m.usage,
    error: m.error,
    createdAt: m.createdAt,
  };
}
