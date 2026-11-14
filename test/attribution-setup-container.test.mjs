// Acceptance 14 (C-2): a fresh root on a team container's deployment refuses `container` before
// any effect, even when the deployment is reached through a link onto it (round 26). The link is
// emulated: realpathSync reports the temp deployment as the container's path, and only reads are
// redirected, so every write and the fake aw stay in the temp directory and no /state path is
// created or touched.
import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import test from "node:test";
import { endorseRoot, parseEndorseArgs } from "../oats-package/capabilities/oats-aweb/lib/endorse-root.mjs";
import { CONTAINER_DEPLOYMENT } from "../oats-package/capabilities/oats-aweb/lib/attribution.mjs";

test("acceptance 14: a fresh --new-root on a deployment that links onto the team container's refuses container with no aw call and no root directory", (t) => {
  const D = fs.mkdtempSync(join(fs.realpathSync("/tmp"), "oats-aweb-container-"));
  t.after(() => fs.rmSync(D, { recursive: true, force: true }));
  const profile = join(D, "profile.json");
  fs.writeFileSync(profile, JSON.stringify({ registry_origin: "https://registry.example", service_id: "svc" }), { mode: 0o600 });
  fs.writeFileSync(join(D, "oats-local.yaml"), "schemaVersion: 2\nworkspace: fixture\n");
  const saved = { realpathSync: fs.realpathSync, statSync: fs.statSync, readFileSync: fs.readFileSync, existsSync: fs.existsSync };
  const inContainer = (p) => String(p) === CONTAINER_DEPLOYMENT || String(p).startsWith(`${CONTAINER_DEPLOYMENT}/`);
  const local = (p) => (inContainer(p) ? join(D, String(p).slice(CONTAINER_DEPLOYMENT.length)) : p);
  fs.realpathSync = (p, ...a) => (p === D ? CONTAINER_DEPLOYMENT : saved.realpathSync(p, ...a));
  fs.statSync = (p, ...a) => saved.statSync(local(p), ...a);
  fs.readFileSync = (p, ...a) => saved.readFileSync(local(p), ...a);
  fs.existsSync = (p) => (inContainer(p) ? false : saved.existsSync(p));
  syncBuiltinESMExports();
  t.after(() => { Object.assign(fs, saved); syncBuiltinESMExports(); });
  const calls = [];
  const o = parseEndorseArgs(["--endorse-root", "--new-root", "--name", "root-1", "--human", "did:aw:human", "--protected-profile", profile, "--service", "https://aweb.example/api"]);
  assert.throws(() => endorseRoot(o, {
    deployment: D, kernel: () => ({ features: ["spawn-attribution"] }), awVersion: "1.36.59-rc.2", versionAtLeast: () => true,
    teams: { default: { label: "default", team: "backend:example.test" }, mapped: [] },
    scan: () => ({ findings: [], unknown: [] }),
    aw: (argv) => { calls.push(argv); return JSON.stringify({ did_aw: "did:aw:root-1", status: "created" }); },
    writePrivate: () => {}, record: () => {},
  }), (e) => e.code === "E_ATTRIBUTION_ROOT_HOME" && e.details?.problem === "container");
  assert.deepEqual(calls, [], "no aw call");
  assert.equal(saved.existsSync(join(D, ".aweb-endorsed-root", "root-1")), false, "no root directory");
});
