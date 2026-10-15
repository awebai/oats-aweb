// The health publisher is opt-in: the provider's other commands and hooks do
// not load it, so nothing of it can break a deployment that never enables it.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CAPABILITY = new URL("../oats-package/capabilities/oats-aweb", import.meta.url).pathname;

test("another command runs unchanged when the health modules cannot load", () => {
  const dir = mkdtempSync(join(tmpdir(), "aweb-health-isolation-"));
  try {
    cpSync(CAPABILITY, join(dir, "oats-aweb"), { recursive: true });
    rmSync(join(dir, "oats-aweb", "phrases"), { recursive: true });
    const r = spawnSync(process.execPath, [join(dir, "oats-aweb", "bin", "oats-aweb.mjs"), "invite", "--help"], { cwd: dir, encoding: "utf8", env: { PATH: process.env.PATH, HOME: dir } });
    assert.match(r.stderr + r.stdout, /^E_INVITE_ARGUMENT: usage: oats aweb invite/, r.stderr);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
