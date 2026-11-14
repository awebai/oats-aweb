// The host-only setting settings.oats.aweb.attribution (spec v4.3.7 C-1): its
// shape, the label rule (the kernel's waiting-message rule), the protected
// profile's integrity check and its recorded digest, and its declaration in the
// manifest.
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { attributionSetting, profileDigest, profileProblem, validLabel } from "../oats-package/capabilities/oats-aweb/lib/attribution.mjs";
import { fixture } from "./helpers/delivery-fixture.mjs";

const DIGEST = `sha256:${"a".repeat(64)}`;
const valid = () => ({
  attribution: {
    root: { id: "did:aw:root1", home: "/srv/deploy/.aweb-endorsed-root/acme-root" },
    human: { id: "did:aw:human1", label: "Juan Pérez" },
    service: { id: "svc-acme", profile: "/srv/deploy/profile.json", profileDigest: `sha256:${"b".repeat(64)}`, url: "https://aweb.acme.example/api" },
    teams: ["backend:acme.example", "ops:acme.example"],
    endorsement: { operationId: "3f2b8c1e-9d4a-4b6e-8f0a-1c2d3e4f5a6b", policy: { version: 3, digest: DIGEST } },
  },
});

test("absent: no attribution, today's behaviour", () => {
  assert.equal(attributionSetting({}), null);
  assert.equal(attributionSetting({ delivery: "session" }), null);
});

test("a well-formed setting reads back whole", () => {
  assert.deepEqual(attributionSetting(valid()), valid().attribution);
});

test("a malformed setting refuses E_ATTRIBUTION_SETTING, naming the key", () => {
  const cases = [
    ["attribution", (s) => { s.attribution = "human"; }],
    ["attribution", (s) => { s.attribution = null; }],
    ["attribution.extra", (s) => { s.attribution.extra = 1; }],
    ["attribution.root", (s) => { delete s.attribution.root; }],
    ["attribution.service", (s) => { delete s.attribution.service; }],
    ["attribution.teams", (s) => { delete s.attribution.teams; }],
    ["attribution.endorsement", (s) => { delete s.attribution.endorsement; }],
    ["attribution.human", (s) => { s.attribution.human = "Juan"; }],
    ["attribution.root.id", (s) => { s.attribution.root.id = "did:key:z6Mkroot"; }],
    ["attribution.root.id", (s) => { s.attribution.root.id = "did:aw:"; }],
    ["attribution.root.home", (s) => { s.attribution.root.home = "relative/root"; }],
    ["attribution.root.home", (s) => { s.attribution.root.home = "/srv/deploy/../x"; }],
    ["attribution.root.extra", (s) => { s.attribution.root.extra = "x"; }],
    ["attribution.human.id", (s) => { s.attribution.human.id = 7; }],
    ["attribution.human.label", (s) => { delete s.attribution.human.label; }],
    ["attribution.human.label", (s) => { s.attribution.human.label = "two\nlines"; }],
    ["attribution.service.id", (s) => { s.attribution.service.id = ""; }],
    ["attribution.service.profile", (s) => { s.attribution.service.profile = "profile.json"; }],
    ["attribution.service.profileDigest", (s) => { s.attribution.service.profileDigest = "sha256:ABC"; }],
    ["attribution.service.profileDigest", (s) => { s.attribution.service.profileDigest = "a".repeat(64); }],
    ["attribution.service.url", (s) => { delete s.attribution.service.url; }],
    ["attribution.service.url", (s) => { s.attribution.service.url = "http://aweb.acme.example/api"; }],
    ["attribution.service.url", (s) => { s.attribution.service.url = "https://aweb.acme.example/api?x=1"; }],
    ["attribution.service.url", (s) => { s.attribution.service.url = "https://aweb.acme.example/api/"; }],
    ["attribution.teams", (s) => { s.attribution.teams = []; }],
    ["attribution.teams", (s) => { s.attribution.teams = "backend:acme.example"; }],
    ["attribution.teams", (s) => { s.attribution.teams = ["backend"]; }],
    ["attribution.teams", (s) => { s.attribution.teams = ["backend:acme.example", "backend:acme.example"]; }],
    ["attribution.endorsement.operationId", (s) => { s.attribution.endorsement.operationId = "not-a-uuid"; }],
    ["attribution.endorsement.policy.version", (s) => { s.attribution.endorsement.policy.version = 0; }],
    ["attribution.endorsement.policy.version", (s) => { s.attribution.endorsement.policy.version = "3"; }],
    ["attribution.endorsement.policy.version", (s) => { s.attribution.endorsement.policy.version = 1.5; }],
    ["attribution.endorsement.policy.digest", (s) => { s.attribution.endorsement.policy.digest = `sha256:${"A".repeat(64)}`; }],
  ];
  for (const [key, change] of cases) {
    const settings = valid();
    change(settings);
    assert.throws(() => attributionSetting(settings), (e) => {
      assert.equal(e.code, "E_ATTRIBUTION_SETTING", key);
      assert.equal(e.details.key, `settings.oats.aweb.${key}`, `${key}: ${e.message}`);
      assert.ok(e.message.includes(`settings.oats.aweb.${key}`), `${key}: ${e.message}`);
      assert.match(e.message, /oats-local\.yaml/);
      return true;
    });
  }
});

test("the label is one line of 1-200 characters with no control, line-break or bidi character", () => {
  for (const ok of ["J", "x".repeat(200), "🧑‍💻 Ana", "名前", " padded "]) assert.equal(validLabel(ok), true, JSON.stringify(ok));
  for (const bad of ["", "x".repeat(201), "a\nb", "a\rb", "a b", "a b", "a\u0007b", "a\u007fb", "a\u0085b", "a‮b", "a⁦b", "a​b", "a﻿b", "a\u{e0041}b", 42, null])
    assert.equal(validLabel(bad), false, JSON.stringify(bad));
});

// The profile pins the origins, registry and keys every protected call trusts.
function profileDir(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "oats-aweb-profile-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, "profile.json");
  writeFileSync(file, '{"v":1}\n', { mode: 0o600 });
  chmodSync(file, 0o600);
  return { dir, file };
}

test("a regular profile owned by the running user that only its owner can write passes", (t) => {
  const { file } = profileDir(t);
  for (const mode of [0o600, 0o644, 0o400, 0o444]) {
    chmodSync(file, mode);
    assert.equal(profileProblem(file, { key: "--protected-profile" }), null, mode.toString(8));
  }
});

test("a profile group or others can write refuses profile-mode, naming the key and the file", (t) => {
  const { file } = profileDir(t);
  for (const mode of [0o620, 0o602, 0o666]) {
    chmodSync(file, mode);
    const e = profileProblem(file, { key: "settings.oats.aweb.attribution.service.profile" });
    assert.equal(e?.code, "E_ATTRIBUTION_SETTING", mode.toString(8));
    assert.equal(e.details.problem, "profile-mode");
    assert.equal(e.details.key, "settings.oats.aweb.attribution.service.profile");
    assert.ok(e.message.includes(file), e.message);
  }
});

test("a profile that is a symlink, a directory or missing refuses profile-mode", (t) => {
  const { dir, file } = profileDir(t);
  const link = join(dir, "link.json");
  symlinkSync(file, link);
  mkdirSync(join(dir, "adir"));
  for (const path of [link, join(dir, "adir"), join(dir, "missing.json")]) {
    const e = profileProblem(path, { key: "--protected-profile" });
    assert.equal(e?.code, "E_ATTRIBUTION_SETTING", path);
    assert.equal(e.details.problem, "profile-mode", path);
  }
});

test("a profile another user owns refuses profile-mode; one root owns passes", (t) => {
  const { file } = profileDir(t);
  const me = process.getuid();
  assert.equal(profileProblem(file, { key: "--protected-profile", uid: me + 1 })?.details.problem, "profile-mode");
  // A root-owned 0644 operator-provisioned file (Juan's side, 7b066515), as /etc's passwd is on every Linux host.
  assert.equal(profileProblem("/etc/passwd", { key: "--protected-profile", uid: me === 0 ? 1000 : me }), null);
});

test("the profile's digest is sha256: and its 64 lowercase hex digits over the file's bytes", (t) => {
  const { file } = profileDir(t);
  // The file holds '{"v":1}\n'; its sha256, from `printf '{"v":1}\n' | sha256sum`.
  assert.equal(profileDigest(file), "sha256:2b4248702881de2f5638efe96b233de1c0dd9be5dd24ec35ad030d6b06aede9a");
});

test("the manifest declares attribution host-only", () => {
  const manifest = JSON.parse(readFileSync(new URL("../oats-package/capabilities/oats-aweb/oats.json", import.meta.url), "utf8"));
  assert.equal(manifest.settings.attribution?.hostOnly, true);
  assert.match(manifest.settings.attribution.description, /oats-local\.yaml/);
});

test("home readiness takes settings that carry attribution as a configuration it knows", (t) => {
  const fx = fixture(t, { delivery: "session", runtime: "codex", settings: valid() });
  const result = fx.readiness();
  assert.ok(["ready", "unavailable"].includes(result.status), JSON.stringify(result));
});

test("home readiness reports a malformed attribution setting as needs-configuration", (t) => {
  const settings = valid();
  settings.attribution.teams = [];
  const fx = fixture(t, { delivery: "session", runtime: "codex", settings });
  const result = fx.readiness();
  assert.equal(result.status, "needs-configuration", JSON.stringify(result));
});
