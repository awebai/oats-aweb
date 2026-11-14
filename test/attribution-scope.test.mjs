// Acceptance test 11 (spec v4.3.12): every new refusal is reachable only with
// the setting, the new setup flags, or a 403 from a protected team. Each
// recorded v1.42.1 journey (test 9) runs again on a deployment holding what
// the new refusals look for, with no settings.oats.aweb.attribution, and
// stays byte-identical: an endorsed-root directory open to others, with a
// key in it; a protected profile anyone can write; a spawner whose identity
// carries a chain outside any root.
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { compatTranscript } from "./helpers/compat-journey.mjs";

const RECORDED = JSON.parse(readFileSync(new URL("./fixtures/compat-1.42.1.json", import.meta.url), "utf8"));

function plant(fx) {
  const root = join(fx.ws, ".aweb-endorsed-root", "acme-root", ".aw");
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "signing.key"), "k\n", { mode: 0o644 });
  chmodSync(join(fx.ws, ".aweb-endorsed-root"), 0o755);
  writeFileSync(join(fx.ws, "protected-profile.json"), "{\"v\":1}\n", { mode: 0o666 });
  chmodSync(join(fx.ws, "protected-profile.json"), 0o666);
  const lead = join(fx.ws, "agents", "lead", "instances", "lead-1", ".aw");
  mkdirSync(lead, { recursive: true });
  writeFileSync(join(lead, "id-chain.json"), JSON.stringify([{ id: "did:aw:otherhuman", kind: "human" }, { id: "did:key:zlead-1", kind: "agent", parent: { kind: "identity", id: "did:aw:otherhuman" } }]));
}

for (const { journey, transcript } of RECORDED) {
  test(`acceptance 11: no setting, ${journey.delivery} delivery on ${journey.runtime}${journey.settings.join ? " with a joined team" : ""}${journey.spawner ? " with OATS_SPAWNER_HOME" : ""}, with a stray root, profile and chained spawner: still v1.42.1's`, (t) => {
    assert.deepEqual(compatTranscript(t, journey, { plant }), transcript);
  });
}
