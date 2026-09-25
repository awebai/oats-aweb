# oats-aweb

Official [OATS](https://github.com/awebai/oats) messaging-layer integration for
[aweb](https://aweb.ai). It provides per-instance native identities, mail/chat
skills, team roster discovery and session/channel delivery integration. Messaging
is separate from durable task tracking; the selected tasks provider owns tasks.

## Portable captured profile — 1.14.1

### Fixed

- `join=` and `oats aweb join` no longer use the human-facing `aw team join` wrapper under an external identity home, which aw's identity-home policy refused in 1.14.0. Joined-team minting now requires aw >= 1.36.12 and redeems the provider-minted invite with `aw --identity-home <home>/.aweb-identity-<label> id team accept-invite <token> --local --name <alias> --json`; the joined root must auto-connect and publish its E2E key. Joined per-team homes are not initialized with `aw init`; they are used only through `--identity-home` for polling and sends. The per-team identity home's parent must be a real (non-symlink) directory, matching aw's identity-home policy. Joined-team leave removes local state only when `aw workspace delete --json` returns the structured receipt `alias_released: true`; explicit `alias_released: false`, identity-deleted-only receipts, malformed JSON, permission/auth errors, transport errors and ambiguous text keep the local joined home and provider record for retry.

1.14.1 requires OATS >=0.26.0 and the workspace model. It removes the classic team-scope path, refuses older-kernel environments with a fixed diagnostic, adds host wake-daemon readiness (`WAKE_STREAM_MIN` 1.36.5), and adds explicit wider-team operations (`oats aweb teams|join|leave`) plus the `join` spawn setting. The primary identity always mints into the personal team: `settings.oats.aweb.team` when set, otherwise the root's active/default team as the stand-in until per-workspace personal teams exist. Mapped workspace labels, including the primary label, are eligible wider teams and join only by `join=` or `oats aweb join`. Joined team identities are local per-team homes (`.aweb-identity-<label>`) and receive by polling in this release.

1.13.1 attaches resident session grant homes to custody at mint time. Global-mode
spawns pass the preflight's absolute `status.socket_path` to
`aw id grant mint --custody-socket`, read `grant.yaml` back, then verify the
attachment with `aw custody status --json` from the grant home with
`AWEB_IDENTITY_HOME` set to that grant home. Any missing/mismatched attachment
is revoked and removed; launch renewal keeps the previous grant on attachment
failure. `CUSTODY_ATTACH_MIN` is `1.36.3`, the first published aw release whose
`aw id grant mint --help` includes `--custody-socket`.

1.13.0 prepares resident grant custody preflight and scoped grant profiles:
global-mode spawns check `aw custody status --json` before minting, `profile:
normal|reviewer` expands to concrete scope lists unless explicit `scopes` are
provided, grant homes are recorded and cleaned up, and launch-time renewal stays
off unless `identity.renew: launch` is explicitly set. Grant minting passes
`--team` from aw 1.36.2 (`GRANT_TEAM_FLAG_MIN`); complete custody operations
need aw 1.36.2 with aweb server 1.27.5. Older aw versions do not receive
`--team` and may reject the full normal-profile scope list, which fails closed
rather than silently narrowing a grant. The binding check also answers the
kernel's binding-less workspace readiness probe (OATS 0.26.0) from settings.
The OATS floor remains >=0.25.6.

1.12.3 aligns spawned local aliases with aweb's server rule (1-64 characters,
alphanumeric start, then alphanumeric/`-`/`_`) and refuses an invalid instance
alias before invoking `aw`; alias-reuse guidance now names both the explicit
`--name` remedy available on OATS kernels 0.26.0+ and the older `--purpose`
remedy. The OATS floor remains >=0.25.6.

1.12.2 declares host-only path settings (`root`, `roots`, `residents`) for
kernels that enforce `hostOnly: true` (OATS >=0.25.6) and hardens `oats aweb
setup` around existing `aw` primitives only: `aw init --username <u>`,
`AWEB_API_KEY=… aw init`, and `aw team join <token>`. Guidance no longer names
nonexistent team-creation shortcut; when a new hosted username is used, setup tells the
operator to map the workspace team to `default:<u>.aweb.ai` if that is the
intended team. Readiness now matches the spawn hook's no-explicit-team fallback:
a root with an active aweb team is ready, while an unmapped workspace team label
still reports the v2 team-setting remedy.

1.12.0 added resident-identity session grants: `identity.mode: global` makes an
instance act as a named resident identity through an expiring `aw` grant
(never minting or copying root keys), `team` is read from the payload,
`residents.<name>` is the host-only custody map, and every spawn emits the
messaging-layer meta key `identity` (`{ mode, alias, team, address, resident, grant? }`).
See `oats-package/capabilities/oats-aweb/oats.json` and the OATS integrations guide.

## 1.11.2

1.11.2 is manifest-only over 1.11.1: it declares `helperInjection: {version: 1, mode: omit}` so a harvest helper (which has no messaging identity) composes without the aweb briefing. Without the declaration the kernel refuses helper composition for every soul that requires messaging (second-operator finding, 2026-09-21). Code identical to 1.11.0.

The 1.11 line provides the manifest-owned binding codec and selected
execution-input consumer. This patch declares its fixed diagnostic vocabulary
and owned operator keys; it does not change native execution behavior. See [the exact profile boundary](PORTABLE-PROFILE-STATUS.md)
for declarations, fixed missing-item diagnostics and native lifecycle behavior.
It requires **OATS >=0.24.4** for the new `binding.reasons`/`keys` metadata;
older closed manifest readers reject those fields. Release and upgrade the
compatible kernel before selecting this provider. The underlying HOME-route
custody arrived in0.24.1, and the retained launch projection/caller-owned codec
CLI locator in0.24.2 at b92f0d07; those runtime checks are unchanged. Check the
actual caller version AND observations: a tag or source checkout alone is not
installed availability.

`delivery: session` is explicit. The check reports `needs-configuration` when its
binding, instance, private-team selection, caller version or retained profile is
unavailable; the execution adapter separately reports missing native setup.
**Strict-Pi print does not accept session input** and remains held; required messaging is never silently removed and the
runtime is never silently switched. Ordinary input-capable profiles are evaluated
under their exact retained selection; other required resources/hooks can still
block native start.

Native enrollment reuses aw's existing commands from the explicit retained
deployment's already initialized authority context, for the child's own identity
and exact selected team. No ambient root search, copied credential, new H/account
mapping, private-grant protocol or automatic team creation is added. Session
registration uses the existing home/identity-home/delivery ABI. Native identity,
workspace and directory correspondence are checked around effects; unknown or
partial outcomes remain recorded for explicit reconciliation.

The codec consumes complete kernel source/workspace/operator declarations,
reading only messaging-owned fields while preserving other providers' choices.
Already in 1.11.0, normalize/bind/check errors use existing typed `error.message`
with fixed safe reasons; non-ready checks use `problems[].message`. No raw
exception text, supplied aliases/keys/values or native diagnostics are relayed.
The 1.11.1 `binding.reasons` list declares all 30 fixed error/fallback/check
strings, so an implementing kernel can retain only byte-exact matches. Its
`binding.keys` is exactly `responsibleHuman`, `privateTeam`, `wider`: workspace
`teams` and adoption `teamAliases` are not additional operator-map keys. Kernel
0.24.4 validates the key declaration only; filtering/overlap enforcement is a
separate later kernel contract. Provider-side foreign-key ignoring remains.

Scoped HOME-route operational custody is NOT human-account/private-grant
attestation or proof that a model consumed a wake. Parent/operator acceptance of
actual installed versions, identities and runtime delivery is separate from the
controlled fixture results. This 1.11.1 source/version metadata is not proof of
publication, installation or kernel diagnostic rendering.

## Native requirements and resources

Install a compatible `aw` CLI separately, through operator-approved setup. The
captured adapter uses the existing aw1.36.1 command shapes. Its selected deployment
needs a legitimate existing native context with permission to issue the requested
invite; OATS does not manufacture that native permission. The child must have its
own native identity, not an external `AWEB_IDENTITY_HOME` override.

The package owns reviewed MIT-licensed `aweb-messaging`, `aweb-team-membership`
and `aweb-identity` resources. [Vendored provenance](oats-package/capabilities/oats-aweb/skills/VENDORED.md)
records the upstream repository, pi-v0.2.3 tag/commit, registry integrity and sync
procedure. Acquisition performs no npm runtime install or credential setup.
Native aw and conditional runtime resources remain declared requirements; session
`ifInstalled` minimums and `AWEB_DELIVERY=session` are not removed to force a pass.

## OATS compatibility

Kernels before 0.26.0 are not supported by this release; use oats.aweb 1.13.x there.

## Development

```bash
node scripts/validate-manifests.mjs
node --test test/portable-profile.test.mjs test/captured-execution.test.mjs \
  test/session-readiness.test.mjs test/captured-native.test.mjs
# Full local provider unit suite when appropriate. When running through Node 22,
# invoke the Node 22 binary directly or put the real aw 1.36.6 / 5a285ceb binary
# ahead of node_modules/.bin; otherwise a dependency-provided old aw can shadow
# PATH and fail the real-CLI fixtures.
npm test
```

Focused tests use controlled public-kernel/native-aw doubles and explicit source
coupling for the wire/resolver/private snapshot transport. Set
`OATS_S3_FRAMEWORK_ROOT` to an exact verified kernel export for
`test/public-kernel-readiness.test.mjs`: it couples real codecs, approval/scaffold,
broker and readonly CLI, with no native setup/start, when the package floor is
met. The merged b92f0d07 source still identifies as0.24.1: final1.11 metadata must
refuse acquisition on it, not rewrite its version. The pre-metadata code commit
143a8a9 coupled those exact kernel bytes and verified the CLI locator/projection
while retaining the runtime version hold. That case also preserves Claude's
runtime-package refusal and uses a separate explicit inert Codex observation
fixture, not a pilot fallback.
They are not real
provider enrollment, SDK/model/backend or broker-consumption evidence. Old failed
and corrected scopes stay separate. Maintainer vendored updates still use
`node scripts/sync-vendored-skills.mjs --source /path/to/aweb` against the recorded
clean upstream revision; this adapter does not edit those vendored skills.
