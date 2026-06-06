import { beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "../src/registry/db.js";
import { Repository } from "../src/registry/repository.js";

describe("Repository", () => {
  let repo: Repository;

  beforeEach(() => {
    repo = new Repository(openDatabase(":memory:"));
  });

  it("crea e recupera una sessione", () => {
    const s = repo.createSession("titolo", 1000);
    expect(repo.getSession(s.id)).toEqual(s);
  });

  it("aggiunge messaggi e li lista in ordine cronologico", () => {
    const s = repo.createSession(null, 1000);
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

  it("elimina una sessione e i suoi messaggi (cascade)", () => {
    const s = repo.createSession(null, 1000);
    repo.addMessage({ sessionId: s.id, role: "user", parts: [{ type: "text", text: "x" }] }, 1001);
    expect(repo.deleteSession(s.id)).toBe(true);
    expect(repo.getSession(s.id)).toBeUndefined();
    expect(repo.listMessages(s.id)).toHaveLength(0);
  });
});
