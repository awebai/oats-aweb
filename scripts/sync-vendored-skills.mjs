#!/usr/bin/env node
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const UPSTREAM_REPOSITORY = "https://github.com/awebai/aweb.git";
const UPSTREAM_PACKAGE = "@awebai/pi";
const UPSTREAM_VERSION = "0.2.3";
const UPSTREAM_TAG = "pi-v0.2.3";
const UPSTREAM_COMMIT = "812bdeb1be8ed99dbd339a910a153e7b802501d4";
const UPSTREAM_INTEGRITY = "sha512-SnCT+5Ybh57G7+zwlfw6QRgAoyAVkyhcgRqIPPx47e+UcJdi5REXw9td806LveLEKAx0CwFTyxOInPH6mfs4EA==";
// Each vendored tree, with how this package adapts it for OATS (VENDORED.md says so).
const SKILLS = [
  ["aweb-messaging", ", adapted for OATS: a sync rewrites its Pi channel line to say OATS installs `@awebai/pi`, filtering out its bundled skills below 0.5.0, and that a home's skills come from OATS, so `@awebai/claude-skills` is not installed in a pi folder that OATS homes use"],
  ["aweb-team-membership", ", adapted for OATS: team changes go through `oats aweb teams|join|leave`"],
  ["aweb-identity", ""],
];
// Upstream lines a sync replaces, each found exactly once: [skill, file, upstream line, OATS line].
// OATS installs the pi extension without skills: below 0.5.0 its entry filters
// them out, and @awebai/claude-skills stays out of the pi folder (README, "The
// pi extension without its skills").
export const LINE_ADAPTATIONS = [
  ["aweb-messaging", "SKILL.md",
    "- **Pi**: install `@awebai/pi`; the aweb channel and these skills are bundled together.",
    "- **Pi**: OATS installs the `@awebai/pi` extension; below 0.5.0, its entry in the pi folder's `settings.json` carries `\"skills\": []`, as `{\"source\": \"npm:@awebai/pi\", \"skills\": []}`. A home's skills come from OATS: don't install `@awebai/claude-skills` in a pi folder that OATS homes use."],
];

/** `text` of `skill`/`file` with its line adaptations applied; refuses when an
 *  upstream line is not there exactly once, so a changed upstream is reviewed. */
export function adaptVendored(skill, file, text) {
  for (const [s, f, upstream, adapted] of LINE_ADAPTATIONS) {
    if (s !== skill || f !== file) continue;
    const lines = text.split("\n");
    const at = lines.flatMap((line, i) => (line === upstream ? [i] : []));
    if (at.length !== 1) throw new Error(`${skill}/${file}: expected upstream line ${JSON.stringify(upstream)} exactly once, found ${at.length}`);
    lines[at[0]] = adapted;
    text = lines.join("\n");
  }
  return text;
}

/** VENDORED.md as the shipped tree carries it: a sync rewrites it, adaptations included. */
export function vendoredMarkdown() {
  return `# Vendored aweb Agent Skills

These reviewed resources are vendored from the MIT-licensed aweb repository:

- Repository: <${UPSTREAM_REPOSITORY}>
- Upstream package: \`${UPSTREAM_PACKAGE}@${UPSTREAM_VERSION}\`
- Tag: \`${UPSTREAM_TAG}\`
- Commit: \`${UPSTREAM_COMMIT}\`
- Registry integrity: \`${UPSTREAM_INTEGRITY}\`
- License: MIT; see [\`LICENSE\`](LICENSE)

Vendored trees:

${SKILLS.map(([skill, adapted]) => `- /${skill} (directory \`skills/${skill}/\`${adapted})`).join("\n")}

All three trees are adapted for OATS: they carry no task-coordination text, since this messaging capability never teaches it. A sync restores upstream's text; \`test/no-task-coordination.test.mjs\` fails until it is adapted again.

Not vendored: /oats-aweb (directory \`skills/oats-aweb/\`) is this package's own OATS playbook (identity,
default and joined teams, roster, delivery and wakes, etiquette,
troubleshooting). Every \`aw\` invocation it and the vendored skills cite is
checked against a real published aw by \`test/oats-aweb-1-15.test.mjs\`.

To update, check out the named upstream repository at the intended reviewed commit, update the constants in \`scripts/sync-vendored-skills.mjs\`, then run from this repository root:

\`\`\`bash
node scripts/sync-vendored-skills.mjs --source /path/to/aweb
npm test
git diff -- oats-package/capabilities/oats-aweb/skills
\`\`\`

The sync command refuses a checkout whose \`HEAD\` differs from its pinned commit. Review the complete generated diff, upstream license, and triggering descriptions before changing the recorded version/ref. Runtime acquisition never fetches these resources.
`;
}

function sync() {
  const sourceIndex = process.argv.indexOf("--source");
  if (sourceIndex === -1 || !process.argv[sourceIndex + 1]) {
    process.stderr.write("usage: node scripts/sync-vendored-skills.mjs --source /path/to/aweb\n");
    process.exit(2);
  }

  const source = resolve(process.argv[sourceIndex + 1]);
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  // Vendored skills are DISTRIBUTED payload: they live under the package root
  // (`oats-package/`), not the repo root that carries this dev-only sync tool.
  const root = join(repoRoot, "oats-package");
  const destination = join(root, "capabilities", "oats-aweb", "skills");
  const git = (...args) => execFileSync("git", ["-C", source, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

  if (!existsSync(join(source, ".git"))) throw new Error(`${source} is not an aweb git checkout`);
  const head = git("rev-parse", "HEAD");
  if (head !== UPSTREAM_COMMIT) throw new Error(`upstream HEAD ${head} does not match pinned ${UPSTREAM_COMMIT} (${UPSTREAM_TAG})`);
  try { git("diff", "--quiet", "--", "LICENSE", "skills", "pi-extension/package.json"); }
  catch { throw new Error("upstream checkout has uncommitted vendored-source changes"); }

  const upstreamPackage = JSON.parse(readFileSync(join(source, "pi-extension", "package.json"), "utf8"));
  if (upstreamPackage.name !== UPSTREAM_PACKAGE || upstreamPackage.version !== UPSTREAM_VERSION) {
    throw new Error(`expected ${UPSTREAM_PACKAGE}@${UPSTREAM_VERSION}, found ${upstreamPackage.name}@${upstreamPackage.version}`);
  }

  for (const [skill] of SKILLS) {
    const from = join(source, "skills", skill);
    if (!existsSync(join(from, "SKILL.md"))) throw new Error(`missing upstream skill ${skill}/SKILL.md`);
    rmSync(join(destination, skill), { recursive: true, force: true });
    cpSync(from, join(destination, skill), { recursive: true });
  }
  for (const [skill, file] of LINE_ADAPTATIONS) {
    const path = join(destination, skill, file);
    writeFileSync(path, adaptVendored(skill, file, readFileSync(path, "utf8")));
  }
  cpSync(join(source, "LICENSE"), join(destination, "LICENSE"));

  writeFileSync(join(destination, "VENDORED.md"), vendoredMarkdown());
  process.stdout.write(`Synchronized ${SKILLS.length} skills from ${UPSTREAM_TAG} (${UPSTREAM_COMMIT}).\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) sync();
