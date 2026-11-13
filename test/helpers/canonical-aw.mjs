// A wrapper `aw` that spells every team id it is given as aw does (awid/team_id.go:
// the name lowercased and trimmed, the domain lowercased and trimmed, without a
// trailing dot), then runs the fake `aw` it wraps. A fixture's answers and files then
// carry aw's spelling while the deployment configures another (awebai/oats-aweb#252).
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** → a PATH whose `aw` is the wrapper, in front of `path` (the fake's PATH). */
export function canonicalAwPath(dir, path) {
  const bin = join(dir, "canonical-aw-bin"), fake = join(path.split(":")[0], "aw");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "aw"), `#!${process.execPath}
const { spawnSync } = require("node:child_process");
const canon = (v) => { const i = v.indexOf(":"); return i < 0 ? v : v.slice(0, i).trim().toLowerCase() + ":" + v.slice(i + 1).trim().toLowerCase().replace(/\\.$/, ""); };
const flags = ["--team", "--team-id", "--join-team"];
const args = process.argv.slice(2).map((a, i, all) => {
  for (const f of flags) { if (a.startsWith(f + "=")) return f + "=" + canon(a.slice(f.length + 1)); if (all[i - 1] === f) return canon(a); }
  return a;
});
const r = spawnSync(${JSON.stringify(fake)}, args, { stdio: "inherit" });
process.exit(r.status ?? 1);
`);
  chmodSync(join(bin, "aw"), 0o755);
  return `${bin}:${path}`;
}
