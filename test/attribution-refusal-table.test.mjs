// Every spawn refusal the package emits, each built at its longest legal inputs: at most 300
// characters, carrying its whole fix (C-9, test 23; the lead, mail
// 12973e40-45d8-451f-a349-a738ab7cdbaa). The refusal sites are read from the source
// (helpers/refusal-sites.mjs): a message template that carries a fix (" → "), or any message given
// to attributionError. Each site has a row here, a builder or the reason it isn't a spawn's, so a
// refusal added without a row fails the first test.
//
// The longest legal inputs: a 64-character alias, label, soul and root name (aw's and setup's
// limits), aw's 256-character team id, a 64-character aw code, Linux's longest pid, a service URL
// of 400 characters, and a deployment path of over 600, so every home under it is longer still.
// What a refusal's problem names, refusalText shortens; its fix must fit whole.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { README_ADMISSION, admitIdentity, admitRefusal, admittedCertificate, installRefusal, keepRootCopy, recordAdmission, recordsUnreadable } from "../oats-package/capabilities/oats-aweb/lib/admission.mjs";
import { lockRefusal } from "../oats-package/capabilities/oats-aweb/lib/admission-lock.mjs";
import { SCOPE_CODES } from "../oats-package/capabilities/oats-aweb/lib/admission-states.mjs";
import { CHAIN_MAX_CERTIFICATES, CONTAINER_DEPLOYMENT, PROTECTED_ADMISSION_REQUIRED, REFUSAL_ROOM, ROOT_DIR, attributionSetting, chainRefusal, chooseIssuer, issueChain, profileProblem, recordedProfileProblem, refusalText, rootHomeProblem } from "../oats-package/capabilities/oats-aweb/lib/attribution.mjs";
import { AwRefusal } from "../oats-package/capabilities/oats-aweb/lib/protected-client.mjs";
import { attributionFixture } from "./helpers/attribution-fixture.mjs";
import { BIN, refusalSites, templateMatcher } from "./helpers/refusal-sites.mjs";

const LONG = {
  name: "a".repeat(64),
  label: "l".repeat(64),
  soul: "s".repeat(64),
  team: `${"t".repeat(60)}:${["d", "e", "f"].map((c) => c.repeat(63)).join(".")}`,
  root: `did:aw:${"r".repeat(60)}`,
  human: `did:aw:${"h".repeat(60)}`,
  url: `https://${"u".repeat(63)}.example/${"p".repeat(300)}`,
  code: "x".repeat(64),
  pid: 4194304,
  operation: "0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a",
  certificate: "0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b0b",
};
assert.ok(LONG.team.length <= 256);

/** A deployment over 600 characters long, its root home, and a home of LONG.soul/LONG.name. */
function place() {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "oats-aweb-table-")));
  const D = join(base, ..."abc".split("").map((c) => c.repeat(200)));
  const rootHome = join(D, ROOT_DIR, LONG.name);
  const home = join(D, "agents", LONG.soul, "instances", LONG.name);
  for (const d of [join(rootHome, ".aw"), join(rootHome, "admissions"), join(home, ".oats-aweb")]) mkdirSync(d, { recursive: true, mode: 0o700 });
  const profile = join(D, "protected-profile.json");
  writeFileSync(profile, "{}", { mode: 0o600 });
  const setting = {
    root: { id: LONG.root, home: rootHome }, human: { id: LONG.human, label: "h".repeat(200) },
    service: { id: "svc", profile, profileDigest: `sha256:${"0".repeat(64)}`, url: LONG.url },
    teams: [LONG.team], endorsement: { operationId: LONG.operation, policy: { version: 1, digest: `sha256:${"0".repeat(64)}` } },
  };
  return { base, D, rootHome, home, providerDir: join(home, ".oats-aweb"), identityHome: join(home, ".aw"), profile, setting };
}
const refusal = (code) => new AwRefusal("id team admit", { code, message: "m".repeat(200) });
const awError = (code) => Object.assign(new Error(`aw failed: ${code}`), { stdout: JSON.stringify({ error: { code, message: "m".repeat(200) } }) });
const thrown = (f) => { try { f(); } catch (e) { return e; } assert.fail("no refusal"); };

/** One admission of LONG.label, its aw answering as `answers` says (each a function of argv). */
function admitted(p, answers = {}) {
  const key = "did:key:z6Mk" + "k".repeat(40);
  const aw = (argv) => {
    const a = argv.slice(1).filter((x) => x !== "--json");
    const is = (...words) => words.every((w, i) => a[i] === w);
    if (is("id", "create")) return answers.create ? answers.create(argv) : JSON.stringify({ status: "created", did_key: key, identity_home: p.identityHome });
    if (is("id", "team", "admit")) {
      if (answers.admit) return answers.admit(argv);
      const out = argv[argv.indexOf("--certificate-out") + 1];
      writeFileSync(out, JSON.stringify({ certificate_id: LONG.certificate, team_id: LONG.team, alias: LONG.name, member_did_key: key }));
      return JSON.stringify({ operation_id: LONG.operation, state: "committed", certificate_out: out });
    }
    if (is("id", "team", "install-cert")) return answers.install ? answers.install(argv) : JSON.stringify({ status: "installed", team_id: LONG.team, alias: LONG.name, certificate_id: LONG.certificate });
    if (is("service", "init")) { if (answers.connect) return answers.connect(argv); return "{}"; }
    throw new Error(`unexpected aw call: ${a.join(" ")}`);
  };
  return thrown(() => admitIdentity({ aw, setting: p.setting, team: LONG.team, label: LONG.label, alias: LONG.name, identityHome: p.identityHome, providerDir: p.providerDir, plan: { action: "chainless" }, registry: "https://registry.example", count: () => 0, instance: LONG.name, exchangeDir: join(p.providerDir, "attribution") }));
}
const verified = (over = {}) => ({ kind: "verified", id: LONG.root, humanId: LONG.human, chain: [LONG.human, LONG.root], ...over });

/** The rows: [site, builder]. `site` is [file, a piece of its template]; a builder returns the
 *  refusal (an Error) or, through the spawn hook, the refusal's text. */
const LIB = "oats-package/capabilities/oats-aweb/lib";
const ROWS = [
  [`${LIB}/admission.mjs`, "the admission's outcome is unknown", () => admitRefusal(refusal("receipt_unavailable"), { team: LONG.team, operationId: LONG.operation })],
  [`${LIB}/admission.mjs`, "is at its admission bounds", () => admitRefusal(refusal("admission_limit_reached"), { team: LONG.team, bounds: () => ({ max_active: 2 ** 31, max_per_window: 2 ** 31, rate_window_seconds: 2 ** 31 }), count: 99999 })],
  [`${LIB}/admission.mjs`, "${} (${}) → see the README section for what to do", () => admitRefusal(refusal("admission_policy_missing"), { team: LONG.team, root: LONG.root })],
  // The scope fix names the root and the team while they fit, and the README section past that.
  ...[...SCOPE_CODES].map((code) => [`${LIB}/admission.mjs`, "this root likely isn't bound for ${}'s controller → ${}", () => admitRefusal(refusal(code), { team: "ops:acme.example", root: LONG.root })]),
  ...[...SCOPE_CODES].map((code) => [`${LIB}/admission.mjs`, "for this root and this team", () => admitRefusal(refusal(code), { team: LONG.team, root: LONG.root })]),
  [`${LIB}/admission.mjs`, "admission policy changed since the endorsement", () => admitRefusal(refusal("policy_changed"), { team: LONG.team })],
  [`${LIB}/admission.mjs`, "aw sent this admission's operation id with other inputs", () => admitRefusal(refusal("operation_conflict"), { team: LONG.team })],
  ...["subject_ineligible", "operation_expired", "approval_expired"].map((code) => [`${LIB}/admission.mjs`, "a final refusal among the contract's receipt codes", () => admitRefusal(refusal(code), { team: LONG.team })]),
  [`${LIB}/admission.mjs`, "the registry couldn't be read to install", () => installRefusal(refusal("registry_unavailable"))],
  [`${LIB}/admission.mjs`, "the admitted certificate couldn't be installed", () => installRefusal(refusal(LONG.code))],
  [`${LIB}/admission.mjs`, "an admission record can't be read", () => recordsUnreadable({ shown: `.oats-aweb/admission-${LONG.label}~left-${LONG.certificate}.json`, reason: "a certificate id that isn't aw's form" }, "retire again")],
  [`${LIB}/admission.mjs`, "the admitted certificate ${} → respawn", (p) => { const f = join(p.home, "c".repeat(200)); writeFileSync(f, JSON.stringify({ certificate_id: "n".repeat(200) })); return thrown(() => admittedCertificate(f, p.rootHome)); }],
  [`${LIB}/admission.mjs`, "already holds another file for this certificate", (p) => { const copy = join(p.rootHome, "admissions", `${LONG.certificate}.cert`); writeFileSync(copy, "other"); return thrown(() => keepRootCopy({ copy, text: "this" })); }],
  [`${LIB}/admission.mjs`, "for a key ${} no longer holds", (p) => { recordAdmission(p.providerDir, LONG.label, { team: LONG.team, label: LONG.label, alias: LONG.name, state: "unknown", operationId: LONG.operation, memberKey: "did:key:zother", identityHome: p.identityHome, certificateOut: join(p.providerDir, "x.cert") }); return admitted(p); }],
  [`${LIB}/admission.mjs`, "the new identity's key couldn't be created", (p) => admitted(p, { create: () => { throw awError(LONG.code); } })],
  [`${LIB}/admission.mjs`, "aw id create --local answered no key", (p) => admitted(p, { create: () => JSON.stringify({ status: "x" }) })],
  [`${LIB}/admission.mjs`, "aw id team admit answered ${}", (p) => admitted(p, { admit: () => JSON.stringify({ operation_id: LONG.operation, state: "p".repeat(200) }) })],
  [`${LIB}/admission.mjs`, "aw installed certificate", (p) => admitted(p, { install: () => JSON.stringify({ status: "installed", team_id: "o".repeat(200), alias: LONG.name, certificate_id: "i".repeat(200) }) })],
  [`${LIB}/admission.mjs`, "the new home couldn't connect to the aweb service", (p) => admitted(p, { connect: () => { throw awError(LONG.code); } })],
  // A failure that isn't a refusal, after the key exists: here the root's admissions/ is a file.
  [`${LIB}/admission.mjs`, "the spawn failed after its key was created", (p) => { rmSync(join(p.rootHome, "admissions"), { recursive: true }); writeFileSync(join(p.rootHome, "admissions"), ""); return admitted(p); }],
  [`${LIB}/attribution.mjs`, "settings.oats.aweb.${} ${} in oats-local.yaml", () => thrown(() => attributionSetting({ attribution: { root: { id: LONG.root, home: "relative" } } }))],
  [`${LIB}/attribution.mjs`, "the protected profile ${} ${} → have the service's operator", (p) => { const link = join(p.D, "l".repeat(200)); symlinkSync(p.profile, link); return profileProblem(link, { key: "settings.oats.aweb.attribution.service.profile" }); }],
  [`${LIB}/attribution.mjs`, "changed since setup recorded it", (p) => recordedProfileProblem(p.setting)],
  [`${LIB}/attribution.mjs`, "this deployment is a team container's", (p) => rootHomeProblem(p.rootHome, { deployment: CONTAINER_DEPLOYMENT })],
  [`${LIB}/attribution.mjs`, "the root home ${} doesn't exist", (p) => rootHomeProblem(join(p.D, ROOT_DIR, "m".repeat(64)), { deployment: p.D })],
  [`${LIB}/attribution.mjs`, "is not directly under", (p) => { const h = join(p.D, "x".repeat(200), LONG.name); mkdirSync(h, { recursive: true, mode: 0o700 }); return rootHomeProblem(h, { deployment: p.D }); }],
  [`${LIB}/attribution.mjs`, "is inside a Git work tree", (p) => { mkdirSync(join(p.D, ".git")); return rootHomeProblem(p.rootHome, { deployment: p.D }); }],
  [`${LIB}/attribution.mjs`, "is under an instance home", (p) => { writeFileSync(join(p.D, "instance.json"), "{}"); return rootHomeProblem(p.rootHome, { deployment: p.D }); }],
  [`${LIB}/attribution.mjs`, "is open to other users", (p) => { mkdirSync(join(p.rootHome, "w".repeat(200)), { mode: 0o755 }); return rootHomeProblem(p.rootHome, { deployment: p.D }); }],
  [`${LIB}/attribution.mjs`, "'s chain is revoked or replaced", () => chainRefusal({ kind: "revoked", reason: LONG.code }, { who: "the endorsed root", step: "issuer" })],
  [`${LIB}/attribution.mjs`, "'s chain is unavailable", () => chainRefusal({ kind: "unavailable", reason: LONG.code }, { who: "the endorsed root", step: "issuer" })],
  [`${LIB}/attribution.mjs`, "'s chain doesn't verify", () => chainRefusal({ kind: "malformed", reason: LONG.code }, { who: "the endorsed root", step: "issuer" })],
  [`${LIB}/attribution.mjs`, "the endorsed root's identity in ${} can't be read", (p) => thrown(() => chooseIssuer({ setting: p.setting, root: { kind: "error", reason: "r".repeat(200) } }))],
  [`${LIB}/attribution.mjs`, "settings.oats.aweb.attribution.root names", (p) => thrown(() => chooseIssuer({ setting: p.setting, root: verified({ id: `did:aw:${"o".repeat(60)}` }) }))],
  [`${LIB}/attribution.mjs`, "the endorsed root verifies to another human now", (p) => thrown(() => chooseIssuer({ setting: p.setting, root: verified({ humanId: `did:aw:${"o".repeat(60)}` }) }))],
  [`${LIB}/attribution.mjs`, "the grant-seat spawner has no chain", (p) => thrown(() => chooseIssuer({ setting: p.setting, root: verified(), spawner: { grant: true, home: p.home, verdict: { kind: "unavailable", reason: "r".repeat(200) } } }))],
  [`${LIB}/attribution.mjs`, "a grant seat doesn't issue", (p) => thrown(() => chooseIssuer({ setting: p.setting, root: verified(), spawner: { grant: true, home: p.home, verdict: verified() } }))],
  [`${LIB}/attribution.mjs`, "the spawner's identity can't be read", (p) => thrown(() => chooseIssuer({ setting: p.setting, root: verified(), spawner: { home: p.home, verdict: { kind: "error", reason: "r".repeat(200) } } }))],
  [`${LIB}/attribution.mjs`, "the spawner's meta records a chain", (p) => thrown(() => chooseIssuer({ setting: p.setting, root: verified(), spawner: { home: p.home, recordedChain: true, verdict: { kind: "chainless" } } }))],
  [`${LIB}/attribution.mjs`, "doesn't run through this deployment's endorsed root", (p) => thrown(() => chooseIssuer({ setting: p.setting, root: verified(), spawner: { home: p.home, identityHome: p.identityHome, verdict: verified({ id: "did:aw:x", chain: [`did:aw:${"o".repeat(60)}`], humanId: `did:aw:${"q".repeat(60)}` }) } }))],
  [`${LIB}/attribution.mjs`, "the child's chain would hold", (p) => thrown(() => chooseIssuer({ setting: p.setting, root: verified({ chain: Array.from({ length: CHAIN_MAX_CERTIFICATES }, (_, i) => `did:aw:${i}`) }) }))],
  [`${LIB}/attribution.mjs`, "the chain exchange failed at", (p) => thrown(() => issueChain({ aw: () => "{}", issuer: { identityHome: join(p.rootHome, ".aw"), id: LONG.root }, identityHome: p.identityHome, instance: LONG.name, setting: p.setting, dir: join(p.providerDir, "attribution") }))],
  [`${LIB}/attribution.mjs`, "this team now admits agents only through an endorsed root", () => PROTECTED_ADMISSION_REQUIRED],
  [`${LIB}/admission-lock.mjs`, "'s admission lock can't be read", (p) => lockRefusal(LONG.label, join(p.providerDir, `admission-${LONG.label}.lock.takeover`))],
  [`${LIB}/admission-lock.mjs`, "another command holds ${}'s admission lock", (p) => lockRefusal(LONG.label, join(p.providerDir, `admission-${LONG.label}.lock.takeover`), LONG.pid)],
  // The preflight's own, and the region after the admission, through the spawn hook.
  [BIN, "isn't among the teams this deployment's root admits into", { hook: (fx) => fx.spawn(LONG.name, { extra: { OATS_SETTINGS: JSON.stringify({ ...fx.settings, join: LONG.label }), OATS_TEAMS: teamsWith(fx, { label: LONG.label, team: LONG.team }) } }) }],
  [BIN, "attribution needs an OATS kernel that lists", { fixture: { features: [] } }],
  [BIN, "the protected-client floor", { hook: (fx) => fx.spawn(LONG.name, { extra: { FAKE_AW_VERSION: "1.36.58" } }) }],
  [BIN, "can't be read as JSON", { hook: (fx) => { writeFileSync(fx.profile, "{", { mode: 0o600 }); return spawnWithDigest(fx); } }],
  [BIN, "names no registry origin", { hook: (fx) => { writeFileSync(fx.profile, "{}", { mode: 0o600 }); return spawnWithDigest(fx); } }],
  [BIN, "the root home's deployment can't be confirmed", { hook: (fx) => fx.spawn(LONG.name, { extra: { OATS_WORKSPACE: join(fx.ws, "missing") } }) }],
  [BIN, "OATS_SPAWNER_HOME is not an absolute path", { hook: (fx) => fx.spawn(LONG.name, { extra: { OATS_SPAWNER_HOME: "relative" } }) }],
  [BIN, "the host wake broker couldn't register this home", { fixture: { runtime: "codex", delivery: "session", service: { wake: "running", wakeRegister: "w".repeat(400) } } }],
  [BIN, "the spawn failed after its admission", { hook: (fx) => { mkdirSync(join(fx.homeOf(LONG.name), ".oats-aweb", "teams.json"), { recursive: true }); return fx.spawn(LONG.name); } }],
];
/** Sites that aren't a spawn's refusal: [file, a piece of its template, why]. */
const NOT_SPAWN = [
  [`${LIB}/attribution.mjs`, " → ", "refusalText's own separator, not a message"],
  [`${LIB}/attribution.mjs`, "${} → respawn this home to use the current setting", "joinSetting's: a join's, never a spawn's"],
  [`${LIB}/attribution.mjs`, "aw id child invite answered no invitation", "a cause the chain exchange's refusal carries in its problem"],
  [`${LIB}/attribution.mjs`, "aw id child receive answered no request id", "a cause the chain exchange's refusal carries in its problem"],
  [`${LIB}/attribution.mjs`, "the issuer's response is not readable JSON", "a cause the chain exchange's refusal carries in its problem"],
  [`${LIB}/attribution.mjs`, "the issuer's response carries no chain", "a cause the chain exchange's refusal carries in its problem"],
  [`${LIB}/attribution.mjs`, "the new identity doesn't verify to the recorded human", "a cause the chain exchange's refusal carries in its problem"],
  [`${LIB}/attribution.mjs`, "message", "rootHomeProblem's wrapper: each caller's message is a row"],
  [`${LIB}/admission.mjs`, "text", "admitRefusal's wrapper: each caller's message is a row"],
  [`${LIB}/admission.mjs`, "connectText(setting.service.url)", "its message is connectText's template, a row"],
  [`${LIB}/admission.mjs`, " → ", "admitRefusal's own separator, not a message"],
  [`${LIB}/admission-lock.mjs`, "pid === undefined", "lockRefusal's two messages are rows"],
  [`${LIB}/admission-lock.mjs`, "so this retire acted on nothing", "a retire's warning, which no cap shortens"],
  [BIN, "the deployment's live settings could not be read", "a join's, never a spawn's"],
  [BIN, "--reconcile-admissions takes only", "setup's argument refusal"],
  [BIN, "--reconcile-admissions needs settings.oats.aweb.attribution", "setup's argument refusal"],
  [BIN, "${}", "setup's argument refusal (its message is its cause's)"],
];
const teamsWith = (fx, extra) => JSON.stringify([{ label: "default", team: fx.setting.teams[0], default: true, from: "local" }, { ...extra, default: false, from: "shared" }]);
/** A spawn whose recorded profile digest is the profile's current one, so its later checks run. */
function spawnWithDigest(fx) {
  const settings = { ...fx.settings, attribution: { ...fx.setting, service: { ...fx.setting.service, profileDigest: digestOf(fx.profile) } } };
  return fx.spawn(LONG.name, { extra: { OATS_SETTINGS: JSON.stringify(settings) } });
}
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
const digestOf = (path) => `sha256:${createHash("sha256").update(readFileSync(path)).digest("hex")}`;

/** The site a row names: the one in its file whose template holds its piece (the longest such). */
function siteOf(sites, [file, piece]) {
  const found = sites.filter((s) => s.file === file && s.template.includes(piece)).sort((a, b) => a.template.length - b.template.length);
  assert.ok(found.length, `no refusal site in ${file} holds ${JSON.stringify(piece)}`);
  return found[0];
}

test("every refusal site of the spawn's modules has a row: a builder, or why it isn't a spawn's", () => {
  const sites = refusalSites();
  const named = new Set([...ROWS, ...NOT_SPAWN].map((row) => siteOf(sites, row)));
  const missing = sites.filter((s) => !named.has(s)).map((s) => `${s.file}:${s.line} ${s.template.slice(0, 100)}`);
  assert.deepEqual(missing, [], "add a row to ROWS (or NOT_SPAWN, with why) for each");
});

for (const [file, piece, build] of ROWS) {
  test(`C-9: a spawn refusal at its longest inputs fits 300 characters with its whole fix: ${piece}`, (t) => {
    const site = siteOf(refusalSites(), [file, piece]);
    let text, code;
    if (typeof build === "function") {
      const p = place();
      t.after(() => rmSync(p.base, { recursive: true, force: true }));
      const e = build(p);
      assert.ok(e instanceof Error && /^E_[A-Z_]+$/.test(e.code), `a refusal: ${e?.code} ${e?.message}`);
      if (!site.template.startsWith("<")) assert.match(e.message, templateMatcher(site.template), "the row builds its own site's refusal");
      text = refusalText(e); code = e.code;
      assert.ok(e.message.includes(" → "), `a fix: ${e.message}`);
      assert.ok(text.endsWith(e.message.slice(e.message.indexOf(" → "))), `the whole fix: ${text}`);
    } else {
      const fx = attributionFixture(t, build.fixture ?? {});
      const r = (build.hook ?? ((f) => f.spawn(LONG.name)))(fx);
      assert.equal(r.status, 1, JSON.stringify(r.doc) + r.stderr);
      text = String(r.doc?.warning ?? "").split(" | ")[0].replace(/^oats-aweb: /, "");
      code = text.split(/[ :]/)[0];
      const fix = site.template.slice(site.template.indexOf(" → "));
      assert.ok(site.template.includes(" → "), `a fix: ${site.template}`);
      assert.match(text, new RegExp(`${templateMatcher(fix).source.slice(1, -1)}$`), `the whole fix: ${text}`);
    }
    assert.ok(/^E_[A-Z_]+$/.test(code), `starts with its code: ${text}`);
    assert.ok(text.length <= REFUSAL_ROOM, `${text.length}: ${text}`);
  });
}
