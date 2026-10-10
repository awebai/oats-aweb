import test from "node:test";
import assert from "node:assert/strict";
import { durationNanoseconds, resolveGrantTTL } from "../oats-package/capabilities/oats-aweb/lib/grant-duration.mjs";

test("Go duration syntax and component nanosecond truncation at grant limits", () => {
  for (const ttl of ["720h", "720h0.1ns", "719h59m60s", "43200m", "+720h", "720.h",
    "2592000s", "2592000000ms", "2592000000000us", "2592000000000µs",
    "2592000000000μs", "2592000000000000ns", "60s", "1m", ".016666666666667h"]) {
    assert.equal(resolveGrantTTL(ttl), ttl);
  }
  for (const omitted of [undefined, null, ""]) assert.equal(resolveGrantTTL(omitted), "never");
  assert.equal(durationNanoseconds("1.5h2m3.000000001s"), 5523000000001n);
  assert.equal(durationNanoseconds("0.6ns0.6ns"), 0n);
  assert.equal(durationNanoseconds("-0"), 0n);
  for (const ttl of ["720h1ns", "43200m1ns", "720.000000000001h", "2592000.000000001s",
    "720h+1s", "720h 1s", "720H", "30d", "1e3s", ".s", ".", "60", "0", "-60s",
    "59.999999999s", "9223372036854775808ns", "9999999999999999999999999h", [], {}]) {
    assert.throws(() => resolveGrantTTL(ttl), /E_GRANT_TTL.*maximum 720h/);
  }
});
