// aw-compat.json is oats.aweb's public statement of the aw it supports: `min`,
// the client floor every path is held to, and `tested`, the highest aw the CI
// journeys pass on. lib/aw-floor.mjs reads it at import, relative to itself, so
// the capability copied whole into a home's .oats/modules/oats-aweb/ reads its
// own copy. A file that is missing or breaks its rules fails the import, naming
// the file. Each case here copies aw-floor.mjs into a scratch capability with
// its own aw-compat.json and imports that copy.
import test from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { AW_MIN, AW_TESTED } from "../oats-package/capabilities/oats-aweb/lib/aw-floor.mjs";

const CAPABILITY = new URL("../oats-package/capabilities/oats-aweb/", import.meta.url);
const COMPAT = new URL("aw-compat.json", CAPABILITY);

/** A scratch capability holding lib/aw-floor.mjs and, unless `text` is
 *  undefined, aw-compat.json with `text`. Returns its aw-compat.json path and
 *  the import of its aw-floor.mjs (a promise). */
function scratchCapability(t, text) {
  const dir = mkdtempSync(join(tmpdir(), "aw-compat-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, "lib"));
  copyFileSync(new URL("lib/aw-floor.mjs", CAPABILITY), join(dir, "lib", "aw-floor.mjs"));
  const file = join(dir, "aw-compat.json");
  if (text !== undefined) writeFileSync(file, text);
  return { file, imported: import(pathToFileURL(join(dir, "lib", "aw-floor.mjs")).href) };
}

/** Asserts the import fails with a message naming the file and matching `why`. */
async function refuses(t, text, why) {
  const { file, imported } = scratchCapability(t, text);
  await assert.rejects(imported, (error) => {
    assert.ok(error.message.includes(file), `the message names ${file}: ${error.message}`);
    assert.match(error.message, why);
    return true;
  });
}

test("aw-compat.json is exactly two keys, min then tested, in 2-space JSON with a trailing newline", () => {
  const text = readFileSync(COMPAT, "utf8");
  const doc = JSON.parse(text);
  assert.deepEqual(Object.keys(doc), ["min", "tested"]);
  assert.equal(text, `${JSON.stringify(doc, null, 2)}\n`);
});

test("AW_MIN and AW_TESTED are the file's min and tested", () => {
  const doc = JSON.parse(readFileSync(COMPAT, "utf8"));
  assert.equal(AW_MIN, doc.min);
  assert.equal(AW_TESTED, doc.tested);
});

test("aw-floor.mjs reads the aw-compat.json beside its own capability, not the repository's", async (t) => {
  const { imported } = scratchCapability(t, '{\n  "min": "1.2.3",\n  "tested": "1.2.4-rc.1"\n}\n');
  const floor = await imported;
  assert.equal(floor.AW_MIN, "1.2.3");
  assert.equal(floor.AW_TESTED, "1.2.4-rc.1");
  assert.match(floor.awNewerThanTestedMessage("1.2.4", "https://aweb.example.test/api") || "", /tested with \(1\.2\.4-rc\.1\)/);
});

test("min may equal tested", async (t) => {
  const { imported } = scratchCapability(t, '{"min": "1.36.33", "tested": "1.36.33"}');
  assert.equal((await imported).AW_TESTED, "1.36.33");
});

test("a missing aw-compat.json fails the import, naming the file", async (t) => {
  await refuses(t, undefined, /cannot be read/);
});

test("an aw-compat.json that isn't JSON fails the import, naming the file", async (t) => {
  await refuses(t, '{"min": "1.36.33", "tested": ', /not valid JSON/);
  await refuses(t, "", /not valid JSON/);
});

test("an aw-compat.json that isn't a JSON object fails the import, naming the file", async (t) => {
  for (const text of ["null", '["1.36.33", "1.36.56"]', '"1.36.56"', "1"]) await refuses(t, text, /must be a JSON object/);
});

test("an aw-compat.json with an extra key fails the import, naming the file and the key", async (t) => {
  await refuses(t, '{"min": "1.36.33", "tested": "1.36.56", "max": "1.37.0"}', /exactly the keys "min" and "tested".*"max"/);
  await refuses(t, '{"min": "1.36.33", "tested": "1.36.56", "__proto__": {}}', /exactly the keys "min" and "tested".*"__proto__"/);
});

test("an aw-compat.json missing a key fails the import, naming the file", async (t) => {
  await refuses(t, '{"min": "1.36.33"}', /exactly the keys "min" and "tested"/);
  await refuses(t, '{"tested": "1.36.56"}', /exactly the keys "min" and "tested"/);
  await refuses(t, "{}", /exactly the keys "min" and "tested"/);
});

test("a value that isn't an exact semver string fails the import, naming the file and the field", async (t) => {
  for (const [field, value] of [
    ["min", "^1.36.33"], ["min", ">=1.36.33"], ["min", "1.36"], ["min", "v1.36.33"], ["min", "01.36.33"], ["min", " 1.36.33"], ["min", 1.36],
    ["tested", "1.36.x"], ["tested", "latest"], ["tested", "1.36.56 || 1.36.57"], ["tested", ""], ["tested", null],
  ]) {
    const doc = { min: "1.36.33", tested: "1.36.56", [field]: value };
    await refuses(t, JSON.stringify(doc), new RegExp(`${field} must be an exact semver version`));
  }
});

test("min above tested fails the import, naming the file and both values", async (t) => {
  await refuses(t, '{"min": "1.36.56", "tested": "1.36.33"}', /min 1\.36\.56 is above tested 1\.36\.33/);
  await refuses(t, '{"min": "1.36.56", "tested": "1.36.56-rc.1"}', /min 1\.36\.56 is above tested 1\.36\.56-rc\.1/);
});

test("no code in the oats-aweb capability holds its own copy of min or tested", () => {
  const files = [];
  const walk = (dir) => { for (const entry of readdirSync(dir, { withFileTypes: true })) entry.isDirectory() ? walk(join(dir, entry.name)) : entry.name.endsWith(".mjs") && files.push(join(dir, entry.name)); };
  walk(fileURLToPath(CAPABILITY));
  assert.ok(files.some((f) => f.endsWith(join("lib", "aw-floor.mjs"))), "the walk reaches lib/aw-floor.mjs");
  // A feature's own floor (AW_INVITE_INSPECT, AW_STATUS_MIN) is a named
  // constant and may equal a bound by chance; any other version written as a
  // value, quoted or after @ as in an npm spec, is a copy.
  const featureFloor = /^export const (?!AW_MIN\b|AW_TESTED\b)AW_[A-Z_]+ = '[^']*';$/gm;
  for (const version of [AW_MIN, AW_TESTED]) {
    const literal = new RegExp(`[@'"\`]${version.replaceAll(".", "\\.")}(?![0-9A-Za-z.+-])`);
    for (const file of files) assert.doesNotMatch(readFileSync(file, "utf8").replace(featureFloor, ""), literal, `${file} writes ${version}; read AW_MIN or AW_TESTED from lib/aw-floor.mjs`);
  }
});

test("the manifest's aw requirement names aw-compat.json's min", () => {
  const manifest = JSON.parse(readFileSync(new URL("oats.json", CAPABILITY), "utf8"));
  const aw = manifest.requires.filter((r) => r.command === "aw");
  assert.equal(aw.length, 1);
  assert.match(aw[0].why, new RegExp(`^aw >= ${AW_MIN.replaceAll(".", "\\.")}:`));
});

test("the README's aw-compat.json section shows the file as it is", () => {
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
  const section = readme.slice(readme.indexOf("\n## aw-compat.json: the aw this provider supports\n"));
  assert.ok(section.length < readme.length, "the README has the section");
  assert.ok(section.includes(`\`\`\`json\n${readFileSync(COMPAT, "utf8")}\`\`\`\n`), "its json block is the file, byte for byte");
});
