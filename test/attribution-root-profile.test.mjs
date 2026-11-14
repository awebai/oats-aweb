// The root home and the protected profile at spawn (spec v4.3.12 C-1, C-3),
// the spawn half of acceptance test 14: each problem refuses before any
// effect, with its fix inside the 300-character cap (test 23).
import assert from "node:assert/strict";
import { appendFileSync, chmodSync, copyFileSync, mkdirSync, mkdtempSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import test from "node:test";
import { CONTAINER_DEPLOYMENT, rootHomeProblem } from "../oats-package/capabilities/oats-aweb/lib/attribution.mjs";
import { attributionFixture, verbs } from "./helpers/attribution-fixture.mjs";
import { raceRootWalk } from "./helpers/root-walk-race.mjs";

const RACE = fileURLToPath(new URL("./helpers/root-walk-race.mjs", import.meta.url));

/** The refusal's own text, checked against the cap, and the aw calls the spawn made besides reading aw's version. */
function refused(fx, r) {
  assert.equal(r.status, 1, JSON.stringify(r.doc));
  const text = r.doc.warning.split(" | ")[0].replace(/^oats-aweb: /, "");
  assert.ok(text.length <= 300, `${text.length}: ${text}`);
  return { text, calls: verbs(fx.fake).filter((v) => !v.startsWith("version") && !v.startsWith("wake")) };
}

for (const [name, change, problem] of [
  ["group-writable", (fx) => chmodSync(fx.profile, 0o664), "is writable by its group"],
  ["other-writable", (fx) => chmodSync(fx.profile, 0o602), "is writable by others"],
  ["a symlink", (fx) => { copyFileSync(fx.profile, `${fx.profile}.real`); renameSync(fx.profile, `${fx.profile}.old`); symlinkSync(`${fx.profile}.real`, fx.profile); }, "is a symlink"],
]) {
  test(`acceptance 14: a profile that is ${name} refuses E_ATTRIBUTION_SETTING profile-mode at spawn, before any aw call`, (t) => {
    const fx = attributionFixture(t);
    change(fx);
    const { text, calls } = refused(fx, fx.spawn("dev-1"));
    assert.ok(text.startsWith("E_ATTRIBUTION_SETTING (problem: profile-mode): "), text);
    assert.ok(text.includes(problem), text);
    assert.ok(text.endsWith("that only its owner can write"), `the fix is cut: ${text}`);
    assert.deepEqual(calls, []);
  });
}

test("acceptance 14: a spawn after the profile changed refuses profile-changed, before any aw call", (t) => {
  const fx = attributionFixture(t);
  appendFileSync(fx.profile, " ");
  const { text, calls } = refused(fx, fx.spawn("dev-1"));
  assert.ok(text.startsWith("E_ATTRIBUTION_SETTING (problem: profile-changed): "), text);
  assert.deepEqual(calls, []);
});

test("acceptance 14: a root home open to others refuses E_ATTRIBUTION_ROOT_HOME mode before any effect", (t) => {
  const fx = attributionFixture(t);
  chmodSync(fx.rootHome, 0o755);
  const { text, calls } = refused(fx, fx.spawn("dev-1"));
  assert.ok(text.startsWith("E_ATTRIBUTION_ROOT_HOME (problem: mode): "), text);
  assert.ok(text.includes("`chmod -R go-rwx .aweb-endorsed-root` in the deployment"), text);
  assert.deepEqual(calls, []);
});

test("acceptance 23: a root home open to others under a longer alias still carries its whole fix within the cap", (t) => {
  const fx = attributionFixture(t);
  const rootHome = join(fx.ws, ".aweb-endorsed-root", "an-endorsed-root-with-a-moderately-long-name");
  renameSync(fx.rootHome, rootHome);
  mkdirSync(join(rootHome, "admissions", "a-subdirectory-with-a-long-name"), { recursive: true });
  chmodSync(join(rootHome, "admissions", "a-subdirectory-with-a-long-name"), 0o755);
  chmodSync(rootHome, 0o755);
  const settings = { ...fx.settings, attribution: { ...fx.setting, root: { ...fx.setting.root, home: rootHome } } };
  const { text, calls } = refused(fx, fx.hook("spawn", "dev-1", { OATS_SETTINGS: JSON.stringify(settings) }));
  assert.ok(text.startsWith("E_ATTRIBUTION_ROOT_HOME (problem: mode): "), text);
  assert.ok(text.endsWith("→ `chmod -R go-rwx .aweb-endorsed-root` in the deployment, then try again"), text);
  assert.deepEqual(calls, []);
});

test("acceptance 14: a root home outside D/.aweb-endorsed-root refuses placement before any effect", (t) => {
  const elsewhere = (fx) => { const home = join(fx.ws, "roots", "acme-root"); mkdirSync(join(fx.ws, "roots"), { mode: 0o700 }); renameSync(fx.rootHome, home); return home; };
  const probe = attributionFixture(t);
  const home = elsewhere(probe);
  const r = probe.hook("spawn", "dev-1", { OATS_SETTINGS: JSON.stringify({ ...probe.settings, attribution: { ...probe.setting, root: { ...probe.setting.root, home } } }) });
  const { text, calls } = refused(probe, r);
  assert.ok(text.startsWith("E_ATTRIBUTION_ROOT_HOME (problem: placement): "), text);
  assert.deepEqual(calls, []);
});

test("acceptance 14: a team container's deployment refuses container", () => {
  const problem = rootHomeProblem(`${CONTAINER_DEPLOYMENT}/.aweb-endorsed-root/acme-root`, { deployment: CONTAINER_DEPLOYMENT });
  assert.equal(problem.code, "E_ATTRIBUTION_ROOT_HOME");
  assert.equal(problem.details.problem, "container");
});

// Round 32, the lead's decision: other homes' admissions publish and delete copies under the root
// while a spawn checks it. A file that vanishes mid-walk is skipped (it can't be open to others,
// and a copy published after the listing is written owner-only); any other read failure fails
// closed as E_ATTRIBUTION_ROOT_HOME `mode`, naming the path and its code.
const COPY = "11111111-1111-4111-8111-111111111111.cert";
function rootWithCopy(t, name) {
  const D = mkdtempSync(join(tmpdir(), "oats-aweb-walk-"));
  t.after(() => rmSync(D, { recursive: true, force: true }));
  const R = join(D, ".aweb-endorsed-root", "r"), copies = join(R, "admissions");
  mkdirSync(copies, { recursive: true, mode: 0o700 });
  chmodSync(join(D, ".aweb-endorsed-root"), 0o700); chmodSync(R, 0o700);
  writeFileSync(join(copies, name), "{}", { mode: 0o600 });
  return { D, R, copies };
}
for (const [mode, name] of [["publish", `${COPY}.123.tmp`], ["delete", COPY]]) {
  test(`round 32: a root copy another admission ${mode === "publish" ? "publishes" : "deletes"} between the walk's listing and its check is skipped; the root passes`, (t) => {
    const { D, R, copies } = rootWithCopy(t, name);
    const restore = raceRootWalk(copies, mode);
    t.after(restore);
    assert.equal(rootHomeProblem(R, { deployment: D }), null);
  });
}
test("round 32: a directory under the root its owner can't read fails closed E_ATTRIBUTION_ROOT_HOME mode, naming it and its code, with the fix", (t) => {
  const { D, R, copies } = rootWithCopy(t, COPY);
  chmodSync(copies, 0o300);
  let e;
  try { e = rootHomeProblem(R, { deployment: D }); } finally { chmodSync(copies, 0o700); }
  assert.equal(e?.code, "E_ATTRIBUTION_ROOT_HOME", e?.message);
  assert.equal(e.details.problem, "mode");
  assert.ok(e.message.includes("admissions") && e.message.includes("EACCES"), e.message);
  assert.ok(e.message.includes("→ "), e.message);
});
test("round 32: a spawn whose root check races another admission's copy publication spawns", (t) => {
  const fx = attributionFixture(t), copies = join(fx.rootHome, "admissions");
  mkdirSync(copies, { mode: 0o700 });
  writeFileSync(join(copies, `${COPY}.123.tmp`), "{}", { mode: 0o600 });
  const r = fx.spawn("dev-1", { extra: { NODE_OPTIONS: `--import=${RACE}`, RACE_COPY_DIR: copies, RACE_MODE: "publish" } });
  assert.equal(r.status, 0, JSON.stringify(r.doc) + r.stderr);
});
