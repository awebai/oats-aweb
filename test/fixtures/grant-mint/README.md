# Native mint serializer fixtures

The four JSON files are byte-for-byte copies of
`cli/go/cmd/aw/testdata/grant-mint/{empty,catalog,legacy,skipped}.json`
at awebai/aweb source `873ed2bf5cdad65a20577fcd726f167eb9f5ebb4`,
annotated `aw-v1.36.26` tag object
`fb0a2c3ad453ca56e82230dc3620554e810ccf40`.
They are synthetic native serializer examples, not usable grants or live app
acceptance. The native `legacy` example still contains inventory arrays;
provider tests separately cover older receipts where both fields are absent.
Do not copy the receipt's out/custody locators into provider inventory metadata
or display. Package publication/binary receipts are separate evidence.
