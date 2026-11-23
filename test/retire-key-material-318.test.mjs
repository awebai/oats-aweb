// awebai/oats-aweb#318: a home the kernel keeps after a retire holds no usable
// aweb key. Every answer of the retire hook that exits 0 removes the home's
// credential entries (.aw, .aweb-identity, .aweb-identity-*); one that exits
// nonzero holds them, renamed as themselves, in .oats-aweb/held; every run puts
// held entries back first, and fails closed when an entry and its held copy both
// exist. A rerun after the key is gone answers what the first run answered, from
// what that run recorded (lib/retire-key-material.mjs, the retire branch of
// bin/oats-aweb.mjs). The six cases of #318 are named in the test titles.
//
// The fake aw answers as aw does where the hook depends on it: `workspace delete`
// needs the identity home's key (without one aw says it is not initialized), a
// joined leave's team_not_hosted is aw's JSON receipt, and `id team list` lists
// the identity home's certificates. A kill is a SIGKILL from a preload at one fs
// or child_process call, as test/killed-mint-240.test.mjs does.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { fakeAw as fakeGrantAw } from "./helpers/fake-aw-grant.mjs";
import { holdEntries, removeEntries, restoreHeld } from "../oats-package/capabilities/oats-aweb/lib/retire-key-material.mjs";

const HOOK = resolve(new URL("../oats-package/capabilities/oats-aweb/bin/oats-aweb.mjs", import.meta.url).pathname);
const TEAM = "default:example.test", OPS = "ops:example.test";
const WORKSPACE_ID = "11111111-2222-4333-8444-555555555555";
const ENTRY_RE = /^(?:\.aw|\.aweb-identity|\.aweb-identity-.+)$/;

function tempDir(t, prefix = "oats-aweb-318-") {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function write(p, c) { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, c); }
const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");
/** Every path under dir with its type and, for a file, its content's hash: never the content. */
function listing(dir) {
  const rows = [];
  const walk = (d, rel) => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name), r = rel ? `${rel}/${name}` : name, st = lstatSync(p);
      if (st.isSymbolicLink()) rows.push(`${r} -> ${readlinkSync(p)}`);
      else if (st.isDirectory()) { rows.push(`${r}/`); walk(p, r); }
      else rows.push(`${r} ${sha(p)}`);
    }
  };
  walk(dir, "");
  return rows;
}
/** The credential entries at the paths aw reads. */
const entriesAt = (home) => readdirSync(home).filter((n) => ENTRY_RE.test(n)).sort();
const held = (home) => existsSync(join(home, ".oats-aweb", "held")) ? readdirSync(join(home, ".oats-aweb", "held")).sort() : [];

function identityHome(dir, team, certificateId, alias = "dev-1") {
  write(join(dir, "signing.key"), `fixture-key-${certificateId}-${Math.random()}`);
  write(join(dir, "identity.yaml"), `alias: ${alias}\ndid: did:key:z6Mk${certificateId.replace(/[^a-z0-9]/gi, "")}\n`);
  write(join(dir, "team-certs", `${team.replace(/:/g, "__")}.pem`), JSON.stringify({ version: 1, team_id: team, certificate_id: certificateId, alias }));
}

function fakeAw(base) {
  const bin = join(base, "bin"), calls = join(base, "calls.jsonl");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "aw"), `#!${process.execPath}
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
let args = process.argv.slice(2), identityHome = null;
if (args[0] === "--identity-home") { identityHome = args[1]; args = args.slice(2); }
const dir = identityHome || process.env.AWEB_IDENTITY_HOME || path.join(process.cwd(), ".aw");
let keyHash = null; try { keyHash = crypto.createHash("sha256").update(fs.readFileSync(path.join(dir, "signing.key"))).digest("hex"); } catch {}
fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify({ args, identityHome, cwd: process.cwd(), keyHash }) + "\\n");
const emit = (o) => console.log(JSON.stringify(o));
if (args[0] === "version") { console.log("aw 1.36.58"); process.exit(0); }
if (args[0] === "wake") { console.log("ok"); process.exit(0); }
const needKey = () => { if (!keyHash) { console.error("Error: not initialized: no identity at " + dir + " (run aw init)"); process.exit(1); } };
if (args[0] === "id" && args[1] === "team" && args[2] === "list") {
  needKey();
  let memberships = [];
  try { memberships = fs.readdirSync(path.join(dir, "team-certs")).map((f) => JSON.parse(fs.readFileSync(path.join(dir, "team-certs", f), "utf8"))).map((c) => ({ team_id: c.team_id, certificate_id: c.certificate_id, registry_origin: "https://registry.example.test" })); } catch {}
  emit({ memberships }); process.exit(0);
}
if (args[0] === "workspace" && args[1] === "delete") {
  needKey();
  const mode = (identityHome ? process.env.FAKE_LEAVE : process.env.FAKE_DELETE) || "released";
  if (mode === "fail") { console.error("Error: delete workspace: 503 Service Unavailable"); process.exit(1); }
  if (mode === "released") { emit({ alias_released: true, alias_released_reason: "released", identity_deleted: true }); process.exit(0); }
  emit({ alias_released: false, alias_released_reason: mode }); process.exit(0);
}
console.error("unexpected fake aw " + args.join(" ")); process.exit(93);
`);
  chmodSync(join(bin, "aw"), 0o755);
  return { path: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`, calls: () => existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse) : [] };
}

/** A local home: .aw bound to the default team, and optionally a joined team "ops". */
function fixture(t, { joined = false } = {}) {
  const base = tempDir(t), ws = join(base, "ws"), home = join(ws, "agents", "dev", "instances", "dev-1");
  write(join(ws, "oats-local.yaml"), "settings: {}\n");
  identityHome(join(home, ".aw"), TEAM, "cert-default-1");
  write(join(home, ".aw", "workspace.yaml"), `aweb_url: https://service.example.test/api\nmemberships:\n  - team_id: ${TEAM}\n    alias: dev-1\n    workspace_id: ${WORKSPACE_ID}\n`);
  const joinedHome = join(home, ".aweb-identity-ops");
  if (joined) identityHome(joinedHome, OPS, "cert-ops-1");
  const kernel = join(base, "kernel.mjs");
  writeFileSync(kernel, "console.log(JSON.stringify({features: []}));");
  const fake = fakeAw(base);
  const meta = { runtime: "codex", delivery: "session", team: TEAM, alias: "dev-1", identity: { mode: "local", alias: "dev-1", team: TEAM }, ...(joined ? { joinedTeams: [{ label: "ops", team: OPS, alias: "dev-1", identityHome: joinedHome, receive: "poll", since: "2026-11-23T00:00:00.000Z" }] } : {}) };
  const env = {
    PATH: fake.path, HOME: base, OATS_NODE_BIN: process.execPath, OATS_CLI_BIN: kernel,
    OATS_INSTANCE: "dev-1", OATS_HOME: home, OATS_WORKSPACE: ws,
    OATS_DEFAULT_TEAM: "default", OATS_DEFAULT_TEAM_ID: TEAM, OATS_DEFAULT_TEAM_FROM: "deployment",
    OATS_TEAMS: JSON.stringify([{ label: "default", team: TEAM, default: true, from: "local" }, { label: "ops", team: OPS, default: false, from: "local" }]),
    OATS_SETTINGS: JSON.stringify({ delivery: "session" }),
  };
  const hook = (event, more = {}) => {
    const r = spawnSync(process.execPath, [HOOK, event], { cwd: home, env: { ...env, OATS_EVENT: event, ...more }, encoding: "utf8", timeout: 60000 });
    let doc; try { doc = JSON.parse(r.stdout.trim().split("\n").at(-1)); } catch { doc = undefined; }
    return { ...r, doc };
  };
  const retire = (more = {}, m = meta) => hook("retire", { OATS_META: JSON.stringify(m), ...more });
  const record = () => { try { return JSON.parse(readFileSync(join(ws, ".oats-aweb", "retired-certificates.json"), "utf8")).entries; } catch { return []; } };
  /** NODE_OPTIONS that SIGKILL the hook where `body` (a preload module's body) says. */
  const killAt = (body) => {
    const preload = join(base, `kill-${Math.random().toString(36).slice(2)}.mjs`);
    writeFileSync(preload, `import fs from "node:fs";\nimport cp from "node:child_process";\nimport { syncBuiltinESMExports } from "node:module";\nconst kill = () => process.kill(process.pid, "SIGKILL");\n${body}\nsyncBuiltinESMExports();\n`);
    return { NODE_OPTIONS: `--import=${pathToFileURL(preload).href}` };
  };
  return { base, ws, home, joinedHome, meta, fake, hook, retire, record, killAt };
}
const deletes = (calls) => calls.filter((c) => c.args[0] === "workspace" && c.args[1] === "delete");
const withKey = (calls) => calls.filter((c) => c.args[0] !== "version" && c.args[0] !== "wake");

// ------------------------------------------------------------ exit 0 removes

test("#318 case 1 (A1): default identity released: exit 0, and no .aw is left in the home", (t) => {
  const fx = fixture(t);
  const r = fx.retire();
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.doc.meta.retired, true);
  assert.equal(r.doc.meta.aliasReusable, true);
  assert.equal(existsSync(join(fx.home, ".aw")), false);
  assert.deepEqual(entriesAt(fx.home), []);
  assert.deepEqual(held(fx.home), [], "nothing is held on an exit 0");
  assert.equal(r.doc.warning, undefined, "a clean retire says nothing about its key material");
});

test("#318 case 2 (A2): default identity team_not_hosted: exit 0, cleanup recorded once, .aw absent; a rerun answers the same with no aw call that needs the key", (t) => {
  const fx = fixture(t);
  const first = fx.retire({ FAKE_DELETE: "team_not_hosted" });
  assert.equal(first.status, 0, first.stdout + first.stderr);
  assert.equal(first.doc.meta.aliasReason, "team_not_hosted");
  assert.deepEqual(first.doc.meta.pendingControllerCleanup.map((c) => [c.label, c.team, c.certificateId]), [["default", TEAM, "cert-default-1"]]);
  assert.match(first.doc.warning, /default identity cleanup failed: team_not_hosted; controller cleanup: aw id team remove-member/);
  assert.equal(existsSync(join(fx.home, ".aw")), false);
  assert.equal(fx.record().length, 1);
  const before = fx.fake.calls().length;

  const rerun = fx.retire({ FAKE_DELETE: "team_not_hosted" }, first.doc.meta);
  assert.equal(rerun.status, 0, rerun.stdout + rerun.stderr);
  assert.deepEqual(rerun.doc.meta, first.doc.meta, "the same meta");
  assert.equal(rerun.doc.warning, first.doc.warning, "the same words");
  assert.deepEqual(withKey(fx.fake.calls().slice(before)), [], "no aw call that needs the removed key");
  assert.equal(fx.record().length, 1, "the controller cleanup is still recorded once");
  assert.deepEqual(entriesAt(fx.home), []);
});

test("#318 case 2 (A3): default identity not released for another reason (not_own_workspace): exit 0, and .aw is absent", (t) => {
  const fx = fixture(t);
  const r = fx.retire({ FAKE_DELETE: "not_own_workspace" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.doc.meta.retired, true);
  assert.equal(r.doc.meta.aliasReason, "not_own_workspace");
  assert.equal(r.doc.meta.pendingControllerCleanup, undefined, "only team_not_hosted is handed to the controller (#319)");
  assert.equal(existsSync(join(fx.home, ".aw")), false);
  const rerun = fx.retire({}, r.doc.meta);
  assert.equal(rerun.status, 0, rerun.stdout + rerun.stderr);
  assert.equal(rerun.doc.meta.aliasReason, "not_own_workspace");
});

test("#318 case 4 (A4): a joined team handed to its controller: exit 0, its .aweb-identity-<label> absent; a rerun exits 0 without attempting the leave", (t) => {
  const fx = fixture(t, { joined: true });
  const first = fx.retire({ FAKE_LEAVE: "team_not_hosted" });
  assert.equal(first.status, 0, first.stdout + first.stderr);
  assert.deepEqual(first.doc.meta.pendingControllerCleanup.map((c) => [c.label, c.certificateId]), [["ops", "cert-ops-1"]]);
  assert.match(first.doc.warning, /joined team ops cleanup failed: team_not_hosted; controller cleanup:/);
  assert.equal(existsSync(fx.joinedHome), false);
  assert.deepEqual(entriesAt(fx.home), []);
  assert.equal(fx.record().length, 1);
  const before = fx.fake.calls().length;

  const rerun = fx.retire({ FAKE_LEAVE: "team_not_hosted" }, first.doc.meta);
  assert.equal(rerun.status, 0, rerun.stdout + rerun.stderr);
  assert.deepEqual(rerun.doc.meta, first.doc.meta);
  assert.equal(rerun.doc.warning, first.doc.warning);
  assert.deepEqual(withKey(fx.fake.calls().slice(before)), [], "no leave, no delete: nothing needs the removed keys");
  assert.equal(fx.record().length, 1);
});

// ---------------------------------------------------------- nonzero holds

test("#318 case 3 (A6): self-delete failed: .aw is held with the same files; the retry restores it, deletes with the home's key, exits 0 and leaves nothing", (t) => {
  const fx = fixture(t);
  const keyHash = sha(join(fx.home, ".aw", "signing.key"));
  const files = listing(join(fx.home, ".aw"));
  const failed = fx.retire({ FAKE_DELETE: "fail" });
  assert.equal(failed.status, 1, failed.stdout + failed.stderr);
  assert.equal(failed.doc.meta.retired, false);
  assert.equal(failed.doc.meta.reason, "self-delete-failed");
  assert.equal(existsSync(join(fx.home, ".aw")), false, "nothing at aw's path");
  const heldAw = join(fx.home, ".oats-aweb", "held", ".aw");
  assert.deepEqual(listing(heldAw), files, "the same files, held");
  assert.equal(sha(join(heldAw, "signing.key")), keyHash);
  assert.ok(failed.doc.warning.includes(`held .aw in ${join(fx.home, ".oats-aweb", "held")}: a session started in this home cannot act as this identity; the next retire puts it back first`), failed.doc.warning);
  assert.equal(lstatSync(join(fx.home, ".oats-aweb", "held")).mode & 0o077, 0, "the held directory is owner-only");

  const before = fx.fake.calls().length;
  const retry = fx.retire({}, failed.doc.meta);
  assert.equal(retry.status, 0, retry.stdout + retry.stderr);
  assert.equal(retry.doc.meta.retired, true);
  const del = deletes(fx.fake.calls().slice(before));
  assert.equal(del.length, 1);
  assert.equal(del[0].keyHash, keyHash, "the delete ran with the home's own key, restored at .aw");
  assert.deepEqual(entriesAt(fx.home), []);
  assert.deepEqual(held(fx.home), []);
  assert.equal(existsSync(join(fx.home, ".oats-aweb", "held")), false);
});

test("#318 case 3 and case 4 (A7): a joined leave failed: .aw and the joined identity home are held; a retry restores them, leaves, exits 0 and removes them", (t) => {
  const fx = fixture(t, { joined: true });
  const joinedFiles = listing(fx.joinedHome);
  const failed = fx.retire({ FAKE_LEAVE: "fail" });
  assert.equal(failed.status, 1, failed.stdout + failed.stderr);
  assert.equal(failed.doc.meta.retired, false);
  assert.equal(failed.doc.meta.reason, "joined-team-leave-failed");
  assert.deepEqual(failed.doc.meta.failedLeaves, ["ops"]);
  assert.deepEqual(entriesAt(fx.home), []);
  assert.deepEqual(held(fx.home), [".aw", ".aweb-identity-ops"]);
  assert.deepEqual(listing(join(fx.home, ".oats-aweb", "held", ".aweb-identity-ops")), joinedFiles);

  const before = fx.fake.calls().length;
  const retry = fx.retire({}, failed.doc.meta);
  assert.equal(retry.status, 0, retry.stdout + retry.stderr);
  assert.equal(retry.doc.meta.retired, true);
  assert.equal(retry.doc.meta.failedLeaves, undefined);
  const leave = deletes(fx.fake.calls().slice(before)).filter((c) => c.identityHome === fx.joinedHome);
  assert.equal(leave.length, 1, "the leave ran at the joined home's recorded path, restored");
  assert.ok(leave[0].keyHash);
  assert.deepEqual(entriesAt(fx.home), []);
  assert.deepEqual(held(fx.home), []);
});

test("#318 case 4 (A4 with A7): a handed-off joined team and a failed default self-delete: the handed-off home is held too, and the retry hands it off again without leaving", (t) => {
  const fx = fixture(t, { joined: true });
  const failed = fx.retire({ FAKE_LEAVE: "team_not_hosted", FAKE_DELETE: "fail" });
  assert.equal(failed.status, 1, failed.stdout + failed.stderr);
  assert.deepEqual(held(fx.home), [".aw", ".aweb-identity-ops"]);
  const before = fx.fake.calls().length;
  const retry = fx.retire({ FAKE_LEAVE: "team_not_hosted" }, failed.doc.meta);
  assert.equal(retry.status, 0, retry.stdout + retry.stderr);
  assert.deepEqual(retry.doc.meta.pendingControllerCleanup.map((c) => c.label), ["ops"]);
  assert.equal(deletes(fx.fake.calls().slice(before)).filter((c) => c.identityHome).length, 0, "no second leave");
  assert.equal(fx.record().length, 1);
  assert.deepEqual(entriesAt(fx.home), []);
});

// ------------------------------------------------------- the restore fails closed

test("A10: a held .aw and a .aw both present at the start: exit nonzero, retired false, no aw call, both untouched", (t) => {
  const fx = fixture(t);
  const failed = fx.retire({ FAKE_DELETE: "fail" });
  assert.equal(failed.status, 1);
  // A revived session ran `aw init` in the home.
  identityHome(join(fx.home, ".aw"), TEAM, "cert-revived");
  const heldAw = join(fx.home, ".oats-aweb", "held", ".aw");
  const both = [listing(join(fx.home, ".aw")), listing(heldAw)];
  const before = fx.fake.calls().length;
  const r = fx.retire({}, failed.doc.meta);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.deepEqual(r.doc.meta, { retired: false, reason: "held-credentials-not-restored" });
  assert.ok(r.doc.warning.includes(`both ${heldAw} and ${join(fx.home, ".aw")} exist`), r.doc.warning);
  assert.match(r.doc.warning, /nothing was retired and no aw command ran/);
  assert.deepEqual(fx.fake.calls().slice(before), [], "no aw call at all");
  assert.deepEqual([listing(join(fx.home, ".aw")), listing(heldAw)], both, "both untouched");
});

test("A10: a held directory that is a symlink is never followed: the retire fails closed and touches nothing", (t) => {
  const fx = fixture(t);
  const elsewhere = join(fx.base, "elsewhere");
  identityHome(join(elsewhere, ".aw"), TEAM, "cert-elsewhere");
  rmSync(join(fx.home, ".aw"), { recursive: true });
  mkdirSync(join(fx.home, ".oats-aweb"), { recursive: true });
  symlinkSync(elsewhere, join(fx.home, ".oats-aweb", "held"));
  const r = fx.retire();
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.equal(r.doc.meta.reason, "held-credentials-not-restored");
  assert.match(r.doc.warning, /held is not a directory/);
  assert.equal(existsSync(join(elsewhere, ".aw", "signing.key")), true);
  assert.equal(existsSync(join(fx.home, ".aw")), false);
});

// ------------------------------------------------------------- kill points

test("A11: a retire killed after the joined handoff was recorded and before the identity home was removed: the next run removes it and exits 0, without leaving", (t) => {
  const fx = fixture(t, { joined: true });
  const killed = fx.retire({ FAKE_LEAVE: "team_not_hosted", ...fx.killAt(`const rm = fs.rmSync;\nfs.rmSync = function (p, ...a) { if (String(p).endsWith(".aweb-identity-ops")) kill(); return rm.call(this, p, ...a); };`) });
  assert.equal(killed.signal, "SIGKILL", killed.stdout + killed.stderr);
  assert.equal(killed.stdout, "", "no answer was printed");
  assert.ok(existsSync(join(fx.home, ".oats-aweb", "retire-handoffs.json")), "the handoff was recorded before the removal");
  const before = fx.fake.calls().length;
  const next = fx.retire({ FAKE_LEAVE: "team_not_hosted" });
  assert.equal(next.status, 0, next.stdout + next.stderr);
  assert.deepEqual(next.doc.meta.pendingControllerCleanup.map((c) => c.label), ["ops"]);
  assert.equal(deletes(fx.fake.calls().slice(before)).filter((c) => c.identityHome).length, 0, "the leave is not attempted again");
  assert.deepEqual(entriesAt(fx.home), []);
  assert.equal(fx.record().length, 1);
});

test("A11: a retire killed after the default handoff (its marker) was written and before .aw was removed: the next run answers the same and removes .aw", (t) => {
  const fx = fixture(t);
  const killed = fx.retire({ FAKE_DELETE: "team_not_hosted", ...fx.killAt(`const rm = fs.rmSync;\nfs.rmSync = function (p, ...a) { if (String(p).endsWith("/.aw")) kill(); return rm.call(this, p, ...a); };`) });
  assert.equal(killed.signal, "SIGKILL", killed.stdout + killed.stderr);
  assert.equal(existsSync(join(fx.home, ".aw")), true, "a kill before the removal leaves today's state");
  const before = fx.fake.calls().length;
  const next = fx.retire({ FAKE_DELETE: "team_not_hosted" });
  assert.equal(next.status, 0, next.stdout + next.stderr);
  assert.equal(next.doc.meta.aliasReason, "team_not_hosted");
  assert.deepEqual(next.doc.meta.pendingControllerCleanup.map((c) => c.label), ["default"]);
  assert.equal(deletes(fx.fake.calls().slice(before)).length, 0, "the marker stops a second self-delete");
  assert.deepEqual(entriesAt(fx.home), []);
  assert.equal(fx.record().length, 1);
});

test("A11 and A15 (b): a retire killed after the restore and before the remote act: the next run finishes", (t) => {
  const fx = fixture(t);
  const failed = fx.retire({ FAKE_DELETE: "fail" });
  assert.equal(failed.status, 1);
  const killed = fx.retire({ ...fx.killAt(`const rename = fs.renameSync;\nfs.renameSync = function (from, to, ...a) { const r = rename.call(this, from, to, ...a); if (String(from).endsWith("/held/.aw")) kill(); return r; };`) }, failed.doc.meta);
  assert.equal(killed.signal, "SIGKILL", killed.stdout + killed.stderr);
  assert.equal(existsSync(join(fx.home, ".aw", "signing.key")), true, "restored, and killed before anything else");
  assert.deepEqual(held(fx.home), []);
  const next = fx.retire({}, failed.doc.meta);
  assert.equal(next.status, 0, next.stdout + next.stderr);
  assert.equal(next.doc.meta.retired, true);
  assert.deepEqual(entriesAt(fx.home), []);
});

test("A11: a retire killed at its remote act, after the restore: the next run finishes", (t) => {
  const fx = fixture(t);
  const failed = fx.retire({ FAKE_DELETE: "fail" });
  const killed = fx.retire({ ...fx.killAt(`const run = cp.execFileSync;\ncp.execFileSync = function (file, args, ...a) { if (Array.isArray(args) && args[0] === "workspace" && args[1] === "delete") kill(); return run.call(this, file, args, ...a); };`) }, failed.doc.meta);
  assert.equal(killed.signal, "SIGKILL", killed.stdout + killed.stderr);
  const next = fx.retire({}, failed.doc.meta);
  assert.equal(next.status, 0, next.stdout + next.stderr);
  assert.deepEqual(entriesAt(fx.home), []);
  assert.deepEqual(held(fx.home), []);
});

test("A15 (a): a retire killed right after .aw was renamed into .oats-aweb/held, before it answered: the next run restores it, retries the delete and finishes", (t) => {
  const fx = fixture(t);
  const keyHash = sha(join(fx.home, ".aw", "signing.key"));
  const killed = fx.retire({ FAKE_DELETE: "fail", ...fx.killAt(`const rename = fs.renameSync;\nfs.renameSync = function (from, to, ...a) { const r = rename.call(this, from, to, ...a); if (String(to).endsWith("/held/.aw")) kill(); return r; };`) });
  assert.equal(killed.signal, "SIGKILL", killed.stdout + killed.stderr);
  assert.equal(killed.stdout, "");
  assert.deepEqual(held(fx.home), [".aw"]);
  assert.equal(existsSync(join(fx.home, ".aw")), false);
  const before = fx.fake.calls().length;
  const next = fx.retire({});
  assert.equal(next.status, 0, next.stdout + next.stderr);
  const del = deletes(fx.fake.calls().slice(before));
  assert.equal(del.length, 1);
  assert.equal(del[0].keyHash, keyHash);
  assert.deepEqual(entriesAt(fx.home), []);
  assert.deepEqual(held(fx.home), []);
});

test("A15 (c): both present at the start answers A10's fail-closed answer", (t) => {
  const fx = fixture(t);
  mkdirSync(join(fx.home, ".oats-aweb", "held"), { recursive: true });
  identityHome(join(fx.home, ".oats-aweb", "held", ".aw"), TEAM, "cert-held");
  const r = fx.retire();
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.deepEqual(r.doc.meta, { retired: false, reason: "held-credentials-not-restored" });
  assert.deepEqual(withKey(fx.fake.calls()), []);
});

// ------------------------------------------------------------------ symlinks

test("A12: a symlinked .aw is removed as a link on exit 0, and held as a link on a nonzero exit; its target is untouched", (t) => {
  for (const [mode, status] of [["released", 0], ["fail", 1]]) {
    const fx = fixture(t);
    const target = join(fx.base, "linked-identity");
    renameSync(join(fx.home, ".aw"), target);
    symlinkSync(target, join(fx.home, ".aw"));
    const files = listing(target);
    const r = fx.retire({ FAKE_DELETE: mode });
    assert.equal(r.status, status, r.stdout + r.stderr);
    assert.deepEqual(entriesAt(fx.home), [], mode);
    assert.deepEqual(listing(target), files, `${mode}: the target is untouched`);
    if (status) {
      const heldAw = join(fx.home, ".oats-aweb", "held", ".aw");
      assert.ok(lstatSync(heldAw).isSymbolicLink(), "held as the link itself");
      assert.equal(readlinkSync(heldAw), target);
      const retry = fx.retire({}, r.doc.meta);
      assert.equal(retry.status, 0, retry.stdout + retry.stderr);
      assert.deepEqual(entriesAt(fx.home), []);
      assert.deepEqual(listing(target), files);
    }
  }
});

// -------------------------------------------------- the other exits, and edges

test("a home with none of the entries: nothing to do and no warning", (t) => {
  const fx = fixture(t);
  rmSync(join(fx.home, ".aw"), { recursive: true });
  const r = fx.retire({}, { runtime: "codex", delivery: "session" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(r.doc.meta, { retired: false, reason: "nothing-to-delete" });
  assert.equal(r.doc.warning, undefined);
  assert.equal(existsSync(join(fx.home, ".oats-aweb", "held")), false);
});

test("nothing-to-delete with a stray .aw (no alias recorded or bound) still removes it", (t) => {
  const fx = fixture(t);
  rmSync(join(fx.home, ".aw", "workspace.yaml"));
  const r = fx.retire({}, { runtime: "codex", delivery: "session" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.doc.meta.reason, "nothing-to-delete");
  assert.deepEqual(entriesAt(fx.home), []);
});

test("an early nonzero exit after the restore holds the entries too (seat-record-unreadable)", (t) => {
  const fx = fixture(t);
  write(join(fx.home, ".oats-aweb", "seat.json"), "{not json");
  const r = fx.retire();
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.equal(r.doc.meta.reason, "seat-record-unreadable");
  assert.deepEqual(entriesAt(fx.home), []);
  assert.deepEqual(held(fx.home), [".aw"]);
});

test("an empty .aw and a .aweb-identity file (not a directory) are removed like any entry", (t) => {
  const fx = fixture(t);
  rmSync(join(fx.home, ".aw"), { recursive: true });
  mkdirSync(join(fx.home, ".aw"));
  writeFileSync(join(fx.home, ".aweb-identity"), "not a directory");
  const r = fx.retire({}, { runtime: "codex", delivery: "session" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(entriesAt(fx.home), []);
});

test("a hold whose rename fails leaves that entry in place, says which and why, and keeps the exit code", (t) => {
  const fx = fixture(t, { joined: true });
  const r = fx.retire({ FAKE_LEAVE: "fail", ...fx.killAt(`const rename = fs.renameSync;\nfs.renameSync = function (from, to, ...a) { if (String(to).endsWith("/held/.aweb-identity-ops")) throw Object.assign(new Error("denied"), { code: "EACCES" }); return rename.call(this, from, to, ...a); };`) });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.equal(r.doc.meta.reason, "joined-team-leave-failed", "the outcome is the retire's, not the hold's");
  assert.deepEqual(held(fx.home), [".aw"]);
  assert.deepEqual(entriesAt(fx.home), [".aweb-identity-ops"]);
  assert.ok(r.doc.warning.includes(`key material not held: ${fx.joinedHome} stays in place: it could not be moved to ${join(fx.home, ".oats-aweb", "held", ".aweb-identity-ops")} (EACCES)`), r.doc.warning);
});

test("holdEntries never overwrites: an entry whose held name is taken stays in place, with the reason", (t) => {
  const home = join(tempDir(t), "home");
  mkdirSync(join(home, ".oats-aweb", "held", ".aw"), { recursive: true });
  writeFileSync(join(home, ".oats-aweb", "held", ".aw", "marker"), "x");
  mkdirSync(join(home, ".aw"));
  const r = holdEntries(home);
  assert.deepEqual(r.held, []);
  assert.deepEqual(r.problems, [`${join(home, ".aw")} stays in place: ${join(home, ".oats-aweb", "held", ".aw")} already exists`]);
  assert.equal(existsSync(join(home, ".oats-aweb", "held", ".aw", "marker")), true, "never overwritten");
});

test("restoreHeld is all or none: a rename that fails puts back the ones it restored", (t) => {
  const base = tempDir(t), home = join(base, "home");
  for (const name of [".aw", ".aweb-identity-a", ".aweb-identity-b"]) write(join(home, ".oats-aweb", "held", name, "signing.key"), name);
  const preload = join(base, "fail-b.mjs");
  writeFileSync(preload, `import fs from "node:fs";\nimport { syncBuiltinESMExports } from "node:module";\nconst rename = fs.renameSync;\nfs.renameSync = function (from, to) { if (String(from).endsWith("held/.aweb-identity-b")) throw Object.assign(new Error("denied"), { code: "EACCES" }); return rename.call(this, from, to); };\nsyncBuiltinESMExports();\n`);
  const lib = pathToFileURL(resolve("oats-package/capabilities/oats-aweb/lib/retire-key-material.mjs")).href;
  const r = spawnSync(process.execPath, ["--import", pathToFileURL(preload).href, "--input-type=module", "-e", `import { restoreHeld } from ${JSON.stringify(lib)}; console.log(JSON.stringify(restoreHeld(${JSON.stringify(home)})));`], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const doc = JSON.parse(r.stdout);
  assert.match(doc.problem, /could not be put back .* \(EACCES\)/);
  assert.deepEqual(entriesAt(home), [], "nothing left at aw's paths");
  assert.deepEqual(held(home), [".aw", ".aweb-identity-a", ".aweb-identity-b"]);
  assert.deepEqual(restoreHeld(home).restored, [".aw", ".aweb-identity-a", ".aweb-identity-b"]);
  assert.deepEqual(removeEntries(home), { removed: [".aw", ".aweb-identity-a", ".aweb-identity-b"], problems: [] });
});

// -------------------------------------------------- readers of a retiring home

test("a start, a join or leave and mail from a home whose keys a failed retire holds say the home is being retired, not aw's error", (t) => {
  const fx = fixture(t, { joined: true });
  const failed = fx.retire({ FAKE_DELETE: "fail" });
  assert.equal(failed.status, 1);
  const before = fx.fake.calls().length;
  const launch = fx.hook("launch", { OATS_META: JSON.stringify(fx.meta) });
  assert.equal(launch.status, 1, launch.stdout + launch.stderr);
  assert.match(launch.doc.warning, /this home is being retired: its aweb key material is held in .*\.oats-aweb\/held by a retire that did not finish/);
  for (const [event, argv] of [["leave", ["--labels", "ops"]], ["mail", ["inbox"]]]) {
    const r = spawnSync(process.execPath, [HOOK, event, ...argv], { cwd: fx.home, env: { ...process.env, PATH: fx.fake.path, HOME: fx.base, OATS_EVENT: event, OATS_HOME: fx.home, OATS_INSTANCE: "dev-1", OATS_WORKSPACE: fx.ws, OATS_META: JSON.stringify(fx.meta), OATS_SETTINGS: JSON.stringify({ delivery: "session" }), OATS_DEFAULT_TEAM: "default", OATS_DEFAULT_TEAM_ID: TEAM, OATS_TEAMS: JSON.stringify([{ label: "ops", team: OPS, default: false, from: "local" }]) }, encoding: "utf8" });
    assert.equal(r.status, 1, event + r.stdout + r.stderr);
    assert.match(r.stderr, /E_INSTANCE_RETIRING: this home is being retired/, event);
  }
  assert.deepEqual(withKey(fx.fake.calls().slice(before)), [], "no aw call reached the missing identity");
});

test("a start from a kept home a retire finished says the home was retired", (t) => {
  const fx = fixture(t);
  const r = fx.retire();
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const launch = fx.hook("launch", { OATS_META: JSON.stringify(fx.meta) });
  assert.equal(launch.status, 1, launch.stdout + launch.stderr);
  assert.match(launch.doc.warning, /this home was retired: its aweb key material was removed, so it has no identity/);
});

// -------------------------------------------------------- grant and retained seats

function grantSeat(t) {
  const base = tempDir(t), bin = fakeGrantAw(base);
  const root = join(base, "root"); mkdirSync(join(root, ".aw"), { recursive: true });
  const home = join(root, "agents", "dev", "instances", "probe"); mkdirSync(home, { recursive: true });
  const custody = join(base, "custody", "merlin"); write(join(custody, ".aw", "identity.yaml"), "alias: resident-alias\n");
  const settings = { identity: { mode: "global", resident: "merlin" }, residents: { merlin: custody } };
  const hook = (event, env = {}) => {
    const r = spawnSync(process.execPath, [HOOK, event], { encoding: "utf8", env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, OATS_EVENT: event, OATS_DEFAULT_TEAM: "default", OATS_DEFAULT_TEAM_ID: "t:example.test", OATS_DEFAULT_TEAM_FROM: "deployment", OATS_TEAMS: JSON.stringify([{ label: "default", team: "t:example.test", default: true, from: "local" }]), OATS_INSTANCE: "probe", OATS_HOME: home, OATS_WORKSPACE: root, OATS_CONTEXT: root, OATS_SETTINGS: JSON.stringify(settings), ...env } });
    let doc; try { doc = JSON.parse(r.stdout.trim().split(/\n/).at(-1)); } catch { doc = undefined; }
    return { ...r, doc };
  };
  return { base, home, hook };
}

test("#318 case 6 (A8): a grant seat whose revoke failed holds its grant homes; the revoke that succeeds removes them", (t) => {
  const s = grantSeat(t);
  const spawned = s.hook("spawn");
  assert.equal(spawned.status, 0, spawned.stdout + spawned.stderr);
  assert.deepEqual(entriesAt(s.home), [".aweb-identity"], "the spawn's grant home");
  const files = listing(join(s.home, ".aweb-identity"));
  const failed = s.hook("retire", { OATS_META: JSON.stringify(spawned.doc.meta), FAKE_REVOKE_FAIL: "grant-spawn" });
  assert.equal(failed.status, 1, failed.stdout + failed.stderr);
  assert.equal(failed.doc.meta.reason, "grant-revoke-failed");
  assert.deepEqual(entriesAt(s.home), []);
  assert.deepEqual(held(s.home), [".aweb-identity"]);
  assert.deepEqual(listing(join(s.home, ".oats-aweb", "held", ".aweb-identity")), files);
  const retried = s.hook("retire", { OATS_META: JSON.stringify(failed.doc.meta) });
  assert.equal(retried.status, 0, retried.stdout + retried.stderr);
  assert.equal(retried.doc.meta.identityRevoked, true);
  assert.deepEqual(entriesAt(s.home), []);
  assert.deepEqual(held(s.home), []);
});

test("#318 case 6 (A8): a grant seat whose grants were revoked at the first retire leaves no grant home", (t) => {
  const s = grantSeat(t);
  const spawned = s.hook("spawn");
  const r = s.hook("retire", { OATS_META: JSON.stringify(spawned.doc.meta) });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.doc.meta.identityRevoked, true);
  assert.deepEqual(entriesAt(s.home), []);
});

function retainedSeat(t) {
  const base = tempDir(t), bin = fakeGrantAw(base);
  const root = join(base, "root"); mkdirSync(join(root, ".aw"), { recursive: true });
  const home = join(root, "agents", "dev", "instances", "retained"); mkdirSync(home, { recursive: true });
  const source = join(base, "seats", "retained", ".aw");
  write(join(source, "signing.key"), "fixture-signing-key");
  write(join(source, "identity.yaml"), "alias: retained\ndid: did:key:zRetained\naddress: fixture.test/retained\n");
  write(join(source, "teams.yaml"), "active_team: t:example.test\n");
  write(join(source, "workspace.yaml"), "alias: retained\naweb_url: https://fixture.invalid/api\n");
  const hook = (event, env = {}) => {
    const r = spawnSync(process.execPath, [HOOK, event], { encoding: "utf8", env: {
      ...process.env, PATH: `${bin}:${process.env.PATH}`, OATS_EVENT: event, OATS_INSTANCE: "retained", OATS_HOME: home,
      OATS_WORKSPACE: root, OATS_CONTEXT: root, OATS_RUNTIME: "codex", FAKE_RETAINED: "1",
      OATS_DEFAULT_TEAM: "default", OATS_DEFAULT_TEAM_ID: "t:example.test", OATS_DEFAULT_TEAM_FROM: "deployment",
      OATS_TEAMS: JSON.stringify([{ label: "default", team: "t:example.test", default: true, from: "local" }]),
      OATS_SETTINGS: JSON.stringify({ delivery: "session", identity: { mode: "local", source } }), ...env } });
    let doc; try { doc = JSON.parse(r.stdout.trim().split(/\n/).at(-1)); } catch { doc = undefined; }
    return { ...r, doc };
  };
  return { base, home, source, lock: join(dirname(source), ".aw-retained-seat.json"), hook };
}

test("#318 case 5 (A5): a retained seat's retire removes the home's copy, leaves the source byte-identical and releases the lock; a rerun still says released", (t) => {
  const s = retainedSeat(t);
  const spawned = s.hook("spawn");
  assert.equal(spawned.status, 0, spawned.stdout + spawned.stderr);
  assert.equal(existsSync(join(s.home, ".aw", "signing.key")), true, "the seat's copy");
  const source = listing(s.source);
  const r = s.hook("retire", { OATS_META: JSON.stringify(spawned.doc.meta) });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.doc.meta.retained, true);
  assert.equal(r.doc.meta.identityReleased, true);
  assert.match(r.doc.warning, /released the retained identity "retained" \(lock .* removed\)/);
  assert.deepEqual(entriesAt(s.home), [], "the copy is gone");
  assert.deepEqual(listing(s.source), source, "the source .aw is untouched");
  assert.equal(existsSync(s.lock), false, "the lock is released");
  const rerun = s.hook("retire", { OATS_META: JSON.stringify(spawned.doc.meta) });
  assert.equal(rerun.status, 0, rerun.stdout + rerun.stderr);
  assert.deepEqual(rerun.doc.meta, r.doc.meta);
  assert.match(rerun.doc.warning, /released the retained identity "retained" \(lock .* already gone\)/);
  assert.deepEqual(listing(s.source), source);
});

test("#318 case 5: a retained seat whose spawn did not answer: the rerun after the copy is gone names the seat and the rebind from what the first run recorded", (t) => {
  const s = retainedSeat(t);
  const spawned = s.hook("spawn");
  assert.equal(spawned.status, 0, spawned.stdout + spawned.stderr);
  // The spawn's answer was lost: the kernel's retire has no meta.
  const first = s.hook("retire", { OATS_META: "{}" });
  assert.equal(first.status, 0, first.stdout + first.stderr);
  assert.match(first.doc.warning, /released the retained identity "retained"/);
  assert.match(first.doc.warning, /to bind it back to its source/);
  assert.deepEqual(entriesAt(s.home), []);
  // The lock is gone now: the rerun's words come from what the first run recorded of the copy.
  const rerun = s.hook("retire", { OATS_META: "{}" });
  assert.equal(rerun.status, 0, rerun.stdout + rerun.stderr);
  assert.match(rerun.doc.warning, /released nothing: this home does not hold the retained identity's lock/);
  assert.match(rerun.doc.warning, /to bind it back to its source/, "the rebind is decided from the recorded binding, not the removed copy");
});
