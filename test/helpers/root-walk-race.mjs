// A deterministic same-root interleaving for rootHomeProblem's walk (round 32): loaded with
// --import into a spawn hook, or called in process, it makes the next readdirSync of
// RACE_COPY_DIR return its listing and then, before the walk lstats the entries, either publish
// the listed `*.tmp` copy as writePrivate does (RACE_MODE=publish: rename it to its final name) or
// delete a listed `*.cert` copy as retire and reconcile do (RACE_MODE=delete).
import fs from "node:fs";
import { join } from "node:path";
import { syncBuiltinESMExports } from "node:module";

/** Install the race on `dir` in this process; returns the function that removes it. */
export function raceRootWalk(dir, mode) {
  const original = fs.readdirSync;
  fs.readdirSync = (p, ...args) => {
    const names = original(p, ...args);
    if (p === dir) {
      const name = names.find((n) => (mode === "delete" ? n.endsWith(".cert") : n.endsWith(".tmp")));
      if (name && mode === "delete") fs.rmSync(join(p, name), { force: true });
      else if (name) fs.renameSync(join(p, name), join(p, name.replace(/\.[0-9]+\.tmp$/, "")));
    }
    return names;
  };
  syncBuiltinESMExports();
  return () => { fs.readdirSync = original; syncBuiltinESMExports(); };
}
if (process.env.RACE_COPY_DIR) raceRootWalk(process.env.RACE_COPY_DIR, process.env.RACE_MODE);
