// Records test/fixtures/compat-<version>.json from a released tree, never from
// the working branch:
//
//   git archive v1.42.1 | tar -x -C <dir>
//   node test/helpers/record-compat-fixture.mjs <dir> test/fixtures/compat-1.42.1.json
//
// It copies compat-journey.mjs into <dir>/test/helpers/ and runs every journey
// there, so the transcript comes from that tree's own hook, fixture and fakes.
import { copyFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const [tree, out] = process.argv.slice(2);
if (!tree || !out) { console.error("usage: node test/helpers/record-compat-fixture.mjs <released tree> <out.json>"); process.exit(2); }
const target = join(resolve(tree), "test", "helpers", "compat-journey.mjs");
copyFileSync(fileURLToPath(new URL("./compat-journey.mjs", import.meta.url)), target);
const { COMPAT_JOURNEYS, compatTranscript } = await import(pathToFileURL(target).href);

const cleanups = [];
const t = { after: (f) => cleanups.push(f) };
const recorded = [];
try {
  for (const journey of COMPAT_JOURNEYS) recorded.push({ journey, transcript: compatTranscript(t, journey) });
} finally {
  for (const f of cleanups.reverse()) f();
}
writeFileSync(out, `${JSON.stringify(recorded, null, 1)}\n`);
console.log(`recorded ${recorded.length} journeys from ${resolve(tree)} into ${out}`);
