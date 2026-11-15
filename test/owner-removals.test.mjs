// aweb-adbl: the host's record of members that retires handed to their team's owner
// (<deployment>/.oats-aweb/owner-removals.json). Data only; the owner's command is rebuilt
// from validated values wherever it is shown.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO = resolve(fileURLToPath(new URL("..", import.meta.url)));
const LIB_DIR = join(REPO, "oats-package", "capabilities", "oats-aweb", "lib");
const { OWNER_REMOVALS_MAX, ownerRemovalCommand, readOwnerRemovals, recordOwnerRemovals } = await import(pathToFileURL(join(LIB_DIR, "owner-removals.mjs")).href);

function tempDir(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "oats-aweb-owner-removals-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function write(p, c) { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, c); }
const recordFile = (ws) => join(ws, ".oats-aweb", "owner-removals.json");
const entry = (over = {}) => ({ team: "default:example.test", alias: "dev-1", certificateId: "cert-default-123", instance: "dev-1", retiredAt: "2026-11-15T10:00:00.000Z", ...over });

test("the owner's command names the member address and the team", () => {
  assert.equal(ownerRemovalCommand({ team: "default:example.test", alias: "dev-1" }), "aw team admin remove-agent example.test/dev-1 --team-id default:example.test");
});

test("no owner command is built from a team or alias that is not valid", () => {
  for (const bad of [{ team: "default", alias: "dev-1" }, { team: "default:example.test; rm -rf /", alias: "dev-1" }, { team: "default:example.test", alias: "-rf" }, { team: "default:example.test", alias: "dev 1" }, { team: "default:example.test", alias: "dev-1\naw x" }, { team: "default:example.test" }, {}]) {
    assert.equal(ownerRemovalCommand(bad), undefined, JSON.stringify(bad));
  }
});

test("the record holds data only, never a command", (t) => {
  const ws = tempDir(t);
  assert.deepEqual(recordOwnerRemovals(ws, [entry()]), {});
  assert.deepEqual(JSON.parse(readFileSync(recordFile(ws), "utf8")), { version: 1, entries: [entry()] });
});

test("recording the same instance's member again writes no second entry", (t) => {
  const ws = tempDir(t);
  recordOwnerRemovals(ws, [entry()]);
  recordOwnerRemovals(ws, [entry({ retiredAt: "2026-11-15T11:00:00.000Z" })]);
  assert.deepEqual(readOwnerRemovals(ws).entries, [entry({ retiredAt: "2026-11-15T11:00:00.000Z" })]);
});

test("an entry no owner command can be built from is not recorded", (t) => {
  const ws = tempDir(t);
  assert.deepEqual(recordOwnerRemovals(ws, [entry({ alias: "-rf" }), entry({ team: "nope" })]), {});
  assert.equal(existsSync(recordFile(ws)), false);
});

test("a record with a malformed entry is reported, and nothing from it is read", (t) => {
  const ws = tempDir(t);
  write(recordFile(ws), JSON.stringify({ version: 1, entries: [entry(), entry({ alias: "x; aw id team remove-member" })] }));
  assert.deepEqual(readOwnerRemovals(ws), { entries: [], problem: "the record of members OATS handed to their team's owner on this host is malformed; nothing from it is shown" });
});

test("no record is no entries and no problem", (t) => {
  assert.deepEqual(readOwnerRemovals(tempDir(t)), { entries: [], missing: true });
});

test("the record keeps the newest entries up to its cap", (t) => {
  const ws = tempDir(t);
  recordOwnerRemovals(ws, Array.from({ length: OWNER_REMOVALS_MAX + 2 }, (_, i) => entry({ alias: `dev-${i}`, instance: `dev-${i}` })));
  const { entries } = readOwnerRemovals(ws);
  assert.equal(entries.length, OWNER_REMOVALS_MAX);
  assert.equal(entries[0].alias, "dev-2");
});

test("an older provider rewriting retired-certificates.json on the same host leaves owner-removals.json untouched", (t) => {
  const ws = tempDir(t), old = tempDir(t);
  // The record writer as oats.aweb 1.42.1 (f3f5e02) shipped it, with the modules it imports.
  for (const name of ["retired-certificates.mjs", "aweb-team-id.mjs", "plain-service.mjs"]) {
    write(join(old, name), execFileSync("git", ["-C", REPO, "show", `f3f5e02:oats-package/capabilities/oats-aweb/lib/${name}`], { encoding: "utf8" }));
  }
  recordOwnerRemovals(ws, [entry()]);
  const before = readFileSync(recordFile(ws), "utf8");
  // A malformed retired-certificates record, so the older writer replaces it.
  write(join(ws, ".oats-aweb", "retired-certificates.json"), JSON.stringify({ version: 1, entries: [{ kind: "something newer" }] }));
  const script = `const { recordRetiredCertificates } = await import(${JSON.stringify(pathToFileURL(join(old, "retired-certificates.mjs")).href)});
console.log(JSON.stringify(recordRetiredCertificates(${JSON.stringify(ws)}, [{ team: "default:example.test", certificateId: "cert-other-1", alias: "dev-2", instance: "dev-2", retiredAt: "2026-11-15T12:00:00.000Z" }])));`;
  const answer = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" }));
  assert.deepEqual(answer, { cause: "the previous record was malformed and was replaced" }, "premise: the older writer rewrote its record");
  assert.equal(readFileSync(recordFile(ws), "utf8"), before);
});
