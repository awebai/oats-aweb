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

// aweb's team instructions, roles and pi's welcome point agents to a skill for
// the session loop that an OATS home may not have, so oats.aweb teaches the
// whole messaging loop itself, mail and chat only.
test("the inject and the oats-aweb skill teach the whole messaging loop and defer skill names in team text to OATS", () => {
  const inject = readFileSync(join(CAPABILITY, "injects", "aweb.md"), "utf8").replace(/\s+/g, " ");
  const skill = readFileSync(join(CAPABILITY, "skills", "oats-aweb", "SKILL.md"), "utf8").replace(/\s+/g, " ");
  const loop = skill.split("**The messaging loop** (when woken).")[1]?.split("**Never sleep, poll or busy-wait")[0];
  assert.ok(loop, "section 4 holds the messaging loop");
  assert.match(inject, /\*\*Your messaging loop\*\*.*`\/oats-aweb` section 4, "The messaging loop"/);
  for (const [name, text] of [["inject", inject], ["oats-aweb section 4", loop]]) {
    assert.match(text, /run `aw mail inbox` and `aw chat pending`/, `${name}: read what is waiting`);
    assert.match(text, /`aw mail reply/, `${name}: reply in thread`);
    assert.match(text, /`aw chat send-and-leave`.*`aw chat extend-wait`/, `${name}: answer or extend a waiting chat`);
    assert.match(text, /(?:Return|Go back) to (?:your task|the task you were on)/, `${name}: back to the task`);
    assert.match(text, /\(`aw instructions`, (?:a role description|role descriptions)|Team instructions \(`aw instructions`\), role descriptions/, `${name}: names team and role text`);
    assert.match(text, /may not be installed in this home: follow (?:the|this loop and the other) skills OATS composed here instead/, `${name}: defers to OATS's skills`);
  }
});
