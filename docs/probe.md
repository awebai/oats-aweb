# Explicit round-trip probe

`oats aweb probe --home /absolute/canonical/instance/home [--timeout 60] [--json]`

The probe is an explicit operator action that sends one challenge and waits for
one signed nonce reply. It is never called from readiness, lifecycle hooks,
startup, onboarding or health checks. It provisions no identity, encryption
key, team, plugin or permission and types into no terminal.

## Release admission

At execution, the probe requires the provider's single aw floor, **aw >=
1.36.32** (`AW_MIN`), and the selected hosted service's **`build.aweb_version
>= 1.27.12`**, a probe-only server floor. The probe was source-qualified at aw
1.36.28 ([source qualification](probe-source-qualification.md)), below the
floor. The recognized origin is
`https://app.aweb.ai`. No flag or environment variable bypasses admission.

The accepted trust assumption is: **selected-service guarantee holds modulo
redirects issued by the selected origin**, scoped only to native unauthenticated
heartbeat discovery during API-path recovery. That heartbeat GET can follow
redirects and carries no principal headers; its final destination is not
independently origin-pinned. Authenticated signed mail/API requests already
refuse redirects through the native `DoNoRedirectWithTimeout` wrapper. The
provider's own `/meta` request also refuses redirects. This caveat neither
forwards the signed mail body/auth to a redirect destination nor admits arbitrary
configured services. Additional recognized origins still need an owner-approved
metadata contract. Future heartbeat redirect hardening has no declared released
floor; no new native flag or fixed version is assumed here.

The executable is resolved once from absolute PATH entries, observed through
`aw version` with update checks disabled, and reused by absolute real path.
The anchored `aw X.Y.Z` text line must identify a stable release; malformed,
missing, prerelease or below-floor versions refuse. Changes to that file's
identity/size/timestamps invalidate qualification.

Both explicit identity homes must contain native-format `workspace.yaml`
records with the same exact `aweb_url`. The bounded reader accepts the released
native-generated block mapping and membership list, single-line plain or quoted
scalars, and standalone comments. It refuses duplicate keys, flow mappings,
multiline scalars, aliases, tags, merges, document markers, unknown fields,
symlinks and files over 64 KiB. This intentionally conservative reader is not a
general YAML parser. Unsupported forms return `selected-service-config-unavailable`;
no config is rewritten or inherited from another home. Config bytes are checked
again after metadata and before every identity/mail command. Mismatched services
return `selected-service-mismatch`; drift returns `selected-service-config-changed`.
Do not change identity configuration concurrently with a probe: these checks
are observations, not a lock against another process changing files inside an
aw invocation.

A single unauthenticated HTTPS GET reads `/meta` at the scheme/host origin of
that exact selected URL (`https://app.aweb.ai/api` becomes
`https://app.aweb.ai/meta`). Root paths and `/api` with optional trailing slash
are accepted; credentials, query strings, fragments, alternate ports/origins,
encoded or other paths are refused. The request sends no inherited credentials,
follows no redirects, and shares the total deadline/cancellation with a 5-second
cap and a 64-KiB body limit. Only `build.aweb_version` qualifies the service,
never the static top-level `version`. Missing, malformed, below-floor or
unavailable metadata and unrecognized origins fail before send with
`fresh-conversation support unknown/unsupported on <origin>` (or `unknown origin`
for invalid URLs). A canary send cannot establish support. There is no legacy
send fallback. Published releases do not establish the current Cloud version:
this observation is required for each invocation.

The accepted attempted-send failure contract is `send-outcome-unknown`, with
no retry, for every subprocess failure. This includes a server conversation
mismatch, HTTP 422, timeout or lost response; none proves that no message was
delivered. The CLI emits structured JSON only on success, so the probe does not
parse stderr prose, expose raw errors or invent status/code fields. Typed error
projections are a future follow-up, not a requirement for this delivery.

Released source/binary qualification and the native-generated config fixture
are documented in [the source receipt](probe-source-qualification.md). Upstream
fresh-conversation tests establish no conversation/inbox discovery and no
uncertain-send retry in the qualified native implementation; provider fakes
alone cannot establish those properties. Native service-path recovery can probe
same-origin API paths and persist a corrected workspace URL; a subsequent probe
command observes that as config drift and refuses. Ordinary trust-cache and
communication-log side effects of aw remain native behavior.

## Selection and proof

The required home is canonical and belongs to the dispatch deployment. Its
captured provider settings, primary identity, team and runtime must agree with
public kernel inspection and the explicitly selected native identities. The
recorded team's `roots[team]` entry wins over `root`; missing or malformed
explicit roots are refused. Caller `OATS_META`, default team and
`AWEB_IDENTITY_HOME` never select the target. Joined identities are excluded.
Captured global identities return exactly `global probe not yet implemented`,
including retained seats recorded as global. A consistently captured local
retained identity can qualify under the same checks; the configured root is
not asserted to be its historical minter.

Subprocesses use argv and explicit identity home. `--team` is passed to mail
and whoami, where the released CLI binds it; `id team list` receives no team
flag and its returned active team/single membership must match the capture.
A LOCAL member may omit whoami custody; a present value must be exactly `self`.
Absent custody does not relax DID, scope, grant or membership checks. They use a sanitized environment
and an owned neutral temporary cwd. This prevents aw's `.env.aweb` overload
from restoring ambient service/identity selectors. The one-line challenge
contains a cryptographically random nonce of 192 bits; its body file is mode
0600 inside a mode-0700 directory and removed on completion or cancellation.
The root and target DID are pinned before send and checked again at completion.
No target inbox, broad root inbox, unrelated conversation, ack or input command
is called. A send error, timeout, cancellation or malformed response is
`send-outcome-unknown`: sending is never retried. Text says “send outcome
unknown; no retry.” The current CLI failure path supplies no message or
conversation ID: those JSON fields remain null and text says “recovery ID
unavailable.” Exact-ID inspection can only be suggested when a real ID was
obtained; no recovery ID or placeholder conversation is manufactured.

An exact-ID read checks the sent message. Polling uses only the returned fresh
conversation with `--limit 500`, once per second. This is an oldest-first
window; a full window is incomplete evidence when no acceptable reply appears.
Transient read errors may be retried within the deadline. A candidate needs a
nonempty distinct message ID, the exact conversation, pinned target sender DID,
intended root recipient DID, `verification_status: verified`, and the complete
nonce token. Legacy, custodial, stale and boolean verification claims fail.
The exact candidate ID is read again and its proof must remain identical.

Both reply formats are supported:

- `legacy_plaintext_v1`: the bounded parsed `signed_payload` must be an object
  with `type: mail` and exact body, message ID, conversation ID and sender/recipient
  DIDs equal to the accepted outer fields. The nonce must therefore be signed.
  The CLI remains responsible for signature and continuity verification.
- `encrypted_v2`: the selected root's qualified CLI must successfully verify and
  decrypt the envelope before emitting its normalized body. Require consistent
  outer mode/version, authenticated envelope type `aweb.e2ee.message`, kind
  `mail`, matching IDs/thread, and the pinned sender and one intended recipient.
  The CLI checks encrypted inner/outer agreement; the probe checks the outer
  display IDs against that envelope. It never requires plaintext
  `signed_payload` for an encrypted reply. Decryption failure, missing proof or
  contradictory fields cannot pass. There is no downgrade or key creation.

Read commands do not acknowledge mail. They are not filesystem-pure: aw can
update its existing trust cache (including removal of stale local alias pins
from `known_agents.yaml`). The probe disables update checks and never writes
identity configuration itself.

PASS proves one authenticated round trip at probe time. It does not prove
exclusive native delivery, pane presentation, model execution time, future
wakes or continuous liveness. A message's `read_at` does not prove presentation.

## Output and deadlines

`--json` emits exactly one document on stdout; exit 0 means PASS, nonzero means
FAIL. Text starts with PASS/FAIL and includes reason, elapsed/send/reply timing
and IDs. No nonce, body, key, token, raw subprocess error or configuration is
projected. Malformed, duplicate and unknown flags are refused. Timeout is a
finite positive decimal number of seconds, default 60, maximum 300.

All subprocesses, polls and diagnostics share one monotonic deadline; each
child has a smaller cap. Cancellation kills the owned process group. Initial
read-only kernel diagnostics are bounded inside the deadline. A small final
budget is reserved for an exact sent-message read. Unavailable evidence stays
unknown. The public session projection does not claim a harness is running
merely because a pane exists. Channel configuration/readiness does not confirm
that a development prompt is currently blocking.

Schema version 1:

| Field | Meaning |
| --- | --- |
| `outcome`, `reason` | `PASS` or `FAIL`, and a bounded provider reason |
| `target` | `{home, alias, team, did, harness, delivery}`; unknown values null; harness is captured claude/codex/pi; delivery is channel/broker |
| `sender` | `{did}` pinned selected root identity |
| `request` | `{messageId, conversationId, sentAt, sendStartedAt, sendCompletedAt}` |
| `reply` | `{messageId, sentAt, observedAt}` or null; a verified observation can remain present when final identity revalidation fails |
| `timing` | `{startedAt, finishedAt, elapsedMs, sendMs, waitMs, replyMs}` |
| `diagnostics` | The typed projections below |
| `warnings` | Bounded fixed messages, never raw errors |

`request.sentAt` and `reply.sentAt` are server `created_at` observations, not
claims that those timestamps were signed. `sendStartedAt`, `sendCompletedAt`
and `reply.observedAt` are local wall timestamps. `elapsedMs` is the monotonic
whole command span; `sendMs` spans the one send attempt; `waitMs` spans send
completion to verified exact-reply observation or failure completion;
`replyMs` spans send completion to that verified exact-reply observation.
These spans include transport, queue, agent and polling time. They do not
isolate model execution. Clock skew can make subtraction of server and local
wall timestamps misleading. Null means unknown or the phase was not reached.

Diagnostic shapes:

- `readiness`: `{status: ready|not-ready|unknown, source, observedAt}` from public
  `oats readiness --home … --json` readinessApi2, exact subject and summary.
- `pane`: `{status: observed|unknown, state: stopped|not-launched|shell|unknown|null,
  present: boolean|null, source, observedAt}` from public `oats session inspect`.
  Observation failure is unknown, not stopped. Pane state unknown can itself
  be a successfully observed public state.
- `mailRead`: `{status: unread|read-unanswered|unknown, readAt, source, observedAt}`
  from the exact sender-visible request. On PASS the unanswered classification
  is cleared; any observed read timestamp retains its source/time.
- `versions`: `{aw, oatsKernel, oatsAweb, harness}`. Each version observation is
  `{status: known|unknown, version, source, observedAt}`. Harness also has
  `{name, binarySha256}`; its running version/hash remain unknown without
  public evidence tied to the current start. The harness is never executed
  to infer its running version. The selected kernel's version command and
  executing provider manifest describe those artifacts; they do not establish
  which harness build is running. The aw observation must identify the exact
  qualified binary the probe invokes.

## Development and disposable acceptance

`probe-runtime.mjs` owns bounded process execution; `probe-target.mjs` validates
captured authority; `probe-proof.mjs` binds the CLI's verified projections;
`probe-diagnostics.mjs` projects public observations; `probe-service.mjs` reads
the selected native config; `probe-support.mjs` owns dual release admission; `probe.mjs` sequences the one send and observation.
Tests inject process/clock dependencies at the module boundary, not through
production command flags or environment. Run `npm test` for provider regression
coverage; `node --test test/probe.test.mjs test/probe-support.test.mjs test/probe-identity.test.mjs` runs the focused
offline proof, gate, identity, config-drift and deadline suite.

Live acceptance is separate and has **not** been performed. It needs an
operator-designated disposable deployment, explicit captured local root sender,
distinct local receiver, already provisioned encryption keys for the encrypted
case, and operator consent to send a nonce challenge, allow its receiver to
reply, and inspect only that conversation. The operator must also authorize
fixture creation/retirement and any intentional stopped-receiver scenario.

After the selected Cloud deployment meets admission and the disposable pair is authorized:

1. The designated operator provisions the disposable lifecycle fixture and
   records the exact deployed CLI, service guarantee and kernel/provider versions.
2. Spawn the designated local receiver with the captured root/team and selected
   delivery policy. Run public read-only observations and then one explicit probe.
3. Confirm plaintext PASS, then a separate explicit probe with an encrypted
   reply from the receiver's existing key material. Keep only sanitized IDs,
   version evidence, timings and outcomes in the acceptance receipt.
4. Stop the disposable receiver under the operator's lifecycle authority; run
   a separately consented timeout probe and confirm bounded FAIL and no resend.
5. The operator retires the receiver and sender fixture according to their
   retention policy and records cleanup. Do not reuse an unrelated live thread
   or the operator's resident identity as a test substitute.

Fake/source tests do not constitute this live acceptance.
