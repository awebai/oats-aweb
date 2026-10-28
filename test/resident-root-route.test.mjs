// oats aweb resident create without an API key (awebai/oats-aweb#146): the
// deployment's team root authorizes `aw id create` for the resident, through
// aw's --owner-identity-home. The fake answers it in aw's own JSON shape
// (helpers/fake-aw-resident.mjs); no test runs it against a real server.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { AUTHORITY_TEAM_ID, CAPTURED, fakeResidentAw } from "./helpers/fake-aw-resident.mjs";
import { HOOK, KEY, NAME, createCalls, initCalls, setup, teamRoot } from "./helpers/resident-harness.mjs";
import { AW_RESIDENT_ROOT_MIN } from "../oats-package/capabilities/oats-aweb/lib/aw-floor.mjs";

const KEYLESS = { unset: ["AWEB_API_KEY", "AWEB_URL"] };
const ROOT_AW = { version: AW_RESIDENT_ROOT_MIN };
const settings = (doc) => ({ OATS_SETTINGS: JSON.stringify(doc) });
const createArgv = (s, authority, org = "acme", teamId = AUTHORITY_TEAM_ID) => ["--identity-home", join(s.root, ".aw"), "id", "create", "--owner-identity-home", join(authority, ".aw"), "--org", org, "--team-id", teamId, "--name", NAME, "--inbound-mode", "contacts-only", "--json"];
const recovery = (s) => join(s.root, ".aw", "hosted-identity-create.json");
const envKeys = (call) => Object.keys(call.env).filter((k) => k !== "__CF_USER_TEXT_ENCODING").sort();

test("the root route runs exactly aw id create with the team root's .aw as owner, in the team root, with no key and no aweb variable", (t) => {
  const s = setup(t, ROOT_AW);
  const authority = teamRoot(s);
  const r = s.run(["create", NAME, "--json"], { ...settings({ root: authority }), AWEB_IDENTITY_HOME: "/elsewhere/.aw", AWEB_TEAM_ID: "x", SECRET_TOKEN: "s" }, KEYLESS);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.doc.result.outcome, "created");
  const [create, ...more] = createCalls(s.fake);
  assert.equal(more.length, 0, "one run, no retry");
  assert.deepEqual(create.argv, createArgv(s, authority));
  assert.equal(create.cwd, authority);
  assert.deepEqual(envKeys(create), ["AW_NO_UPDATE_CHECK", "HOME", "PATH"]);
  assert.deepEqual(initCalls(s.fake), []);
  for (const call of s.fake.calls()) assert.deepEqual(Object.keys(call.env).filter((k) => /^AWEB_/.test(k)), [], `${call.cmd} ${call.argv.join(" ")}`);
  // The team id and the org come from the team root's own identity.
  const reads = s.fake.calls().filter((c) => c.cmd === "aw" && c.argv[0] === "--identity-home" && c.argv[1] === join(authority, ".aw"));
  assert.deepEqual(reads.map((c) => c.argv.slice(2)), [["inbound-mode", "--json"], ["whoami", "--json"]]);
  // The resident is recorded and served as on the key route.
  assert.ok(s.localYaml().includes(`"${NAME}": ${JSON.stringify(s.root)}`));
  assert.ok(s.fake.loaded());
});

test("AWID_REGISTRY_URL reaches aw id create only when it is set", (t) => {
  const s = setup(t, ROOT_AW);
  const authority = teamRoot(s);
  assert.equal(s.run(["create", NAME], { ...settings({ root: authority }), AWID_REGISTRY_URL: "http://127.0.0.1:18010" }, KEYLESS).status, 0);
  const [create] = createCalls(s.fake);
  assert.deepEqual(envKeys(create), ["AWID_REGISTRY_URL", "AW_NO_UPDATE_CHECK", "HOME", "PATH"]);
  assert.equal(create.env.AWID_REGISTRY_URL, "http://127.0.0.1:18010");
});

// ------------------------------------------------------------------ route selection

test("with AWEB_API_KEY set, the key route runs even where a team root exists", (t) => {
  const s = setup(t, ROOT_AW);
  const authority = teamRoot(s);
  const r = s.run(["create", NAME, "--json"], settings({ root: authority }));
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(initCalls(s.fake).length, 1);
  assert.deepEqual(createCalls(s.fake), []);
});

test("the root for the resident's team, roots[team], wins over root", (t) => {
  // The deployment's default team is the one the captured resident is in.
  const team = CAPTURED.team;
  const s = setup(t, ROOT_AW, { kernel: { teams: [{ label: "default", team, from: "local" }], defaultTeam: { label: "default", team, from: "deployment" } } });
  const forTeam = teamRoot(s, "team-root"), plain = teamRoot(s, "plain-root");
  const r = s.run(["create", NAME, "--json"], settings({ root: plain, roots: { [team]: forTeam } }), KEYLESS);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(createCalls(s.fake)[0].argv, createArgv(s, forTeam));
});

test("--team-label selects the root of the team it maps to", (t) => {
  const team = "ops:acme.aweb.ai";
  const s = setup(t, ROOT_AW, { kernel: { teams: [{ label: "ops", team, from: "local" }] } });
  const forTeam = teamRoot(s, "ops-root"), plain = teamRoot(s, "plain-root");
  const r = s.run(["create", NAME, "--team-label", "ops", "--plan", "--json"], settings({ root: plain, roots: { [team]: forTeam } }), KEYLESS);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.doc.result.init.authorityRoot, forTeam);
  assert.equal(r.doc.result.init.authorityFrom, `settings.oats.aweb.roots[${JSON.stringify(team)}]`);
});

test("--authority-root overrides the settings", (t) => {
  const s = setup(t, ROOT_AW);
  const given = teamRoot(s, "given-root"), plain = teamRoot(s, "plain-root");
  const r = s.run(["create", NAME, "--authority-root", given, "--json"], settings({ root: plain }), KEYLESS);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(createCalls(s.fake)[0].argv, createArgv(s, given));
});

test("--authority-root or --org with AWEB_API_KEY set is refused: the two routes do not combine", (t) => {
  const s = setup(t, ROOT_AW);
  for (const [flag, value] of [["--authority-root", teamRoot(s)], ["--org", "acme"]]) {
    const r = s.run(["create", NAME, flag, value, "--json"]);
    assert.equal(r.status, 1);
    assert.equal(r.doc.error.code, "E_RESIDENT_ARGUMENT");
    assert.equal(r.doc.error.message, `${flag} belongs to the root route, and AWEB_API_KEY selects the key route: unset AWEB_API_KEY or drop ${flag}`);
  }
  assert.deepEqual(s.fake.calls().filter((c) => c.cmd === "aw" && c.argv[0] !== "version"), []);
});

test("neither a key nor a team root: E_RESIDENT_KEY names both routes, and nothing runs", (t) => {
  const s = setup(t, ROOT_AW);
  const r = s.run(["create", NAME, "--json"], {}, KEYLESS);
  assert.equal(r.status, 1);
  assert.equal(r.doc.error.code, "E_RESIDENT_KEY");
  assert.equal(r.doc.error.details.stage, "key");
  assert.equal(r.doc.error.message, `no AWEB_API_KEY in the environment and no team root to authorize the resident: for the root route, set settings.oats.aweb.root (or settings.oats.aweb.roots[<team>]) to the directory holding the team root's .aw, or pass --authority-root <dir>; for the key route, run AWEB_API_KEY=<key> AWEB_URL=<url> oats aweb resident create ${NAME}`);
  assert.deepEqual(createCalls(s.fake), []);
  assert.deepEqual(initCalls(s.fake), []);
  assert.equal(existsSync(s.root), false);
});

test("a configured root that holds no .aw is not a team root", (t) => {
  const s = setup(t, ROOT_AW);
  const empty = join(s.base, "empty-root");
  mkdirSync(empty);
  const r = s.run(["create", NAME, "--json"], settings({ root: empty }), KEYLESS);
  assert.equal(r.doc.error.code, "E_RESIDENT_KEY");
  assert.equal(r.doc.error.message, `no AWEB_API_KEY in the environment, and settings.oats.aweb.root (${empty}) holds no .aw to authorize the resident: point it at the team root, pass --authority-root <dir>, or run AWEB_API_KEY=<key> AWEB_URL=<url> oats aweb resident create ${NAME}`);
  const given = s.run(["create", NAME, "--authority-root", empty, "--json"], {}, KEYLESS);
  assert.equal(given.doc.error.code, "E_RESIDENT_KEY");
  assert.match(given.doc.error.message, /--authority-root \(.*\) holds no \.aw/);
  assert.deepEqual(createCalls(s.fake), []);
});

test("the team root cannot be the resident's own directory", (t) => {
  const s = setup(t, ROOT_AW);
  const r = s.run(["create", NAME, "--root", join(s.base, "team-root"), "--authority-root", teamRoot(s), "--json"], {}, KEYLESS);
  assert.equal(r.doc.error.code, "E_RESIDENT_ROOT");
  assert.match(r.doc.error.message, /is the team root that authorizes it/);
  assert.deepEqual(createCalls(s.fake), []);
});

test("a partial aw init is continued only by the key route: without a key it is refused, with no create", (t) => {
  const s = setup(t, ROOT_AW);
  mkdirSync(join(s.root, ".aw"), { recursive: true });
  writeFileSync(join(s.root, ".aw", "partial-init.yaml"), "");
  const r = s.run(["create", NAME, "--json"], settings({ root: teamRoot(s) }), KEYLESS);
  assert.equal(r.doc.error.code, "E_RESIDENT_KEY");
  assert.equal(r.doc.error.message, `${s.root} holds a partial aw init, which only the key route continues: run AWEB_API_KEY=<key> AWEB_URL=<url> oats aweb resident create ${NAME}, or choose another --root for the root route`);
  assert.deepEqual(createCalls(s.fake), []);
});

test("a complete identity is adopted with neither a key nor a team root", (t) => {
  const s = setup(t);
  mkdirSync(join(s.root, ".aw"), { recursive: true });
  for (const f of ["identity.yaml", "signing.key", "workspace.yaml"]) writeFileSync(join(s.root, ".aw", f), "");
  const r = s.run(["create", NAME, "--json"], {}, KEYLESS);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.doc.result.outcome, "adopted");
});

// ------------------------------------------------------------------ no prompt

// Runs the command on a real pseudo-terminal and returns everything it showed.
const PTY_DRIVER = `
import base64, os, pty, select, sys, time
argv = sys.argv[1:]
pid, fd = pty.fork()
if pid == 0:
    os.execvp(argv[0], argv)
shown, deadline = b"", time.time() + 30
while time.time() < deadline:
    r, _, _ = select.select([fd], [], [], 0.2)
    if fd in r:
        try: chunk = os.read(fd, 4096)
        except OSError: break
        if not chunk: break
        shown += chunk
_, status = os.waitpid(pid, 0)
print(base64.b64encode(shown).decode()); print(os.waitstatus_to_exitcode(status))
`;
function onTerminal(args, env) {
  const r = spawnSync("python3", ["-I", "-c", PTY_DRIVER, process.execPath, HOOK, "resident", ...args], { env, encoding: "utf8", timeout: 60000 });
  assert.equal(r.status, 0, r.stderr);
  const [shown, code] = r.stdout.trim().split("\n");
  return { shown: Buffer.from(shown, "base64").toString("utf8"), code: Number(code) };
}

test("no prompt is ever shown on a terminal: without a key it refuses, and with a team root it creates", (t) => {
  if (spawnSync("python3", ["-c", "import pty"]).status !== 0) { t.skip("python3 with pty is required to drive a terminal"); return; }
  const s = setup(t, ROOT_AW);
  const env = { ...s.env }; delete env.AWEB_API_KEY; delete env.AWEB_URL;
  const refused = onTerminal(["create", NAME], env);
  assert.equal(refused.code, 1, refused.shown);
  assert.match(refused.shown, /FAIL key: no AWEB_API_KEY in the environment and no team root/);
  assert.doesNotMatch(refused.shown, /input hidden|API key \(/);
  const created = onTerminal(["create", NAME], { ...env, ...settings({ root: teamRoot(s) }) });
  assert.equal(created.code, 0, created.shown);
  assert.match(created.shown, /^PASS resident /m);
  assert.doesNotMatch(created.shown, /input hidden|API key \(/);
});

// ------------------------------------------------------------------ verify

test("an inbound mode read back other than the requested one fails verify", (t) => {
  const s = setup(t, { ...ROOT_AW, inbound: "team_and_contacts" });
  const r = s.run(["create", NAME, "--json"], settings({ root: teamRoot(s) }), KEYLESS);
  assert.equal(r.status, 1);
  assert.equal(r.doc.error.code, "E_RESIDENT_VERIFY");
  assert.equal(r.doc.error.details.stage, "verify");
  assert.equal(r.doc.error.message, "aw inbound-mode answered inbound_mode \"team_and_contacts\", not contacts_only (requested with --inbound-mode contacts-only)");
  assert.equal(s.fake.loaded(), false, "no custody for an unverified resident");
});

test("a rerun after a refused read-back still refuses it, until the mode reads back, then adopts with no second create", (t) => {
  const s = setup(t, { ...ROOT_AW, inbound: "team_and_contacts" });
  const env = settings({ root: teamRoot(s) });
  const residentReads = () => s.fake.calls().filter((c) => c.cmd === "aw" && c.argv[0] === "inbound-mode").length;
  for (const attempt of [1, 2]) {
    const r = s.run(["create", NAME, "--json"], env, KEYLESS);
    assert.equal(r.doc.error.code, "E_RESIDENT_VERIFY", `attempt ${attempt}: ${r.stdout}`);
    assert.equal(r.doc.error.message, "aw inbound-mode answered inbound_mode \"team_and_contacts\", not contacts_only (requested with --inbound-mode contacts-only)");
    assert.equal(residentReads(), attempt);
    assert.equal(s.fake.loaded(), false, "no custody");
    assert.ok(!s.localYaml().includes("residents"), "not recorded");
  }
  const plan = s.run(["create", NAME, "--plan", "--json"], env, KEYLESS);
  assert.equal(plan.doc.result.state, "adopt");
  assert.ok(plan.doc.result.verify.some((v) => v.startsWith("aw inbound-mode --json, which must read back contacts_only")), JSON.stringify(plan.doc.result.verify));
  // The mode is fixed on the aweb side: the rerun reads it back and adopts.
  fakeResidentAw(s.base, { ...ROOT_AW, inbound: "contacts_only" });
  const fixed = s.run(["create", NAME, "--json"], env, KEYLESS);
  assert.equal(fixed.status, 0, fixed.stdout + fixed.stderr);
  assert.equal(fixed.doc.result.outcome, "adopted");
  assert.equal(residentReads(), 3);
  assert.equal(createCalls(s.fake).length, 1);
  assert.equal(existsSync(join(s.root, ".oats-resident", "root-route-pending")), false);
  // Once verified, a rerun is the ordinary verify, with no mode read.
  const again = s.run(["create", NAME, "--json"], { OATS_SETTINGS: JSON.stringify({ root: join(s.base, "team-root"), residents: { [NAME]: s.root } }) }, KEYLESS);
  assert.equal(again.doc.result.outcome, "already-exists");
  assert.equal(residentReads(), 3);
});

test("aw's refusal of the create passes through as E_RESIDENT_INIT, and a rerun resumes it with the same command", (t) => {
  const s = setup(t, { ...ROOT_AW, create: "refused" });
  const authority = teamRoot(s);
  const env = settings({ root: authority });
  const r = s.run(["create", NAME, "--json"], env, KEYLESS);
  assert.equal(r.status, 1);
  assert.equal(r.doc.error.code, "E_RESIDENT_INIT");
  assert.equal(r.doc.error.details.stage, "init");
  assert.equal(r.doc.error.message, "fake aw: the owner identity is not the owner of this organization");
  assert.ok(existsSync(recovery(s)), "aw keeps its recovery state");
  const again = s.run(["create", NAME, "--json"], env, KEYLESS);
  assert.equal(again.doc.error.message, "fake aw: the owner identity is not the owner of this organization");
  assert.deepEqual(createCalls(s.fake).map((c) => c.argv), [createArgv(s, authority), createArgv(s, authority)]);
});

test("a create aw refused before its recovery state leaves only aw's lock; the rerun creates", (t) => {
  const s = setup(t, { ...ROOT_AW, create: "invalid-owner" });
  const authority = teamRoot(s);
  const env = settings({ root: authority });
  assert.equal(s.run(["create", NAME, "--json"], env, KEYLESS).doc.error.code, "E_RESIDENT_INIT");
  assert.equal(s.run(["create", NAME, "--plan", "--json"], env, KEYLESS).doc.result.state, "create");
  fakeResidentAw(s.base, ROOT_AW);
  const r = s.run(["create", NAME, "--json"], env, KEYLESS);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.doc.result.outcome, "created");
  assert.equal(createCalls(s.fake).length, 2);
});

for (const [create, when] of [["lost-response", "before"], ["interrupted-install", "after"]]) {
  test(`a create interrupted ${when} aw installed the identity is resumed by the same aw id create, never adopted`, (t) => {
    const s = setup(t, { ...ROOT_AW, create });
    const authority = teamRoot(s);
    const env = settings({ root: authority });
    const first = s.run(["create", NAME, "--json"], env, KEYLESS);
    assert.equal(first.doc.error.code, "E_RESIDENT_INIT", first.stdout);
    assert.ok(existsSync(recovery(s)));
    const plan = s.run(["create", NAME, "--plan", "--json"], env, KEYLESS);
    assert.equal(plan.doc.result.state, "recover");
    assert.deepEqual(plan.doc.result.init.argv, ["aw", ...createArgv(s, authority)]);
    const r = s.run(["create", NAME, "--json"], env, KEYLESS);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(r.doc.result.outcome, "resumed");
    assert.deepEqual(createCalls(s.fake).map((c) => c.argv), [createArgv(s, authority), createArgv(s, authority)]);
    assert.equal(existsSync(recovery(s)), false, "aw removed its recovery state");
    assert.ok(existsSync(`${recovery(s)}.lock`), "aw keeps its lock");
    assert.equal(existsSync(join(s.root, ".oats-resident", "root-route-pending")), false);
    assert.ok(s.localYaml().includes(`"${NAME}": ${JSON.stringify(s.root)}`));
  });
}

test("aw's recovery state is resumed, never adopted, even beside another file in R", (t) => {
  const s = setup(t, { ...ROOT_AW, create: "interrupted-install" });
  const authority = teamRoot(s);
  const env = settings({ root: authority });
  s.run(["create", NAME, "--json"], env, KEYLESS);
  writeFileSync(join(s.root, ".DS_Store"), "");
  const r = s.run(["create", NAME, "--json"], env, KEYLESS);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.doc.result.outcome, "resumed");
  assert.equal(createCalls(s.fake).length, 2);
  assert.equal(existsSync(recovery(s)), false, "aw removed its recovery state");
});

test("the key route refuses aw's root-route recovery state, naming the rerun without the key", (t) => {
  const s = setup(t, { ...ROOT_AW, create: "lost-response" });
  s.run(["create", NAME, "--json"], settings({ root: teamRoot(s) }), KEYLESS);
  const r = s.run(["create", NAME, "--json"]);
  assert.equal(r.doc.error.code, "E_RESIDENT_KEY");
  assert.equal(r.doc.error.message, `${s.root} holds an interrupted aw id create (${recovery(s)}), which only the root route resumes: unset AWEB_API_KEY and rerun with the same team root, --org and --team-label; never empty ${s.root}, the identity may already exist`);
  assert.deepEqual(initCalls(s.fake), []);
  assert.equal(createCalls(s.fake).length, 1);
});

test("--org is the slug of a <slug>.aweb.ai namespace; any other namespace is refused before the create", (t) => {
  for (const domain of ["acme.example.com", "a.b.aweb.ai", "aweb.ai"]) {
    const s = setup(t, { ...ROOT_AW, authority: { domain } });
    const r = s.run(["create", NAME, "--json"], settings({ root: teamRoot(s) }), KEYLESS);
    assert.equal(r.doc?.error?.code, "E_RESIDENT_VERIFY", `${domain}: ${r.stdout}`);
    assert.equal(r.doc.error.details.stage, "preflight");
    assert.equal(r.doc.error.message, `aw whoami in the team root ${join(s.base, "team-root")} answered domain ${JSON.stringify(domain)}, not <org>.aweb.ai, so the organization cannot be derived from it: pass --org <slug or id>`);
    assert.deepEqual(createCalls(s.fake), []);
  }
  const s = setup(t, { ...ROOT_AW, authority: { domain: "juan.aweb.ai" } });
  const authority = teamRoot(s);
  assert.equal(s.run(["create", NAME], settings({ root: authority }), KEYLESS).status, 0);
  assert.deepEqual(createCalls(s.fake)[0].argv, createArgv(s, authority, "juan"));
});

test("--org <slug or id> wins over the derivation, where the namespace gives none and where it gives another", (t) => {
  const byot = setup(t, { ...ROOT_AW, authority: { domain: "acme.example.com" } });
  const authority = teamRoot(byot);
  assert.equal(byot.run(["create", NAME, "--org", "acme", "--json"], settings({ root: authority }), KEYLESS).status, 0);
  assert.deepEqual(createCalls(byot.fake)[0].argv, createArgv(byot, authority, "acme"));
  assert.ok(!byot.fake.calls().some((c) => c.argv.includes("whoami") && c.argv[1] === join(authority, ".aw")), "no derivation read with --org");
  const s = setup(t, { ...ROOT_AW, authority: { domain: "juan.aweb.ai" } });
  const other = teamRoot(s);
  const id = "0b9c8d7e-6f5a-4b3c-9d2e-1f0a9b8c7d6e";
  assert.equal(s.run(["create", NAME, "--org", id], settings({ root: other }), KEYLESS).status, 0);
  assert.deepEqual(createCalls(s.fake)[0].argv, createArgv(s, other, id));
});

test("an --org that is neither a slug nor an id is refused before anything runs", (t) => {
  const s = setup(t, ROOT_AW);
  for (const org of ["acme.aweb.ai", "-acme", "a b"]) {
    const r = s.run(["create", NAME, "--org", org, "--json"], {}, KEYLESS);
    assert.equal(r.status, 2, org);
    assert.equal(r.doc.error.code, "E_RESIDENT_ARGUMENT");
    assert.equal(r.doc.error.message, `invalid --org ${JSON.stringify(org)}: an organization is its slug (letters, digits and '-', starting with a letter or digit) or its UUID, never a domain`);
  }
  assert.deepEqual(s.fake.calls(), []);
});

test("--team-id is the team root's inbound-mode team_id unchanged, canonical or a service UUID", (t) => {
  for (const teamId of ["default:acme.aweb.ai", "6f1d2c3b-4a59-4e8f-9b7a-0c1d2e3f4a5b"]) {
    const s = setup(t, { ...ROOT_AW, authority: { teamId } });
    const authority = teamRoot(s);
    const r = s.run(["create", NAME, "--json"], settings({ root: authority }), KEYLESS);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.deepEqual(createCalls(s.fake)[0].argv, createArgv(s, authority, "acme", teamId));
  }
});

test("a team root whose inbound-mode answers no team_id is refused before the create", (t) => {
  for (const teamId of [undefined, ""]) {
    const s = setup(t, { ...ROOT_AW, authority: { teamId } });
    const authority = teamRoot(s);
    const r = s.run(["create", NAME, "--json"], settings({ root: authority }), KEYLESS);
    assert.equal(r.doc.error.code, "E_RESIDENT_VERIFY");
    assert.equal(r.doc.error.message, `aw inbound-mode in the team root ${authority} answered no team_id`);
    assert.deepEqual(createCalls(s.fake), []);
  }
});

// ------------------------------------------------------------------ aw floor

test(`below aw ${AW_RESIDENT_ROOT_MIN} the root route fails E_RESIDENT_AW_FLOOR, naming the version; the key route does not need it`, (t) => {
  const s = setup(t, { version: "1.36.47" });
  const env = settings({ root: teamRoot(s) });
  for (const args of [["create", NAME, "--json"], ["create", NAME, "--plan", "--json"]]) {
    const r = s.run(args, env, KEYLESS);
    assert.equal(r.status, 1);
    assert.equal(r.doc.error.code, "E_RESIDENT_AW_FLOOR");
    assert.equal(r.doc.error.details.stage, "aw");
    assert.equal(r.doc.error.message, `aw 1.36.47 is older than ${AW_RESIDENT_ROOT_MIN}, the first aw whose id create takes --owner-identity-home: creating a resident without an API key needs it; upgrade with \`npm i -g @awebai/aw@latest\``);
  }
  assert.deepEqual(createCalls(s.fake), []);
  assert.equal(s.run(["create", NAME, "--json"], env).status, 0);
});

// ------------------------------------------------------------------ plan

test("--plan shows the create's argv, its environment and the authority root, and has no remote effect", (t) => {
  const s = setup(t, ROOT_AW);
  const authority = teamRoot(s);
  const before = s.localYaml();
  const r = s.run(["create", NAME, "--plan", "--json"], { ...settings({ root: authority }), AWID_REGISTRY_URL: "http://127.0.0.1:18010" }, KEYLESS);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(r.doc.result.init, {
    route: "root",
    argv: ["aw", ...createArgv(s, authority)],
    cwd: authority,
    authorityRoot: authority,
    authorityFrom: "settings.oats.aweb.root",
    env: ["PATH", "HOME", "AW_NO_UPDATE_CHECK", "AWID_REGISTRY_URL"],
  });
  assert.deepEqual(createCalls(s.fake), []);
  assert.equal(existsSync(s.root), false);
  assert.equal(s.localYaml(), before);
  const text = s.run(["create", NAME, "--plan"], settings({ root: authority }), KEYLESS);
  assert.equal(text.status, 0, text.stderr);
  assert.ok(text.stdout.includes(`  create:  ${["aw", ...createArgv(s, authority)].join(" ")}  (in ${authority}, authorized by the team root ${authority} from settings.oats.aweb.root; environment PATH, HOME, AW_NO_UPDATE_CHECK only)\n`), text.stdout);
  assert.ok(!r.stdout.includes(KEY));
});
