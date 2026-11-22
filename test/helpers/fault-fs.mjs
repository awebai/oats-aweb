// Loaded with `node --import`: each fs call FAULT_CALLS names (default realpathSync),
// on the path FAULT_PATH, fails with EIO, as a disk or IO error at retire's
// inspection would (test/human-attribution.test.mjs).
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
for (const call of (process.env.FAULT_CALLS || "realpathSync").split(",")) {
  const real = fs[call];
  fs[call] = function faulty(p, ...rest) {
    if (process.env.FAULT_PATH && String(p) === process.env.FAULT_PATH) throw Object.assign(new Error(`injected ${call} IO error`), { code: "EIO" });
    return real.call(this, p, ...rest);
  };
}
syncBuiltinESMExports();
