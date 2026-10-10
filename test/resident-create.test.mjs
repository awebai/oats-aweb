// oats aweb resident create: the provider command that provisions a GLOBAL
// resident identity in an existing hosted team, serves it with a per-user
// custody unit and records it in the deployment. aw answers come from real
// aw 1.36.33 captures (test/fixtures/resident); see helpers/fake-aw-resident.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { userInfo } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { CAPTURED, fixture } from "./helpers/fake-aw-resident.mjs";
import { AWEB_URL, HOOK, KEY, LABEL, NAME, initCalls, setup } from "./helpers/resident-harness.mjs";
import { fakeKernelTeamConfig } from "./helpers/fake-kernel-team-config.mjs";

function filesUnder(dir) {
  const out = [];
  const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) walk(p); else if (e.isFile()) out.push(p); } };
  if (existsSync(dir)) walk(dir);
  return out;
}
/** Every written file and every log of the run, except the fakes themselves
 *  and the call log, which records the init child's environment on purpose. */
function keyHits(base) {
  return filesUnder(base).filter((p) => !p.startsWith(join(base, "bin")) && p !== join(base, "calls.jsonl") && readFileSync(p, "utf8").includes(KEY));
}

// ------------------------------------------------------------------ arguments

test("the manifest declares the resident command the kernel dispatches as oats aweb resident", () => {
  const manifest = JSON.parse(readFileSync(new URL("../oats-package/capabilities/oats-aweb/oats.json", import.meta.url), "utf8"));
  assert.equal(manifest.commands.resident, "bin/oats-aweb.mjs resident");
});

test("usage documents the env form and no key flag; every key flag is refused as an unknown argument", (t) => {
  const s = setup(t);
  for (const args of [["create", NAME, "--key", KEY], ["create", NAME, `--key=${KEY}`], ["create", NAME, "--key-file", "/k"], ["create", NAME, "--key-stdin"], ["create", NAME, "--api-key", KEY], ["create", NAME, "--aweb-url", AWEB_URL], [], ["create"], ["delete", NAME]]) {
    const r = s.run(args);
    assert.equal(r.status, 2, JSON.stringify(args));
    assert.equal(r.stderr, "usage: AWEB_API_KEY=<key> AWEB_URL=<url> oats aweb resident create <name> [--dir <deployment>] [--root <dir>] [--team-label <label>] [--plan] [--json]\n");
    assert.ok(!r.stdout.includes(KEY) && !r.stderr.includes(KEY));
  }
  assert.deepEqual(initCalls(s.fake), []);
  const json = s.run(["create", NAME, "--key-stdin", "--json"]);
  assert.equal(json.status, 2);
  assert.deepEqual(json.doc, { schemaVersion: 1, ok: false, error: { code: "E_RESIDENT_ARGUMENT", message: "usage: AWEB_API_KEY=<key> AWEB_URL=<url> oats aweb resident create <name> [--dir <deployment>] [--root <dir>] [--team-label <label>] [--plan] [--json]", details: { stage: "arguments" } } });
});

test("an invalid resident name is refused before anything runs", (t) => {
  const s = setup(t);
  const r = s.run(["create", "bad.name"]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /^FAIL arguments: invalid resident name "bad\.name": aweb aliases must be 1-64 characters/);
  assert.deepEqual(s.fake.calls(), []);
});

// ------------------------------------------------------------------ the key

test("no TTY and no key refuses at once, before aw init", (t) => {
  const s = setup(t);
  const r = s.run(["create", NAME], {}, { unset: ["AWEB_API_KEY"] });
  assert.equal(r.status, 1);
  assert.ok(r.ms < 10000, `took ${r.ms} ms`);
  assert.equal(r.stderr, `FAIL key: no AWEB_API_KEY in the environment and no terminal to ask for it on: run AWEB_API_KEY=<key> AWEB_URL=<url> oats aweb resident create ${NAME}\n`);
  assert.deepEqual(initCalls(s.fake), []);
  assert.equal(existsSync(s.root), false);
});

// Runs the command on a real pseudo-terminal, types `input` after the prompt,
// and returns everything the terminal showed.
const PTY_DRIVER = `
import base64, os, pty, select, sys, time
argv, typed = sys.argv[2:], sys.argv[1].encode()
pid, fd = pty.fork()
if pid == 0:
    os.execvp(argv[0], argv)
shown, sent, deadline = b"", False, time.time() + 30
while time.time() < deadline:
    r, _, _ = select.select([fd], [], [], 0.2)
    if fd in r:
        try: chunk = os.read(fd, 4096)
        except OSError: break
        if not chunk: break
        shown += chunk
    if not sent and b"(input hidden): " in shown:
        os.write(fd, typed); sent = True
_, status = os.waitpid(pid, 0)
print(base64.b64encode(shown).decode()); print(os.waitstatus_to_exitcode(status))
`;
function onTerminal(s, args, typed, env) {
  const r = spawnSync("python3", ["-I", "-c", PTY_DRIVER, typed, process.execPath, HOOK, "resident", ...args], { env, encoding: "utf8", timeout: 60000 });
  assert.equal(r.status, 0, r.stderr);
  const [shown, code] = r.stdout.trim().split("\n");
  return { shown: Buffer.from(shown, "base64").toString("utf8"), code: Number(code) };
}

test("with no key in the environment, a terminal prompt reads it without echo and hands it to the init child", (t) => {
  if (spawnSync("python3", ["-c", "import pty"]).status !== 0) { t.skip("python3 with pty is required to drive a terminal"); return; }
  const s = setup(t);
  const env = { ...s.env }; delete env.AWEB_API_KEY;
  const { shown, code } = onTerminal(s, ["create", NAME], `${KEY}\r`, env);
  assert.equal(code, 0, shown);
  assert.match(shown, /aweb API key \(input hidden\): /);
  assert.ok(!shown.includes(KEY), shown);
  assert.match(shown, new RegExp(`PASS resident ${CAPTURED.address}`));
  assert.equal(initCalls(s.fake)[0].env.AWEB_API_KEY, KEY);
  assert.deepEqual(keyHits(s.base), []);
});

test("an empty answer at the prompt refuses without running init", (t) => {
  if (spawnSync("python3", ["-c", "import pty"]).status !== 0) { t.skip("python3 with pty is required to drive a terminal"); return; }
  const s = setup(t);
  const env = { ...s.env }; delete env.AWEB_API_KEY;
  const { shown, code } = onTerminal(s, ["create", NAME], "\r", env);
  assert.equal(code, 1);
  assert.match(shown, /FAIL key: no API key was entered/);
  assert.deepEqual(initCalls(s.fake), []);
});

test("AWEB_URL is required for an init", (t) => {
  const s = setup(t);
  const r = s.run(["create", NAME, "--json"], {}, { unset: ["AWEB_URL"] });
  assert.equal(r.status, 1);
  assert.equal(r.doc.error.code, "E_RESIDENT_ARGUMENT");
  assert.equal(r.doc.error.message, `AWEB_URL is not set: copy the dashboard line, AWEB_API_KEY=<key> AWEB_URL=<url> oats aweb resident create ${NAME}`);
  assert.deepEqual(initCalls(s.fake), []);
});

test("the init child gets exactly the env built from nothing, and the key is in no argv and no other child", (t) => {
  const s = setup(t);
  const r = s.run(["create", NAME], { AWEB_IDENTITY_HOME: "/elsewhere/.aw", AWEB_TEAM_ID: "x", AW_DEBUG: "1", AWID_REGISTRY_URL: "http://127.0.0.1:18010", SECRET_TOKEN: "s" });
  assert.equal(r.status, 0, r.stderr);
  const [init, ...more] = initCalls(s.fake);
  assert.equal(more.length, 0, "one run, no retry");
  assert.deepEqual(init.argv, ["init", "--global", "--name", NAME, "--do-not-touch-agents-md", "--json"]);
  assert.equal(init.cwd, s.root);
  assert.deepEqual(Object.keys(init.env).filter((k) => k !== "__CF_USER_TEXT_ENCODING").sort(), ["AWEB_API_KEY", "AWEB_URL", "AWID_REGISTRY_URL", "AW_NO_UPDATE_CHECK", "HOME", "PATH"]);
  assert.deepEqual({ ...init.env, __CF_USER_TEXT_ENCODING: undefined }, { AWEB_API_KEY: KEY, AWEB_URL, AWID_REGISTRY_URL: "http://127.0.0.1:18010", AW_NO_UPDATE_CHECK: "1", HOME: s.home, PATH: s.env.PATH, __CF_USER_TEXT_ENCODING: undefined });
  for (const call of s.fake.calls()) {
    assert.ok(!call.argv.some((a) => a.includes(KEY)), `${call.cmd} ${call.argv.join(" ")}`);
    if (!(call.cmd === "aw" && call.argv[0] === "init")) assert.ok(!Object.values(call.env).some((v) => String(v).includes(KEY)), `${call.cmd} ${call.argv.join(" ")} has the key in its env`);
  }
});

test("AWID_REGISTRY_URL reaches the init child only when it is set", (t) => {
  const s = setup(t);
  assert.equal(s.run(["create", NAME]).status, 0);
  assert.equal(Object.hasOwn(initCalls(s.fake)[0].env, "AWID_REGISTRY_URL"), false);
});

// ------------------------------------------------------------------ success

test("create: PASS line, next step, recorded resident, custody unit, captures, and no key in any written file", (t) => {
  const s = setup(t);
  const r = s.run(["create", NAME]);
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stdout.trimEnd().split("\n");
  assert.equal(lines[0], `PASS resident ${CAPTURED.address} team ${CAPTURED.team} custody running`);
  assert.match(r.stdout, new RegExp(`Next: spawn a seat on this resident: give its soul the oats\\.aweb settings identity: \\{ mode: global, resident: ${NAME} \\}, then oats spawn <soul>\\.`));
  assert.equal(s.localYaml(), `schemaVersion: 2\nworkspace: local\nsettings:\n  oats.aweb:\n    residents:\n      "${NAME}": ${JSON.stringify(s.root)}\n`);
  const unit = readFileSync(s.unitPath, "utf8");
  assert.ok(unit.includes(s.root));
  assert.ok(s.fake.loaded());
  const captures = readdirSync(join(s.root, ".oats-resident"));
  assert.deepEqual(captures.map((n) => n.replace(/^init-\d{8}T\d{6}Z\./, "init-<at>.")).sort(), ["init-<at>.exit", "init-<at>.stderr", "init-<at>.stdout"]);
  assert.equal(statSync(join(s.root, ".oats-resident")).mode & 0o777, 0o700);
  for (const c of captures) assert.equal(statSync(join(s.root, ".oats-resident", c)).mode & 0o777, 0o600);
  assert.deepEqual(keyHits(s.base), []);
  assert.ok(!r.stdout.includes(KEY) && !r.stderr.includes(KEY));
});

test("create --json answers one envelope with the outcome, the unit and the recorded setting", (t) => {
  const s = setup(t);
  const r = s.run(["create", NAME, "--json"]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim().split("\n").length, 1);
  const { result } = r.doc;
  assert.equal(r.doc.ok, true);
  assert.deepEqual({ ...result, captures: undefined }, {
    outcome: "created", name: NAME, root: s.root, address: CAPTURED.address, team: CAPTURED.team, stableId: CAPTURED.stableId,
    custody: { status: "running", manager: process.platform === "darwin" ? "launchd" : "systemd", label: LABEL, path: s.unitPath },
    recorded: { file: join(s.deployment, "oats-local.yaml"), setting: `settings.oats.aweb.residents.${NAME}` },
    warnings: ["aw doctor registry --online: awid.address.delivery_origin is warn (this can be publication lag)"],
    next: `spawn a seat on this resident: give its soul the oats.aweb settings identity: { mode: global, resident: ${NAME} }, then oats spawn <soul>.`,
    captures: undefined,
  });
  assert.equal(result.captures.length, 3);
});

test("a re-run after success is a pure verify: no init, already exists, custody re-ensured", (t) => {
  const s = setup(t);
  assert.equal(s.run(["create", NAME]).status, 0);
  const yaml = s.localYaml();
  // The kernel hands the recorded resident back in the provider's settings.
  const recorded = { OATS_SETTINGS: JSON.stringify({ residents: { [NAME]: s.root } }) };
  const r = s.run(["create", NAME, "--json"], recorded, { unset: ["AWEB_API_KEY", "AWEB_URL"] });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.doc.result.outcome, "already-exists");
  assert.equal(initCalls(s.fake).length, 1);
  assert.equal(s.localYaml(), yaml);
  const text = s.run(["create", NAME], recorded, { unset: ["AWEB_API_KEY", "AWEB_URL"] });
  assert.equal(text.stdout.split("\n")[0], `PASS resident ${CAPTURED.address} team ${CAPTURED.team} custody running (already exists)`);
});

// ------------------------------------------------------------------ init failures

test("an init failure that leaves a partial passes aw's text through, rerun included, and keeps the partial", (t) => {
  const s = setup(t, { init: "partial-404" });
  const r = s.run(["create", NAME, "--json"]);
  assert.equal(r.status, 1);
  assert.equal(r.doc.error.code, "E_RESIDENT_INIT");
  assert.equal(r.doc.error.message, fixture("init-apikey-workspace-init-404").stderr.trim());
  assert.equal(r.doc.error.details.stage, "init");
  assert.equal(r.doc.error.details.partial, join(s.root, ".aw", "partial-init.yaml"));
  assert.ok(existsSync(join(s.root, ".aw", "partial-init.yaml")));
  const text = s.run(["create", NAME]);
  assert.equal(text.stderr, `FAIL init: ${fixture("init-apikey-workspace-init-404").stderr.trim()}\n`);
});

test("a root holding a partial is continued: one init in that root, outcome resumed", (t) => {
  const s = setup(t);
  mkdirSync(join(s.root, ".aw"), { recursive: true });
  writeFileSync(join(s.root, ".aw", "partial-init.yaml"), "");
  const r = s.run(["create", NAME, "--json"]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.doc.result.outcome, "resumed");
  assert.equal(initCalls(s.fake).length, 1);
  assert.equal(initCalls(s.fake)[0].cwd, s.root);
});

test("aw's registry-context refusal passes through unchanged, with no rerun advice of ours", (t) => {
  const s = setup(t, { init: "mismatch" });
  mkdirSync(join(s.root, ".aw"), { recursive: true });
  writeFileSync(join(s.root, ".aw", "partial-init.yaml"), "");
  const r = s.run(["create", NAME, "--json"], { AWID_REGISTRY_URL: "http://localhost:18010" });
  assert.equal(r.status, 1);
  assert.equal(r.doc.error.message, fixture("init-apikey-registry-mismatch").stderr.trim());
  assert.equal(r.doc.error.details.partial, join(s.root, ".aw", "partial-init.yaml"), "the partial is a fact; what to do is aw's text");
});

test("a quarantined partial: init runs once and aw's refusal is the answer, never rerun", (t) => {
  const s = setup(t, { init: "rejected" });
  mkdirSync(join(s.root, ".aw"), { recursive: true });
  writeFileSync(join(s.root, ".aw", "partial-init.yaml.20261010T000000.000000000Z.1.rejected"), "");
  const r = s.run(["create", NAME, "--json"]);
  assert.equal(r.status, 1);
  assert.equal(r.doc.error.code, "E_RESIDENT_INIT");
  assert.equal(r.doc.error.message, fixture("init-apikey-rejected").stderr.trim());
  assert.doesNotMatch(r.stdout + r.stderr, /rerun/i);
  assert.equal(initCalls(s.fake).length, 1);
});

test("an init that leaves nothing to continue says so and names the capture", (t) => {
  const s = setup(t, { init: "nothing" });
  const r = s.run(["create", NAME, "--json"]);
  assert.equal(r.status, 1);
  assert.equal(r.doc.error.code, "E_RESIDENT_NOTHING_TO_CONTINUE");
  const capture = r.doc.error.details.captures.find((p) => p.endsWith(".stderr"));
  assert.equal(r.doc.error.message, `${fixture("init-apikey-registry-local").stderr.trim()}\nprovisioning left nothing to continue; ${s.root} contains .oats-resident; contact aweb with ${capture}`);
  assert.equal(readFileSync(capture, "utf8"), fixture("init-apikey-registry-local").stderr);
  // R now holds only the captures: a re-run refuses rather than init into it.
  const again = s.run(["create", NAME, "--json"]);
  assert.equal(again.doc.error.code, "E_RESIDENT_ROOT");
  assert.equal(initCalls(s.fake).length, 1);
});

test("the key is never echoed: an aw that prints it on both streams is scrubbed in our output and in the captures", (t) => {
  const s = setup(t, { init: "echo-key" });
  for (const args of [["create", NAME], ["create", NAME, "--json"]]) {
    rmSync(s.root, { recursive: true, force: true });
    const r = s.run(args);
    assert.equal(r.status, 1);
    assert.ok(!r.stdout.includes(KEY), r.stdout);
    assert.ok(!r.stderr.includes(KEY), r.stderr);
    assert.match(r.stdout + r.stderr, /rejected key <redacted>/);
  }
  assert.deepEqual(keyHits(s.base), []);
});

// ------------------------------------------------------------------ preflight

test("a root holding anything else is refused, naming what is there, before any init", (t) => {
  const s = setup(t);
  mkdirSync(s.root, { recursive: true });
  writeFileSync(join(s.root, ".env"), "X=1\n");
  mkdirSync(join(s.root, "notes"));
  const r = s.run(["create", NAME, "--json"]);
  assert.equal(r.status, 1);
  assert.equal(r.doc.error.code, "E_RESIDENT_ROOT");
  assert.equal(r.doc.error.message, `${s.root} is neither empty, a partial aw init nor a complete global identity: it contains .env, notes; never init into it: choose another --root or empty it yourself`);
  assert.deepEqual(initCalls(s.fake), []);
});

test("a resident already recorded at another root is refused, naming both", (t) => {
  const s = setup(t);
  const r = s.run(["create", NAME, "--json"], { OATS_SETTINGS: JSON.stringify({ residents: { [NAME]: "/elsewhere/carol" } }) });
  assert.equal(r.status, 1);
  assert.equal(r.doc.error.code, "E_RESIDENT_ROOT");
  assert.equal(r.doc.error.message, `settings.oats.aweb.residents.${NAME} already records /elsewhere/carol, not ${s.root}: pass --root /elsewhere/carol to verify that resident, or choose another name`);
  assert.deepEqual(initCalls(s.fake), []);
});

test("a custody unit for this name that serves another directory is refused before any init", (t) => {
  const s = setup(t);
  mkdirSync(dirname(s.unitPath), { recursive: true });
  const other = `${dirname(s.unitPath)}/ai.aweb.custody.other.example.${NAME}${process.platform === "darwin" ? ".plist" : ".service"}`;
  writeFileSync(other, process.platform === "darwin"
    ? `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict><key>Label</key><string>x</string><key>WorkingDirectory</key><string>/srv/other/carol</string></dict></plist>\n`
    : `[Service]\nWorkingDirectory=/srv/other/carol\nExecStart=/usr/bin/aw custody serve\n`);
  const r = s.run(["create", NAME, "--json"]);
  assert.equal(r.status, 1);
  assert.equal(r.doc.error.code, "E_RESIDENT_UNIT_CONFLICT");
  assert.equal(r.doc.error.message, `custody unit ${other} already serves /srv/other/carol, not ${s.root}; remove that unit or choose another name`);
  assert.deepEqual(initCalls(s.fake), []);
});

test("--plan changes nothing and names the steps without the key", (t) => {
  const s = setup(t);
  const before = s.localYaml();
  const r = s.run(["create", NAME, "--plan", "--json"]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(existsSync(s.root), false);
  assert.equal(existsSync(s.unitPath), false);
  assert.equal(s.localYaml(), before);
  assert.deepEqual(initCalls(s.fake), []);
  const plan = r.doc.result;
  assert.equal(plan.outcome, "plan");
  assert.equal(plan.state, "create");
  assert.deepEqual(plan.init, { argv: ["aw", "init", "--global", "--name", NAME, "--do-not-touch-agents-md", "--json"], cwd: s.root, env: ["PATH", "HOME", "AWEB_URL", "AWEB_API_KEY", "AW_NO_UPDATE_CHECK"] });
  assert.equal(plan.custody.label, `ai.aweb.custody.<domain of the returned address>.${NAME}`);
  assert.equal(plan.record, `settings.oats.aweb.residents.${NAME}: ${s.root} in ${join(s.deployment, "oats-local.yaml")}`);
  assert.ok(!r.stdout.includes(KEY));
});

// ------------------------------------------------------------------ verify and custody

test("verify requires every offline identity check to be ok, not only the top-level status", (t) => {
  // A root with identity marker files whose doctor answers like the empty-root
  // capture: status ok, every check info.
  const s = setup(t);
  const aw = join(s.fake.bin, "aw");
  writeFileSync(aw, readFileSync(aw, "utf8").replace('replay(f["doctor-identity-offline"])', 'replay({ stdout: ' + JSON.stringify(fixture("doctor-identity-offline-partial").stdout) + ', stderr: "", exit: 0 })'));
  const r = s.run(["create", NAME, "--json"]);
  assert.equal(r.status, 1);
  assert.equal(r.doc.error.code, "E_RESIDENT_VERIFY");
  assert.match(r.doc.error.message, /^aw doctor identity --offline: identity\.local\.context is info, not ok/);
  assert.equal(existsSync(s.unitPath), false);
});

test("custody without the floor ops fails at the custody stage, naming them", (t) => {
  const s = setup(t, { custody: "missing-ops" });
  const r = s.run(["create", NAME, "--json"]);
  assert.equal(r.status, 1);
  assert.equal(r.doc.error.code, "E_RESIDENT_CUSTODY");
  assert.match(r.doc.error.message, /required custody operations are missing: mail_reply_continuation\.v1, grant_never_ttl\.v1; restart the custody on aw 1\.36\.33 or later/);
  assert.doesNotMatch(s.localYaml(), /residents/);
});

// ------------------------------------------------------------------ --team-label

test("--team-label maps the label to the returned team where local teams are allowed; the kernel child gets no aweb variables", (t) => {
  const s = setup(t);
  const kernel = fakeKernelTeamConfig(join(s.base, "kernel"), s.deployment);
  const r = s.run(["create", NAME, "--team-label", "residents", "--json"], { OATS_CLI_BIN: kernel.cli, AWID_REGISTRY_URL: "http://127.0.0.1:18010" });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.doc.result.teamLabel, { label: "residents", team: CAPTURED.team, status: "added" });
  assert.deepEqual(kernel.read().teams.find((row) => row.label === "residents"), { label: "residents", team: CAPTURED.team, from: "local" });
  for (const call of kernel.calls()) assert.deepEqual(call.awebEnv, [], JSON.stringify(call.args));
  const again = s.run(["create", NAME, "--team-label", "residents", "--json"], { OATS_CLI_BIN: kernel.cli });
  assert.deepEqual(again.doc.result.teamLabel, { label: "residents", team: CAPTURED.team, status: "reused" });
});

test("--team-label on a workspace without local teams prints the lines to commit and edits nothing", (t) => {
  const s = setup(t);
  const kernel = fakeKernelTeamConfig(join(s.base, "kernel"), s.deployment, { localTeams: false });
  const r = s.run(["create", NAME, "--team-label", "residents"], { OATS_CLI_BIN: kernel.cli });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.stdout.includes(`This workspace does not allow local teams; commit the team in oats-workspace.yaml:\n    teams:\n      "residents": { team: "${CAPTURED.team}" }\n`), r.stdout);
  assert.deepEqual(kernel.calls().filter((c) => c.args[1] === "add"), []);
});

test("--team-label already mapped to another team is refused at the record stage", (t) => {
  const s = setup(t);
  const kernel = fakeKernelTeamConfig(join(s.base, "kernel"), s.deployment, { teams: [{ label: "residents", team: "default:other.example", from: "local" }] });
  const r = s.run(["create", NAME, "--team-label", "residents", "--json"], { OATS_CLI_BIN: kernel.cli });
  assert.equal(r.status, 1);
  assert.equal(r.doc.error.code, "E_RESIDENT_TEAM_LABEL");
  assert.equal(r.doc.error.message, `team label residents already maps to default:other.example, not ${CAPTURED.team}; choose another --team-label`);
});

test("Linux without systemd lingering stops before any init with the exact admin command", (t) => {
  if (process.platform !== "linux") { t.skip("lingering is systemd's, on Linux"); return; }
  const s = setup(t, { linger: "no" });
  const user = userInfo().username;
  const r = s.run(["create", NAME, "--json"]);
  assert.equal(r.status, 1);
  assert.equal(r.doc.error.code, "E_RESIDENT_LINGER");
  assert.equal(r.doc.error.message, `systemd lingering is off for ${user}, so the custody unit would stop when ${user} logs out: an administrator runs \`loginctl enable-linger ${user}\`, then rerun`);
  assert.deepEqual(initCalls(s.fake), []);
  assert.equal(existsSync(s.root), false);
});

test("--plan on a complete identity names the exact unit and needs no key", (t) => {
  const s = setup(t);
  mkdirSync(join(s.root, ".aw"), { recursive: true });
  for (const f of ["identity.yaml", "signing.key", "workspace.yaml"]) writeFileSync(join(s.root, ".aw", f), "");
  const r = s.run(["create", NAME, "--plan"], {}, { unset: ["AWEB_API_KEY", "AWEB_URL"] });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.split("\n")[0], `Plan for resident ${NAME} in ${s.root} (adopt). Nothing was changed.`);
  assert.ok(r.stdout.includes(`unit ${LABEL} at ${s.unitPath}`), r.stdout);
  assert.doesNotMatch(r.stdout, /init:/);
  assert.equal(existsSync(s.unitPath), false);
});
