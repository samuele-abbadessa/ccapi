import { beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "../src/registry/db.js";
import { Repository } from "../src/registry/repository.js";

describe("Repository", () => {
  let repo: Repository;

  beforeEach(() => {
    repo = new Repository(openDatabase(":memory:"));
  });

  it("crea e recupera una sessione", () => {
    const s = repo.createSession("titolo", "/tmp/work", 1000);
    expect(repo.getSession(s.id)).toEqual(s);
    expect(s.cwd).toBe("/tmp/work");
  });

  it("aggiunge messaggi e li lista in ordine cronologico", () => {
    const s = repo.createSession(null, null, 1000);
    repo.addMessage(
      { sessionId: s.id, role: "user", parts: [{ type: "text", text: "ciao" }] },
      1001,
    );
    repo.addMessage(
      {
        sessionId: s.id,
        role: "assistant",
        parts: [{ type: "text", text: "risposta" }],
        status: "completed",
        model: "opus",
        usage: { inputTokens: 10, outputTokens: 5 },
      },
      1002,
    );
    const msgs = repo.listMessages(s.id);
    expect(msgs).toHaveLength(2);
    expect(msgs[0]?.role).toBe("user");
    expect(msgs[1]?.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
  });

  it("isStarted/markStarted tracciano l'avvio della sessione", () => {
    const s = repo.createSession(null, null, 1000);
    expect(repo.isStarted(s.id)).toBe(false);
    repo.markStarted(s.id);
    expect(repo.isStarted(s.id)).toBe(true);
  });

  it("persiste cwd null per sessioni senza working directory", () => {
    const s = repo.createSession(null, null, 1000);
    expect(repo.getSession(s.id)?.cwd).toBeNull();
  });

  it("listSessions ordina per updated_at DESC (più recenti attive prima)", () => {
    const a = repo.createSession("A", null, 1000);
    const b = repo.createSession("B", null, 2000);
    // A creata prima, ma viene "toccata" dopo B → deve risultare prima
    repo.touchSession(a.id, 3000);
    const list = repo.listSessions();
    expect(list[0]?.id).toBe(a.id);
    expect(list[1]?.id).toBe(b.id);
  });

  it("elimina una sessione e i suoi messaggi (cascade)", () => {
    const s = repo.createSession(null, null, 1000);
    repo.addMessage({ sessionId: s.id, role: "user", parts: [{ type: "text", text: "x" }] }, 1001);
    expect(repo.deleteSession(s.id)).toBe(true);
    expect(repo.getSession(s.id)).toBeUndefined();
    expect(repo.listMessages(s.id)).toHaveLength(0);
  });
});
