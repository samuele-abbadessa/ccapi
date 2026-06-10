import { z } from "zod";
import type { Message } from "../types.js";

export const createSessionSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  cwd: z.string().min(1).optional(),
  // Valori arbitrari: vengono coerciati a stringa dopo il parse (vedi coerceEnvVars).
  envVars: z.record(z.string(), z.unknown()).optional(),
});

/** Coerce un singolo valore di env var a stringa (l'ambiente di un processo richiede stringhe). */
export function coerceEnvValue(v: unknown): string {
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.join();
  if (v !== null && typeof v === "object") {
    return Object.entries(v)
      .map((e) => e.join(";"))
      .join();
  }
  return String(v);
}

/** Coerce tutti i valori di un record di env var a stringa, preservando le chiavi. */
export function coerceEnvVars(raw: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) out[k] = coerceEnvValue(v);
  return out;
}

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
