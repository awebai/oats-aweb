# Explicit round-trip probe

`oats aweb probe --home /absolute/canonical/instance/home [--timeout 60] [--json]`

The probe is an explicit operator action that sends one challenge and waits for
one signed nonce reply. It is never called from readiness, lifecycle hooks,
startup, onboarding or health checks. It provisions no identity, encryption
key, team, plugin or permission and types into no terminal.

## Release admission

The production send gate is closed: the fresh-conversation CLI primitive and
Cloud behavior do not yet have qualified released support observations. The
command returns `FAIL probe-cli-and-server-support-unqualified` before sending.
There is no flag or environment bypass. Offline tests inject an admission
result for the proposed `aw mail send --new-conversation` primitive. Before
opening the gate, qualify **both** the published CLI floor and documented
read-only server support observation. The settled server contract is a GET of
`/meta` at the scheme/host origin of the exact selected `aweb_url` used to send
(for example, `https://app.aweb.ai/api` becomes `https://app.aweb.ai/meta`),
never a different origin or `/api/v1/release`, comparing
`build.aweb_version` to the release owner's declared server floor. Recognized
origins, exact admission details and CLI/server floors must come from that
release; none is invented here. Non-hosted/unrecognized services are refused
until an equivalent observation is qualified. Unknown support must fail before send;
a canary send cannot establish support. Never fall back to ordinary `mail send`.
The accepted attempted-send failure contract is `send-outcome-unknown`, with
no retry, for every subprocess failure. This includes a server conversation
mismatch, HTTP 422, timeout or lost response; none proves that no message was
delivered. The CLI emits structured JSON only on success, so the probe does not
parse stderr prose, expose raw errors or invent status/code fields. Typed error
projections are a future follow-up, not a requirement for this delivery.

The existing provider floor remains aw 1.36.13. aw 1.36.23 is a source reference
for identity, mail projection and verification behavior, **not** a supported
probe send version. Its ordinary send can reuse a conversation and read the
broad inbox during discovery. A unique subject does not ensure freshness.
Upstream CLI/server tests and release acceptance must establish that the new
primitive skips discovery and creates a fresh conversation. Provider fakes
cannot certify those upstream properties.

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

Subprocesses use argv, explicit identity home and team, a sanitized environment
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
`probe-diagnostics.mjs` projects public observations; `probe-support.mjs` owns
dual release admission; `probe.mjs` sequences the one send and observation.
Tests inject process/clock dependencies at the module boundary, not through
production command flags or environment. Run `npm test` for provider regression
coverage; `node --test test/probe.test.mjs` runs the focused offline suite.

Live acceptance is separate and has **not** been performed. It needs an
operator-designated disposable deployment, explicit captured local root sender,
distinct local receiver, already provisioned encryption keys for the encrypted
case, and operator consent to send a nonce challenge, allow its receiver to
reply, and inspect only that conversation. The operator must also authorize
fixture creation/retirement and any intentional stopped-receiver scenario.

After CLI and Cloud support are released and independently qualified:

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
