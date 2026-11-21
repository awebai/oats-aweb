// oats.aweb 1.27.0: the kernel confirms Claude's development-channel prompt at
// launch (oats#886), so the provider states that decision instead of a consent
// recipe, and readiness is quiet once the kernel recorded a completed start.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const REPO = resolve(fileURLToPath(new URL("..", import.meta.url)));
const CAPABILITY = join(REPO, "oats-package", "capabilities", "oats-aweb");
const manifest = JSON.parse(readFileSync(join(CAPABILITY, "oats.json"), "utf8"));

test("the kernel floor admits stopped-home upgrades", () => {
  const distribution = JSON.parse(readFileSync(join(REPO, "oats-package", "oats-package.json"), "utf8"));
  assert.equal(manifest.compatibility.oats, ">=0.70.0");
  assert.equal(distribution.compatibility.oats, ">=0.70.0");
});
