// Host-only provider settings in a deployment's oats-local.yaml: the block-YAML
// writer shared by settings.oats.aweb.roots (setup) and .residents (resident create).
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { assertAwebSettingRecordable, recordAwebScalar, recordAwebSetting } from "../oats-package/capabilities/oats-aweb/lib/local-settings.mjs";

function deployment(t, text) {
  const dir = mkdtempSync(join(tmpdir(), "oats-local-settings-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  if (text !== undefined) writeFileSync(join(dir, "oats-local.yaml"), text);
  return dir;
}
const read = (dir) => readFileSync(join(dir, "oats-local.yaml"), "utf8");

test("records a resident beside existing roots without touching them", (t) => {
  const dir = deployment(t, 'schemaVersion: 2\nworkspace: local\nsettings:\n  oats.aweb:\n    roots:\n      "default:example.com": "/roots/default"\n');
  recordAwebSetting("residents", "alice", "/d/.aweb-residents/alice", { start: dir });
  assert.equal(read(dir), 'schemaVersion: 2\nworkspace: local\nsettings:\n  oats.aweb:\n    roots:\n      "default:example.com": "/roots/default"\n    residents:\n      "alice": "/d/.aweb-residents/alice"\n');
});

test("creates the file and the residents block when absent", (t) => {
  const dir = deployment(t);
  recordAwebSetting("residents", "alice", "/r/alice", { start: dir });
  assert.equal(read(dir), 'schemaVersion: 2\nworkspace: local\nsettings:\n  oats.aweb:\n    residents:\n      "alice": "/r/alice"\n');
});

test("re-recording the same resident is idempotent and a new value replaces the entry", (t) => {
  const dir = deployment(t, "settings:\n  oats.aweb:\n    residents:\n      alice: /old # kept comment\n      bob: /b\n");
  recordAwebSetting("residents", "alice", "/new", { start: dir });
  recordAwebSetting("residents", "alice", "/new", { start: dir });
  assert.equal(read(dir), 'settings:\n  oats.aweb:\n    residents:\n      "alice": "/new" # kept comment\n      bob: /b\n');
});

test("a flow-style residents mapping is refused with the line to add by hand, naming residents", (t) => {
  const dir = deployment(t, "settings:\n  oats.aweb:\n    residents: { bob: /b }\n");
  const before = read(dir);
  assert.throws(() => assertAwebSettingRecordable("residents", "alice", "/r/alice", { start: dir }),
    { message: `${join(dir, "oats-local.yaml")}: cannot safely update settings.oats.aweb.residents automatically (line 3 is not a block-style residents: mapping); add this line by hand under block-style settings.oats.aweb.residents: "alice": "/r/alice"` });
  assert.throws(() => recordAwebSetting("residents", "alice", "/r/alice", { start: dir }), /settings\.oats\.aweb\.residents/);
  assert.equal(read(dir), before);
});

test("roots keep their own wording", (t) => {
  const dir = deployment(t, "settings:\n  oats.aweb:\n    roots: { x: /x }\n");
  assert.throws(() => recordAwebSetting("roots", "default:example.com", "/r", { start: dir }),
    { message: `${join(dir, "oats-local.yaml")}: cannot safely update settings.oats.aweb.roots automatically (line 3 is not a block-style roots: mapping); add this line by hand under block-style settings.oats.aweb.roots: "default:example.com": "/r"` });
});

test("the health map takes a boolean as a YAML boolean, beside quoted strings, and replaces it in place", (t) => {
  const dir = deployment(t, 'schemaVersion: 2\nworkspace: local\nsettings:\n  oats.aweb:\n    root: "/roots/default"\n');
  recordAwebSetting("health", "publish", true, { start: dir });
  recordAwebSetting("health", "operator", "Nactiva's operator", { start: dir });
  assert.equal(read(dir), 'schemaVersion: 2\nworkspace: local\nsettings:\n  oats.aweb:\n    root: "/roots/default"\n    health:\n      "publish": true\n      "operator": "Nactiva\'s operator"\n');
  recordAwebSetting("health", "publish", false, { start: dir });
  assert.match(read(dir), /\n {6}"publish": false\n {6}"operator"/);
});

test("records the attribution scalar directly under oats.aweb, beside maps, and replaces it in place", (t) => {
  const dir = deployment(t, 'settings:\n  oats.aweb:\n    roots:\n      "default:example.com": "/roots/default"\n');
  recordAwebScalar("attribution", "human", { start: dir });
  assert.equal(read(dir), 'settings:\n  oats.aweb:\n    roots:\n      "default:example.com": "/roots/default"\n    attribution: "human"\n');
  recordAwebScalar("attribution", "human", { start: dir });
  assert.equal(read(dir), 'settings:\n  oats.aweb:\n    roots:\n      "default:example.com": "/roots/default"\n    attribution: "human"\n');
  const plain = deployment(t, "settings:\n  oats.aweb:\n    attribution: none # chosen\n    delivery: session\n");
  recordAwebScalar("attribution", "human", { start: plain });
  assert.equal(read(plain), 'settings:\n  oats.aweb:\n    attribution: "human" # chosen\n    delivery: session\n');
});

test("creates the file and blocks for the attribution scalar when absent", (t) => {
  const dir = deployment(t);
  recordAwebScalar("attribution", "human", { start: dir });
  assert.equal(read(dir), 'schemaVersion: 2\nworkspace: local\nsettings:\n  oats.aweb:\n    attribution: "human"\n');
});

test("an attribution scalar it cannot edit safely refuses with the line to add by hand", (t) => {
  for (const text of ["settings:\n  oats.aweb:\n    attribution:\n      nested: x\n", "settings:\n  oats.aweb: { attribution: none }\n", "settings:\n  oats.aweb:\n    attribution: none\n    attribution: human\n"]) {
    const dir = deployment(t, text);
    assert.throws(() => recordAwebScalar("attribution", "human", { start: dir }), /add this line by hand under block-style settings\.oats\.aweb: attribution: "human"/, text);
    assert.equal(read(dir), text);
  }
});
