// docs/resident-create.md shows one --json envelope per outcome. Each is the
// real command's output for that outcome (aw answers replayed from the real
// captures), with machine-specific paths and the captured namespace replaced
// by the placeholders the document uses. A change to any envelope fails here.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { CAPTURED, fixture } from "./helpers/fake-aw-resident.mjs";
import { DOMAIN, NAME, setup } from "./helpers/resident-harness.mjs";

const DOC = readFileSync(new URL("../docs/resident-create.md", import.meta.url), "utf8");
function documented(name) {
  const m = new RegExp(`<!-- envelope: ${name} -->\\n\`\`\`json\\n([\\s\\S]*?)\\n\`\`\``).exec(DOC);
  assert.ok(m, `docs/resident-create.md has no envelope ${name}`);
  return JSON.parse(m[1]);
}
/** The document's placeholders for what differs between machines and captures. */
function normalized(s, doc) {
  let text = JSON.stringify(doc);
  const swap = (from, to) => { text = text.split(from).join(to); };
  // aw's refusal of a quarantined partial names the directory it was captured in.
  swap(/at (\S+)\/\.aw\/partial-init\.yaml\./.exec(fixture("init-apikey-rejected").stderr)[1], s.root);
  swap(s.unitPath, "<unit path>");
  swap(s.deployment, "/srv/deploy");
  swap(s.home, "/home/me");
  swap(s.fake.bin, "/usr/local/bin");
  swap(CAPTURED.stableId, "did:aw:<stable id>");
  swap(DOMAIN, "acme.aweb.ai");
  const out = JSON.parse(text.replace(/init-\d{8}T\d{6}Z\./g, "init-20261010T120000Z."));
  // The unit's manager and path are the platform's: launchd on macOS, systemd on Linux.
  if (out.result?.custody?.manager) out.result.custody.manager = "<launchd or systemd>";
  if (out.result?.custody?.path) out.result.custody.path = "<unit path>";
  return out;
}
const withPartial = (s) => { mkdirSync(join(s.root, ".aw"), { recursive: true }); writeFileSync(join(s.root, ".aw", "partial-init.yaml"), ""); };
const complete = (s) => { mkdirSync(join(s.root, ".aw"), { recursive: true }); for (const f of ["identity.yaml", "signing.key", "workspace.yaml"]) writeFileSync(join(s.root, ".aw", f), ""); };

const cases = {
  created: { run: (s) => s.run(["create", NAME, "--json"]) },
  resumed: { prepare: withPartial, run: (s) => s.run(["create", NAME, "--json"]) },
  adopted: { prepare: complete, run: (s) => s.run(["create", NAME, "--json"], {}, { unset: ["AWEB_API_KEY", "AWEB_URL"] }) },
  "already-exists": { prepare: complete, run: (s) => s.run(["create", NAME, "--json"], { OATS_SETTINGS: JSON.stringify({ residents: { [NAME]: s.root } }) }, { unset: ["AWEB_API_KEY", "AWEB_URL"] }) },
  plan: { run: (s) => s.run(["create", NAME, "--plan", "--json"]) },
  "init-partial": { fake: { init: "partial-404" }, run: (s) => s.run(["create", NAME, "--json"]) },
  "init-quarantined": { fake: { init: "rejected" }, prepare: (s) => { mkdirSync(join(s.root, ".aw"), { recursive: true }); writeFileSync(join(s.root, ".aw", "partial-init.yaml.20261010T000000.000000000Z.1.rejected"), ""); }, run: (s) => s.run(["create", NAME, "--json"]) },
  "nothing-to-continue": { fake: { init: "nothing" }, run: (s) => s.run(["create", NAME, "--json"]) },
  key: { run: (s) => s.run(["create", NAME, "--json"], {}, { unset: ["AWEB_API_KEY"] }) },
  root: { prepare: (s) => { mkdirSync(s.root, { recursive: true }); writeFileSync(join(s.root, "notes.txt"), ""); }, run: (s) => s.run(["create", NAME, "--json"]) },
  "unit-conflict": {
    prepare: (s) => {
      const other = join(dirname(s.unitPath), `ai.aweb.custody.other.example.${NAME}${s.unitPath.slice(s.unitPath.lastIndexOf("."))}`);
      mkdirSync(dirname(other), { recursive: true });
      writeFileSync(other, process.platform === "darwin" ? "<plist><dict><key>WorkingDirectory</key><string>/srv/other</string></dict></plist>\n" : "[Service]\nWorkingDirectory=/srv/other\n");
      s.otherUnit = other;
    },
    run: (s) => s.run(["create", NAME, "--json"]),
    normalize: (s, doc) => JSON.parse(JSON.stringify(doc).split(s.otherUnit).join("<other unit path>")),
  },
  verify: {
    prepare: (s) => {
      const aw = join(s.fake.bin, "aw");
      writeFileSync(aw, readFileSync(aw, "utf8").replace('replay(f["doctor-identity-offline"])', `replay({ stdout: ${JSON.stringify(fixture("doctor-identity-offline-partial").stdout)}, stderr: "", exit: 0 })`));
    },
    run: (s) => s.run(["create", NAME, "--json"]),
  },
  custody: { fake: { custody: "missing-ops" }, run: (s) => s.run(["create", NAME, "--json"]) },
};

for (const [name, c] of Object.entries(cases)) {
  test(`docs/resident-create.md shows the real ${name} envelope`, (t) => {
    const s = setup(t, c.fake);
    c.prepare?.(s);
    const r = c.run(s);
    assert.ok(r.doc, r.stdout + r.stderr);
    assert.deepEqual(normalized(s, c.normalize ? c.normalize(s, r.doc) : r.doc), documented(name));
  });
}
