// The setup command a refusal's fix names (C-8, C-3c step 2), read back out of the refusal's text
// so a test can check that what the text tells a deployment to run is a command setup accepts.
import assert from "node:assert/strict";

/** The setup command a refusal's fix names, with each placeholder filled, as argv after `oats aweb setup`. */
export function filledSetupCommand(text) {
  const at = text.indexOf("oats aweb setup --endorse-root");
  assert.ok(at >= 0, text);
  const words = text.slice(at).split(/[`(;,]| \(/)[0].trim().split(/\s+/);
  assert.deepEqual(words.slice(0, 3), ["oats", "aweb", "setup"]);
  const FILL = { "<alias>": "root-1", "<did:aw>": "did:aw:human1", "<abs>": "/srv/aweb/protected-profile.json", "<url>": "https://aweb.acme.example/api" };
  const left = words.filter((w) => /^<.*>$/.test(w) && !(w in FILL));
  assert.deepEqual(left, [], `placeholders no one fills: ${left}`);
  return words.slice(3).map((w) => FILL[w] ?? w);
}
