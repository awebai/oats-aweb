// What opting in costs and needs (spec v4.3.18): the A5 scan at setup
// (acceptance test 15's setup half; readiness's is with check-only) and the
// opt-in text in the endorse output and the README (acceptance test 21).
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { OPT_IN } from "../oats-package/capabilities/oats-aweb/lib/endorse-root.mjs";
import { scanProtectedKeys } from "../oats-package/capabilities/oats-aweb/lib/key-scan.mjs";
import { HUMAN, OPS, SERVICE_URL, attributionFixture, verbs } from "./helpers/attribution-fixture.mjs";
import { writeIdentity } from "./helpers/fake-aw-protected.mjs";

const README = fileURLToPath(new URL("../README.md", import.meta.url));
const KEY_TEXT = "-----BEGIN PRIVATE KEY-----\nnot-a-real-key-but-key-shaped\n-----END PRIVATE KEY-----\n";
const endorseArgs = (fx) => ["--endorse-root", "--new-root", "--name", "acme-root", "--human", HUMAN, "--protected-profile", fx.profile, "--service", SERVICE_URL, "--teams", "default,ops"];
const flat = (text) => text.replace(/\s+/g, " ");
/** A README section by its heading, as read (whitespace normalised). */
function section(heading) {
  const text = readFileSync(README, "utf8"), start = text.indexOf(`\n## ${heading}\n`);
  assert.ok(start >= 0, `README has ## ${heading}`);
  const end = text.indexOf("\n## ", start + 1);
  return flat(text.slice(start, end < 0 ? undefined : end));
}

for (const [custody, dir, entry] of [
  ["namespace-controller", [".awid", "controllers"], "acme.example.key"],
  ["namespace-controller", [".config", "aw", "controllers"], "acme.example.key"],
  ["team-controller", [".awid", "team-keys"], "acme.example"],
  ["team-controller", [".config", "aw", "team-keys"], "acme.example"],
  ["team-invite", [".config", "aw", "team-invites"], "inv-1.json"],
]) {
  test(`acceptance 15: a reachable ${dir.join("/")} refuses setup E_PROTECTED_KEY_REACHABLE, appears in findings without key material, and is left in place`, (t) => {
    const fx = attributionFixture(t, { attribution: false, root: "none" });
    const location = join(fx.ws, ...dir), file = join(location, entry);
    mkdirSync(location, { recursive: true, mode: 0o700 });
    writeFileSync(file, KEY_TEXT, { mode: 0o600 });
    const r = fx.setup([...endorseArgs(fx), "--json"]);
    assert.equal(r.doc?.ok, false, r.stdout);
    const e = r.doc.error;
    assert.equal(e.code, "E_PROTECTED_KEY_REACHABLE");
    assert.ok(e.details.findings.some((f) => f.reference === file && f.custody === custody && f.readiness === "protected-key-reachable"), JSON.stringify(e.details.findings));
    assert.ok(!r.stdout.includes("not-a-real-key") && !r.stdout.includes("PRIVATE KEY"), "no key material");
    assert.equal(readFileSync(file, "utf8"), KEY_TEXT, "nothing is deleted or changed");
    assert.deepEqual(verbs(fx.fake).filter((v) => v.startsWith("id ")), [], "before any effect");
    assert.ok(!existsSync(join(fx.ws, ".aweb-endorsed-root")));
  });
}

test("acceptance 15, C-5: legacy minting roots are inventory, never a reachable key: with a configured root for another team and an .aweb-roots root, setup goes past the scan", (t) => {
  const other = realpathSync(mkdtempSync(join(tmpdir(), "oats-aweb-ops-root-")));
  t.after(() => rmSync(other, { recursive: true, force: true }));
  const fx = attributionFixture(t, { attribution: false, root: "none", settings: { roots: { [OPS]: other } } });
  writeIdentity(join(other, ".aw"));
  writeIdentity(join(fx.ws, ".aweb-roots", "lab", ".aw"));
  const r = fx.setup([...endorseArgs(fx), "--json"]);
  assert.notEqual(r.doc?.error?.code, "E_PROTECTED_KEY_REACHABLE", r.stdout);
  assert.ok(verbs(fx.fake).some((v) => v.startsWith("id create")), `setup went on to create the root: ${verbs(fx.fake).join(", ")}`);
});

test("acceptance 15: an unreadable location reports unknown, the keychain is always unknown, and the scan never says clean", (t) => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "oats-aweb-scan-")));
  t.after(() => { chmodSync(join(home, ".awid", "team-keys"), 0o700); rmSync(home, { recursive: true, force: true }); });
  mkdirSync(join(home, ".awid", "team-keys"), { recursive: true });
  chmodSync(join(home, ".awid", "team-keys"), 0o000);
  const scan = scanProtectedKeys({ home, deployment: "/srv/deploy", service: "svc-acme", consumer: "oats.aweb" });
  assert.deepEqual(scan.findings, []);
  assert.ok(scan.unknown.some((u) => u.reference === join(home, ".awid", "team-keys") && u.readiness === "protected-key-inventory-unknown"), JSON.stringify(scan.unknown));
  assert.ok(scan.unknown.some((u) => u.custody === "human-keychain"));
  assert.ok(!JSON.stringify(scan).includes("clean"));
});

test("acceptance 15: a finding carries the contract's §7 fields: deployment, service, custody, reference, consumer, readiness and the proposed action", () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "oats-aweb-scan-")));
  try {
    mkdirSync(join(home, ".awid", "controllers"), { recursive: true });
    writeFileSync(join(home, ".awid", "controllers", "acme.example.key"), KEY_TEXT);
    const [finding] = scanProtectedKeys({ home, deployment: "/srv/deploy", service: "svc-acme", consumer: "oats.aweb" }).findings;
    assert.deepEqual(Object.keys(finding).sort(), ["action", "consumer", "custody", "deployment", "readiness", "reference", "service"]);
    assert.match(finding.action, /package 8/);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("acceptance 21: the endorse output carries every opt-in line", (t) => {
  const fx = attributionFixture(t, { attribution: false, root: "none" });
  const r = fx.setup(endorseArgs(fx));
  assert.equal(r.status, 0, r.stdout + r.stderr);
  for (const line of OPT_IN) assert.ok(r.stdout.includes(line), `missing: ${line}`);
});

test("acceptance 21: the opt-in lines say what test 21 lists", () => {
  const all = OPT_IN.join(" ");
  for (const needle of ["readable by every instance", "within its bounds", "spawns into the protected teams stop while", "respawn to attribute", "approves this root once", "E_ATTRIBUTION_REVOKED", "Human attribution: revocation", "~/.awid/team-keys", "~/.awid/controllers", "every existing BYOT deployment", "known precondition, not a bug", "no new residents until aweb's custody update lands", "a genuinely chainless spawner's child is still admitted by the root, but carries no chain"]) assert.ok(all.includes(needle), needle);
});

test("acceptance 21: the README's opt-in section carries every opt-in line, and says the derived label reaches the protected service", () => {
  const text = section("Human attribution: opting in");
  for (const line of OPT_IN) assert.ok(text.includes(flat(line)), `missing: ${line}`);
  assert.ok(text.includes("<short host name>:<basename of D>") && text.includes("sent to the protected service") && text.includes("shown on the approval page"), text);
});
