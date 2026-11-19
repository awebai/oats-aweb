# Native probe workspace input

`native-workspace.yaml` is the decoded JSON string from the tested leg's
`workspace-record.json`: the real aw 1.36.58 workspace record after the retained
seat connected. Native commit: `a3223c1d32b8144abfd34d63b521b38d2b227ad5`.
It replaces the old 1.36.28 source-generated record; memberships, absent fields,
timestamps and the loopback `aweb_url` are preserved.

Captured on 2026-11-19 in [CI run 44439390779](https://github.com/awebai/oats-aweb/actions/runs/44439390779), from
package branch `f978ed929d0eb0a21e55b7f8770b5b143e2eca45` and PR merge
`df85234e7ca74a01d0e16a9b6f1db2d7e3d75f78` (main `66d02dc1` plus that branch).
The disposable stack was aweb `679d50066d4160748f6f9cfa0537161992399573`;
the kernel was OATS `13f8f133808f5932bf461108703c1bada4b3f3d3`.
Both the floor and tested stack groups passed. Their artifacts were inspected
before committing; they contain public wire data, no credentials or private keys.
The sanitizer redacts credential patterns and normalizes runner paths. Disposable
public IDs, timestamps, field omissions and newly emitted fields are preserved.

Artifact: `aw-captures-1.36.58`, ID `14490417023`. The adjacent provenance
is copied from `workspace-record.provenance.json`; the only additional transform
is JSON string decoding to YAML bytes. The owned home was already normalized
to `/fixture/codex` by the CI helper.

`aw-record.test.mjs` and the direct service projection read the unmodified
loopback origin. `probe-support.test.mjs` explicitly substitutes only `aweb_url`
with the qualified Cloud origin for its offline admission vectors. Those
mutations are not hosted acceptance. The mail-send help captures have their
own independent receipt in `mail-send-help-provenance.json`.
