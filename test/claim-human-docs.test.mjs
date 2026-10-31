// The /oats-aweb section a person follows to attach themselves to an aweb
// account that `oats aweb setup --username` created without a sign-in. The
// oats.setup onboarding skill points to it by its heading, so the heading is a
// cross-reference contract.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const REPO = resolve(fileURLToPath(new URL("..", import.meta.url)));
const SKILL = readFileSync(join(REPO, "oats-package", "capabilities", "oats-aweb", "skills", "oats-aweb", "SKILL.md"), "utf8");

const section = () => {
  const start = SKILL.indexOf("\n### attach yourself to the account\n");
  assert.notEqual(start, -1, "the skill has a section headed \"attach yourself to the account\"");
  const end = SKILL.indexOf("\n#", start + 1);
  return SKILL.slice(start, end === -1 ? undefined : end);
};

test("the claim-human section gives the person's command against the setup root's identity", () => {
  assert.match(section(), /aw --identity-home "<root>\/\.aw" claim-human --email <your email>/);
});

test("the claim-human section says the account is theirs only once the link is clicked", () => {
  const text = section();
  assert.match(text, /`verification_sent`/);
  assert.match(text, /only once they click the link/);
  assert.match(text, /`attached`/);
  assert.match(text, /`already_attached`/);
});

test("the claim-human section is the person's own act, never run with a guessed email", () => {
  assert.match(section(), /the person's own act/);
  assert.match(section(), /never with a guessed email/);
});
