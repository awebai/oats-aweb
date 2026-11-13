// The root home and the protected profile at spawn (spec v4.3.12 C-1, C-3),
// the spawn half of acceptance test 14: each problem refuses before any
// effect, with its fix inside the 300-character cap (test 23).
import assert from "node:assert/strict";
import { appendFileSync, chmodSync, copyFileSync, mkdirSync, renameSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { CONTAINER_DEPLOYMENT, rootHomeProblem } from "../oats-package/capabilities/oats-aweb/lib/attribution.mjs";
import { attributionFixture, verbs } from "./helpers/attribution-fixture.mjs";

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
  assert.ok(text.includes(`chmod -R go-rwx ${fx.rootHome}`), text);
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
