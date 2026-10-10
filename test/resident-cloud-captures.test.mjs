// `oats aweb resident create` against aw 1.36.33's real answers from aweb
// Cloud's local preview stack (test/fixtures/resident/cloud, SOURCE.md): the
// hosted init's success, the file trees a success and a killed run leave, and
// two refusals that keep the partial.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { checkInitAnswer, rootState } from "../oats-package/capabilities/oats-aweb/lib/resident.mjs";
import { NAME, setup } from "./helpers/resident-harness.mjs";

const cloud = (file) => readFileSync(new URL(`./fixtures/resident/cloud/${file}`, import.meta.url), "utf8");
function scratch(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "oats-resident-cloud-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
/** Recreates a captured listing of names: an entry with others under it is a
 *  directory, any other an empty file. */
function tree(root, listing) {
  const names = listing.trim().split("\n");
  for (const name of names) {
    if (names.some((other) => other.startsWith(`${name}/`))) mkdirSync(join(root, name), { recursive: true });
    else { mkdirSync(join(root, name, ".."), { recursive: true }); writeFileSync(join(root, name), ""); }
  }
}

test("the hosted API-key init's real answer passes the command's check", () => {
  const answer = JSON.parse(cloud("1-init-global-resident1.json"));
  assert.deepEqual(checkInitAnswer(answer, "resident1"), { address: "juan.dev.aweb.test/resident1", stableId: "did:aw:3u52PeUJ7mCp1nJfgANEtcKmUK3N", team: "default:juan.dev.aweb.test" });
  assert.throws(() => checkInitAnswer(answer, "resident2"), { code: "E_RESIDENT_VERIFY", message: 'aw init answered alias "resident1", not resident2' });
});

test("the tree a hosted success leaves is a complete identity; a run killed after registration leaves a partial only", (t) => {
  const done = join(scratch(t), "r1");
  tree(done, cloud("1-aw-file-list-resident1.txt"));
  assert.equal(rootState(done).state, "adopt");
  const killed = join(scratch(t), "r2");
  mkdirSync(join(killed, ".aw"), { recursive: true });
  writeFileSync(join(killed, ".aw", "partial-init.yaml"), cloud("2-partial-init.yaml"));
  assert.equal(rootState(killed).state, "continue");
});

// The replayed refusals keep the partial, as aw does; exit 2 is what the
// capture's README records for the different-name refusal, and 1 stands in for
// the 409's exit status, which the capture does not record.
for (const [file, exit] of [["3-refusal-different-name.txt", 2], ["3-refusal-resume-after-name-taken.txt", 1]]) {
  test(`aw's hosted refusal passes through verbatim, with no advice of ours: ${file}`, (t) => {
    const s = setup(t);
    const aw = join(s.fake.bin, "aw");
    writeFileSync(aw, readFileSync(aw, "utf8").replace('if (argv[0] === "init") {', `if (argv[0] === "init") { process.stderr.write(${JSON.stringify(cloud(file))}); process.exit(${exit}); }\nif (false) {`));
    mkdirSync(join(s.root, ".aw"), { recursive: true });
    writeFileSync(join(s.root, ".aw", "partial-init.yaml"), "");
    const r = s.run(["create", NAME, "--json"]);
    assert.equal(r.status, 1);
    assert.equal(r.doc.error.code, "E_RESIDENT_INIT");
    assert.equal(r.doc.error.message, cloud(file).trim());
    assert.equal(r.doc.error.details.partial, join(s.root, ".aw", "partial-init.yaml"));
    const text = s.run(["create", NAME]);
    assert.equal(text.stderr, `FAIL init: ${cloud(file).trim()}\n`);
  });
}
