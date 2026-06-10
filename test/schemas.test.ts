import { describe, expect, it } from "vitest";
import { coerceEnvValue, coerceEnvVars } from "../src/http/schemas.js";

describe("coerceEnvValue", () => {
  it("lascia invariata una stringa", () => {
    expect(coerceEnvValue("ciao")).toBe("ciao");
  });

  it("coercia number e boolean con String()", () => {
    expect(coerceEnvValue(42)).toBe("42");
    expect(coerceEnvValue(true)).toBe("true");
    expect(coerceEnvValue(null)).toBe("null");
    expect(coerceEnvValue(undefined)).toBe("undefined");
  });

  it("coercia un array con join virgola", () => {
    expect(coerceEnvValue([1, 2, 3])).toBe("1,2,3");
  });

  it("coercia un oggetto con entries 'k;v' separate da virgola", () => {
    expect(coerceEnvValue({ a: 1, b: 2 })).toBe("a;1,b;2");
  });
});

describe("coerceEnvVars", () => {
  it("coercia tutti i valori preservando le chiavi", () => {
    expect(coerceEnvVars({ s: "x", n: 7, arr: [1, 2], obj: { a: 1 } })).toEqual({
      s: "x",
      n: "7",
      arr: "1,2",
      obj: "a;1",
    });
  });
});
