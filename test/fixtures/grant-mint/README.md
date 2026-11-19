# Native mint serializer fixtures

The four JSON files `empty`, `catalog`, `legacy` and `skipped` are byte-for-byte copies of
`cli/go/cmd/aw/testdata/grant-mint/{empty,catalog,legacy,skipped}.json`
at awebai/aweb source `873ed2bf5cdad65a20577fcd726f167eb9f5ebb4`,
annotated `aw-v1.36.26` tag object
`fb0a2c3ad453ca56e82230dc3620554e810ccf40`.
They are synthetic native serializer examples, not usable grants or live app
acceptance. The native `legacy` example still contains inventory arrays;
provider tests separately cover older receipts where both fields are absent.
Do not copy the receipt's out/custody locators into provider inventory metadata
or display. Package publication/binary receipts are separate evidence.

## Current real mint receipt

`native.json` is a real `aw id grant mint` receipt from the tested leg, aw
1.36.58 (`a3223c1d32b8144abfd34d63b521b38d2b227ad5`). Its empty app inventories
are what this disposable OSS stack returned, not installed-app acceptance.
`native.provenance.json` preserves the capture receipt; only the CI helper's
owned path normalization was applied. The synthetic catalog/legacy/skipped
vectors above remain to exercise their independent inventory cases.

Captured on 2026-11-19 in [CI run 44439390779](https://github.com/awebai/oats-aweb/actions/runs/44439390779), from
package branch `f978ed929d0eb0a21e55b7f8770b5b143e2eca45` and PR merge
`df85234e7ca74a01d0e16a9b6f1db2d7e3d75f78` (main `66d02dc1` plus that branch).
The disposable stack was aweb `679d50066d4160748f6f9cfa0537161992399573`;
the kernel was OATS `13f8f133808f5932bf461108703c1bada4b3f3d3`.
Both the floor and tested stack groups passed. Their artifacts were inspected
before committing; they contain public wire data, no credentials or private keys.
The sanitizer redacts credential patterns and normalizes runner paths. Disposable
public IDs, timestamps, field omissions and newly emitted fields are preserved.

Artifact: `aw-captures-1.36.58`, ID `14490417023`, `grant-mint.json`.
