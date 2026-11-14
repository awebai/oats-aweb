// Runs a second command of one home inside the first one's aw call: a wrapper `aw` in front
// of the fake that, once, after the call `at` matches (a JS expression over `a`, that call's
// argv) answers, runs the hook with `args` from the same home, then lets the first go on.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const HOOK = fileURLToPath(new URL("../../oats-package/capabilities/oats-aweb/bin/oats-aweb.mjs", import.meta.url));

/** → {path: the PATH for the first command, inner(): the second's {status, stdout, stderr}, or null if it never ran}. */
export function interleave(fx, { at, args }) {
  const bin = mkdtempSync(join(fx.ws, "interleave-")), result = join(bin, "inner.json");
  const fakeAw = join(fx.fake.path.split(":")[0], "aw");
  writeFileSync(join(bin, "aw"), `#!${process.execPath}
const fs = require("node:fs"), cp = require("node:child_process"), a = process.argv.slice(2);
const r = cp.spawnSync(${JSON.stringify(fakeAw)}, a, { stdio: "inherit" });
if (r.status === 0 && (${at}) && !fs.existsSync(${JSON.stringify(result)})) {
  fs.writeFileSync(${JSON.stringify(result)}, "null");
  const j = cp.spawnSync(${JSON.stringify(process.execPath)}, [${JSON.stringify(HOOK)}, ...${JSON.stringify(args)}], { cwd: process.cwd(), env: { ...process.env, PATH: ${JSON.stringify(fx.fake.path)} }, encoding: "utf8" });
  fs.writeFileSync(${JSON.stringify(result)}, JSON.stringify({ status: j.status, stdout: j.stdout, stderr: j.stderr }));
}
process.exit(r.status ?? 1);
`, { mode: 0o700 });
  return { path: `${bin}:${fx.fake.path}`, inner: () => { try { return JSON.parse(readFileSync(result, "utf8")); } catch { return null; } } };
}
