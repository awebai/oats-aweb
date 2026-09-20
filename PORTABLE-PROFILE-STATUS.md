# Phase1 portable messaging — declaration support is not native readiness

This candidate starts from released `oats-aweb` 1.10.3. It adds the missing
manifest-owned provider binding interface required by OATS >=0.24.0. It is a
new source change needing coordinated version selection/publication; it does
not overwrite or qualify the published 1.10.3 tag. Package versions remain at
their released/development baseline until the maintainer chooses a release.

## First concrete barrier and this slice

The released manifest has no binding codec. The current kernel's retained
provider broker therefore refuses it with `provider-not-qualified` before
normalizing a required messaging declaration. Its legacy hook separately
selects ambient `.aw` roots and can enroll/copy an identity or register a wake
broker; that is not an implementation of captured source authority.

This slice supplies actual bounded `normalize` / `bind` / read-only `check`
commands, keeping the kernel's sole choice resolver. It preserves explicit
human/context/private-team/wider choices and provenance without native probes.
Checks distinguish missing configuration from the unimplemented native
qualification path. All captured native hook/command entrypoints refuse before
legacy root/settings/identity/enrollment/wake selection, including invalid or
unpaired supplied snapshot markers. They do not read credentials or treat an
ambient working identity as the requested actor.

The declaration/parser core is a selected new diff from earlier provider
prototype logic; generic invocation-shape validation is byte-identical to the
published OKF2.1 module, and the manifest schema is the current kernel schema.
No old feature-branch ancestry, native setup receipt/grant protocol, speculative
native workspace adapter or be9 team-readback utility is adopted by association.
These new bytes require their own review.

## Exact declaration/settings boundary for the pilot

Both primary and SOURCE helper must retain their actual required capabilities.
M owns production export/source locators; this document does not advertise a
future unreviewed package/soul path. Once that locator is selected, messaging
requires capability **`oats.aweb`** and explicit supported settings:

```yaml
settings:
  delivery: session
```

`channel` remains the manifest default. `session` is NOT rewritten to channel or
none. Host `aw`, both channel requirements and both session `ifInstalled` minimum
version requirements remain declared unchanged. Settings do not prove broker
registration, native authority or the eligibility of a strict Pi profile.

The existing messaging declaration inputs are:

- Soul value: `{teams: [<source-alias>, ...]}`.
- Workspace value: `{teams: {private: "per-human", <alias>: {provider: "oats.aweb", id: "<team>:<namespace>"}}}`.
- Optional adoption value: `{teamAliases: {<source-alias>: <workspace-alias>}}`.
- Operator value: `{bindings: {responsibleHuman: {provider: "oats.aweb", id: "<explicit-provider-human-ref>"}, privateTeam: {provider: "oats.aweb", id: "<explicit-private-team>:<namespace>"}, wider: []}}`.

These are values inside the kernel's witnessed declaration envelopes. The human
reference and wider consent are required choices; a missing private-team choice
can remain unresolved for readiness but is never filled from current membership.
A standalone context needs an explicit key. Workspace context uses the qualified
workspace identity/observation. Aliases are availability, NOT wider consent.
`wider: []` explicitly chooses private-only; it does not disable messaging.

Wire: one UTF-8 JSON request/response, version1, slot `messaging`, capability
`oats.aweb`; 1MiB/depth32/16384-entry limits, duplicate/unknown/malformed rejection.
Payload contract remains `oats.aweb.messaging@1`, with no credential references.
The resulting `messagingChoice` binds H+context and explicit wider choices. The
kernel retains selected `delivery` separately; no second settings resolver is
introduced. An inline invocation, if present, must match the action/context and
binding; a shape-valid or null-intent projection does not authorize effects.

## Bounded pilot readiness matrix

| Stage | Current result | Required fact or remaining implementation |
|---|---|---|
| Normalize / bind explicit messaging | Supported by this source slice | Real source/context origins, explicit H and wider consent; exact private team for configured checks |
| Kernel wire / single resolver | Coupled fixture against current approved framework | This is protocol coupling, not enrollment or a live profile |
| `delivery: session` intent/resource closure | Preserved, not downgraded | Actual native wake capability/version and later authorized registration must be established |
| Captured native provider readiness | **Specific implementation gap; unavailable/provider-not-qualified** | A bounded native collector and admitted lifecycle adapter must establish H-to-actor delegation, exact private context/team and applicable admin/grant authority; no such implementation is present in the released legacy hook |
| Missing private-team input | **Needs configuration** | Operator selects the intended provider-resolvable team; selection is not verification |
| Captured spawn/retire/setup/roster | **Held before native effects** | No ambient root/identity fallback, automatic enrollment/trust, credential copy or invented native authority |
| Enriched primary/SOURCE helper | **Not qualified by this slice** | Keep knowledge, messaging and authoring requirements; OKF's published sole-OKF helper restriction and selected native profile eligibility are separate barriers |
| Worker completion / knowledge acceptance | **Not evidenced here** | Actual independent worker/judgment/delivery, Git PR acceptance and subsequent reading remain distinct; runtime Git knowledge publication stays PR-only |

The native barrier above is an implementation/fact gap, not a claim that every
current or future aweb service API is incapable. Before adapting effects, the
maintainer/operator must identify the legitimate native actor/delegation and
private-context authority route. A team ID, `whoami`, connectivity or copied
identity is not a substitute. Previously undecided grants/bootstrap protocols
remain undecided; no new authority schema is invented by this codec.

No corpus migration, visibility change, new permanent soul, provider-default
change, native SDK/model/backend/provider-admin call or live deployment is part
of this increment. Older ordinary legacy behavior remains separate, not evidence
for captured/private readiness. Missing required messaging must never be removed
to make a knowledge-only or zero-plugin fixture pass.
