# Probe source qualification

This receipt covers source and isolated fixtures, not installed binaries,
Cloud deployment, live mail or disposable-pair acceptance.

## Pins and admission authority

The [maintainer declaration](https://github.com/awebai/oats-aweb/issues/57#issuecomment-6077900224)
sets probe-only CLI 1.36.28 and server 1.27.12. The general aw floor remains
1.36.13. The qualified hosted origin is `https://app.aweb.ai`; its current
version must be observed at execution.

| Artifact | Annotated tag object | Peeled source |
| --- | --- | --- |
| public aw v1.36.28 | cc5d101e5317cf77675dddfeff13344fa1adf1f2 | f639b06d45092181a3aa705f959b2d77cb073277 |
| aweb aw-v1.36.28 | 0cdf7dedd41223dc94396dddea3779d18034005c | 67849f400bcfa2cde339dc8a18e505afb49a6dc5 |
| aweb server-v1.27.12 | cb1f324b76068b39e75068af36f21817cc2e85ce | a6ca92ad458c8366f563a676499989bd281ac74d |

npm `@awebai/aw@1.36.28` reports the public aw source as gitHead.
The pinned server's
[messages route](https://github.com/awebai/aweb/blob/a6ca92ad458c8366f563a676499989bd281ac74d/server/src/aweb/routes/messages.py#L1312)
requires fresh IDs/recipient, refuses existing conversations and bypasses
ordinary reuse when `new_conversation` is true. This release-source fact does
not establish what any selected deployment currently runs.

## Exact service and executable

[awconfig/selection.go](https://github.com/awebai/aw/blob/f639b06d45092181a3aa705f959b2d77cb073277/awconfig/selection.go)
`ResolveWorkspace` selects the explicit external identity home's workspace;
`AWEB_URL` overrides it when environment overrides are allowed. Missing
workspace state does not supply a default service.
[team_state.go](https://github.com/awebai/aw/blob/f639b06d45092181a3aa705f959b2d77cb073277/awconfig/team_state.go#L292)
reads that home's exact workspace and teams files. The workspace URL, not a
membership URL, feeds mail selection.
[workspace.go](https://github.com/awebai/aw/blob/f639b06d45092181a3aa705f959b2d77cb073277/awconfig/workspace.go#L365)
defines the native schema and `MarshalYAML` serialization.

[cmd/aw/helpers.go](https://github.com/awebai/aw/blob/f639b06d45092181a3aa705f959b2d77cb073277/cmd/aw/helpers.go)
passes explicit home/team in `resolveSelectionAtIdentityHome` and otherwise
cleans the workspace URL in `resolveAuthenticatedBaseURL`. Explicit `--team`
disables other-team alias search. Service-path fallback tries the same origin's
`/api` or root path; transport failures on writes are not replayed. Concrete
404 recovery can retry a corrected path and persist its URL. The provider
checks for config drift before its next native command; no private endpoint
or URL override suppresses native behavior.

[root.go](https://github.com/awebai/aw/blob/f639b06d45092181a3aa705f959b2d77cb073277/cmd/aw/root.go#L72)
loads `.env.aweb` for ordinary commands, so probe children use a neutral owned
cwd and remove ambient AW/AWEB selectors. `version` bypasses initialization;
`versionReport` emits `aw <version>` and optional commit/build lines as text
regardless of `--json`. `AW_NO_UPDATE_CHECK=1` prevents its update request.
The probe resolves one executable from absolute PATH entries and uses that
same real path throughout.

[awid/mail.go](https://github.com/awebai/aw/blob/f639b06d45092181a3aa705f959b2d77cb073277/awid/mail.go#L716)
retains the released plaintext display-binding and encrypted outer-ID checks.
The provider still independently requires strict signed/envelope equality.

## Reproducible isolated evidence

Copy the checked-in [Go fixture](../test/fixtures/probe/probe57_service_test.go)
into `awconfig/` in the exact public aw source above. Run from that source root
with an absolute output path:

```sh
PROBE57_NATIVE_WORKSPACE=/absolute/provider/test/fixtures/probe/native-workspace-1.36.28.yaml \
  go test ./awconfig -run '^TestProbe57' -count=1 -v
go test ./cmd/aw -run '^(TestAwMailSendNewConversation|TestVersionReportNamesTheRepositoryTheCommitResolvesIn|TestVersionReportClaimsNoOriginWhenItWasNotGivenOne)$' -count=1 -v
```

Observed: both `TestProbe57` tests PASS (0.186s package time); native mail/version
tests PASS (3.233s package time), including all 11 mail subcases. The
[native-generated YAML](../test/fixtures/probe/native-workspace-1.36.28.yaml)
is serialized and decoded by released `WorktreeWorkspace` code. The second
fixture proves explicit-root service/team selection, environment URL override
precedence (which the provider removes), and missing-root refusal. Names,
memberships and paths are synthetic; no live identity is read.

Upstream
[mail_new_conversation_test.go](https://github.com/awebai/aw/blob/f639b06d45092181a3aa705f959b2d77cb073277/cmd/aw/mail_new_conversation_test.go)
builds the actual CLI source into a temporary executable and uses local test
servers. Cases cover alias/DID/address fresh sends, zero conversation/inbox
lookups, mismatched response, 422, expired/unavailable/lost response, flag
conflict and legacy omission. This is a source-built binary fixture, not an
installed upgrade or hosted-delivery result. Failures have empty stdout and
prose stderr, not typed JSON errors. The provider preserves
`send-outcome-unknown` and never retries.

Provider tests combine generated YAML with unsupported forms, service mismatch,
config/executable drift, preflight composition, both floors and metadata
byte/deadline/cancellation bounds. HTTP transport is faked; no hosted `/meta`
request is made. These tests do not authorize a live probe.

## Path-recovery boundary and signature preservation

All locations below use public aw commit
`f639b06d45092181a3aa705f959b2d77cb073277`.

- `cmd/aw/mail.go:474–480` allocates the fresh UUID before target resolution;
  fresh mode bypasses auto-thread lookup and the expired-conversation retry.
  `awid/mail.go:94–103` preserves a supplied conversation ID;
  `:134–166` signs that conversation/body/message ID before the HTTP POST.
  `cmd/aw/mail_new_conversation_test.go:147–166` checks fresh IDs, verifies the
  Ed25519 signature and checks the signed conversation/body/message ID. The
  wire `new_conversation` flag does not change the signature format.
- `awid/client.go:1361–1380` marshals the payload once and uses a bytes reader.
  `cmd/aw/helpers.go:1071–1095` clones the request, reconstructs its body with
  `GetBody`, and changes URL/Host, not the serialized signed payload or IDs.
- `helpers.go:1102–1117` permits recovery after a concrete HTTP 404. With a
  transport error, only GET/HEAD/OPTIONS qualify: POST never qualifies. This is
  native path recovery, not a provider retry or a new mail conversation.
- `helpers.go:781–833` constructs recovery candidates by changing path suffixes
  of the selected base: `/api` and root for the provider's admitted URL forms.
  Scheme/host are preserved by construction; `rebaseRequestURL` itself is a
  general helper, not a separate origin allowlist. Recovery's discovery is
  `GET <candidate>/v1/agents/heartbeat` (`:753–776`), not conversations, inbox,
  target messages or unrelated threads. A non-404, non-HTML response identifies
  a candidate; this is not a mail-delivery proof.
- `helpers.go:1041–1046` calls persistence after the recovered RoundTrip returns
  without a transport error, before returning its response to the CLI. This
  includes HTTP error responses. `:854–860` supplies the selected workspace
  persistence callback; `:974–991` loads that workspace, changes its URL and
  saves it. Persistence errors are debug-logged, not promoted to send failures.
  The provider rechecks config bytes after metadata, before every native
  identity/mail command and immediately before entering its send attempt.
  A persisted repair during identity reads therefore refuses before send;
  repair during send is observed before the next exact-ID read. A failed send
  still reports `send-outcome-unknown`, without a provider retry.

The origin statement above covers candidate construction and path rebasing.
It does **not** claim native HTTP clients prohibit redirects: the recovery
heartbeat client (`helpers.go:761`) and configured clients (`:864` onward)
have no explicit `CheckRedirect` policy. The provider's own `/meta` transport
does prohibit redirects. A hard guarantee about all native redirect destinations
requires separate upstream qualification; same-origin candidate construction
alone does not prove it.

Additional pure fixture:
[probe57_rebase_test.go](../test/fixtures/probe/probe57_rebase_test.go).
Copy it into the pinned source's `cmd/aw/` and run:

```sh
go test ./cmd/aw -run '^(TestProbe57PathRebasePreservesSignedRequest|TestShouldRetryBaseURLRequestNeverReplaysMutatingTransportErrors|TestBaseURLFallbackDoesNotReplayMutatingTransportError)$' -count=1 -v
```

Observed: all three PASS (0.341s package time). The new fixture performs no
HTTP request: it verifies that the same-origin path rebase preserves exact
serialized bytes, IDs, fresh flag and a locally generated Ed25519 signature.
The other two upstream fixtures cover the 404 predicate and no mutating
transport-error replay. No hosted observation is implied.
