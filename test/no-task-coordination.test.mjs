// oats.aweb is messaging only: nothing it puts into a home mentions the task-
// coordination layer, which oats.aweb-tasks teaches only when it is composed.
// This file reads the inject, every file under skills/ (the vendored aweb
// skills included: a resync from upstream would bring the task text back) and
// the readiness phrases. The briefs and warnings the hook writes are checked
// through the fixtures that produce them: spawn in oats-aweb-1-17-4, the grant
// seat in never-grant, captured-native's brief in captured-native.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describeTaskCoordination, taskCoordinationMentions } from "./helpers/task-coordination-text.mjs";

const REPO = fileURLToPath(new URL("..", import.meta.url));
const CAPABILITY = join(REPO, "oats-package", "capabilities", "oats-aweb");

function filesUnder(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? filesUnder(join(dir, entry.name)) : [join(dir, entry.name)]);
}

test("oats.aweb's inject, skills and readiness phrases never mention task coordination", () => {
  const files = [join(CAPABILITY, "injects", "aweb.md"), join(CAPABILITY, "oats.json"), join(CAPABILITY, "phrases", "en.json"), ...filesUnder(join(CAPABILITY, "skills"))];
  assert.ok(files.some((file) => file.endsWith(join("aweb-messaging", "SKILL.md"))), "the vendored skills are read");
  const found = files.flatMap((file) => describeTaskCoordination(relative(REPO, file), readFileSync(file, "utf8")));
  assert.deepEqual(found, [], `oats.aweb mentions task coordination; it belongs to oats.aweb-tasks:\n${found.join("\n")}`);
});

test("the patterns catch each banned form and spare the allowed uses", () => {
  for (const banned of [
    "load /aweb-tasks", "with `oats.aweb-tasks`", "load `aweb-coordination`", "`aw task` and `aw work`",
    "aw --identity-home <home> task list", "`aw lock` and `aw roles` stay outside OATS", "your tasks layer's",
    "your deployment's task layer", "durable task tracking", "Task state is", "STATE and task records",
    "Task coordination belongs", "broader work coordination", "regular coordination polling loops",
    "the next coordination loop", "claim a task", "claims the work", "claiming", "mail, chat, control, work, or claim",
    "For work/claim notifications",
    // Wrapped by Markdown, or split by inline code and emphasis.
    "Coordination stays in your deployment's task\nlayer.", "Use `aw\nwork ready` before starting.",
    "an event of type `work` or `claim` beside mail", "**task** state", "claim\na task", "`work`/`claim`",
  ]) assert.ok(taskCoordinationMentions(banned).length, `not caught: ${banned}`);
  for (const allowed of [
    "return to your task", "your TASK.md", "check it that way at task boundaries", "overriding your task or human",
    "unread-delivery attention claims", "oats.aweb waiting claim update failed", "wakeHold: on-claims",
    "aw workspace status", "`aw workspace connect`", "without trusting the coordination server",
    "the coordination binding", "reconcile STATE and your own records", "aw claim-human --email <e>",
    "`aw --identity-home <identityHome> mail inbox`", "If the mistaken run claimed an address",
  ]) assert.deepEqual(taskCoordinationMentions(allowed), [], `caught: ${allowed}`);
});

test("a failure names the file, the line and the matched text", () => {
  assert.deepEqual(describeTaskCoordination("injects/aweb.md", "Mail.\nTask state is your tasks layer's."), [
    'injects/aweb.md:2: the task layer: "tasks layer"',
    'injects/aweb.md:2: task tracking, state or records: "Task state"',
  ]);
  assert.deepEqual(describeTaskCoordination("SKILL.md", "Mail.\nCoordination stays in your deployment's task\nlayer."), [
    'SKILL.md:2: the task layer: "task\\nlayer"',
  ], "a wrapped match is named by the line it starts on");
});
