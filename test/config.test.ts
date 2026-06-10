import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULTS, resolveConfig } from "../src/config.js";

describe("resolveConfig", () => {
  it("usa i default senza flag né env", () => {
    const cfg = resolveConfig([], {});
    expect(cfg.port).toBe(DEFAULTS.port);
    expect(cfg.host).toBe(DEFAULTS.host);
    expect(cfg.claudeBin).toBe(DEFAULTS.claudeBin);
    expect(cfg.dataDir).toBe(join(homedir(), ".ccapi"));
    expect(cfg.dbPath).toBe(join(homedir(), ".ccapi", "ccapi.db"));
    expect(cfg.detachedCwdBase).toBeNull();
  });

  it("env sovrascrive i default", () => {
    const cfg = resolveConfig([], { CCAPI_PORT: "5000", CCAPI_HOST: "0.0.0.0" });
    expect(cfg.port).toBe(5000);
    expect(cfg.host).toBe("0.0.0.0");
  });

  it("i flag CLI sovrascrivono env", () => {
    const cfg = resolveConfig(["--port", "6000"], { CCAPI_PORT: "5000" });
    expect(cfg.port).toBe(6000);
  });

  it("rifiuta una porta non valida", () => {
    expect(() => resolveConfig(["--port", "abc"], {})).toThrow();
  });
});

describe("resolveConfig — dataDir e dbPath", () => {
  it("default: dataDir = ~/.ccapi, dbPath = ~/.ccapi/ccapi.db", () => {
    const cfg = resolveConfig([], {});
    expect(cfg.dataDir).toBe(join(homedir(), ".ccapi"));
    expect(cfg.dbPath).toBe(join(homedir(), ".ccapi", "ccapi.db"));
  });

  it("--data-dir con path assoluto", () => {
    const cfg = resolveConfig(["--data-dir", "/tmp/dd"], {});
    expect(cfg.dataDir).toBe(resolve("/tmp/dd"));
    expect(cfg.dbPath).toBe(join(resolve("/tmp/dd"), "ccapi.db"));
  });

  it("CCAPI_DATA_DIR con espansione di ~", () => {
    const cfg = resolveConfig([], { CCAPI_DATA_DIR: "~/altro" });
    expect(cfg.dataDir).toBe(join(homedir(), "altro"));
    expect(cfg.dbPath).toBe(join(homedir(), "altro", "ccapi.db"));
  });

  it("il flag --data-dir ha precedenza sull'env", () => {
    const cfg = resolveConfig(["--data-dir", "/tmp/cli"], { CCAPI_DATA_DIR: "/tmp/env" });
    expect(cfg.dataDir).toBe(resolve("/tmp/cli"));
  });

  it("--db relativo è risolto sulla data dir", () => {
    const cfg = resolveConfig(["--data-dir", "/tmp/dd", "--db", "proj2.db"], {});
    expect(cfg.dbPath).toBe(join(resolve("/tmp/dd"), "proj2.db"));
  });

  it("--db assoluto è usato così com'è", () => {
    const cfg = resolveConfig(["--data-dir", "/tmp/dd", "--db", "/var/data/x.db"], {});
    expect(cfg.dbPath).toBe(resolve("/var/data/x.db"));
  });

  it("CCAPI_DB relativo è risolto sulla data dir", () => {
    const cfg = resolveConfig([], { CCAPI_DATA_DIR: "/tmp/dd", CCAPI_DB: "sub/p.db" });
    expect(cfg.dbPath).toBe(join(resolve("/tmp/dd"), "sub", "p.db"));
  });
});

describe("resolveConfig — detachedCwdBase", () => {
  it("null senza flag né env", () => {
    expect(resolveConfig([], {}).detachedCwdBase).toBeNull();
  });

  it("--detached-cwd con valore → path assoluto risolto", () => {
    expect(resolveConfig(["--detached-cwd", "/tmp/x"], {}).detachedCwdBase).toBe(resolve("/tmp/x"));
  });

  it("--detached-cwd=<val> → path assoluto risolto", () => {
    expect(resolveConfig(["--detached-cwd=/tmp/y"], {}).detachedCwdBase).toBe(resolve("/tmp/y"));
  });

  it("--detached-cwd senza valore → cwd del server", () => {
    expect(resolveConfig(["--detached-cwd"], {}).detachedCwdBase).toBe(resolve());
  });

  it("--detached-cwd seguito da un altro flag → senza valore", () => {
    const cfg = resolveConfig(["--detached-cwd", "--port", "5000"], {});
    expect(cfg.detachedCwdBase).toBe(resolve());
    expect(cfg.port).toBe(5000);
  });

  it("--detached-cwd= (vuoto) → cwd del server", () => {
    expect(resolveConfig(["--detached-cwd="], {}).detachedCwdBase).toBe(resolve());
  });

  it("env CCAPI_DETACHED_CWD con valore → path assoluto", () => {
    expect(resolveConfig([], { CCAPI_DETACHED_CWD: "/tmp/z" }).detachedCwdBase).toBe(
      resolve("/tmp/z"),
    );
  });

  it("env CCAPI_DETACHED_CWD vuota → cwd del server", () => {
    expect(resolveConfig([], { CCAPI_DETACHED_CWD: "" }).detachedCwdBase).toBe(resolve());
  });

  it("il flag CLI ha precedenza sull'env", () => {
    const cfg = resolveConfig(["--detached-cwd", "/tmp/cli"], { CCAPI_DETACHED_CWD: "/tmp/env" });
    expect(cfg.detachedCwdBase).toBe(resolve("/tmp/cli"));
  });
});
