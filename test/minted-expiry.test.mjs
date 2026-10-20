import test from "node:test";
import assert from "node:assert/strict";
import { mintedExpiryProblem } from "../oats-package/capabilities/oats-aweb/lib/grant-expiry.mjs";

for (const [ttl, expiresAt] of [["never", "never"], ["never", "2026-10-27T12:00:00Z"], ["24h", "2026-10-21T12:00:00+02:00"]]) {
  test(`mint receipt accepts ${ttl} → ${expiresAt}`, () => {
    assert.equal(mintedExpiryProblem(expiresAt, ttl), undefined);
  });
}
for (const ttl of ["never", "24h"]) {
  for (const expiresAt of ["garbage", "", "2026-02-30T00:00:00Z", "2026-10-21", undefined, null, 42]) {
    test(`mint receipt refuses ${ttl} → ${JSON.stringify(expiresAt)}`, () => {
      assert.match(mintedExpiryProblem(expiresAt, ttl), /aw id grant mint returned expires_at/);
    });
  }
}
test("a duration request refuses a never-expiring receipt", () => {
  assert.match(mintedExpiryProblem("never", "24h"), /expires_at.*24h grant/);
});
