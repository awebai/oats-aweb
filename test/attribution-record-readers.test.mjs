// Every read of an admission record goes through its two readers in lib/admission.mjs:
// providerRecords (a directory's records) and readAdmission (one label's). Both apply one check
// (recordProblem, with the label of the record's file), so no command acts on a record another
// refuses (the lead, mail 2bf3ffb7-b48b-4385-89a9-ffd945f54901). This search fails on any other
// line of the package that names a record's path: a new one is a read that skips the check, or a
// write to add below with why.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";

const ROOT = new URL("..", import.meta.url).pathname;
const PACKAGE = join(ROOT, "oats-package");
/** A line that names an admission record's path: its file name, or a builder of one. */
const NAMES_RECORD = /admissionFile\(|leftAdmissionName\(|admission-[^'"`\s]*json/;
/** The lines allowed to name one: [file, the line's text (trimmed), why]. */
const ALLOWED = [
  ["oats-package/capabilities/oats-aweb/lib/admission.mjs", "export const admissionFile = (providerDir, label) => join(providerDir, `admission-${label}.json`);", "the record path's one builder"],
  ["oats-package/capabilities/oats-aweb/lib/admission.mjs", "try { names = readdirSync(dir).filter((f) => /^admission-.+\\.json$/.test(f)).sort(); }", "providerRecords, the first reader"],
  ["oats-package/capabilities/oats-aweb/lib/admission.mjs", "const file = join(dir, f), shown = `${basename(dir)}/${f}`, label = /^admission-(.+?)(?:~left-[^.]*)?\\.json$/.exec(f)?.[1] ?? null;", "providerRecords: each record's label is its file's"],
  ["oats-package/capabilities/oats-aweb/lib/admission.mjs", "const file = admissionFile(providerDir, label), shown = `${basename(providerDir)}/${basename(file)}`;", "readAdmission, the second reader"],
  ["oats-package/capabilities/oats-aweb/lib/admission.mjs", "export const recordAdmission = (providerDir, label, doc) => writePrivate(admissionFile(providerDir, label), `${JSON.stringify(doc, null, 2)}\\n`);", "the record's writer"],
  ["oats-package/capabilities/oats-aweb/lib/removal.mjs", "export const leftAdmissionName = (label, certificateId) => `admission-${label}~left-${certificateId}.json`;", "a set-aside record's name, which providerRecords reads"],
  ["oats-package/capabilities/oats-aweb/bin/oats-aweb.mjs", "const left = join(providerDir, leftAdmissionName(label, after.certificateId));", "a leave writes its set-aside record"],
  ["oats-package/capabilities/oats-aweb/bin/oats-aweb.mjs", "rmSync(admissionFile(providerDir, label), { force: true });", "a leave removes the record it set aside"],
];

function sources(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === "node_modules") return [];
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(?:mjs|js|cjs)$/.test(name) ? [path] : [];
  });
}
/** Every code line in the package that names an admission record's path: [file, text]. */
function namingLines() {
  return sources(PACKAGE).flatMap((path) => readFileSync(path, "utf8").split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("//") && !line.startsWith("*") && !line.startsWith("/*") && NAMES_RECORD.test(line))
    .map((line) => [relative(ROOT, path), line]));
}

test("every line of the package that names an admission record's path is one of its readers, its writers or its builders", () => {
  const allowed = new Set(ALLOWED.map(([file, line]) => `${file}\n${line}`));
  const others = namingLines().filter(([file, line]) => !allowed.has(`${file}\n${line}`));
  assert.deepEqual(others, [], "read admission records with providerRecords or readAdmission (lib/admission.mjs)");
});

test("each allowed line is in the package once, so the list stays the package's", () => {
  const found = namingLines().map(([file, line]) => `${file}\n${line}`);
  for (const [file, line, why] of ALLOWED) assert.equal(found.filter((f) => f === `${file}\n${line}`).length, 1, `${why}: ${file}: ${line}`);
});
