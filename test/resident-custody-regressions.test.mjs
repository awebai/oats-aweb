// Both platforms use temporary homes and fake service managers exclusively.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { createResident } from "../oats-package/capabilities/oats-aweb/lib/resident.mjs";
import { renderUnit, unitPath } from "../oats-package/capabilities/oats-aweb/lib/custody-unit.mjs";
import { CAPTURED } from "./helpers/fake-aw-resident.mjs";
import { LABEL, NAME, initCalls, setup } from "./helpers/resident-harness.mjs";

function snapshot(dir) {
  if (!existsSync(dir)) return null;
  return Object.fromEntries(readdirSync(dir, { withFileTypes: true }).map((e) => [e.name,
    e.isDirectory() ? snapshot(join(dir, e.name)) : readFileSync(join(dir, e.name), "utf8")]));
}
const create = (s, platform, { plan = false, env = {} } = {}) => createResident({ name: NAME, plan }, {
  env: { ...s.env, ...env }, platform,
});
function complete(s) {
  mkdirSync(join(s.root, ".aw"), { recursive: true });
  for (const f of ["identity.yaml", "signing.key", "workspace.yaml"]) writeFileSync(join(s.root, ".aw", f), "fixture");
}
function otherUnit(s, platform, root = s.root) {
  const label = `ai.aweb.custody.legacy.example.${NAME}`;
  const path = unitPath({ platform, home: s.home }, label);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, renderUnit({ platform, label, aw: "/fixture/bin/aw", root, path: "/fixture/bin", home: s.home, address: CAPTURED.address }));
  return { label, path };
}
function remedy(message, unit, platform) {
  assert.ok(message.includes(unit.label), message);
  assert.ok(message.includes(unit.path), message);
  if (platform === "darwin") {
    assert.ok(message.includes(`launchctl bootout gui/${process.getuid()}/${unit.label}`), message);
    assert.ok(message.includes(`move ${unit.path} out of ~/Library/LaunchAgents`), message);
  } else {
    assert.ok(message.includes(`systemctl --user disable --now ${unit.label}.service`), message);
    assert.ok(message.includes(`remove the unit file ${unit.path}`), message);
  }
  assert.doesNotMatch(message, /aw custody stop/);
}
for (const platform of ["darwin", "linux"]) {
  for (const state of ["empty", "partial", "complete", "symlink"]) {
    test(`${platform}: unloaded foreign same-root unit (${state}) refuses run and plan without writes`, async (t) => {
      const s = setup(t);
      if (state === "complete" || state === "symlink") complete(s);
      if (state === "partial") {
        mkdirSync(join(s.root, ".aw"), { recursive: true });
        writeFileSync(join(s.root, ".aw", "partial-init.yaml"), "fixture");
      }
      let served = s.root;
      if (state === "symlink") {
        served = join(s.base, "root-link"); symlinkSync(s.root, served);
      }
      const unit = otherUnit(s, platform, served);
      const before = [snapshot(s.home), snapshot(s.deployment)];
      for (const plan of [false, true]) {
        await assert.rejects(create(s, platform, { plan }), (e) => {
          assert.equal(e.code, "E_RESIDENT_UNIT_CONFLICT"); assert.equal(e.stage, "preflight");
          remedy(e.message, unit, platform); return true;
        });
      }
      assert.deepEqual([snapshot(s.home), snapshot(s.deployment)], before);
      assert.equal(initCalls(s.fake).length, 0);
      assert.ok(!s.fake.calls().some((c) => ["launchctl", "systemctl"].includes(c.cmd)));
    });
  }
  test(`${platform}: running foreign custody names its recognised supervisor without writes`, async (t) => {
    const s = setup(t, { custody: "elsewhere" }); complete(s);
    const unit = otherUnit(s, platform);
    const before = [snapshot(s.home), snapshot(s.deployment)];
    for (const plan of [false, true]) {
      await assert.rejects(create(s, platform, { plan }), (e) => {
        assert.equal(e.code, "E_RESIDENT_CUSTODY_RUNNING"); assert.equal(e.stage, "preflight");
        remedy(e.message, unit, platform); return true;
      });
    }
    assert.deepEqual([snapshot(s.home), snapshot(s.deployment)], before);
    assert.equal(initCalls(s.fake).length, 0);
    assert.ok(!s.fake.calls().some((c) => ["launchctl", "systemctl"].includes(c.cmd)));
  });
  test(`${platform}: our running unit does not excuse a second same-root label`, async (t) => {
    const s = setup(t);
    await create(s, platform);
    const foreign = otherUnit(s, platform);
    const before = [snapshot(s.home), snapshot(s.deployment)];
    await assert.rejects(create(s, platform), (e) => {
      assert.equal(e.code, "E_RESIDENT_UNIT_CONFLICT");
      remedy(e.message, foreign, platform); return true;
    });
    assert.deepEqual([snapshot(s.home), snapshot(s.deployment)], before);
    assert.equal(initCalls(s.fake).length, 1);
  });
  test(`${platform}: arbitrary service names stay outside discovery and the running remedy says so`, async (t) => {
    const s = setup(t, { custody: "elsewhere" }); complete(s);
    const label = "custom-custody";
    const path = unitPath({ platform, home: s.home }, label);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, renderUnit({ platform, label, aw: "/fixture/bin/aw", root: s.root, path: "/fixture/bin", home: s.home, address: CAPTURED.address }));
    const before = [snapshot(s.home), snapshot(s.deployment)];
    await assert.rejects(create(s, platform), (e) => {
      assert.equal(e.code, "E_RESIDENT_CUSTODY_RUNNING");
      assert.match(e.message, /no recognised unit was found/);
      assert.match(e.message, /find and stop any supervisor outside the recognised units/);
      assert.ok(e.message.includes(`aw custody stop\` in ${s.root} (or stop whatever supervises it)`));
      assert.ok(!e.message.includes(label)); return true;
    });
    assert.deepEqual([snapshot(s.home), snapshot(s.deployment)], before);
  });
  for (const stage of ["preflight", "custody"]) {
    test(`${platform}: ${stage} keeps our non-serving unit out of the supervisor remedy`, async (t) => {
      const s = setup(t, { custody: stage === "preflight" ? "crashloop" : "takeover" });
      complete(s);
      const path = unitPath({ platform, home: s.home }, LABEL);
      if (stage === "preflight") {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, renderUnit({ platform, label: LABEL, aw: "/fixture/bin/aw", root: s.root, path: "/fixture/bin", home: s.home, address: CAPTURED.address }));
        writeFileSync(join(s.base, "unit-loaded"), "");
      }
      const before = stage === "preflight" ? [snapshot(s.home), snapshot(s.deployment)] : undefined;
      await assert.rejects(create(s, platform), (e) => {
        assert.equal(e.code, "E_RESIDENT_CUSTODY_RUNNING"); assert.equal(e.stage, stage);
        assert.equal(e.message, `custody for ${NAME} is already running in ${s.root}, and this command's unit ${LABEL} is not what serves it (its process is not running): no other recognised unit was found; find and stop any supervisor outside the recognised units: run \`aw custody stop\` in ${s.root} (or stop whatever supervises it), then rerun; a unit started beside it would restart in a loop against it`);
        assert.doesNotMatch(e.message, /bootout|disable --now|move .*LaunchAgents|remove the unit/);
        return true;
      });
      assert.ok(existsSync(path), "our unit remains in place");
      assert.equal(initCalls(s.fake).length, 0);
      if (before) assert.deepEqual([snapshot(s.home), snapshot(s.deployment)], before);
    });
  }
  test(`${platform}: resident create rewrites the existing unit with the kernel-selected node directory`, async (t) => {
    const s = setup(t);
    const oldBin = join(s.base, "Cellar", "node", "old", "bin");
    const newBin = join(s.base, "opt", "node", "bin");
    const oldNode = join(oldBin, "node"), newNode = join(newBin, "node");
    const first = await create(s, platform, { env: { OATS_NODE_BIN: oldNode } });
    const path = first.custody.path;
    assert.ok(readFileSync(path, "utf8").includes(oldBin));
    const calls = s.fake.calls().length, yaml = s.localYaml();
    const again = await create(s, platform, { env: { OATS_NODE_BIN: newNode, AWEB_API_KEY: undefined, AWEB_URL: undefined, OATS_SETTINGS: JSON.stringify({ residents: { [NAME]: s.root } }) } });
    assert.equal(again.outcome, "already-exists"); assert.equal(again.custody.path, path);
    const text = readFileSync(path, "utf8");
    assert.ok(text.includes(newBin)); assert.ok(!text.includes(oldBin));
    assert.ok(text.includes(join(s.fake.bin, "aw")), "keeps the selected absolute aw path");
    assert.equal(initCalls(s.fake).length, 1); assert.equal(s.localYaml(), yaml);
    const managerCalls = s.fake.calls().slice(calls).filter((c) => ["launchctl", "systemctl"].includes(c.cmd)).map((c) => c.argv.join(" "));
    if (platform === "darwin") {
      assert.ok(managerCalls.includes(`bootout gui/${process.getuid()}/${LABEL}`));
      assert.ok(managerCalls.includes(`bootstrap gui/${process.getuid()} ${path}`));
    } else {
      assert.ok(managerCalls.includes("--user daemon-reload"));
      assert.ok(managerCalls.includes(`--user restart ${LABEL}.service`));
    }
  });
}
