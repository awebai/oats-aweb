// oats.aweb 1.27.0: the kernel confirms Claude's development-channel prompt at
// launch (oats#886), so the provider states that decision instead of a consent
// recipe, and readiness is quiet once the kernel recorded a completed start.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const REPO = resolve(fileURLToPath(new URL("..", import.meta.url)));
const CAPABILITY = join(REPO, "oats-package", "capabilities", "oats-aweb");
const SKILL_DIR = join(CAPABILITY, "skills", "oats-aweb");
const manifest = JSON.parse(readFileSync(join(CAPABILITY, "oats.json"), "utf8"));

test("the kernel floor admits stopped-home upgrades", () => {
  const distribution = JSON.parse(readFileSync(join(REPO, "oats-package", "oats-package.json"), "utf8"));
  assert.equal(manifest.compatibility.oats, ">=0.68.0");
  assert.equal(distribution.compatibility.oats, ">=0.68.0");
});

test("the changelog leads 1.27.0 with the host order and the kernel floor, quoting the kernel's refusal", () => {
  const changelog = readFileSync(join(REPO, "CHANGELOG.md"), "utf8");
  const section = changelog.slice(changelog.indexOf("## 1.27.0"), changelog.indexOf("\n## ", changelog.indexOf("## 1.27.0") + 1));
  assert.match(section, /^## 1\.27\.0 — 2026-10-11\n\n\*\*Host order, before syncing to this release:\*\* upgrade the OATS kernel to\n0\.52\.0 or later first, then `oats sync`\./);
  assert.match(section, /aw 1\.36\.33 or later, with every resident custody service and the host wake\ndaemon restarted/);
  assert.match(section, /\*\*Compatibility: requires OATS 0\.52\.0 or later\.\*\* Older kernels stay on\noats\.aweb 1\.26\.2\./);
  // The kernel's own refusal (lib/resolve.mjs, E_CAPABILITY_INCOMPATIBLE), for a package pin.
  assert.ok(section.includes("`E_CAPABILITY_INCOMPATIBLE`: \"oats.aweb requires oats >=0.52.0; this kernel is <version> — pin a release of oats.aweb whose range admits <version> in the workspace's packages:, or run a kernel the range admits\""), section);
});

test("claudeChannelMode's description states what each mode passes and who confirms the prompt", () => {
  const description = manifest.settings.claudeChannelMode.description;
  assert.match(description, /development passes --dangerously-load-development-channels, and OATS confirms Claude's development-channel prompt at launch/i);
  assert.match(description, /approved .*passes --channels and, with the machine's managed policy, avoids the prompt/i);
  assert.match(description, /channelsEnabled/);
  assert.match(description, /allowedChannelPlugins/);
  assert.match(description, /No automatic fallback, migration or flip-back; a future default change requires an explicit reviewed release\./);
  assert.doesNotMatch(description, /never launch consent|fixed plugin argument/);
});

test("the skill drops the exact-home consent and its reference, and says where the decision shows", () => {
  assert.equal(existsSync(join(SKILL_DIR, "references", "launch-consent.md")), false);
  const skill = readFileSync(join(SKILL_DIR, "SKILL.md"), "utf8");
  for (const gone of [/launchPromptAnswers/, /launch-consent\.md/, /exact-home/, /awebDevelopmentChannel/]) assert.doesNotMatch(skill, gone);
  assert.match(skill, /\*\*Channel selection and the development-channel prompt\*\*/);
  assert.match(skill, /OATS 0\.52\.0 and later confirm that prompt once\nat launch\. `settings\.oats\.aweb\.claudeChannelMode: approved` stops the prompt\./);
  const devRow = skill.split("\n").find((line) => line.startsWith("| `channel-dev-confirmation` |"));
  assert.match(devRow, /to stop the prompt, operator: section 4's approved route, then respawn/);
  assert.match(skill, /decision at spawn apply, at start and restart, in the start preview\n\(`oats launch-config preview`\) and at readiness\./);
  assert.match(skill, /`oats spawn --preview` runs no provider hooks, so it shows no decision statement\nyet, from the provider or the kernel \(\[oats#912\]\(https:\/\/github\.com\/awebai\/oats\/issues\/912\)\)/);
  for (const file of ["README.md"]) assert.doesNotMatch(readFileSync(join(REPO, file), "utf8"), /launch-consent\.md|launchPromptAnswers/, file);
  assert.doesNotMatch(readFileSync(join(CAPABILITY, "injects", "aweb.md"), "utf8"), /per-home consent|nothing in this provider answers/);
});

test("every sentence saying what stops the prompt names the full setting paths", () => {
  const flat = (text) => text.replace(/\s+/g, " ");
  const STOP = "`settings.oats.aweb.claudeChannelMode: approved` stops the prompt";
  const changelog = readFileSync(join(REPO, "CHANGELOG.md"), "utf8");
  const section = changelog.slice(changelog.indexOf("## 1.27.0"), changelog.indexOf("\n## ", changelog.indexOf("## 1.27.0") + 1));
  assert.ok(flat(section).includes("the kernel confirms it once at launch (oats#886). `settings.oats.aweb.delivery: session` or `settings.oats.aweb.claudeChannelMode: approved` stop the prompt altogether."), section);
  assert.ok(flat(readFileSync(join(REPO, "README.md"), "utf8")).includes(`OATS 0.52.0 and later confirm it once at launch; ${STOP}.`), "README configuration section");
  // The inject leaves channel modes to the skill (operator material); it routes there and states no partial stop rule.
  const inject = flat(readFileSync(join(CAPABILITY, "injects", "aweb.md"), "utf8"));
  assert.ok(inject.includes("Channel modes are the operator's (`/oats-aweb` section 4)"), "injects/aweb.md routes channel modes to the skill");
  assert.ok(!/stops? the prompt/i.test(inject) || inject.includes(STOP), "injects/aweb.md");
});

test("the skill, readme and changelog give both causes of claude-channels-unavailable, without approved as its remedy", () => {
  const flat = (text) => text.replace(/\s+/g, " ");
  const CAUSES = "Claude Code disables channels when its launch environment opts out of telemetry (`DISABLE_TELEMETRY`, `DO_NOT_TRACK` or `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`) or when the account or organization has no channels.";
  const skill = readFileSync(join(SKILL_DIR, "SKILL.md"), "utf8");
  const paragraph = flat(skill.slice(skill.indexOf("When Claude ignored the flag"), skill.indexOf("`oats spawn --preview` runs no provider hooks")));
  assert.ok(paragraph.startsWith("When Claude ignored the flag, the kernel records `flag-ignored` and sends no key; readiness then warns `claude-channels-unavailable` instead"), paragraph);
  assert.ok(paragraph.includes(CAUSES), paragraph);
  assert.ok(paragraph.includes("Remove the variable from the launch environment, or use an account with channels"), paragraph);
  assert.ok(paragraph.includes("The provider never reads or changes those variables."), paragraph);
  const row = skill.split("\n").find((line) => line.startsWith("| `claude-channels-unavailable` |"));
  assert.ok(row, "section 7 has a claude-channels-unavailable row");
  for (const name of ["DISABLE_TELEMETRY", "DO_NOT_TRACK", "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC"]) assert.match(row, new RegExp(`\`${name}\``));
  assert.match(row, /remove the variable from the launch environment, or use an account with channels/);
  assert.doesNotMatch(row, /claudeChannelMode: approved`? (stops|fixes)|approved route/);
  const readme = flat(readFileSync(join(REPO, "README.md"), "utf8"));
  assert.ok(readme.includes("when Claude ignored the flag (the kernel recorded `flag-ignored`): its launch environment opts out of telemetry (`DISABLE_TELEMETRY`, `DO_NOT_TRACK` or `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`), or the account or organization has no channels. Remove the variable from the launch environment, or use an account with channels."), "README 1.27.0 bullet");
  assert.ok(readme.includes("OATS confirms it once at launch. `settings.oats.aweb.claudeChannelMode: approved` stops the prompt."), "README 1.27.0 bullet");
  assert.doesNotMatch(readme, /ignored the flag because the account/);
  const changelog = readFileSync(join(REPO, "CHANGELOG.md"), "utf8");
  const section = changelog.slice(changelog.indexOf("## 1.27.0"), changelog.indexOf("\n## ", changelog.indexOf("## 1.27.0") + 1));
  assert.match(section, /- \*\*`claude-channels-unavailable` when Claude ignored the development-channel flag\.\*\*/);
  assert.ok(flat(section).includes("\"Claude ignored the development-channel flag at the last start, so this home has no channel delivery. " + CAUSES + " Remove the variable from the launch environment yourself, use an account with channels, or use `settings.oats.aweb.delivery: session`.\""), section);
  assert.ok(flat(section).includes("\"Claude's development-channel prompt: OATS confirms this prompt at launch; `settings.oats.aweb.delivery: session` or `settings.oats.aweb.claudeChannelMode: approved` stop it.\""), section);
  assert.ok(flat(section).includes("The provider never reads, unsets or changes these variables"), section);
  for (const text of [skill, section]) assert.doesNotMatch(flat(text), /Where the account or organization has no channels, Claude ignores|because the account or organization has no channels/);
});

test("the changelog names each operator-visible 1.27.0 change", () => {
  const changelog = readFileSync(join(REPO, "CHANGELOG.md"), "utf8");
  const section = changelog.slice(changelog.indexOf("## 1.27.0"), changelog.indexOf("\n## ", changelog.indexOf("## 1.27.0") + 1));
  assert.match(section, /^## 1\.27\.0 — 2026-10-11\n/);
  for (const expected of [/OATS confirms/, /channel-dev-confirmation/, /`completed`/, /spawn --preview/, /oats#912/, /launch-consent/]) assert.match(section, expected);
});
