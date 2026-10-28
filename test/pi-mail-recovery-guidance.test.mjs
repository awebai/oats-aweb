// Documentation guardrails only: this does not reproduce or fix aweb#68.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const skill = readFileSync(new URL("../oats-package/capabilities/oats-aweb/skills/oats-aweb/SKILL.md", import.meta.url), "utf8");
const recovery = skill.split("**Mail recovery: session delivery and affected Pi channel versions**")[1]?.split("### Receive verification and recovery")[0]?.replace(/\s+/g, " ");

test("the always-loaded inject triggers recovery even when the skill or wake is absent", () => {
  const inject = readFileSync(new URL("../oats-package/capabilities/oats-aweb/injects/aweb.md", import.meta.url), "utf8").replace(/\s+/g, " ");
  assert.match(inject, /on pi with `@awebai\/pi` 0\.4\.0 after any interrupted turn and at task boundaries/);
  assert.match(inject, /at task boundaries \(load `\/oats-aweb` section 4\), reconcile/);
  assert.match(inject, /STATE and task records against exact (?:delivered )?ids/);
  assert.match(inject, /`aw mail inbox --show-all --json` (?:paged )?with `--cursor`/);
});

test("Pi recovery is scoped to the reported extension version with a fixed-pin removal condition", () => {
  assert.ok(recovery, "extend the shared recovery procedure in section 4");
  assert.match(recovery, /`@awebai\/pi` 0\.4\.0.*Pi 1\.3\.0/);
  assert.match(recovery, /https:\/\/github\.com\/awebai\/aweb\/issues\/68/);
  assert.match(recovery, /Remove this Pi-specific workaround only once an `@awebai\/pi` version fixing #68 is pinned/);
  assert.match(recovery, /Other versions are not established/);
});

test("Pi interruption and task boundaries require a history scan with shared id reconciliation", () => {
  assert.match(recovery, /After any interrupted turn.*at task boundaries, run `aw mail inbox --show-all --json` and reconcile by `message_id`/);
  assert.match(recovery, /even if the unread inbox is empty or no wake was presented/);
  assert.match(recovery, /`has_more` \/ `next_cursor` with `--cursor`/);
  assert.match(recovery, /For the Pi workaround, always do that history scan/);
  assert.match(recovery, /`aw mail show --message-id <id> --json`/);
  assert.match(recovery, /receiving identity's `--identity-home`/);
  assert.match(recovery, /Check sender verification/);
  assert.match(recovery, /compare each id with recorded handling/);
  assert.match(recovery, /Read state is not completion/);
  assert.match(recovery, /check the receipts of earlier side effects before retrying/);
  assert.match(recovery, /`aw mail show --conversation-id` is a thread view, not a recovery check/);
  assert.match(recovery, /never a polling loop/);
});
