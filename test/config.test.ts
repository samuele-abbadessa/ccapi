import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, resolveConfig } from "../src/config.js";

describe("resolveConfig", () => {
  it("usa i default senza flag né env", () => {
    expect(resolveConfig([], {})).toEqual(DEFAULT_CONFIG);
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
