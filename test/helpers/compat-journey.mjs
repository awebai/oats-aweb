// The no-setting lifecycle that spawn attribution must leave as v1.42.1 had
// it: spawn (with and without a joined team, with and without the kernel's
// OATS_SPAWNER_HOME), start, restart, readiness, plain `setup --check-only
// --json`, then retire, across delivery and runtime. The transcript replaces
// the temp deployment, uuids and timestamps, and lists retire's aw calls as a
// sorted set: retire runs its steps concurrently, so their order varies.
//
// This file runs unchanged inside an extracted v1.42.1 tree, against that
// tree's own hook and fixture: scripts/record-compat-fixture.mjs records
// test/fixtures/compat-1.42.1.json that way.
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { fixture } from "./delivery-fixture.mjs";

const HOOK = fileURLToPath(new URL("../../oats-package/capabilities/oats-aweb/bin/oats-aweb.mjs", import.meta.url));

export const COMPAT_JOURNEYS = [
  { delivery: "channel", runtime: "claude", settings: {}, spawner: false },
  { delivery: "channel", runtime: "codex", settings: { join: "alpha" }, spawner: false },
  { delivery: "session", runtime: "claude", settings: {}, spawner: true },
  { delivery: "session", runtime: "codex", settings: { join: "alpha" }, spawner: true },
];

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

/** `plant(fx)`, when given, changes the deployment before the journey starts
 *  (acceptance test 11 plants what the new refusals look for). */
export function compatTranscript(t, { delivery, runtime, settings, spawner }, { plant } = {}) {
  const fx = fixture(t, { delivery, runtime, settings });
  plant?.(fx);
  const extra = spawner ? { OATS_SPAWNER_HOME: join(fx.ws, "agents", "lead", "instances", "lead-1") } : {};
  const result = (r) => ({ status: r.status, doc: r.doc ?? null, stderr: r.stderr });
  const spawned = fx.hook("spawn", extra);
  fx.record(spawned.doc?.meta, runtime);
  const started = fx.launch(spawned.doc?.meta, runtime, { extra });
  const restarted = fx.launch(started.doc?.meta, runtime, { previous: runtime, extra });
  const readiness = fx.readiness();
  const check = spawnSync(process.execPath, [HOOK, "setup", "--check-only", "--json"], { cwd: fx.ws, env: { PATH: fx.fake.path, HOME: fx.ws, OATS_EVENT: "setup", OATS_SETTINGS: JSON.stringify({ root: fx.ws, delivery, ...settings }) }, encoding: "utf8" });
  const lifecycle = fx.fake.readCalls().map((c) => c.args.join(" "));
  const retired = fx.hook("retire", { OATS_META: JSON.stringify(restarted.doc?.meta), ...extra });
  const retire = fx.fake.readCalls().slice(lifecycle.length).map((c) => c.args.join(" ").split(fx.ws).join("<deployment>").replace(UUID, "<uuid>")).sort();
  const transcript = { spawned: result(spawned), started: result(started), restarted: result(restarted), readiness, setup: { status: check.status, stdout: check.stdout, stderr: check.stderr }, retired: result(retired), calls: { lifecycle, retire } };
  return JSON.parse(JSON.stringify(transcript).split(fx.ws).join("<deployment>")
    .replace(UUID, "<uuid>")
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g, "<time>"));
}
