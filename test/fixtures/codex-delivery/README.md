# Native wake status evidence

`wake-status.json` is the complete sanitized `aw wake status --json` observation
from the passing retained-seat journey after its one controlled mail reached the
private inert tmux pane. CLI and daemon both report aw 1.36.58, commit
`a3223c1d32b8144abfd34d63b521b38d2b227ad5`. It replaces the old .40 CLI/.37
daemon sample. No newer daemon behavior is inferred from this capture.

`wake-pre-event.json` records the same target before mail: `pending` /
`not-launched`, even though `post-start-kernel.json` independently reports
`present:true` and `running:true`. This preserves the known request m readiness
false negative. The successful post-mail observation proves terminal delivery;
it does not prove model consumption or healthy quiet-start readiness.

Captured on 2026-11-19 in [CI run 44439390779](https://github.com/awebai/oats-aweb/actions/runs/44439390779), from
package branch `f978ed929d0eb0a21e55b7f8770b5b143e2eca45` and PR merge
`df85234e7ca74a01d0e16a9b6f1db2d7e3d75f78` (main `66d02dc1` plus that branch).
The disposable stack was aweb `679d50066d4160748f6f9cfa0537161992399573`;
the kernel was OATS `13f8f133808f5932bf461108703c1bada4b3f3d3`.
Both the floor and tested stack groups passed. Their artifacts were inspected
before committing; they contain public wire data, no credentials or private keys.
The sanitizer redacts credential patterns and normalizes runner paths. Disposable
public IDs, timestamps, field omissions and newly emitted fields are preserved.

Artifact: `aw-captures-1.36.58`, ID `14490417023`, `1.36.58/` subtree.
The adjacent `*.provenance.json` records retain the capture times and native
commands' names. Paths `/fixture/codex` and `/fixture/journey` were normalized
by the CI capture helper. No further fields, IDs, versions or timestamps were
changed for the tests. Their missing-target/primary/stream-list cases are explicit
local mutations, not native observations.

The launch-input history below is separate source evidence, not part of this run.

The launch-input/receipt seam was confirmed against released OATS 0.62.0,
[source 343fca2](https://github.com/awebai/oats/blob/343fca2119a1b21cba34095d1e120781ad021c88/lib/core.mjs):
spawn supplies `OATS_RUNTIME` from the selected harness (line 4569), and
`prepareLaunchHooks` supplies the target to both preview and real hooks
(line 7249). Start publication records the selected harness in recipe and
top-level fields (line 7684). Hook completion itself is prospective; a later
launch failure can leave provider metadata ahead of the published receipt.
The provider tests execute the real preparation function with fake aw; they
do not execute live hook mutations or the entire restart/backend path.
