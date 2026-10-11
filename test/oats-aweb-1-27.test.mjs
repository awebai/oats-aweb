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
  assert.match(skill, /OATS \(0\.52\.0 and later, which this provider requires\) confirms that prompt once\nat launch\. `delivery: session` or `claudeChannelMode: approved` stop the prompt\./);
  assert.match(skill, /decision at spawn apply, at start and restart, in the start preview\n\(`oats launch-config preview`\) and at readiness\./);
  assert.match(skill, /`oats spawn --preview` runs no provider hooks, so it shows no decision statement\nyet, from the provider or the kernel \(\[oats#912\]\(https:\/\/github\.com\/awebai\/oats\/issues\/912\)\)/);
  for (const file of ["README.md"]) assert.doesNotMatch(readFileSync(join(REPO, file), "utf8"), /launch-consent\.md|launchPromptAnswers/, file);
  assert.doesNotMatch(readFileSync(join(CAPABILITY, "injects", "aweb.md"), "utf8"), /per-home consent|nothing in this provider answers/);
});

test("the skill and changelog name claude-channels-unavailable, without approved as its remedy", () => {
  const skill = readFileSync(join(SKILL_DIR, "SKILL.md"), "utf8");
  assert.match(skill, /When Claude ignored the flag because the account or organization has no\nchannels, the kernel records `flag-ignored` and sends no key; readiness then\nwarns `claude-channels-unavailable` instead/);
  const row = skill.split("\n").find((line) => line.startsWith("| `claude-channels-unavailable` |"));
  assert.ok(row, "section 7 has a claude-channels-unavailable row");
  assert.match(row, /an account with channels, or `delivery: session`/);
  assert.doesNotMatch(row, /claudeChannelMode: approved`? (stops|fixes)|approved route/);
  const changelog = readFileSync(join(REPO, "CHANGELOG.md"), "utf8");
  const section = changelog.slice(changelog.indexOf("## 1.27.0"), changelog.indexOf("\n## ", changelog.indexOf("## 1.27.0") + 1));
  assert.match(section, /- \*\*`claude-channels-unavailable` when Claude ignored the development-channel flag\.\*\*/);
  assert.ok(section.includes("\"Claude ignored the development-channel flag at the last start: this account or\n  organization has no channels, so this home has no channel delivery. Use an\n  account with channels, or `delivery: session`.\""), section);
});

test("the changelog names each operator-visible 1.27.0 change", () => {
  const changelog = readFileSync(join(REPO, "CHANGELOG.md"), "utf8");
  const section = changelog.slice(changelog.indexOf("## 1.27.0"), changelog.indexOf("\n## ", changelog.indexOf("## 1.27.0") + 1));
  assert.match(section, /^## 1\.27\.0 — Unreleased\n/);
  for (const expected of [/OATS confirms/, /channel-dev-confirmation/, /`completed`/, /spawn --preview/, /oats#912/, /launch-consent/]) assert.match(section, expected);
});
