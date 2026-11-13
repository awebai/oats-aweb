// An opted-in deployment for human attribution, driven through the hook as the
// kernel drives it (spec v4.3.7):
// - an endorsed root at D/.aweb-endorsed-root/acme-root: a registered did:aw,
//   owner-only, holding its chain (the human's certificate, then its own);
// - the operator's protected profile at D/protected-profile.json, 0600;
// - settings.oats.aweb.attribution recording both, the profile's digest, the
//   protected teams and the endorsement;
// - a legacy minting root at D/.aw, inventory only;
// - a kernel whose `--version --json` lists spawn-attribution.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { currentRootQuery } from "./current-root-query.mjs";
import { POLICY, fakeAwProtected, writeIdentity } from "./fake-aw-protected.mjs";

const CAPABILITY = fileURLToPath(new URL("../../oats-package/capabilities/oats-aweb/", import.meta.url));
export const HUMAN = "did:aw:human1", ROOT_ID = "did:aw:acme-root";
export const TEAM = "backend:acme.example", OPS = "ops:acme.example";
export const SERVICE_URL = "https://aweb.acme.example/api", REGISTRY = "https://registry.acme.example";
export const ENDORSEMENT_OP = "3f2b8c1e-9d4a-4b6e-8f0a-1c2d3e4f5a6b";
export const PROFILE_TEXT = `${JSON.stringify({ v: 1, service_id: "svc-acme", request_origin: "https://protected.acme.example", human_origin: "https://human.acme.example", rp_id: "human.acme.example", registry_origin: REGISTRY, namespace_authorities: [{ domain: "acme.example", controller_did: "did:key:zcontroller" }], bindings: [] })}\n`;

/** `capability`: the capability directory to run (a test copy, for a flipped
 *  constant). `teams`: the setting's protected teams. `root`: the root home
 *  setup finds, "endorsed" (with its chain), "registered" (a did:aw with no
 *  chain yet), "local" (a did:key) or "none". `extraTeams`: more teams the
 *  deployment maps, [{label, team}], beyond default and ops. */
export function attributionFixture(t, { attribution = true, features = ["spawn-attribution"], label = "Juan Pérez", delivery = "channel", runtime = "claude", settings: extraSettings = {}, teamIds = { default: TEAM, ops: OPS }, teams = [teamIds.default, teamIds.ops], service = {}, capability = CAPABILITY, root = "endorsed", extraTeams = [] } = {}) {
  const hookPath = join(capability, "bin", "oats-aweb.mjs"), binding = join(capability, "bin", "oats-aweb-binding.mjs");
  const ws = realpathSync(mkdtempSync(join(tmpdir(), "oats-aweb-attr-")));
  t.after(() => rmSync(ws, { recursive: true, force: true }));
  writeIdentity(join(ws, ".aw"));
  writeFileSync(join(ws, ".aw", "teams.yaml"), `active_team: ${teamIds.default}\n`);
  writeFileSync(join(ws, "oats-local.yaml"), "schemaVersion: 2\nworkspace: fixture\n");
  const profile = join(ws, "protected-profile.json");
  writeFileSync(profile, PROFILE_TEXT, { mode: 0o600 });
  const rootHome = join(ws, ".aweb-endorsed-root", "acme-root");
  if (root !== "none") {
    mkdirSync(join(ws, ".aweb-endorsed-root"), { mode: 0o700 });
    mkdirSync(rootHome, { mode: 0o700 });
    if (root === "endorsed") writeIdentity(join(rootHome, ".aw"), { did: ROOT_ID, chain: [{ id: HUMAN, kind: "human", parent: { kind: "namespace", id: "acme.example" } }, { id: ROOT_ID, kind: "agent", parent: { kind: "identity", id: HUMAN } }] });
    else if (root === "registered") writeIdentity(join(rootHome, ".aw"), { did: ROOT_ID });
    else writeIdentity(join(rootHome, ".aw"));
  }
  const setting = {
    root: { id: ROOT_ID, home: rootHome }, human: { id: HUMAN, label },
    service: { id: "svc-acme", profile, profileDigest: `sha256:${createHash("sha256").update(PROFILE_TEXT).digest("hex")}`, url: SERVICE_URL },
    teams, endorsement: { operationId: ENDORSEMENT_OP, policy: { version: POLICY.version, digest: POLICY.digest } },
  };
  const settings = { root: ws, delivery, ...(attribution ? { attribution: setting } : {}), ...extraSettings };
  const fake = fakeAwProtected(t, { service });
  const homeOf = (name, soul = "dev") => join(ws, "agents", soul, "instances", name);
  // `oats status --json` lists every home under D/agents that has an instance.json, as the kernel does;
  // FAKE_KERNEL_STATUS=fail makes it fail, =malformed answers a document with no agents list.
  const status = `if(args[0]==='status'&&process.env.FAKE_KERNEL_STATUS==='fail'){console.error('kernel status failed');process.exit(1);}if(args[0]==='status'&&process.env.FAKE_KERNEL_STATUS==='malformed'){doc={schemaVersion:1};}else if(args[0]==='status'){const p=require('node:path'),root=p.join(deployment,'agents'),rows=[];for(const soul of fs.existsSync(root)?fs.readdirSync(root):[])for(const name of fs.existsSync(p.join(root,soul,'instances'))?fs.readdirSync(p.join(root,soul,'instances')):[]){const h=p.join(root,soul,'instances',name);if(!fs.existsSync(p.join(h,'instance.json')))continue;rows.push({instance:name,home:h,capabilityMeta:JSON.parse(fs.readFileSync(p.join(h,'instance.json'),'utf8')).capabilityMeta});}doc={schemaVersion:1,agents:[{agent:'dev',instances:rows}]};}`;
  const kernel = currentRootQuery(ws, { home: homeOf("dev-1"), deployment: ws, settings, change: `if(args.includes('--version'))doc={schemaVersion:1,name:'@awebai/oats',version:'0.69.19',features:${JSON.stringify(features)}};${status}` });
  const env = {
    PATH: fake.path, HOME: ws, OATS_CLI_BIN: kernel.cli, OATS_WORKSPACE: ws, OATS_WORKSPACE_KEY: "github.com/acme/agents", OATS_WORKSPACE_NAME: "acme",
    OATS_DEFAULT_TEAM: "default", OATS_DEFAULT_TEAM_ID: teamIds.default, OATS_DEFAULT_TEAM_FROM: "deployment",
    OATS_TEAMS: JSON.stringify([{ label: "default", team: teamIds.default, default: true, from: "local" }, { label: "ops", team: teamIds.ops, default: false, from: "shared" }, ...extraTeams.map(({ label, team }) => ({ label, team, default: false, from: "shared" }))]), OATS_TEAMS_SOURCE: "live",
    OATS_RUNTIME: runtime, OATS_SETTINGS: JSON.stringify(settings),
  };
  const hook = (event, name, extra = {}) => {
    const home = homeOf(name);
    mkdirSync(home, { recursive: true });
    const r = spawnSync(process.execPath, [hookPath, event], { cwd: home, env: { ...env, OATS_HOME: home, OATS_INSTANCE_HOME: home, OATS_INSTANCE: name, OATS_EVENT: event, ...extra }, encoding: "utf8", timeout: 60000 });
    const last = r.stdout.trim().split("\n").pop();
    return { status: r.status, doc: last ? JSON.parse(last) : undefined, stderr: r.stderr, home };
  };
  /** The kernel's record of a spawned home: its harness and this provider's meta. */
  const record = (name, meta) => writeFileSync(join(homeOf(name), "instance.json"), JSON.stringify({ harness: runtime, launch: { harness: runtime }, capabilityMeta: { "oats.aweb": meta } }));
  /** Spawn `name` (by a person, or by `spawner`), recorded as the kernel does on success. */
  const spawn = (name, { spawner, extra = {} } = {}) => {
    const r = hook("spawn", name, { ...(spawner ? { OATS_SPAWNER_HOME: homeOf(spawner) } : {}), ...extra });
    if (r.status === 0) record(name, r.doc.meta);
    return r;
  };
  const meta = (name) => JSON.parse(readFileSync(join(homeOf(name), "instance.json"), "utf8")).capabilityMeta["oats.aweb"];
  /** A start of `name` from its recorded meta, under `captured` settings (default: the spawn's). */
  const launch = (name, { captured = settings, extra = {} } = {}) => {
    const r = hook("launch", name, { OATS_META: JSON.stringify(meta(name)), OATS_PREVIOUS_RUNTIME: runtime, OATS_SETTINGS: JSON.stringify(captured), ...extra });
    if (r.status === 0 && r.doc?.meta) record(name, r.doc.meta);
    return r;
  };
  /** Retire `name` from `fromMeta` (default: its recorded meta). */
  const retire = (name, { fromMeta, captured = settings, extra = {} } = {}) => hook("retire", name, { OATS_META: JSON.stringify(fromMeta ?? meta(name)), OATS_SETTINGS: JSON.stringify(captured), ...extra });
  /** Home readiness through the binding check, under `captured` settings. */
  const readiness = (name, { captured = settings } = {}) => {
    const home = homeOf(name);
    const input = { schemaVersion: 1, phase: "check", slot: "messaging", capability: "oats.aweb", settings: captured, input: { action: { kind: "readiness" }, context: { kind: "workspace", workspace: env.OATS_WORKSPACE_KEY, deployment: ws, soul: "dev", team: "default", instance: name, home } } };
    const { OATS_SETTINGS, OATS_RUNTIME, ...rest } = env;
    const r = spawnSync(process.execPath, [binding, "check"], { cwd: home, input: JSON.stringify(input), env: { ...rest, OATS_INSTANCE_HOME: home }, encoding: "utf8", timeout: 60000 });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    return JSON.parse(r.stdout.trim().split("\n").pop()).result;
  };
  /** `oats aweb setup <args>` in D, under the deployment's live settings. */
  const setup = (args, { live = settings, extra = {} } = {}) => {
    const r = spawnSync(process.execPath, [hookPath, "setup", ...args], { cwd: ws, env: { ...env, OATS_EVENT: "setup", OATS_SETTINGS: JSON.stringify(live), ...extra }, encoding: "utf8", timeout: 60000 });
    let doc; try { doc = JSON.parse(r.stdout.trim().split("\n").pop() || "null"); } catch { doc = undefined; }
    return { status: r.status, doc, stdout: r.stdout, stderr: r.stderr };
  };
  /** A home's own command (`oats aweb join|leave <args>`), run in that home under the deployment's live settings, from its recorded meta. */
  const command = (name, event, args, { live = settings, extra = {} } = {}) => {
    const home = homeOf(name);
    const r = spawnSync(process.execPath, [hookPath, event, ...args], { cwd: home, env: { ...env, OATS_HOME: home, OATS_INSTANCE_HOME: home, OATS_INSTANCE: name, OATS_EVENT: event, OATS_SETTINGS: JSON.stringify(live), ...extra }, encoding: "utf8", timeout: 60000 });
    let doc; try { doc = JSON.parse(r.stdout.trim().split("\n").pop() || "null"); } catch { doc = undefined; }
    return { status: r.status, doc, stdout: r.stdout, stderr: r.stderr };
  };
  return { ws, rootHome, profile, setting, settings, fake, kernel, env, homeOf, hook, spawn, record, meta, launch, retire, readiness, setup, command };
}

/** An aw call's argv without its global flags (--json, and a leading --identity-home <path>, which the fake records as identityHome). */
export const commandArgs = (args) => { const words = args.filter((a) => a !== "--json"); return words[0] === "--identity-home" ? words.slice(2) : words; };
/** Each aw call of a fake as its command words: its argv up to the first flag or positional argument (a path, an id), global flags aside. */
export const verbs = (fake) => fake.calls().map((c) => { const words = commandArgs(c.args); const end = words.findIndex((a) => !/^[a-z][a-z-]*$/.test(a)); return (end < 0 ? words : words.slice(0, end)).join(" "); });

/** settings.oats.aweb.attribution as setup wrote it into D's oats-local.yaml (one JSON flow line), or undefined. */
export function writtenAttribution(ws) {
  const line = readFileSync(join(ws, "oats-local.yaml"), "utf8").split("\n").find((l) => /^ {4}attribution: /.test(l));
  return line ? JSON.parse(line.replace(/^ {4}attribution: /, "")) : undefined;
}

/** A test copy of the capability with the served-feature constants beside the
 *  floor (lib/protected-client.mjs) set as given, for the branch the pinned aw
 *  doesn't take, e.g. {REMOVE_SERVED: false}. Pass it as `capability`. */
export function capabilityWith(t, constants) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "oats-aweb-capability-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  cpSync(CAPABILITY, dir, { recursive: true });
  const file = join(dir, "lib", "protected-client.mjs");
  let text = readFileSync(file, "utf8");
  for (const [name, value] of Object.entries(constants)) {
    const pattern = new RegExp(`^export const ${name} = (true|false);$`, "m");
    assert.ok(pattern.test(text), `${name} is not a served-feature constant`);
    text = text.replace(pattern, `export const ${name} = ${JSON.stringify(value)};`);
  }
  writeFileSync(file, text);
  return dir;
}
