import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { Message, MessageRole, MessageStatus, Part, Session, TokenUsage } from "../types.js";

interface SessionRow {
  id: string;
  title: string | null;
  created_at: number;
  updated_at: number;
}

interface MessageRow {
  id: string;
  session_id: string;
  role: string;
  parts: string;
  status: string | null;
  model: string | null;
  cost_usd: number | null;
  usage: string | null;
  error: string | null;
  created_at: number;
}

export interface NewMessage {
  sessionId: string;
  role: MessageRole;
  parts: Part[];
  status?: MessageStatus | null;
  model?: string | null;
  costUsd?: number | null;
  usage?: TokenUsage | null;
  error?: string | null;
}

export class Repository {
  constructor(private readonly db: Database.Database) {}

  // ---- Sessions ----

  createSession(title: string | null, now: number): Session {
    const id = randomUUID();
    this.db
      .prepare("INSERT INTO sessions (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)")
      .run(id, title, now, now);
    return { id, title, createdAt: now, updatedAt: now };
  }

  getSession(id: string): Session | undefined {
    const row = this.db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as
      | SessionRow
      | undefined;
    return row ? mapSession(row) : undefined;
  }

  listSessions(): Session[] {
    const rows = this.db
      .prepare("SELECT * FROM sessions ORDER BY created_at DESC")
      .all() as SessionRow[];
    return rows.map(mapSession);
  }

  updateSessionTitle(id: string, title: string | null, now: number): Session | undefined {
    const res = this.db
      .prepare("UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?")
      .run(title, now, id);
    return res.changes > 0 ? this.getSession(id) : undefined;
  }

  touchSession(id: string, now: number): void {
    this.db.prepare("UPDATE sessions SET updated_at = ? WHERE id = ?").run(now, id);
  }

  deleteSession(id: string): boolean {
    const res = this.db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
    return res.changes > 0;
  }

  // ---- Messages ----

  addMessage(msg: NewMessage, now: number): Message {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO messages
           (id, session_id, role, parts, status, model, cost_usd, usage, error, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        msg.sessionId,
        msg.role,
        JSON.stringify(msg.parts),
        msg.status ?? null,
        msg.model ?? null,
        msg.costUsd ?? null,
        msg.usage ? JSON.stringify(msg.usage) : null,
        msg.error ?? null,
        now,
      );
    const stored = this.getMessage(id);
    if (!stored) throw new Error("Inserimento messaggio fallito");
    return stored;
  }

  getMessage(id: string): Message | undefined {
    const row = this.db.prepare("SELECT * FROM messages WHERE id = ?").get(id) as
      | MessageRow
      | undefined;
    return row ? mapMessage(row) : undefined;
  }

  listMessages(sessionId: string): Message[] {
    const rows = this.db
      .prepare("SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC")
      .all(sessionId) as MessageRow[];
    return rows.map(mapMessage);
  }
}

function mapSession(row: SessionRow): Session {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapMessage(row: MessageRow): Message {
  return {
    id: row.id,
    sessionId: row.session_id,
    role: row.role as MessageRole,
    parts: JSON.parse(row.parts) as Part[],
    status: row.status as MessageStatus | null,
    model: row.model,
    costUsd: row.cost_usd,
    usage: row.usage ? (JSON.parse(row.usage) as TokenUsage) : null,
    error: row.error,
    createdAt: row.created_at,
  };
}
