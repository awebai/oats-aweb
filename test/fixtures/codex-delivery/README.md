# Read-only native wake status evidence

`aw-1.36.40-daemon-1.36.37.json` is one external-session target extracted
from a real `aw wake status --json` read at 2026-10-17T06:09:33Z. CLI: aw 1.36.40,
commit `0c7b167cace6cf0c2347eff624bc3a87b8117dcf`, built
`2026-10-16T07:13:56Z`. The running daemon reports 1.36.37. Absolute homes
team identifiers, native bundle path, trace message and owner identifiers are replaced; other rows are omitted. Wire fields,
omissions, phases, booleans, worker observations and timestamps are preserved.
No actual aliases, team IDs or deployment homes are included.

`aw wake register --help` on this binary admits `--home`, `--identity-home`,
`--delivery session`, optional `--backend`, and `--registration-json -` for
multi-identity registration. Its help says native and broker presentation on
one primary would double wakes. Released source for this CLI is
[awebai/aw at 0c7b167](https://github.com/awebai/aw/tree/0c7b167cace6cf0c2347eff624bc3a87b8117dcf).
These read-only observations establish CLI admission/schema and observed
stream evidence, not acceptance of a new provider registration or delivery.
No register, deregister, service restart or deployment edit was executed.
There is no captured aw 1.36.40 daemon sample; local fake regression tests
are separate evidence and do not fill that gap.

The launch-input/receipt seam was confirmed against released OATS 0.62.0,
[source 343fca2](https://github.com/awebai/oats/blob/343fca2119a1b21cba34095d1e120781ad021c88/lib/core.mjs):
spawn supplies `OATS_RUNTIME` from the selected harness (line 4569), and
`prepareLaunchHooks` supplies the target to both preview and real hooks
(line 7249). Start publication records the selected harness in recipe and
top-level fields (line 7684). Hook completion itself is prospective; a later
launch failure can leave provider metadata ahead of the published receipt.
The provider tests execute the real preparation function with fake aw; they
do not execute live hook mutations or the entire restart/backend path.
