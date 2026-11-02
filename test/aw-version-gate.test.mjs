// The real-aw doc checks gate the commands a section marks as needing a
// newer aw than the provider's floor (`aw-min <version>` markers): below that
// version they are named in a diagnostic, never silently passed, and nothing
// outside a marked section is ever gated.
import assert from "node:assert/strict";
import test from "node:test";
import { awAtLeast, splitByAwMin } from "./helpers/aw-version-gate.mjs";

test("a marked section is gated by its version; text outside any marker never is", () => {
  const text = "before `aw mail send`\n<!-- aw-min 1.36.53 -->\nchains: `aw who`\n<!-- /aw-min -->\nafter `aw chat pending`\n";
  const { ungated, gated } = splitByAwMin(text);
  assert.match(ungated, /aw mail send/);
  assert.match(ungated, /aw chat pending/);
  assert.doesNotMatch(ungated, /aw who/);
  assert.deepEqual(gated.map((g) => [g.min, /aw who/.test(g.text)]), [["1.36.53", true]]);
});

test("code markers gate the same way", () => {
  const { ungated, gated } = splitByAwMin('run(["aw", "mail"]);\n// aw-min 1.36.53\nrun(["aw", "who", "--json"]);\n// /aw-min\nrun(["aw", "chat"]);\n');
  assert.doesNotMatch(ungated, /"who"/);
  assert.match(ungated, /"mail"[\s\S]*"chat"/);
  assert.equal(gated.length, 1);
});

test("an unclosed, nested or versionless marker refuses, so a typo can't widen the gate", () => {
  for (const text of ["<!-- aw-min 1.36.53 -->\n`aw who`\n", "<!-- aw-min 1.36.53 -->\n<!-- aw-min 1.36.60 -->\n<!-- /aw-min -->\n<!-- /aw-min -->\n", "<!-- /aw-min -->\n", "<!-- aw-min -->\n<!-- /aw-min -->\n"]) {
    assert.throws(() => splitByAwMin(text), /aw-min/, JSON.stringify(text));
  }
});

test("versions compare on major.minor.patch, so a release candidate of the marked version meets it", () => {
  assert.equal(awAtLeast("aw 1.36.53-rc.3 fixture", "1.36.53"), true);
  assert.equal(awAtLeast("aw 1.36.53", "1.36.53"), true);
  assert.equal(awAtLeast("aw 1.36.60", "1.36.53"), true);
  assert.equal(awAtLeast("aw 1.36.51", "1.36.53"), false);
  assert.equal(awAtLeast("no version", "1.36.53"), false);
});

// The shipped files: what their aw-min 1.36.53 sections may hold, and that
// every chain command they cite is in one.
import { readFileSync } from "node:fs";
const CAPABILITY = new URL("../oats-package/capabilities/oats-aweb/", import.meta.url);
const SHIPPED = [new URL("skills/oats-aweb/SKILL.md", CAPABILITY), new URL("bin/oats-aweb.mjs", CAPABILITY), new URL("../README.md", import.meta.url)];
const awCommands = (text) => [...text.matchAll(/`(aw\s[^`]+)`/g)].map((m) => m[1]).concat([...text.matchAll(/\["aw",\s*"([a-z-]+)"(?:,\s*"([a-z-]+)")?(?:,\s*"([a-z-]+)")?/g)].map((m) => ["aw", ...m.slice(1).filter(Boolean)].join(" ")));
const CHAIN = /^aw (who\b|id (child|parent)\b)/;

test("an aw-min 1.36.53 section in the shipped files cites only aw's identity-chain commands", () => {
  for (const file of SHIPPED) for (const section of splitByAwMin(readFileSync(file, "utf8")).gated) {
    assert.equal(section.min, "1.36.53", file.pathname);
    for (const cmd of awCommands(section.text)) assert.match(cmd, CHAIN, `${file.pathname}: ${cmd} is gated but is not a chain command`);
  }
});

test("every identity-chain command the shipped files cite is inside an aw-min 1.36.53 section", () => {
  for (const file of SHIPPED) {
    const outside = awCommands(splitByAwMin(readFileSync(file, "utf8")).ungated).filter((cmd) => CHAIN.test(cmd));
    assert.deepEqual(outside, [], file.pathname);
  }
});
