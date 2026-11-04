// The aweb pi extension without its bundled skills: home readiness warns
// pi-extension-skills-loaded when the launch's pi folder lists npm:@awebai/pi
// without "skills": [] and the @awebai/pi installed there is below 0.5.0 (or of
// unknown version), and pi-skills-package-loaded when it lists
// npm:@awebai/claude-skills unfiltered; the manifest's pi install text names
// the filter and keeps claude-skills out.
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { fakeAwWake } from "./helpers/fake-aw-wake.mjs";
import { piExtensionSkillsWarning, piExtensionVersion, piSkillsPackageWarning, recordedPiAgentDir } from "../oats-package/capabilities/oats-aweb/lib/pi-extension.mjs";
import { piExtensionVersion as tasksPiExtensionVersion } from "../oats-package/capabilities/oats-aweb-tasks/lib/claim-floors.mjs";
import { LINE_ADAPTATIONS, adaptVendored } from "../scripts/sync-vendored-skills.mjs";

const REPO = resolve(fileURLToPath(new URL("..", import.meta.url)));
const CAPABILITY = join(REPO, "oats-package", "capabilities", "oats-aweb");
const BINDING = join(CAPABILITY, "bin", "oats-aweb-binding.mjs");
const CODE = "pi-extension-skills-loaded";
const PACKAGE_CODE = "pi-skills-package-loaded";
/** Install @awebai/pi `version` in pi folder `dir`, as pi's managed npm does. */
const installPi = (dir, version, doc = { name: "@awebai/pi", version }) => {
  const file = join(dir, "npm", "node_modules", "@awebai", "pi", "package.json");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, typeof doc === "string" ? doc : JSON.stringify(doc));
  return file;
};

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
const packageWarnings = (result) => result.warnings.filter((w) => w.code === PACKAGE_CODE);
const without = (result, ...codes) => ({ ...result, warnings: result.warnings.filter((w) => ![CODE, ...codes].includes(w.code)) });
/** The two skills warnings' codes, in readiness order. */
const skillsCodes = (result) => result.warnings.map((w) => w.code).filter((c) => c === CODE || c === PACKAGE_CODE);

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
    assert.deepEqual(skillsWarnings(result), [{ code: CODE, message: `pi loads the skills bundled with the aweb pi extension in every session that uses ${agentDir}: its settings.json lists "npm:@awebai/pi" without a skills filter, and OATS gives a home its skills through its capabilities only. In ${file}, ${edit}, keeping the other entries (the extension still loads, and pi install and pi update keep the filter), or update @awebai/pi to 0.5.0 or later, which bundles no skills` }], name);
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

// ------------------------------------------------------ the extension's version

test("the @awebai/pi installed in the pi folder gates the warning: 0.5.0 and later are quiet, below it warns", (t) => {
  const fx = fixture(t);
  fx.record();
  const agentDir = join(fx.user, ".pi", "agent");
  fx.piSettings({ packages: ["npm:other-tools", "npm:@awebai/pi"] });
  installPi(agentDir, "0.5.0");
  assert.deepEqual(skillsWarnings(fx.readiness()), [], "0.5.0 installed, plain entry");
  installPi(agentDir, "0.4.1");
  assert.equal(skillsWarnings(fx.readiness()).length, 1, "0.4.1 installed, plain entry");
  fx.piSettings({ packages: [{ source: "npm:@awebai/pi@latest" }] });
  installPi(agentDir, "0.5.0");
  assert.deepEqual(skillsWarnings(fx.readiness()), [], "0.5.0 installed, object entry without skills");
  for (const [version, warns] of [["0.5.1", false], ["1.0.0", false], ["0.5.0+build.7", false], ["0.4.9", true], ["0.5.0-rc.1", true], ["0.0.1", true]]) {
    installPi(agentDir, version);
    assert.equal(piExtensionSkillsWarning(agentDir)?.code, warns ? CODE : undefined, version);
  }
});

test("an @awebai/pi of unknown version warns as before: misnamed, unparsable, malformed or not installed", (t) => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "oats-aweb-pi-unknown-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, "settings.json"), JSON.stringify({ packages: ["npm:@awebai/pi"] }));
  assert.equal(piExtensionSkillsWarning(dir)?.code, CODE, "not installed");
  for (const [name, doc] of [["another package", { name: "@awebai/other", version: "0.5.0" }], ["no version", { name: "@awebai/pi" }], ["not semver", { name: "@awebai/pi", version: "latest" }], ["leading zero", { name: "@awebai/pi", version: "0.05.0" }], ["not JSON", "{"]]) {
    installPi(dir, undefined, doc);
    assert.equal(piExtensionVersion(dir), undefined, name);
    assert.equal(piExtensionSkillsWarning(dir)?.code, CODE, name);
  }
});

test("oats.aweb's piExtensionVersion answers exactly as oats.aweb-tasks's claim-floors.mjs, its other copy", (t) => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "oats-aweb-pi-parity-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const agent = join(dir, "agent");
  const both = (name) => {
    const ours = piExtensionVersion(agent);
    assert.equal(ours, tasksPiExtensionVersion(agent), `${name}: the two copies agree`);
    return ours;
  };
  assert.equal(both("missing file"), undefined);
  assert.equal(piExtensionVersion(undefined), tasksPiExtensionVersion(undefined));
  const pkg = installPi(agent, "0.5.0");
  assert.equal(both("a version"), "0.5.0");
  installPi(agent, "0.5.0-rc.1+b.2");
  assert.equal(both("a pre-release with build metadata"), "0.5.0-rc.1+b.2");
  installPi(agent, undefined, { name: "@awebai/other", version: "0.5.0" });
  assert.equal(both("a wrong name"), undefined);
  for (const version of ["latest", "0.5", "05.0.0", " 0.5.0", "", 5]) {
    installPi(agent, undefined, { name: "@awebai/pi", version });
    assert.equal(both(`unparsable ${JSON.stringify(version)}`), undefined);
  }
  installPi(agent, undefined, "{");
  assert.equal(both("malformed"), undefined);
  // 1 MiB is read; one byte more is not.
  const sized = (bytes) => { const head = JSON.stringify({ name: "@awebai/pi", version: "0.5.0", pad: "" }); return head.replace('"pad":""', `"pad":"${"x".repeat(bytes - head.length)}"`); };
  installPi(agent, undefined, sized(1 << 20));
  assert.equal(both("exactly 1 MiB"), "0.5.0");
  installPi(agent, undefined, sized((1 << 20) + 1));
  assert.equal(both("an oversized file"), undefined);
  // A link out of the pi folder's node_modules is never read; a link inside it is.
  const outside = join(dir, "linked-pi");
  mkdirSync(outside);
  writeFileSync(join(outside, "package.json"), JSON.stringify({ name: "@awebai/pi", version: "0.5.0" }));
  rmSync(dirname(pkg), { recursive: true });
  symlinkSync(outside, dirname(pkg));
  assert.equal(both("a symlink escaping the folder"), undefined);
  rmSync(dirname(pkg));
  mkdirSync(dirname(pkg));
  symlinkSync(join(outside, "package.json"), pkg);
  assert.equal(both("a package.json linked out of the folder"), undefined);
  const inside = join(agent, "npm", "node_modules", "real-pi.json");
  writeFileSync(inside, JSON.stringify({ name: "@awebai/pi", version: "0.4.1" }));
  rmSync(pkg);
  symlinkSync(inside, pkg);
  assert.equal(both("a link inside the folder"), "0.4.1");
});

test("each copy of the version reader names the other, and neither capability imports the other", () => {
  const ours = readFileSync(join(CAPABILITY, "lib", "pi-extension.mjs"), "utf8");
  const theirs = readFileSync(join(REPO, "oats-package", "capabilities", "oats-aweb-tasks", "lib", "claim-floors.mjs"), "utf8");
  assert.match(ours, /oats\.aweb-tasks's\s+(?:\*\s+)?lib\/claim-floors\.mjs piExtensionVersion/);
  assert.match(theirs, /oats\.aweb's lib\/pi-extension\.mjs carries a copy/);
  assert.doesNotMatch(ours, /from '[^']*oats-aweb-tasks\//);
});

// --------------------------------------------------------- @awebai/claude-skills

test("a pi home warns pi-skills-package-loaded when its pi folder lists @awebai/claude-skills unfiltered, whatever the extension's version", (t) => {
  const fx = fixture(t);
  fx.record();
  const agentDir = join(fx.user, ".pi", "agent");
  const file = join(agentDir, "settings.json");
  installPi(agentDir, "0.5.0");
  const baseline = fx.readiness();
  assert.deepEqual(packageWarnings(baseline), [], "no settings file: silent");
  for (const [name, entry, edit] of [
    ["plain string", "npm:@awebai/claude-skills", `remove the entry "npm:@awebai/claude-skills", or replace it with {"source":"npm:@awebai/claude-skills","skills":[]}`],
    ["versioned string", "npm:@awebai/claude-skills@0.2.17", `remove the entry "npm:@awebai/claude-skills@0.2.17", or replace it with {"source":"npm:@awebai/claude-skills@0.2.17","skills":[]}`],
    ["object without skills", { source: "npm:@awebai/claude-skills@0.2.17", prompts: [] }, `remove the entry whose "source" is "npm:@awebai/claude-skills@0.2.17", or set "skills": [] in it`],
    ["object with a non-empty skills filter", { source: "npm:@awebai/claude-skills", skills: ["skills/aweb-messaging"] }, `remove the entry whose "source" is "npm:@awebai/claude-skills", or set "skills": [] in it`],
  ]) {
    fx.piSettings({ theme: "dark", packages: ["npm:@awebai/pi", entry] });
    const result = fx.readiness();
    assert.deepEqual(packageWarnings(result), [{ code: PACKAGE_CODE, message: `pi loads the aweb skills of @awebai/claude-skills in every session that uses ${agentDir}: its settings.json lists "npm:@awebai/claude-skills" without a skills filter, and OATS gives a home its skills through its capabilities only. In ${file}, ${edit}, keeping the other entries` }], name);
    assert.deepEqual(skillsWarnings(result), [], `${name}: the extension at 0.5.0 stays quiet`);
    assert.deepEqual(without(result, PACKAGE_CODE), without(baseline, PACKAGE_CODE), `${name}: every other readiness item keeps its shape`);
  }
  for (const [name, doc] of [
    ["filtered object", { packages: [{ source: "npm:@awebai/claude-skills@0.2.17", skills: [] }] }],
    ["absent", { packages: ["npm:@awebai/pi", "npm:@awebai/claude-skills-extra", "npm:@awebai/claude", { source: "git:github.com/awebai/claude-skills" }] }],
  ]) {
    fx.piSettings(doc);
    assert.deepEqual(packageWarnings(fx.readiness()), [], name);
  }
});

test("doing what the claude-skills remedy says, either way, silences it and keeps the other entries", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "oats-aweb-pi-skills-remedy-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, "settings.json");
  for (const entry of ["npm:@awebai/claude-skills", "npm:@awebai/claude-skills@0.2.17", { source: "npm:@awebai/claude-skills", prompts: [] }]) {
    for (const way of ["remove", "filter"]) {
      writeFileSync(file, JSON.stringify({ packages: ["npm:other-tools", entry] }));
      const { message } = piSkillsPackageWarning(dir);
      const doc = JSON.parse(readFileSync(file, "utf8"));
      const plain = /remove the entry ("[^"]+"), or replace it with (\{.*?\}), keeping/.exec(message);
      const source = /remove the entry whose "source" is ("[^"]+"), or set "skills": \[\] in it/.exec(message);
      const target = plain ? (p) => p === JSON.parse(plain[1]) : (p) => p?.source === JSON.parse(source[1]);
      if (way === "remove") doc.packages = doc.packages.filter((p) => !target(p));
      else doc.packages = doc.packages.map((p) => (!target(p) ? p : plain ? JSON.parse(plain[2]) : { ...p, skills: [] }));
      writeFileSync(file, JSON.stringify(doc));
      assert.equal(piSkillsPackageWarning(dir), undefined, `${way} ${JSON.stringify(entry)}`);
      assert.equal(doc.packages[0], "npm:other-tools");
      assert.equal(doc.packages.length, way === "remove" ? 1 : 2);
    }
  }
});

test("a pi home that lists both gets both warnings; soul scope and a home on another runtime get neither", (t) => {
  const fx = fixture(t);
  installPi(join(fx.user, ".pi", "agent"), "0.4.1");
  fx.piSettings({ packages: ["npm:@awebai/pi", "npm:@awebai/claude-skills@0.2.17"] });
  fx.record();
  assert.deepEqual(skillsCodes(fx.readiness()), [CODE, PACKAGE_CODE], "pi home");
  assert.deepEqual(skillsCodes(fx.readiness({ targetHome: null })), [], "soul scope");
  for (const harness of ["claude", "codex"]) {
    fx.record({ harness });
    assert.deepEqual(skillsCodes(fx.readiness()), [], harness);
  }
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
    assert.equal(row.install, `pi install ${spec}, then, if the @awebai/pi installed is below 0.5.0, make its entry {"source": "${spec}", "skills": []} in the pi folder's settings.json (PI_CODING_AGENT_DIR, else ~/.pi/agent), so pi loads the extension without its bundled skills. Never install @awebai/claude-skills in a pi folder that OATS homes use: a home's skills come from its capabilities (README, "The pi extension without its skills")`);
    const entry = JSON.parse(/\{"source".*?\}/.exec(row.install)[0]);
    writeFileSync(join(dir, "settings.json"), JSON.stringify({ packages: [entry] }));
    assert.equal(piExtensionSkillsWarning(dir), undefined, `${row.when.delivery}: the named entry is the filtered one`);
    writeFileSync(join(dir, "settings.json"), JSON.stringify({ packages: [spec] }));
    assert.equal(piExtensionSkillsWarning(dir)?.code, CODE, `${row.when.delivery}: what pi install alone writes warns below 0.5.0`);
    installPi(dir, "0.5.0");
    assert.equal(piExtensionSkillsWarning(dir), undefined, `${row.when.delivery}: what pi install alone writes is quiet from 0.5.0`);
    rmSync(join(dir, "npm"), { recursive: true });
  }
  assert.match(readme, /^#{2,4} The pi extension without its skills$/m, "the README section the install text names");
});

// --------------------------------------------------------- vendored skill text

test("a sync writes the vendored aweb-messaging Pi line: OATS installs the extension without its skills, and not @awebai/claude-skills", () => {
  const [[skill, file, upstream, adapted]] = LINE_ADAPTATIONS;
  assert.equal(`${skill}/${file}`, "aweb-messaging/SKILL.md");
  assert.equal(adapted, `- **Pi**: OATS installs the \`@awebai/pi\` extension; below 0.5.0, its entry in the pi folder's \`settings.json\` carries \`"skills": []\`, as \`{"source": "npm:@awebai/pi", "skills": []}\`. A home's skills come from OATS: don't install \`@awebai/claude-skills\` in a pi folder that OATS homes use.`);
  assert.equal(upstream, "- **Pi**: install `@awebai/pi`; the aweb channel and these skills are bundled together.", "the upstream line stays the pinned 0.2.3 one");
  const shipped = readFileSync(join(CAPABILITY, "skills", skill, file), "utf8");
  assert.equal(shipped.split("\n").filter((l) => l === adapted).length, 1, "the shipped skill carries the adapted line");
  assert.doesNotMatch(shipped, /bundled together/);
  // Upstream's text (the shipped skill with upstream's line back) adapts to exactly the shipped skill.
  assert.equal(adaptVendored(skill, file, shipped.replace(adapted, upstream)), shipped);
  assert.throws(() => adaptVendored(skill, file, shipped), /expected upstream line .* exactly once, found 0/, "a changed upstream is refused, not passed through");
  assert.equal(adaptVendored("aweb-identity", "SKILL.md", "untouched"), "untouched");
});
