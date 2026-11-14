// A spawn refusal is at most 300 characters and carries its whole fix (C-9, test 23): over the
// cap, refusalText shortens the problem, never the fix, and never returns an unbounded text
// (round 25; the lead, mail 12973e40-45d8-451f-a349-a738ab7cdbaa).
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { REFUSAL_ROOM, ROOT_DIR, attributionError, refusalText, rootHomeProblem } from "../oats-package/capabilities/oats-aweb/lib/attribution.mjs";
import { attributionFixture } from "./helpers/attribution-fixture.mjs";

/** The fix a refusal's message names: from its " → " on. */
const fixOf = (e) => e.message.slice(e.message.indexOf(" → "));
/** Asserts `text` is within the cap and ends with `e`'s whole fix. */
function fits(text, e) {
  assert.ok(text.length <= REFUSAL_ROOM, `${text.length}: ${text}`);
  assert.ok(text.startsWith(`${e.code}`), text);
  assert.ok(text.endsWith(fixOf(e)), `the whole fix: ${text}`);
}
/** A legal deployment directory far longer than the cap: three 200-character components. */
function longDeployment(t) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "oats-aweb-room-")));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const D = join(base, ..."abc".split("").map((c) => c.repeat(200)));
  mkdirSync(join(D, ROOT_DIR), { recursive: true, mode: 0o700 });
  return D;
}

test("refusalText: a fix that leaves the problem no room keeps the code and the whole fix, within the cap", () => {
  const head = "E_ATTRIBUTION_EXCHANGE (step: lock): ";
  const fix = ` → ${"f".repeat(REFUSAL_ROOM - head.length - 1 - 3)}`;
  const e = attributionError("E_ATTRIBUTION_EXCHANGE", `${"p".repeat(400)}${fix}`, { step: "lock" });
  const text = refusalText(e);
  assert.equal(text, `${head}…${fix}`);
  fits(text, e);
});

test("refusalText never returns more than the cap: a fix longer than the room, or a message with no fix", () => {
  const long = attributionError("E_ATTRIBUTION_EXCHANGE", `problem → ${"f".repeat(400)}`, { step: "lock" });
  const bare = attributionError("E_ATTRIBUTION_EXCHANGE", "p".repeat(400), { step: "lock" });
  for (const e of [long, bare]) {
    const text = refusalText(e);
    assert.ok(text.length <= REFUSAL_ROOM, `${text.length}`);
    assert.ok(text.startsWith("E_ATTRIBUTION_EXCHANGE (step: lock): "), text);
  }
});

// The root home's fixes name it within the deployment, so a long deployment path never pushes
// them past the cap. Each check of rootHomeProblem, at a deployment path of over 600 characters.
const ROOT_CASES = [
  ["mode", (D) => { const home = join(D, ROOT_DIR, "a".repeat(64)); mkdirSync(home, { mode: 0o755 }); return home; }],
  ["placement: missing", (D) => join(D, ROOT_DIR, "a".repeat(64))],
  ["placement: not directly under", (D) => { const home = join(D, "elsewhere", "a".repeat(64)); mkdirSync(home, { recursive: true, mode: 0o700 }); return home; }],
  ["placement: under an instance home", (D) => { const home = join(D, ROOT_DIR, "a".repeat(64)); mkdirSync(home, { mode: 0o700 }); writeFileSync(join(D, "instance.json"), "{}"); return home; }],
  ["placement: in a Git work tree", (D) => { const home = join(D, ROOT_DIR, "a".repeat(64)); mkdirSync(home, { mode: 0o700 }); mkdirSync(join(D, ".git")); return home; }],
];
for (const [name, make] of ROOT_CASES) {
  test(`C-9: the root home's ${name} refusal keeps its whole fix on a long deployment path`, (t) => {
    const D = longDeployment(t);
    const e = rootHomeProblem(make(D), { deployment: D });
    assert.equal(e?.code, "E_ATTRIBUTION_ROOT_HOME", String(e?.message));
    assert.ok(!fixOf(e).includes(D), `the fix doesn't name the deployment's path: ${fixOf(e)}`);
    fits(refusalText(e), e);
  });
}

test("C-9, test 23: a spawn whose root home is open to other users, on a long deployment path, refuses with its whole fix", (t) => {
  const fx = attributionFixture(t);
  const D = join(fx.ws, "directory-with-a-meaningful-long-deployment-name-".repeat(4));
  mkdirSync(join(D, ROOT_DIR), { recursive: true, mode: 0o700 });
  const root = join(D, ROOT_DIR, "acme-root");
  renameSync(fx.rootHome, root);
  chmodSync(root, 0o755);
  writeFileSync(join(D, "oats-local.yaml"), "schemaVersion: 2\nworkspace: fixture\n");
  const settings = { ...fx.settings, attribution: { ...fx.setting, root: { ...fx.setting.root, home: root } } };
  const r = fx.hook("spawn", "dev-1", { OATS_SETTINGS: JSON.stringify(settings), OATS_WORKSPACE: D });
  assert.equal(r.status, 1);
  const text = r.doc.warning.split(" | ")[0].replace(/^oats-aweb: /, "");
  assert.ok(text.length <= REFUSAL_ROOM, `${text.length}: ${text}`);
  assert.ok(text.startsWith("E_ATTRIBUTION_ROOT_HOME (problem: mode): "), text);
  assert.ok(text.endsWith(`\`chmod -R go-rwx ${ROOT_DIR}\` in the deployment, then try again`), text);
});
