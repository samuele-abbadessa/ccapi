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
