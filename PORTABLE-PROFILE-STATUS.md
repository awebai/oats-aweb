# Captured messaging — scoped HOME-route compatibility

This source candidate adapts released oats-aweb1.10.3 to the existing portable
binding/invocation and native aw interfaces. It is not account/grant attestation,
a new identity registry or proof that a runtime consumed a notification.

## Read-only check and exact missing items

The manifest declares normalize/bind/check for `oats.aweb.messaging@1` and the
kernel's one choice resolver. No provider wire/payload version is changed.
`check` validates the binding/context/inline invocation and queries only the
caller-owned `OATS_CLI_BIN` for its version and exact retained inspection:

```
node <caller-cli> --version --json
node <caller-cli> inspect --deployment D --resolution R --json
```

It requires the actual caller version **>=0.24.2** (HOME custody plus the retained
profile projection and codec-owned CLI locator),
an explicit instance/private-team binding and `delivery: session`, and the actual
retained `launchSelection` observation for an input-capable ordinary Claude/Codex
profile. A missing CLI locator, older kernel, missing/mismatched projection,
missing input or unsupported profile returns **needs-configuration**, with a fixed
nonsecret reason in the EXISTING `problems.message` field. Caught normalize/bind
errors likewise use existing `error.message` with a closed literal allowlist and
safe fixed fallbacks, never arbitrary exception/alias/key text. Older kernel
decoders may strip these diagnostics; kernel-owned surfaced/attributed messages
are a separate correction, not a provider code/schema bypass.

The readonly primary launch projection and codec-owned CLI locator were merged
in kernel PR33 at b92f0d07, shipping in0.24.2. The custody fix alone is in0.24.1.
A version number or tag alone does not prove those fields exist:
missing actual observations remain held. The provider never imports private
kernel modules/indexes, consults current config or substitutes a source default.
Native HOME/profile/auth/Git context is preserved; invoking OATS selectors are
removed only from the readonly child query, whose selectors are explicit.

**Pi strict print is not input-capable.** It remains needs-configuration even
above the kernel floor. Keep required messaging; do not silently switch runtime,
remove a requirement, type into print stdin or start a new model turn as a fix.
Readiness here means this adapter's scoped binding/profile/HOME-route prerequisites,
not provider-private grants, complete native-resource eligibility or live delivery.
The kernel's separate required resources/hooks and native checks still apply.

## Captured execution and existing native behavior

Any binding/invocation/source-receipt marker selects the captured consumer before
legacy settings/root/identity handling. The paired files must be distinct,
physical, same-user, single-link0600 bounded JSON. SourceReceipt1, when present,
must correspond exactly. Entry action, subject, home, incarnation and non-null
intent must match; kernel admission is not fabricated from JSON shape.

Before/after every native boundary, the original snapshots and physical
home/work/deployment are revalidated; descriptors match the current physical
named file before every bounded read. Native identity directories are also pinned
within the invocation. Invalid-present or changed inputs never select legacy.

For a fresh, eligible captured spawn, the existing native path is adapted rather
than replaced:

1. The explicitly retained deployment D must already contain its legitimate,
   physical native `.aw` context. No ancestor, publisher checkout, ambient team
   or other instance is searched as authority. Native aw decides whether this
   existing context can issue an invite for the EXACT selected team.
2. Existing `aw team invite --team-id ...` / `aw team join ... --name ...` / native
   init create/connect the child's OWN identity. OATS never reads or copies keys.
   The default native join identity behavior is unchanged; no global-identity,
   account or wider-membership mechanism is invented.
3. Existing native whoami/workspace status must report the exact alias/team/home;
   the observed native DID is retained as setup evidence, not a human mapping.
4. Register exactly `aw wake register --home H --identity-home H/.aw --delivery
   session`. No invented captured-selector flag, broker, registration schema,
   default backend or daemon start is added. Backend discovery remains native.

An external `AWEB_IDENTITY_HOME` override is a named setup hold, not something
silently cleared/replaced. Retained-seat credential copying stays outside the
captured path. A pre-existing or uncertain child identity/receipt is held for
explicit reconciliation, never automatically adopted or reminted. Selected
wider memberships remain visible requirements and needs-configuration until their
native setup is explicitly qualified; they are not dropped to obtain readiness.

Native command failures preserve partial phase/receipt information. Invite tokens
and native diagnostics from credential-handling calls never reach hook output.
The ordinary existing provider metadata is carried by the kernel's existing
intent/receipt lifecycle; no second journal or authority service is introduced.

Captured setup is diagnostic, not account/team provisioning. Roster reads use the
instance's verified own context and exact team. The retire hook, IF invoked through
a supported admitted kernel path, verifies the recorded native identity before
wake deregistration/self-delete and reports alias release separately. This does
NOT implement the still-separate public captured retirement router or authorize
cleanup of unrelated native state. Unknown effects are preserved, not erased.

## Declarations and resources remain intact

The kernel supplies complete source/workspace/operator declarations, not stripped
messaging-only objects. This provider validates/reads its own fields without
rejecting or claiming other providers' fields; resolution remains the kernel's
one solver. Source declarations retain requested team aliases; workspace availability maps
aliases to exact provider teams and declares `private: per-human`. Operator
bindings explicitly select responsibleHuman/privateTeam/wider. The private
H+context tuple is retained logical scope, not proof of human-account ownership or
native private-grant policy. No new principal-mapping mechanism is claimed.

For the selected session profile, use supported `settings: {delivery: session}`.
Channel remains the legacy default. Host aw, both channel package requirements,
and both session `ifInstalled` minimum-version requirements remain unchanged.
The spawn hook remains required, and `AWEB_DELIVERY=session` remains its declared
contribution. Required native resource/contribution support can still block the
kernel's native start; this adapter does not filter it out to force a pass.

## Evidence and completion boundary

Focused fixtures exercise real codec processes and the paired-input consumer,
with controlled kernel-observation and aw doubles. They preserve the original
PR2 refusal before the corrected eligible case, Pi/old-kernel/missing-projection
holds, native mismatch, replacement and incomplete-enrollment refusal. Actual
kernel wire/resolver/private-snapshot coupling is separately scoped. The new
public-producer case at pre-metadata commit143a8a9 used actual b92f0d07 codecs/
prepare/approval/scaffold/broker/readonly CLI. It preserved that source's actual
0.24.1 version as a runtime floor hold, not a fake0.24.2 success. Final1.11 metadata
requires0.24.2 at acquisition; the test explicitly asserts that earlier refusal
on b92f0d07, and performs full coupling only on a genuinely compatible kernel. A real Claude preparation refuses its declared session
runtime-package closure; a separate explicitly selected inert Codex fixture
exercises the retained projection without deleting those constraints or changing
the pilot runtime. These are NOT real native enrollment, SDK/model/backend,
broker delivery or privacy tests.

The operator/integration owner must qualify the actual installed versions,
selected primary/helper profiles, native actor/team setup and real intended-home
message/wake behavior. Original captured primary/helper/resource closure stays.
A wake submission is not model consumption; a worker receipt/capture is not an
accepted knowledge PR. Runtime Git knowledge publication remains PR-only. No
corpus/roster migration, visibility change or global install belongs to this patch.
