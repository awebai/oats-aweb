// Loaded with `node --import`: realpathSync of FAULT_REALPATH fails with EIO, as a
// disk or IO error at retire's inspection would (test/human-attribution.test.mjs).
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
const real = fs.realpathSync;
fs.realpathSync = function realpathSync(p, ...rest) {
  if (process.env.FAULT_REALPATH && String(p) === process.env.FAULT_REALPATH) throw Object.assign(new Error("injected realpath IO error"), { code: "EIO" });
  return real.call(this, p, ...rest);
};
syncBuiltinESMExports();
