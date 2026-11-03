// The aweb pi extension without its bundled skills: home readiness warns
// pi-extension-skills-loaded when the launch's pi folder lists npm:@awebai/pi
// without "skills": [], and the manifest's pi install text names that filter.
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { fakeAwWake } from "./helpers/fake-aw-wake.mjs";
import { piExtensionSkillsWarning, recordedPiAgentDir } from "../oats-package/capabilities/oats-aweb/lib/pi-extension.mjs";

const REPO = resolve(fileURLToPath(new URL("..", import.meta.url)));
const CAPABILITY = join(REPO, "oats-package", "capabilities", "oats-aweb");
const BINDING = join(CAPABILITY, "bin", "oats-aweb-binding.mjs");
const CODE = "pi-extension-skills-loaded";

function fixture(t) {
  const fake = fakeAwWake(t);
  const ws = realpathSync(mkdtempSync(join(tmpdir(), "oats-aweb-pi-skills-")));
  t.after(() => rmSync(ws, { recursive: true, force: true }));
  const user = join(ws, "user");
  const home = join(ws, "agents", "dev", "instances", "dev-1");
  mkdirSync(join(home, ".aw"), { recursive: true });
  mkdirSync(join(home, ".oats-aweb"));
  writeFileSync(join(home, ".oats-aweb", "teams.json"), JSON.stringify({ joinedTeams: [] }));
  mkdirSync(join(ws, ".aw"));
  const env = {
    PATH: fake.path, HOME: user, OATS_WORKSPACE: ws, OATS_WORKSPACE_KEY: "github.com/acme/agents", OATS_WORKSPACE_NAME: "acme",
    OATS_DEFAULT_TEAM: "default", OATS_DEFAULT_TEAM_ID: "legacy:example.test", OATS_DEFAULT_TEAM_FROM: "deployment",
    OATS_TEAMS: JSON.stringify([{ label: "default", team: "legacy:example.test", default: true, from: "local" }]),
  };
  /** The kernel's record of the home's last start. */
  const record = ({ harness = "pi", launchEnv } = {}) => writeFileSync(join(home, "instance.json"), JSON.stringify({
    launch: { harness, ...(launchEnv ? { env: launchEnv } : {}) }, capabilityMeta: { "oats.aweb": { delivery: "channel", runtime: harness } },
  }));
  /** Write `<dir>/settings.json` (the default dir is HOME's .pi/agent). */
  const piSettings = (doc, dir = join(user, ".pi", "agent")) => {
    mkdirSync(dir, { recursive: true });
    const file = join(dir, "settings.json");
    writeFileSync(file, typeof doc === "string" ? doc : JSON.stringify(doc, null, 2));
    return file;
  };
  /** The binding readiness check; `targetHome: null` is soul scope. */
  const readiness = ({ targetHome = home } = {}) => {
    const input = { schemaVersion: 1, phase: "check", slot: "messaging", capability: "oats.aweb", settings: { root: ws, delivery: "channel" }, input: { action: { kind: "readiness" }, context: { kind: "workspace", workspace: env.OATS_WORKSPACE_KEY, deployment: ws, soul: "dev", team: "default", instance: targetHome ? "dev-1" : null, home: targetHome } } };
    const r = spawnSync(process.execPath, [BINDING, "check"], { cwd: ws, input: JSON.stringify(input), env, encoding: "utf8", timeout: 20000 });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    return JSON.parse(r.stdout).result;
  };
  return { ws, user, home, record, piSettings, readiness };
}
const skillsWarnings = (result) => result.warnings.filter((w) => w.code === CODE);
const without = (result) => ({ ...result, warnings: result.warnings.filter((w) => w.code !== CODE) });

// -------------------------------------------------------------- home readiness

test("a pi home warns when its pi folder lists the extension without the skills filter", (t) => {
  const fx = fixture(t);
  fx.record();
  const agentDir = join(fx.user, ".pi", "agent");
  const file = join(agentDir, "settings.json");
  const baseline = fx.readiness();
  assert.deepEqual(skillsWarnings(baseline), [], "no settings file: silent");
  for (const [name, entry, edit] of [
    ["plain string", "npm:@awebai/pi", `replace the entry "npm:@awebai/pi" with {"source":"npm:@awebai/pi","skills":[]}`],
    ["versioned string", "npm:@awebai/pi@0.4.0", `replace the entry "npm:@awebai/pi@0.4.0" with {"source":"npm:@awebai/pi@0.4.0","skills":[]}`],
    ["object without skills", { source: "npm:@awebai/pi@latest", prompts: [] }, `set "skills": [] in the entry whose "source" is "npm:@awebai/pi@latest"`],
    ["object with a non-empty skills filter", { source: "npm:@awebai/pi", skills: ["skills/aweb-messaging"] }, `set "skills": [] in the entry whose "source" is "npm:@awebai/pi"`],
  ]) {
    fx.piSettings({ theme: "dark", packages: ["npm:other-tools", entry] });
    const result = fx.readiness();
    assert.deepEqual(skillsWarnings(result), [{ code: CODE, message: `pi loads the skills bundled with the aweb pi extension in every session that uses ${agentDir}: its settings.json lists "npm:@awebai/pi" without a skills filter, and OATS gives a home its skills through its capabilities only. In ${file}, ${edit}, keeping the other entries; the extension still loads, and pi install and pi update keep the filter` }], name);
    assert.deepEqual(without(result), baseline, `${name}: every other readiness item keeps its shape`);
  }
});

test("the filtered entry, a missing, unreadable or malformed file, and an unlisted extension are silent", (t) => {
  const fx = fixture(t);
  fx.record();
  for (const [name, doc] of [
    ["object with skills []", { packages: [{ source: "npm:@awebai/pi", skills: [] }] }],
    ["versioned object with skills []", { packages: [{ source: "npm:@awebai/pi@0.4.0", skills: [], extensions: ["dist/index.js"] }] }],
    ["extension not listed", { packages: ["npm:@awebai/pi-tools", "npm:@awebai/aw", { source: "git:github.com/awebai/pi" }] }],
    ["no packages", { theme: "dark" }],
    ["packages not a list", { packages: "npm:@awebai/pi" }],
    ["not JSON", "{\"packages\": [\"npm:@awebai/pi\""],
    ["not an object", "[\"npm:@awebai/pi\"]"],
  ]) {
    fx.piSettings(doc);
    assert.deepEqual(skillsWarnings(fx.readiness()), [], name);
  }
  rmSync(join(fx.user, ".pi"), { recursive: true });
  assert.deepEqual(skillsWarnings(fx.readiness()), [], "missing pi folder");
});

test("an unreadable settings file is silent", { skip: process.getuid?.() === 0 && "root reads a mode-000 file" }, (t) => {
  const fx = fixture(t);
  fx.record();
  const file = fx.piSettings({ packages: ["npm:@awebai/pi"] });
  chmodSync(file, 0o000);
  try { assert.deepEqual(skillsWarnings(fx.readiness()), []); }
  finally { chmodSync(file, 0o600); }
});

test("only a pi home at home scope is checked: another runtime, a home without a launch record and soul scope are silent", (t) => {
  const fx = fixture(t);
  fx.piSettings({ packages: ["npm:@awebai/pi"] });
  assert.deepEqual(skillsWarnings(fx.readiness()), [], "no instance.json");
  for (const harness of ["claude", "codex"]) {
    fx.record({ harness });
    assert.deepEqual(skillsWarnings(fx.readiness()), [], harness);
  }
  fx.record();
  assert.deepEqual(skillsWarnings(fx.readiness({ targetHome: null })), [], "soul scope");
  assert.equal(skillsWarnings(fx.readiness()).length, 1, "the same folder warns for the pi home");
});

test("the launch's PI_CODING_AGENT_DIR selects the pi folder: absolute, under ~, and unknown for anything else", (t) => {
  const fx = fixture(t);
  fx.piSettings({ packages: [{ source: "npm:@awebai/pi", skills: [] }] });
  const elsewhere = join(fx.ws, "pi-elsewhere");
  fx.piSettings({ packages: ["npm:@awebai/pi"] }, elsewhere);
  fx.record({ launchEnv: { PI_CODING_AGENT_DIR: elsewhere } });
  assert.match(skillsWarnings(fx.readiness())[0]?.message ?? "", new RegExp(`In ${join(elsewhere, "settings.json")},`), "absolute");
  fx.piSettings({ packages: ["npm:@awebai/pi@0.4.0"] }, join(fx.user, "pi-tilde"));
  fx.record({ launchEnv: { PI_CODING_AGENT_DIR: "~/pi-tilde" } });
  assert.equal(skillsWarnings(fx.readiness()).length, 1, "~ is HOME, as pi expands it");
  for (const value of [{ fromEnv: "PI_CODING_AGENT_DIR" }, "relative/pi", ""]) {
    fx.record({ launchEnv: { PI_CODING_AGENT_DIR: value } });
    assert.deepEqual(skillsWarnings(fx.readiness()), [], JSON.stringify(value));
  }
  fx.record({ launchEnv: { OTHER: "x" } });
  assert.deepEqual(skillsWarnings(fx.readiness()), [], "no PI_CODING_AGENT_DIR: HOME's .pi/agent, which is filtered");
});

// ---------------------------------------------------------------------- remedy

test("doing what the remedy says silences the warning and keeps the other entries", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "oats-aweb-pi-remedy-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, "settings.json");
  for (const entry of ["npm:@awebai/pi", "npm:@awebai/pi@0.4.0", { source: "npm:@awebai/pi", extensions: ["dist/index.js"] }]) {
    writeFileSync(file, JSON.stringify({ packages: ["npm:other-tools", entry] }));
    const { message } = piExtensionSkillsWarning(dir);
    const doc = JSON.parse(readFileSync(file, "utf8"));
    const replace = /replace the entry ("[^"]+") with (\{.*?\}),/.exec(message);
    const set = /set "skills": \[\] in the entry whose "source" is ("[^"]+")/.exec(message);
    if (replace) doc.packages = doc.packages.map((p) => (p === JSON.parse(replace[1]) ? JSON.parse(replace[2]) : p));
    else doc.packages = doc.packages.map((p) => (p?.source === JSON.parse(set[1]) ? { ...p, skills: [] } : p));
    writeFileSync(file, JSON.stringify(doc));
    assert.equal(piExtensionSkillsWarning(dir), undefined, JSON.stringify(entry));
    assert.equal(doc.packages[0], "npm:other-tools");
  }
});

test("recordedPiAgentDir reads the legacy runtime and needs an absolute HOME for the default", (t) => {
  const home = mkdtempSync(join(tmpdir(), "oats-aweb-pi-dir-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  writeFileSync(join(home, "instance.json"), JSON.stringify({ launch: {}, capabilityMeta: { "oats.aweb": { runtime: "pi" } } }));
  assert.equal(recordedPiAgentDir(home, { HOME: "/u" }), "/u/.pi/agent");
  assert.equal(recordedPiAgentDir(home, {}), undefined);
  assert.equal(recordedPiAgentDir(home, { HOME: "relative" }), undefined);
  writeFileSync(join(home, "instance.json"), JSON.stringify({ capabilityMeta: { "oats.aweb": { runtime: "pi" } } }));
  assert.equal(recordedPiAgentDir(home, { HOME: "/u" }), undefined, "no launch record");
});

// -------------------------------------------------------------------- manifest

test("both pi install texts install the extension, then name the filtered settings entry the warning accepts", (t) => {
  const manifest = JSON.parse(readFileSync(join(CAPABILITY, "oats.json"), "utf8"));
  const readme = readFileSync(join(REPO, "README.md"), "utf8");
  const rows = manifest.requires.filter((r) => r.runtime === "pi");
  assert.deepEqual(rows.map((r) => r.when.delivery).sort(), ["channel", "session"]);
  const dir = mkdtempSync(join(tmpdir(), "oats-aweb-pi-manifest-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const row of rows) {
    const spec = row.when.delivery === "channel" ? "npm:@awebai/pi" : "npm:@awebai/pi@latest";
    assert.equal(row.package, "npm:@awebai/pi");
    assert.equal(row.install, `pi install ${spec}, then make its entry {"source": "${spec}", "skills": []} in the pi folder's settings.json (PI_CODING_AGENT_DIR, else ~/.pi/agent), so pi loads the extension without its bundled skills (README, "The pi extension without its skills")`);
    const entry = JSON.parse(/\{"source".*?\}/.exec(row.install)[0]);
    writeFileSync(join(dir, "settings.json"), JSON.stringify({ packages: [entry] }));
    assert.equal(piExtensionSkillsWarning(dir), undefined, `${row.when.delivery}: the named entry is the filtered one`);
    writeFileSync(join(dir, "settings.json"), JSON.stringify({ packages: [spec] }));
    assert.equal(piExtensionSkillsWarning(dir)?.code, CODE, `${row.when.delivery}: what pi install alone writes warns`);
  }
  assert.match(readme, /^#{2,4} The pi extension without its skills$/m, "the README section the install text names");
});

// --------------------------------------------------------- vendored skill text

test("the vendored aweb-messaging skill says OATS installs the pi extension without its skills", () => {
  const skill = readFileSync(join(CAPABILITY, "skills", "aweb-messaging", "SKILL.md"), "utf8");
  const line = skill.split("\n").find((l) => l.startsWith("- **Pi**:"));
  assert.equal(line, `- **Pi**: OATS installs the \`@awebai/pi\` extension with its bundled skills filtered out: its entry in the pi folder's \`settings.json\` is \`{"source": "npm:@awebai/pi", "skills": []}\`. A home's skills come from OATS.`, "upstream's Pi line came back with a sync: adapt it again (skills/VENDORED.md)");
  assert.doesNotMatch(skill, /bundled together/);
});
