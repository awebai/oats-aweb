// `oats aweb health enable|status|publish|disable`, dispatched by the real
// kernel from a scratch deployment whose member carries this checkout's
// oats.aweb (helpers/scratch-deployment.mjs), with the real aw on PATH and the
// scheduler's real runner. Opt in with OATS_AWEB_HEALTH_NATIVE=1.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { versionAtLeast } from "../oats-package/capabilities/oats-aweb/lib/aw-floor.mjs";
import { createScratchDeployment } from "./helpers/scratch-deployment.mjs";

const skip = process.env.OATS_AWEB_HEALTH_NATIVE === "1" ? false : "set OATS_AWEB_HEALTH_NATIVE=1 to run against the real oats, tmux and aw";
const JOB = "oats-aweb-health";

test("health commands through the real kernel and scheduler", { skip }, async (t) => {
  const scratch = createScratchDeployment({ withAweb: true });
  t.after(() => scratch.dispose());
  const local = join(scratch.deployment, "oats-local.yaml");
  writeFileSync(local, `${readFileSync(local, "utf8")}# operator note kept\n`);
  const aweb = (...args) => {
    const r = scratch.oats(["aweb", "health", ...args, "--json"]);
    return { exit: r.status, doc: JSON.parse(r.stdout), stderr: r.stderr };
  };

  await t.test("status before enable: not publishing, which is not a failure", () => {
    const { exit, doc } = aweb("status");
    assert.equal(exit, 0, JSON.stringify(doc));
    assert.equal(doc.ok, true);
    assert.equal(doc.result.publish, false);
    assert.equal(doc.result.job, null);
  });

  await t.test("--dir naming the deployment, as one token or two, is not taken for the action", () => {
    for (const args of [["status", `--dir=${scratch.deployment}`], ["status", "--dir", scratch.deployment], ["--dir", scratch.deployment, "status"]]) {
      const r = scratch.oats(["aweb", "health", ...args, "--json"]);
      assert.equal(JSON.parse(r.stdout).ok, true, `${args.join(" ")}: ${r.stdout}${r.stderr}`);
    }
  });

  await t.test("enable records the host setting, registers the per-minute job and names the operator's timer step", () => {
    const { exit, doc } = aweb("enable", "--operator", "Scratch's operator");
    assert.equal(doc.ok, true, JSON.stringify(doc));
    const text = readFileSync(local, "utf8");
    assert.match(text, /\n {4}health:\n {6}"publish": true\n {6}"operator": "Scratch's operator"\n/);
    assert.match(text, /# operator note kept/);
    const job = scratch.json(["schedule", "show", JOB]).result.schedule;
    assert.deepEqual([job.kind, job.cron, job.cwd, job.argv], ["command", "* * * * *", scratch.deployment, ["oats", "aweb", "health", "publish"]]);
    assert.equal(doc.result.ready, false);
    assert.match(doc.result.problems.join("\n"), /the host timer is not installed: run `oats schedule host install` \(an operator step\)/);
    assert.match(doc.result.note, /a newly started or restarted agent appears within a minute/);
    assert.equal(exit, 1);
  });

  await t.test("enable again changes nothing and still registers one job", () => {
    const before = readFileSync(local, "utf8");
    aweb("enable", "--operator", "Scratch's operator");
    assert.equal(readFileSync(local, "utf8"), before);
    assert.equal(scratch.json(["schedule", "list"]).result.schedules.filter((j) => j.id === JOB).length, 1);
  });

  await t.test("enable and status state the required aw, Claude channel and pi extension, in text and in JSON", () => {
    const required = "required: aw 1.36.38 to publish; Claude channel 1.7.17 or pi extension 0.3.15 to prove receive";
    for (const action of ["enable", "status"]) {
      const r = scratch.oats(["aweb", "health", action]);
      assert.ok(r.stdout.split("\n").includes(required), `${action}:\n${r.stdout}`);
      assert.deepEqual(aweb(action).doc.result.floors, { aw: "1.36.38", claudeChannel: "1.7.17", piExtension: "0.3.15" });
    }
  });

  await t.test("publish with an aw below the floor fails before sending, in words the scheduler does not hold", () => {
    const { exit, doc } = aweb("publish");
    const version = spawnSync("aw", ["version"], { env: scratch.env, encoding: "utf8" }).stdout.match(/aw (\d+\.\d+\.\d+)/)?.[1];
    if (versionAtLeast(version, "1.36.38")) { assert.equal(doc.ok, true, "an aw at the floor publishes"); return; }
    assert.equal(exit, 1);
    assert.equal(doc.error.code, "E_HEALTH_AW");
    assert.match(doc.error.message, /^aw \d+\.\d+\.\d+ has no status publish; needs aw >= 1\.36\.38/);
    assert.doesNotMatch(doc.error.message, /INCOMPLETE|quarantin|retain|could not (?:be )?(?:verif|confirm)/i);
  });

  await t.test("the scheduler's own runner runs the job and records a plain outcome, never an unconfirmed one", () => {
    const run = scratch.json(["schedule", "run", JOB]);
    assert.equal(run.ok, true, JSON.stringify(run));
    const last = scratch.json(["schedule", "show", JOB]).result.schedule.lastRun;
    assert.ok(last, "the run is recorded");
    assert.notEqual(last.errorCode, "E_UNKNOWN_COMMAND", JSON.stringify(last));
    assert.doesNotMatch(JSON.stringify(last), /"outcome":"unknown"|unconfirmed/);
  });

  await t.test("disable removes the job and turns publishing off, keeping the operator's words", () => {
    const { exit, doc } = aweb("disable");
    assert.equal(exit, 0, JSON.stringify(doc));
    assert.equal(scratch.json(["schedule", "show", JOB]).ok, false);
    const text = readFileSync(local, "utf8");
    assert.match(text, /"publish": false/);
    assert.match(text, /"operator": "Scratch's operator"/);
    assert.equal(aweb("status").doc.result.publish, false);
  });
});
