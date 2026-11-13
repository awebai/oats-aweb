// Acceptance test 19 (spec v4.3.22): every E_* the attribution code emits is
// in C-9, the two codes C-9 drops are never emitted, and no text says
// "steward" (as v3.3's test 16).
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const CAPABILITY = join(ROOT, "oats-package", "capabilities", "oats-aweb");
/** C-9's codes, as the spec lists them (v4.3.22, "Error codes and warnings"). */
const C9 = new Set([
  "E_SETUP_ARGUMENT", "E_SETUP_KERNEL", "E_SETUP_AW_VERSION", "E_REQUIRED_HOOK_FAILED",
  "E_ENDORSE_ROOT_INELIGIBLE", "E_ENDORSE_POLICY", "E_ENDORSE_NOT_APPROVED", "E_ENDORSE_FAILED", "E_ENDORSE_ONE_ROOT", "E_PROTECTED_KEY_REACHABLE",
  "E_PROTECTED_ADMISSION_REQUIRED",
  "E_ATTRIBUTION_ROOT_HOME", "E_ATTRIBUTION_EVIDENCE", "E_ATTRIBUTION_SETTING",
  "E_ATTRIBUTION_ISSUER_OUTSIDE_ROOT", "E_ATTRIBUTION_REVOKED", "E_ATTRIBUTION_EXCHANGE", "E_ATTRIBUTION_DEPTH", "E_ADMISSION_LIMIT", "E_ADMISSION_REFUSED", "E_ADMISSION_UNKNOWN",
]);
const DROPPED = ["E_ENDORSE_LOGIN", "E_ATTRIBUTION_CHAINED_MINT"];
/** The attribution modules, whole. */
const MODULES = ["admission", "attribution", "attribution-readiness", "endorse-root", "key-scan", "protected-client", "reconcile", "removal"].map((m) => join(CAPABILITY, "lib", `${m}.mjs`));
const read = (f) => readFileSync(f, "utf8");
const literals = (text) => [...text.matchAll(/["'`](E_[A-Z][A-Z0-9_]*)["'`]/g)].map((m) => m[1]);

test("acceptance 19: every E_* code the attribution modules emit is in C-9", () => {
  const found = new Set(MODULES.flatMap((f) => literals(read(f))));
  assert.ok(found.size >= 15, `only ${found.size} codes found: the search reads nothing`);
  assert.deepEqual([...found].filter((c) => !C9.has(c)), []);
});

test("acceptance 19: every attribution refusal the hook and the resident command raise is in C-9", () => {
  const hook = read(join(CAPABILITY, "bin", "oats-aweb.mjs")), resident = read(join(CAPABILITY, "lib", "resident.mjs"));
  const raised = [...hook.matchAll(/attributionError\("(E_[A-Z0-9_]+)"/g)].map((m) => m[1]);
  // The setup forms' fallbacks for a refusal with no code of its own.
  const fallbacks = [...hook.matchAll(/e\.code\.startsWith\("E_"\) \? e\.code : "(E_[A-Z0-9_]+)"/g)].map((m) => m[1]);
  const residentCodes = literals(resident).filter((c) => !c.startsWith("E_RESIDENT_"));
  assert.ok(raised.length >= 5 && fallbacks.length >= 2 && residentCodes.length >= 1, "the search reads nothing");
  assert.deepEqual([...raised, ...fallbacks, ...residentCodes].filter((c) => !C9.has(c)), []);
});

test("acceptance 19: the codes C-9 drops are never emitted", () => {
  const all = [...MODULES, join(CAPABILITY, "bin", "oats-aweb.mjs"), join(CAPABILITY, "lib", "resident.mjs")].map(read).join("\n");
  for (const code of DROPPED) assert.ok(!all.includes(code), code);
});

test("acceptance 19: no steward wording in the provider, its skills or the README", () => {
  const files = [join(ROOT, "README.md")];
  const walk = (dir) => { for (const e of readdirSync(dir, { withFileTypes: true })) { const p = join(dir, e.name); if (e.isDirectory()) walk(p); else if (/\.(mjs|md|json|ya?ml)$/.test(e.name)) files.push(p); } };
  walk(CAPABILITY);
  assert.deepEqual(files.filter((f) => /steward/i.test(read(f))), []);
});
