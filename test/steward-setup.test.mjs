// `oats aweb setup --steward` (acmj.21): the human binds this deployment by
// issuing its steward through aw; the provider records only where it is.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { parseStewardArgs, setupSteward } from "../oats-package/capabilities/oats-aweb/lib/steward.mjs";

const HUMAN = "did:aw:human1";
const STEWARD = "did:aw:steward1";
const ARGS = ["--steward", "--human", HUMAN, "--label", "Juan", "--domain", "awtest-demo.example", "--name", "awtest-steward"];

function deployment(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "oats-steward-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, "oats-workspace.yaml"), "schemaVersion: 2\n");
  return dir;
}

/** aw as the steward setup sees it: --help lists --human-parent, `id create`
 *  writes a key into the steward home, and `who` answers with `chain`. */
function fakeAw({ who = { id: STEWARD, outcome: "nearest_human", human_id: HUMAN, identity_valid: true, reason: "verified" }, createStatus = 0, help = "--human-parent string" } = {}) {
  const calls = [];
  return {
    calls,
    runCaptured: (argv, cwd) => {
      calls.push({ argv, cwd });
      if (argv.join(" ") === "aw id create --help") return help;
      if (argv.join(" ") === "aw who --json") return JSON.stringify(who);
      throw new Error(`unexpected ${argv.join(" ")}`);
    },
    runInteractive: (argv, cwd) => {
      calls.push({ argv, cwd, interactive: true });
      if (createStatus === 0) { mkdirSync(join(cwd, ".aw"), { recursive: true }); writeFileSync(join(cwd, ".aw", "signing.key"), "k"); }
      return createStatus;
    },
  };
}
const kernel = (features = ["spawn-attribution"]) => () => ({ version: "0.80.0", features });
const env = (dir, settings = {}) => ({ OATS_WORKSPACE: dir, OATS_SETTINGS: JSON.stringify(settings) });

test("arguments: did:aw human, one-line label, domain and alias are required", () => {
  assert.deepEqual(parseStewardArgs(ARGS), { human: HUMAN, label: "Juan", domain: "awtest-demo.example", name: "awtest-steward" });
  assert.throws(() => parseStewardArgs(ARGS.map((a) => (a === HUMAN ? "did:key:z6Mk" : a))), /--human must be the human's did:aw/);
  assert.throws(() => parseStewardArgs(ARGS.map((a) => (a === "Juan" ? "Ju\nan" : a))), /one line/);
  assert.throws(() => parseStewardArgs(ARGS.map((a) => (a === "awtest-demo.example" ? "Not A Domain" : a))), /--domain must be/);
  assert.throws(() => parseStewardArgs([...ARGS, "--bogus"]), /unknown argument "--bogus"/);
  assert.deepEqual(parseStewardArgs([...ARGS, "--soul", "dev", "--json"]), parseStewardArgs(ARGS), "the forwarded soul is not the steward's");
});

test("binds: aw creates the steward at the terminal, its chain verifies to the human, and the mode switches last", async (t) => {
  const dir = deployment(t);
  const aw = fakeAw();
  const result = await setupSteward(parseStewardArgs(ARGS), { env: env(dir), kernelVersion: kernel(), ...aw });
  const home = join(dir, ".aweb-stewards", "awtest-steward");
  assert.deepEqual(result, { human: { id: HUMAN, label: "Juan" }, steward: { id: STEWARD, home }, attribution: "human", created: true });
  const create = aw.calls.find((c) => c.interactive);
  assert.deepEqual(create.argv, ["aw", "id", "create", "--human-parent", HUMAN, "--domain", "awtest-demo.example", "--name", "awtest-steward"]);
  assert.equal(create.cwd, home);
  const yaml = readFileSync(join(dir, "oats-local.yaml"), "utf8");
  assert.equal(yaml, `schemaVersion: 2\nworkspace: local\nsettings:\n  oats.aweb:\n    steward:\n      "id": "${STEWARD}"\n      "home": "${home}"\n    human:\n      "id": "${HUMAN}"\n      "label": "Juan"\n    attribution: "human"\n`);
});

test("a rerun for the same human verifies and creates nothing", async (t) => {
  const dir = deployment(t);
  await setupSteward(parseStewardArgs(ARGS), { env: env(dir), kernelVersion: kernel(), ...fakeAw() });
  const home = join(dir, ".aweb-stewards", "awtest-steward");
  const aw = fakeAw();
  const result = await setupSteward(parseStewardArgs(ARGS), { env: env(dir, { human: { id: HUMAN, label: "Juan" }, steward: { id: STEWARD, home } }), kernelVersion: kernel(), ...aw });
  assert.equal(result.created, false);
  assert.equal(aw.calls.some((c) => c.interactive), false);
});

test("refuses a second human: one bound human per deployment", async (t) => {
  const dir = deployment(t);
  const aw = fakeAw();
  await assert.rejects(setupSteward(parseStewardArgs(ARGS), { env: env(dir, { human: { id: "did:aw:other", label: "Ana" } }), kernelVersion: kernel(), ...aw }), { code: "E_STEWARD_ONE_HUMAN", message: /Ana \(did:aw:other\) is already bound to this deployment, and this release binds one human per deployment/ });
  assert.equal(aw.calls.length, 0);
});

test("refuses inside an instance: an agent never binds a human", async (t) => {
  const dir = deployment(t);
  await assert.rejects(setupSteward(parseStewardArgs(ARGS), { env: { ...env(dir), OATS_INSTANCE_HOME: "/h" }, kernelVersion: kernel(), ...fakeAw() }), { code: "E_STEWARD_INSIDE_HOME" });
});

test("refuses before any effect on a kernel without spawn-attribution, naming the upgrade", async (t) => {
  const dir = deployment(t);
  const aw = fakeAw();
  await assert.rejects(setupSteward(parseStewardArgs(ARGS), { env: env(dir), kernelVersion: kernel([]), ...aw }), { code: "E_STEWARD_KERNEL", message: /upgrade OATS/ });
  assert.equal(aw.calls.length, 0);
});

test("refuses on an aw without --human-parent, naming the upgrade", async (t) => {
  const dir = deployment(t);
  await assert.rejects(setupSteward(parseStewardArgs(ARGS), { env: env(dir), kernelVersion: kernel(), ...fakeAw({ help: "--domain string" }) }), { code: "E_STEWARD_AW", message: /upgrade aw/ });
});

test("records nothing when aw fails or the chain does not verify to the human", async (t) => {
  const failedCreate = deployment(t);
  await assert.rejects(setupSteward(parseStewardArgs(ARGS), { env: env(failedCreate), kernelVersion: kernel(), ...fakeAw({ createStatus: 1 }) }), { code: "E_STEWARD_CREATE", message: /nothing was recorded/ });
  const wrongHuman = deployment(t);
  await assert.rejects(setupSteward(parseStewardArgs(ARGS), { env: env(wrongHuman), kernelVersion: kernel(), ...fakeAw({ who: { id: STEWARD, outcome: "nearest_human", human_id: "did:aw:other", identity_valid: true } }) }), { code: "E_STEWARD_VERIFY", message: /does not verify to did:aw:human1/ });
  for (const dir of [failedCreate, wrongHuman]) assert.throws(() => readFileSync(join(dir, "oats-local.yaml")), /ENOENT/);
});
