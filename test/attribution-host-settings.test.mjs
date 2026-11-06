// The host's attribution switch, read back from the deployment's
// oats-local.yaml: `attribution`, `human` and `steward` in the deployment-level
// settings.oats.aweb block, in exactly the block style oats.aweb writes. Any
// other form counts as off.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readHostAttribution, recordAwebScalar, recordAwebSetting } from "../oats-package/capabilities/oats-aweb/lib/local-settings.mjs";

function deployment(t, text) {
  const dir = mkdtempSync(join(tmpdir(), "oats-aweb-host-settings-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  if (text !== undefined) writeFileSync(join(dir, "oats-local.yaml"), text);
  return dir;
}
const OFF = { settings: {} };
const UNREADABLE = { settings: {}, unreadable: true };

test("what the bind writes reads back exactly: the writers and the reader stay in step", (t) => {
  const dir = deployment(t, "schemaVersion: 2\nworkspace: fixture\nsettings:\n  oats.aweb:\n    roots:\n      \"team-1\": \"/x/root\"\n");
  const home = `${dir}/.aweb-stewards/${"a-steward-alias-long-enough-to-wrap".repeat(3)}`;
  recordAwebSetting("steward", "id", "did:aw:steward1", { start: dir });
  recordAwebSetting("steward", "home", home, { start: dir });
  recordAwebSetting("human", "id", "did:aw:human1", { start: dir });
  recordAwebSetting("human", "label", "Juan \"JR\" Reyero — ünïcode", { start: dir });
  recordAwebScalar("attribution", "human", { start: dir });
  assert.deepEqual(readHostAttribution(dir), { settings: { attribution: "human", human: { id: "did:aw:human1", label: "Juan \"JR\" Reyero — ünïcode" }, steward: { id: "did:aw:steward1", home } } });
  recordAwebScalar("attribution", "none", { start: dir });
  assert.equal(readHostAttribution(dir).settings.attribution, "none");
});

test("absent counts as off, silently: no file, no settings, no oats.aweb block, no attribution key", (t) => {
  assert.deepEqual(readHostAttribution(deployment(t)), OFF);
  for (const text of ["schemaVersion: 2\nworkspace: fixture\n", "settings:\n  other.cap:\n    attribution: human\n", "settings:\n  oats.aweb:\n    delivery: session\n"]) {
    assert.deepEqual(readHostAttribution(deployment(t, text)), OFF, text);
  }
});

test("the forms the writers keep read too: plain, single- or double-quoted keys and values, comments, a wrapped quoted value", (t) => {
  const text = [
    "settings:",
    "  \"oats.aweb\":",
    "    'attribution': human # opted in",
    "    human:",
    "      id: did:aw:human1",
    "      'label': 'Juan ''JR'''",
    "    steward:",
    "      \"id\": \"did:aw:steward1\"",
    "      home: \"/deployment/.aweb-stewards/a-very-long-steward-alias-that-a-yaml-serializer\\",
    "        \\ wraps at its line width\"",
    "",
  ].join("\n");
  assert.deepEqual(readHostAttribution(deployment(t, text)), { settings: { attribution: "human", human: { id: "did:aw:human1", label: "Juan 'JR'" }, steward: { id: "did:aw:steward1", home: "/deployment/.aweb-stewards/a-very-long-steward-alias-that-a-yaml-serializer wraps at its line width" } } });
});

test("any other form counts as off, with the warning: flow style, duplicates, quoted map headers, nested or unterminated values", (t) => {
  for (const text of [
    "settings: {oats.aweb: {attribution: human}}\n",
    "settings:\n  oats.aweb: {attribution: human}\n",
    "settings:\n  oats.aweb:\n    attribution: human\n    human: {id: did:aw:human1}\n",
    "settings:\n  oats.aweb:\n    attribution: human\n    attribution: none\n",
    "settings:\n  oats.aweb:\n    \"human\":\n      id: did:aw:human1\n",
    "settings:\n  oats.aweb:\n    human:\n      id:\n        nested: x\n",
    "settings:\n  oats.aweb:\n    human:\n      id: \"did:aw:human1\n",
    "settings:\n  oats.aweb:\n    attribution: [human]\n",
    "settings:\n  oats.aweb:\n    attribution: &a human\n",
    "settings:\n  oats.aweb:\n    attribution: \"hu\\xman\"\n",
  ]) {
    assert.deepEqual(readHostAttribution(deployment(t, text)), UNREADABLE, text);
  }
});

test("only the deployment-level block counts: a soul's or another capability's attribution is not the host's", (t) => {
  const text = "settings:\n  other.cap:\n    attribution: human\nsouls:\n  dev:\n    settings:\n      oats.aweb:\n        attribution: human\n";
  assert.deepEqual(readHostAttribution(deployment(t, text)), OFF);
  assert.equal(readFileSync(join(deployment(t, text), "oats-local.yaml"), "utf8"), text, "reading writes nothing");
});
