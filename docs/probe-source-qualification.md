# Probe source qualification

This receipt covers source and isolated fixtures, not installed binaries,
Cloud deployment, live probe or disposable-pair acceptance. Authorized read-only
LOCAL-member output captures are separately identified below.

## Pins and admission authority

The [maintainer declaration](https://github.com/awebai/oats-aweb/issues/57#issuecomment-6077900224)
sets probe-only CLI 1.36.28 and server 1.27.12. The probe was source-qualified
at aw 1.36.28, recorded below. From provider 1.25.0 the probe's CLI floor is the
provider's single aw floor (1.36.30), which is above it; the server floor stays
1.27.12. The qualified hosted origin is `https://app.aweb.ai`; its current
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
Actual authenticated mail has an additional boundary:
`awid/mail.go:160` calls `Post`; `awid/client.go:1436` calls
`DoNoRedirectWithTimeout`; `awid/http_transport.go:86–101` clones the supplied
client and sets `CheckRedirect` to `http.ErrUseLastResponse`, overriding any
injected redirect policy. Fallback calls `RoundTrip` directly, which does not
follow HTTP redirects. Thus the absence of `CheckRedirect` on the configured
client does **not** mean authenticated mail follows redirects.

Only the unauthenticated recovery heartbeat (`helpers.go:753–776`) uses its
own `http.Client.Do` without that wrapper. Its constructor attaches no principal
headers. The controlling disposition `60287d1a`, **as corrected by
`daea7f2d-23b8-4cdf-837c-b08d5fbae7bf`**, accepts this heartbeat-only trust
assumption: **selected-service guarantee holds modulo redirects issued by the
selected origin**. Do not claim that all heartbeat destinations are origin-pinned.
The provider's `/meta` request refuses redirects. Unknown/non-hosted configured
services still refuse; future heartbeat hardening (`aweb-abqk`, P3) has no
qualified released version.

The reviewer's [generic-client reproduction](../test/fixtures/probe/generic-client-redirect.go)
uses a custom in-process RoundTripper and direct `http.Client.Do`: it observes
two POST hops with identical synthetic bytes, from app.aweb.ai to
unqualified.example, with zero network calls. This is valid generic Go client
evidence **only**. It bypasses `Post`/`DoNoRedirectWithTimeout`; the reviewer
withdrew its use as evidence that production mail redirects. It does not prove
nonce-body or authentication forwarding by the actual mail path.

The [actual-mail fixture](../test/fixtures/probe/probe57_mail_redirect_test.go)
calls released `Client.SendMessage` with a locally generated signing identity,
fresh conversation ID and injected in-process transport returning 307. It checks
one authenticated signed POST, no destination hop and no invocation of a
permissive injected redirect policy. No network request is made. Copy it into
the pinned source's `awid/` and run:

```sh
go test ./awid -run '^(TestProbe57ActualMailRejectsRedirect|TestTrustRequestsDoNotFollowRedirects)$' -count=1 -v
```

Observed: both tests PASS (1.164s package time). The upstream
`http_redirect_test.go:97` suite also passes its authenticated API/SSE and
other trust-request cases using isolated local servers. This qualifies the
production call path, not a live hosted send.

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

## LOCAL member command/output capture

Read-only capture on 2026-10-09 used the author's existing authorized LOCAL
member identity, not a provisioned test identity. File-presence checks observed
`workspace.yaml`, `teams.yaml` and `signing.key`, with no `identity.yaml`;
no key/config contents were copied. The installed executable reported:

```text
aw 1.36.27
  commit: ef1ebd163b22553d9e4273356f2c6e67cf86ec63 (github.com/awebai/aw)
  built:  2026-10-08T06:48:09Z
```

These are read-shape captures at 1.36.27, not a 1.36.28 installed/send-support
claim. The probe's send floor was 1.36.28 and is the provider aw floor (1.36.30)
from provider 1.25.0. Exact commands, with locators
redacted, all exited 0:

```sh
AW_NO_UPDATE_CHECK=1 aw version
aw --identity-home <own-home>/.aw --team <own-team> whoami --json
aw --identity-home <own-home>/.aw id team list --json
aw --identity-home <own-home>/.aw --team <own-team> mail show --message-id <already-delivered-id> --json
```

The last command read only the known maintainer-return message already addressed
to this author. No general inbox, test send, acknowledgement, provisioning,
installation or provider/config mutation was performed. Native verification may
update its existing trust cache as documented above. This is not a round-trip
or deployment-adoption acceptance run.

[local-member-capture.json](../test/fixtures/probe/local-member-capture.json)
retains captured field presence and JSON types, including absent `custody`,
`stable_id` and `grant_id`; whoami `inbound_configurable: false`; one active
membership; exact mail `has_more: false`, string `read_at` and null `thread_id`.
The captured message was verified legacy plaintext v1 with a string signed
payload. Identifiers, aliases/addresses, timestamps, subject/body and signature
have been replaced with synthetic values; the parsed signed payload was likewise
redacted before serialization. No raw mail, private config or keys are committed.
The signature is deliberately non-cryptographic: this fixture exercises the
provider's consumption of CLI verification, not signature verification itself.
Encrypted fixtures remain the separately qualified source-derived models;
no encrypted-message capture was made under this authority.

The shared fake now derives whoami/team-list/exact-mail fields from this capture.
Request/reply roles, nonces and IDs are deliberately simulated, and test scenarios
can override `read_at` to null for unread mail. It rejects `--team` on team-list
and requires it on mail/whoami. Corrected cases independently exercise initial
and final identity reads, absent/self/non-self custody and retained scope/DID/
grant/single-membership refusals.

Released 1.36.28 source corroboration (public `f639b06d`):

- `cmd/aw/root.go:157–177` binds team selection to mail and whoami (`introspectCmd`),
  not `id`/`teamListCmd`; `:213–218` defines that command-scoped flag.
- `cmd/aw/id_team.go:451–455` and `:1301` define team-list/runTeamList; its output
  (`:179–191`) exposes `active_team` and membership records for validation.
- `cmd/aw/introspect.go:21` declares custody with `omitempty`; `:46–53` copies
  `sel.Custody`. `awconfig/selection.go:227–243` fills it only when an optional
  standalone identity supplies custody. Normal certificate-backed LOCAL members
  can therefore omit it without being non-self-custodial.
- `awid/mail.go:716` normalizes the exact-message response through the existing
  signed/encrypted proof path. The authorized plaintext capture confirms the
  envelope/field presence consumed by the fake; it does not qualify new live sends.
