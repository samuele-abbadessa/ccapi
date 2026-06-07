import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assertBaseDir, resolveSessionCwd } from "../src/http/cwd.js";

let root: string;
let base: string;
let outside: string;

function mkdir(p: string): string {
  mkdirSync(p, { recursive: true });
  return p;
}

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "ccapi-cwd-")));
  base = mkdir(join(root, "base"));
  outside = mkdir(join(root, "outside"));
  mkdir(join(base, "sub"));
  // symlink dentro base che punta fuori da base
  symlinkSync(outside, join(base, "link-out"), "dir");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("resolveSessionCwd", () => {
  it("cwd relativa dentro base → ok", () => {
    const res = resolveSessionCwd(base, "sub");
    expect(res).toEqual({ ok: true, path: realpathSync(join(base, "sub")) });
  });

  it("cwd '.' (base stessa) → ok", () => {
    const res = resolveSessionCwd(base, ".");
    expect(res).toEqual({ ok: true, path: realpathSync(base) });
  });

  it("cwd assoluta dentro base → ok", () => {
    const abs = join(base, "sub");
    const res = resolveSessionCwd(base, abs);
    expect(res).toEqual({ ok: true, path: realpathSync(abs) });
  });

  it("cwd '..' (traversal) → cwd_outside_base", () => {
    expect(resolveSessionCwd(base, "..")).toEqual({ ok: false, code: "cwd_outside_base" });
  });

  it("cwd assoluta fuori base → cwd_outside_base", () => {
    expect(resolveSessionCwd(base, outside)).toEqual({ ok: false, code: "cwd_outside_base" });
  });

  it("symlink dentro base che punta fuori → cwd_outside_base", () => {
    expect(resolveSessionCwd(base, "link-out")).toEqual({ ok: false, code: "cwd_outside_base" });
  });

  it("cwd inesistente → invalid_cwd", () => {
    expect(resolveSessionCwd(base, "non-esiste")).toEqual({ ok: false, code: "invalid_cwd" });
  });

  it("cwd che è un file (non directory) → invalid_cwd", () => {
    writeFileSync(join(base, "file.txt"), "x");
    expect(resolveSessionCwd(base, "file.txt")).toEqual({ ok: false, code: "invalid_cwd" });
  });
});

describe("assertBaseDir", () => {
  it("directory esistente → ritorna il realpath", () => {
    expect(assertBaseDir(base)).toBe(realpathSync(base));
  });

  it("path inesistente → throw", () => {
    expect(() => assertBaseDir(join(root, "non-esiste"))).toThrow();
  });

  it("file (non directory) → throw", () => {
    const f = join(root, "f.txt");
    writeFileSync(f, "x");
    expect(() => assertBaseDir(f)).toThrow();
  });

  it("radice / → throw (sandbox disattivata)", () => {
    expect(() => assertBaseDir("/")).toThrow();
  });
});
