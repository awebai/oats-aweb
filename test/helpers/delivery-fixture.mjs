// Shared fake-home fixture for delivery and upgrade lifecycle tests.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { fakeAwWake } from "./fake-aw-wake.mjs";
import { assertKernelCheckAnswerRule } from "./kernel-check-answer-rule.mjs";
const CAPABILITY = fileURLToPath(new URL("../../oats-package/capabilities/oats-aweb/", import.meta.url));
const HOOK = join(CAPABILITY, "bin", "oats-aweb.mjs");
const BINDING = join(CAPABILITY, "bin", "oats-aweb-binding.mjs");

export function tempDir(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "oats-aweb-118-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const teamsEnv = JSON.stringify([
  { label: "default", team: "legacy:example.test", default: true, from: "local" },
  { label: "alpha", team: "alpha:example.test", default: false, from: "shared" },
]);

export function fixture(t, { delivery, runtime = "claude", settings = {}, daemon = true, daemonVersion } = {}) {
  const fake = fakeAwWake(t, { daemon, ...(daemonVersion ? { daemonVersion } : {}) });
  const ws = tempDir(t), home = join(ws, "agents", "dev", "instances", "dev-1");
  mkdirSync(home, { recursive: true });
  mkdirSync(join(ws, ".aw"), { recursive: true });
  writeFileSync(join(ws, ".aw", "teams.yaml"), "active_team: legacy:example.test\n");
  const merged = { root: ws, ...(delivery ? { delivery } : {}), ...settings };
  const env = {
    PATH: fake.path, OATS_HOME: home, OATS_INSTANCE_HOME: home, OATS_INSTANCE: "dev-1", OATS_WORKSPACE: ws, OATS_WORKSPACE_KEY: "github.com/acme/agents", OATS_WORKSPACE_NAME: "acme",
    OATS_DEFAULT_TEAM: "default", OATS_DEFAULT_TEAM_ID: "legacy:example.test", OATS_DEFAULT_TEAM_FROM: "deployment", OATS_TEAMS: teamsEnv, OATS_TEAMS_SOURCE: "live",
    OATS_RUNTIME: runtime, OATS_SETTINGS: JSON.stringify(merged),
  };
  const hook = (event, extra = {}) => {
    const r = spawnSync(process.execPath, [HOOK, event], { cwd: home, env: { ...env, ...extra, OATS_EVENT: event }, encoding: "utf8", timeout: 20000 });
    const last = r.stdout.trim().split("\n").pop();
    return { ...r, doc: last ? JSON.parse(last) : undefined };
  };
  /** Spawn under one runtime; return the meta the kernel records. */
  const spawn = () => { const r = hook("spawn"); assert.equal(r.status, 0, r.stdout + r.stderr); return r.doc; };
  /** Start the spawned home under `runtime`, as the kernel does: the recorded
   *  meta, the captured settings, the previous runtime. */
  const launch = (meta, runtime, { previous, delivery: launchDelivery, extra = {} } = {}) => hook("launch", {
    OATS_META: JSON.stringify(meta), OATS_RUNTIME: runtime, OATS_PREVIOUS_RUNTIME: previous ?? meta.runtime ?? "",
    ...(launchDelivery ? { OATS_SETTINGS: JSON.stringify({ ...merged, delivery: launchDelivery }) } : {}), ...extra,
  });
  const wakeCalls = () => fake.readCalls().filter((c) => c.args[0] === "wake").map((c) => c.args[1]);
  /** The kernel's record of the home's last start: the harness it launched
   *  and the meta this provider returned. */
  const record = (meta, harness, { launchPrompts } = {}) => writeFileSync(join(home, "instance.json"), JSON.stringify({ harness, launch: { harness }, capabilityMeta: { "oats.aweb": meta }, ...(launchPrompts !== undefined ? { launchPrompts } : {}) }));
  /** The binding readiness check for this home, as the kernel asks it. */
  const readiness = ({ extra = {}, targetHome = home } = {}) => {
    const input = { schemaVersion: 1, phase: "check", slot: "messaging", capability: "oats.aweb", settings: merged, input: { action: { kind: "readiness" }, context: { kind: "workspace", workspace: env.OATS_WORKSPACE_KEY, deployment: ws, soul: "dev", team: "default", instance: "dev-1", home: targetHome } } };
    const { OATS_SETTINGS, OATS_HOME, OATS_RUNTIME, ...rest } = env;
    const r = spawnSync(process.execPath, [BINDING, "check"], { cwd: home, input: JSON.stringify(input), env: { ...rest, OATS_INSTANCE_HOME: home, ...extra }, encoding: "utf8", timeout: 20000 });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    return assertKernelCheckAnswerRule(r.stdout, input, "oats-aweb binding check").result;
  };
  return { fake, ws, home, hook, spawn, launch, wakeCalls, record, readiness, registered: () => fake.registrations()[home] };
}

