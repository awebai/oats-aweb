import assert from "node:assert/strict";
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

function runFixture(t, capabilityDirs) {
  const fixture = mkdtempSync(join(tmpdir(), "oats-manifest-negative-"));
  t.after(() => rmSync(fixture, { recursive: true, force: true }));
  mkdirSync(join(fixture, "scripts"), { recursive: true });
  mkdirSync(join(fixture, "schemas"), { recursive: true });
  mkdirSync(join(fixture, "oats-package"), { recursive: true });
  copyFileSync(join(ROOT, "scripts", "validate-manifests.mjs"), join(fixture, "scripts", "validate-manifests.mjs"));
  copyFileSync(join(ROOT, "schemas", "oats-package.schema.json"), join(fixture, "schemas", "oats-package.schema.json"));
  copyFileSync(join(ROOT, "schemas", "capability-manifest.schema.json"), join(fixture, "schemas", "capability-manifest.schema.json"));

  const packageManifest = {
    package: "test.package",
    version: "1.0.0",
    description: "Negative manifest-validation fixture.",
    compatibility: { oats: ">=0.6.2" },
    ...(capabilityDirs === undefined ? {} : { capabilities: capabilityDirs }),
  };
  writeFileSync(join(fixture, "oats-package", "oats-package.json"), JSON.stringify(packageManifest, null, 2) + "\n");

  for (const [index, capabilityDir] of (capabilityDirs || []).entries()) {
    const path = join(fixture, "oats-package", capabilityDir, "oats.json");
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({
      capability: `test.capability-${index + 1}`,
      version: "1.0.0",
      compatibility: { oats: ">=0.6.2" },
      description: "Negative manifest-validation fixture capability.",
      requires: [],
    }, null, 2) + "\n");
  }

  return spawnSync(process.execPath, [join(fixture, "scripts", "validate-manifests.mjs")], {
    cwd: fixture,
    encoding: "utf8",
  });
}

function bindingFixture(t) {
  const dir=mkdtempSync(join(tmpdir(),'aweb-binding-manifest-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  mkdirSync(join(dir,'scripts'));mkdirSync(join(dir,'schemas'));
  copyFileSync(join(ROOT,'scripts/validate-manifests.mjs'),join(dir,'scripts/validate-manifests.mjs'));
  for(const name of ['oats-package','capability-manifest'])copyFileSync(join(ROOT,`schemas/${name}.schema.json`),join(dir,`schemas/${name}.schema.json`));
  cpSync(join(ROOT,'oats-package'),join(dir,'oats-package'),{recursive:true});
  const path=join(dir,'oats-package/capabilities/oats-aweb/oats.json'),manifest=JSON.parse(readFileSync(path));
  return {manifest,run(){writeFileSync(path,JSON.stringify(manifest));return spawnSync(process.execPath,[join(dir,'scripts/validate-manifests.mjs')],{cwd:dir,encoding:'utf8',timeout:10000});}};
}

test('binding metadata accepts the declared fixed reasons, optional omission and shape-only key declarations',t=>{
  const f=bindingFixture(t);assert.equal(f.run().status,0);
  delete f.manifest.binding.reasons;delete f.manifest.binding.keys;assert.equal(f.run().status,0);
  f.manifest.binding.reasons=['x'.repeat(200)];f.manifest.binding.keys=['stores.','privateTeam'];assert.equal(f.run().status,0);
  f.manifest.binding.reasons=Array.from({length:64},(_,i)=>`fixed reason ${i}`);f.manifest.binding.keys=[];assert.equal(f.run().status,0);
});

test('binding metadata rejects invalid reason bounds, controls, interpolation and key shapes',t=>{
  const f=bindingFixture(t),valid=structuredClone(f.manifest.binding);
  for(const reasons of [null,{},[],[7],[''],['same','same'],['x'.repeat(201)],Array.from({length:65},(_,i)=>`fixed reason ${i}`),['reason'+String.fromCharCode(10)+'line'],['reason'+String.fromCharCode(9)+'value'],['non-ASCII-é'],['setting ${suppliedValue}']]){
    f.manifest.binding={...valid,reasons};const r=f.run();assert.equal(r.status,1,r.stderr);assert.match(r.stderr,/binding\.reasons/);
  }
  for(const keys of [null,[7],[''],['wider','wider'],['privateTeam*'],['/private/value'],['wider'+String.fromCharCode(10)]]){
    f.manifest.binding={...valid,keys};const r=f.run();assert.equal(r.status,1,r.stderr);assert.match(r.stderr,/binding\.keys/);
  }
});

test("validator rejects a missing capability enumeration", (t) => {
  const result = runFixture(t, undefined);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /must enumerate exactly one capability directory \(found 0\)/);
});

test("validator rejects extra capability enumerations", (t) => {
  const result = runFixture(t, ["capability-one", "capability-two"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /must enumerate exactly one capability directory \(found 2\)/);
});
