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

test("the claim-human section gives the command against the setup root's identity", () => {
  assert.match(section(), /aw --identity-home "<root>\/\.aw" claim-human --email <their email>/);
});

test("the claim-human section says the account is theirs only once the link is clicked", () => {
  const text = section();
  assert.match(text, /`verification_sent`/);
  assert.match(text, /only\s+once\s+they\s+click\s+the\s+link/);
  assert.match(text, /`attached`/);
  assert.match(text, /`already_attached`/);
});

test("the claim-human section checks by one rerun after the click, since a rerun before it replaces the link", () => {
  const text = section();
  assert.match(text, /the\s+person\s+clicks\s+the\s+link\s+first;\s+then\s+run\s+the\s+same\s+command\s+once/);
  assert.match(text, /a\s+new\s+link,\s+and\s+the\s+earlier\s+one\s+stops\s+working/);
  assert.match(text, /use\s+the\s+newest\s+mail/);
});

test("the claim-human section runs with exactly the address the person gives, and the click is theirs", () => {
  const text = section();
  assert.match(text, /ask\s+the\s+person\s+for\s+their\s+email\s+address\s+and\s+run\s+the\s+command\s+with\s+exactly\s+that\s+address/);
  assert.match(text, /never\s+a\s+guessed\s+or\s+inferred\s+one/);
  assert.match(text, /The\s+person's\s+own\s+act\s+is\s+clicking\s+the\s+link/);
  assert.doesNotMatch(text, /in their own\s+shell|never\s+runs it for them/);
});
