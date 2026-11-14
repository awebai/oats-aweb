// Runs a second command of one home inside the first one's aw call: a wrapper `aw` in front
// of the fake that, once, after the call `at` matches (a JS expression over `a`, that call's
// argv) answers, runs the hook with `args` from `cwd` (the aw call's own by default), its event
// `args[0]` and `env` added, then lets the first go on.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const HOOK = fileURLToPath(new URL("../../oats-package/capabilities/oats-aweb/bin/oats-aweb.mjs", import.meta.url));

/** → {path: the PATH for the first command, inner(): the second's {status, stdout, stderr}, or null if it never ran}. */
export function interleave(fx, { at, args, env = {}, cwd }) {
  const bin = mkdtempSync(join(fx.ws, "interleave-")), result = join(bin, "inner.json");
  const fakeAw = join(fx.fake.path.split(":")[0], "aw");
  writeFileSync(join(bin, "aw"), `#!${process.execPath}
const fs = require("node:fs"), cp = require("node:child_process"), a = process.argv.slice(2);
const r = cp.spawnSync(${JSON.stringify(fakeAw)}, a, { stdio: "inherit" });
if (r.status === 0 && (${at}) && !fs.existsSync(${JSON.stringify(result)})) {
  fs.writeFileSync(${JSON.stringify(result)}, "null");
  const j = cp.spawnSync(${JSON.stringify(process.execPath)}, [${JSON.stringify(HOOK)}, ...${JSON.stringify(args)}], { cwd: ${cwd ? JSON.stringify(cwd) : "process.cwd()"}, env: { ...process.env, PATH: ${JSON.stringify(fx.fake.path)}, OATS_EVENT: ${JSON.stringify(args[0])}, ...${JSON.stringify(env)} }, encoding: "utf8" });
  fs.writeFileSync(${JSON.stringify(result)}, JSON.stringify({ status: j.status, stdout: j.stdout, stderr: j.stderr }));
}
process.exit(r.status ?? 1);
`, { mode: 0o700 });
  return { path: `${bin}:${fx.fake.path}`, inner: () => { try { return JSON.parse(readFileSync(result, "utf8")); } catch { return null; } } };
}

/** interleave's twin at the fake kernel (an attribution fixture's): once, when `at` (a JS
 *  expression over the kernel's `args` and `isHome`) holds, the kernel runs the hook with `args`
 *  from `cwd`, `env` added, before it answers. Each later spawn of the kernel answers as before. */
export function interleaveKernel(fx, { at, args, env = {}, cwd }) {
  const result = join(mkdtempSync(join(fx.ws, "interleave-kernel-")), "inner.json");
  const hook = `if((${at})&&!fs.existsSync(${JSON.stringify(result)})){fs.writeFileSync(${JSON.stringify(result)},"null");const j=require("node:child_process").spawnSync(${JSON.stringify(process.execPath)},[${JSON.stringify(HOOK)},...${JSON.stringify(args)}],{cwd:${cwd ? JSON.stringify(cwd) : "process.cwd()"},env:{...process.env,OATS_EVENT:${JSON.stringify(args[0])},...${JSON.stringify(env)}},encoding:"utf8"});fs.writeFileSync(${JSON.stringify(result)},JSON.stringify({status:j.status,stdout:j.stdout,stderr:j.stderr}));}\n`;
  const source = readFileSync(fx.kernel.cli, "utf8"), answer = "console.log(JSON.stringify(doc));";
  if (source.split(answer).length !== 2) throw new Error("the fake kernel's answer line isn't where interleaveKernel expects it");
  writeFileSync(fx.kernel.cli, source.replace(answer, hook + answer));
  return { inner: () => { try { return JSON.parse(readFileSync(result, "utf8")); } catch { return null; } } };
}
