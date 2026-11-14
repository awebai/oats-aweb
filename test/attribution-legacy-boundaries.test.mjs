// Every command that reaches a member-invite accept (a spawn's `aw init --join-from`, a join's
// `aw id team accept-invite`) maps aw's legacy-path refusals at its boundary through one reader,
// legacyRefusalOf (lib/attribution.mjs): E_PROTECTED_ADMISSION_REQUIRED and
// E_PROTECTION_STATE_UNAVAILABLE, each with its whole fix (C-8, C-9; the lead, round 30). This
// search fails on any call of those paths not listed below, and on a listed one whose failure no
// longer reaches legacyRefusalOf: a new caller is a boundary to map, or to add here with why.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const ROOT = new URL("..", import.meta.url).pathname;
const BIN = "oats-package/capabilities/oats-aweb/bin/oats-aweb.mjs";
const lines = readFileSync(join(ROOT, BIN), "utf8").split("\n");
/** A code line that calls an invite-accepting path (its definition aside). */
const CALLS = /\bmintJoinedTeam\(|\bacceptConnectVerifyJoinedTeam\(|"--join-from"/;
/** The line that defines function `name` (a call on it is that function's own). */
const defines = (line, name) => new RegExp(`^(?:async )?function ${name}\\(`).test(line.trim());
const code = (line) => { const t = line.trim(); return t && !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*"); };
/** A line that starts a new top-level function or event branch: a catch past one isn't this call's. */
const TOP = /^(?:async )?function |^\} else if \(event === |^if \(event === /;
const MAPS = "legacyRefusalOf(e)";

/** Each call: [a piece of its line, how its failure reaches legacyRefusalOf, why].
 *  - {catch: piece}: the call's own catch maps it, on the line holding `piece`, after the call
 *    and before the next top-level function or branch;
 *  - {callers: name}: every throw of its catch carries `legacyRefusal` or rethrows the failure,
 *    so each caller of `name` is a row of its own;
 *  - {via: name}: the call is in function `name`, whose every call site's catch maps it. */
const SITES = [
  ['flagEq("--join-from", root)', { catch: "const legacy = legacyRefusalOf(e);" }, "the spawn's primary mint"],
  ["({ joined } = acceptConnectVerifyJoinedTeam({ label: row.label,", { callers: "mintJoinedTeam" }, "a joined team's accept, inside mintJoinedTeam"],
  ["for (const row of joinRows) { const result = mintJoinedTeam(row, meta);", { catch: "const legacy = legacyRefusalOf(e);\n" }, "the spawn's joined teams"],
  ["mintJoinedTeam(row, meta, { current: true })", { via: "runTeamsCommand" }, "a home's own join"],
  // Setup keeps its own code for its readers; the message is the refusal's why and fix, and
  // details.code names it (the lead, round 30).
  ["({ joined } = acceptConnectVerifyJoinedTeam({ label, token, identityHome: idHome,", { catch: "const legacy = legacyRefusalOf(e);" }, "setup --join's per-team root accept"],
];

const indexOf = (piece) => {
  const found = lines.map((l, i) => [l, i]).filter(([l]) => l.includes(piece.trimEnd()));
  assert.equal(found.length, 1, `exactly one line of ${BIN} holds ${JSON.stringify(piece)}: ${found.map(([, i]) => i + 1).join(", ")}`);
  return found[0][1];
};
/** The first line at or after `from` holding `piece`, before the next top-level line. */
function mappedAfter(from, piece) {
  for (let i = from + 1; i < lines.length; i++) {
    if (TOP.test(lines[i])) return -1;
    if (lines[i].includes(piece.trimEnd())) return i;
  }
  return -1;
}
const enclosingFunction = (at) => { for (let i = at; i >= 0; i--) { const m = /^(?:async )?function ([A-Za-z0-9_]+)\(/.exec(lines[i]); if (m) return m[1]; } return null; };

test("every call of an invite-accepting path is a listed boundary", () => {
  const listed = new Set(SITES.map(([piece]) => indexOf(piece)));
  const others = lines.map((l, i) => [l, i]).filter(([l]) => code(l) && CALLS.test(l) && !defines(l, "mintJoinedTeam") && !defines(l, "acceptConnectVerifyJoinedTeam"))
    .filter(([, i]) => !listed.has(i)).map(([l, i]) => `${i + 1}: ${l.trim().slice(0, 120)}`);
  assert.deepEqual(others, [], "map each new caller through legacyRefusalOf at its boundary, or list it with why");
});

for (const [piece, how, why] of SITES) {
  test(`${why}: its failure reaches legacyRefusalOf`, () => {
    const at = indexOf(piece);
    if (how.catch) {
      const m = mappedAfter(at, how.catch);
      assert.ok(m > at && lines[m].includes(MAPS), `the catch after line ${at + 1} maps through ${MAPS}`);
      return;
    }
    if (how.callers) {
      assert.equal(enclosingFunction(at), how.callers, `line ${at + 1} is in ${how.callers}`);
      // Its catch: every throw carries legacyRefusal or rethrows the failure itself.
      const start = lines.findIndex((l, i) => i > at && /catch \(e\) \{/.test(l));
      const end = lines.findIndex((l, i) => i > start && /^ {2}\}$/.test(l));
      const throws = lines.slice(start, end).filter((l) => /\bthrow\b/.test(l));
      assert.ok(throws.length > 0, "the catch throws");
      for (const t of throws) assert.ok(/throw e;/.test(t) || t.includes(`legacyRefusal: ${MAPS}`), `carries or rethrows: ${t.trim()}`);
      const callers = lines.map((l, i) => [l, i]).filter(([l]) => code(l) && l.includes(`${how.callers}(`) && !defines(l, how.callers));
      for (const [, i] of callers) assert.ok(SITES.some(([p]) => lines[i].includes(p.trimEnd())), `the caller at line ${i + 1} is a row`);
      return;
    }
    assert.equal(enclosingFunction(at), how.via, `line ${at + 1} is in ${how.via}`);
    const calls = lines.map((l, i) => [l, i]).filter(([l]) => code(l) && l.includes(`${how.via}(`) && !defines(l, how.via));
    assert.ok(calls.length > 0, `${how.via} is called`);
    for (const [, i] of calls) {
      const m = mappedAfter(i, MAPS);
      assert.ok(m > i && m - i <= 6, `the catch of ${how.via}'s call at line ${i + 1} maps through ${MAPS}`);
    }
  });
}
