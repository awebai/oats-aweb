# Changelog

## Unreleased

Added (#71): `oats aweb invite [--label L] [--plan] [--json]` issues a LOCAL
hosted member invite from the selected deployment team root. No recipient alias
is accepted; the accepting side chooses its name. Plans read without minting or
claiming permission. Native/server authority decides issuance, with isolated
credentials/controller state, deliberate token-once output and secret-safe
HTTP denial/error handling. Unsupported controller-only routes do not borrow
ambient authority. Paired labelled stdin acceptance guidance and pinned native
loopback/public dispatch regressions accompany the source change; no live
issuance, timed journey or release qualification is claimed.

## 1.22.2 — 2026-10-07

Fixed (#66): hosted-account setup requires explicit `--name <alias>` with
`--username` and passes it to native `aw init --new-account`. Missing/invalid
names refuse before bootstrap writes or CLI installation; no alias is derived
from a soul or ambient identity. Credential-bearing native failure output is
withheld. The first-account procedure and native-contract regressions cover
the required input; no live account creation is claimed.

## 1.22.1 — 2026-10-07

Compatibility note (#63): the general OATS >=0.30.0 floor remains for other
behavior. Explicit wider-team LOCAL join additionally needs the selected same
kernel's public `inspect --home` recorded soul provenance, then
`inspect --soul --dir --json` with live teams/current `oats.aweb` root settings,
and `OATS_TEAM_SCOPE` dispatch identifying the selected deployment. Missing or
invalid results refuse before invite minting; no ambient soul/settings workaround.
The pinned `bb2ba8c9` public fixture (OATS 0.42 source) is verified evidence, not
an earliest-release claim. Older homes need the fixed provider composition;
ordinary lifecycle retains captured settings.

Documentation: retain released remote deployment connect and explicit aw
installation procedures, including step/readback, failure and token-exposure
boundaries, in the provider act cards.

Documentation: add version-qualified provider act cards for LOCAL root setup,
controller/hosted team creation, labelled join and tokenless resume, invitations,
GLOBAL resident/custody/grant boundaries and receive verification. Preserve provider 1.22.0
Claude development default and explicit-approved distinctions. Current development
confirmation requires an authorized operator/human; automation is pending kernel
#708, release and qualification. Remove unreleased consent-setting guidance. Native aw 1.36.24
hosted creation is distinct from the unsupported provider wrapper; secret-bearing
JSON requires private capture. External-home invite/removal and doctor-local
forms remain unavailable, while supported acceptance/diagnostic categories are
named. Dashboard team and organization invitations remain distinct from agent
membership. Onboarding owns intake/completion and teams owns policy; one intake
covers routine steps. Setup-root fixes and the development default are qualified against released
1.22.0, without implying installation into older homes. No
#56 token-only, #58 registration or #60 GLOBAL wider-team procedure is advertised
as installed. No live rehearsal, release, install or vendored-skill edit.

Documentation: automated development-channel confirmation remains pending OATS
#708, release and qualification. Current operation requires an authorized
operator/human to handle confirmation; provider, broker and ordinary agents never
answer. Folder trust remains a separate authorization boundary, and mode selection
never grants consent. Source preparation is not installed automation or unattended
admission. Admission and native-receive warnings remain unchanged; issue #44
remains open for kernel, release and admission work.

## 1.22.0 — 2026-10-07

Documentation: superseded the unconditional never-answer development-channel
guidance with the bounded OATS #708 kernel launch-only exception. Only a compatible
kernel with explicit per-home consent and a qualified exact fixture may answer
during its own launch, at most once; provider, broker and ordinary agents never
answer. Folder-trust prompts block with a receipt and zero keys; trust is outside
this exception. Mode selection does not grant consent, and the kernel
result/durable receipt owns actual prompt
status. Old kernels need operator attention and unsupported opted-in fixtures
block. Admission warnings remain present and native-receive warnings are unchanged.
This is source-only
guidance, not unattended admission or release adoption; issue #44 remains open
for kernel, release and admission work.

- Setup creates new per-team roots under the kernel-selected deployment, not
  under the default minting root. Missing, contradictory or unreadable deployment
  facts refuse before creation; only the selected deployment's local file is
  updated. Recorded nested roots remain usable without copying, deleting or
  accepting another invite. Failed setup preserves pre-existing root directories
  and their contents; rollback removes only a newly created empty target.
  An operator may plan a separate move after assessing
  identity/workspace bindings and recovery; this release performs no migration
  and does not claim an unattended identity move is safe.
- Explicit wider-team join reads current `root`/`roots` through same-kernel public
  inspect, verifies the recorded home/soul/deployment and exact-team membership,
  and refuses unavailable or invalid authority before minting. Lifecycle hooks
  retain captured settings; GLOBAL join stays unsupported.
- Setup's missing-membership remedy now uses labelled `--join --invite-stdin`,
  retaining deployment/soul and required name/service inputs. Token-only setup
  is still refused; the future #56 envelope cutover is not installed.
- Correct the stale hosted-creation diagnostic: provider bare `--create` remains
  unsupported, while native aw 1.36.24 supports `id team create --hosted` (not
  aw 1.36.23). Native JSON contains a secret invite; capture it privately. The
  existing controller-owned `--namespace` route is unchanged.

Documentation: added the shipped existing-team GLOBAL resident journey, linked
from setup and resident guidance. It separates native fresh creation from reuse,
plain LOCAL setup and provider grants; documents authority/output/custody and
acceptance checkpoints, protected diagnostic requirements, stop rules and the
unchanged native partial-deletion/lost-response limits. This is procedure source
preparation, not an executable bootstrap/recovery fix, hosted-error diagnosis or
live acceptance. The native contract is linked at landed source revision
`4e477ad74dabf5a944898e9d6f3f6d169c7f5ff6`; its diagnostics and recovery/capture
characterization are distinguished from pinned aw 1.36.23 behavior and coverage.
Source landing does not establish a package release or installation.

Changed: superseded the unreleased approved-default selection with development
for new Claude/channel compositions (intended 1.22.0). Explicit `approved` remains
available through host-only `settings.oats.aweb.claudeChannelMode`. aweb-channel is
currently not on the default approved list; approved registers no aweb channel
unless applicable managed `allowedChannelPlugins` for this identity lists the
plugin and marketplace, or a future approval exists. Installation/trusted
marketplace is not approval. Development avoids that silent missing receiver but
never grants launch consent; nothing in the provider answers the confirmation.
A compatible kernel may answer it at launch under explicit per-home consent
recorded in the kernel's host-only configuration. No automatic fallback,
frozen-home migration or flip-back occurs; a
future default change requires an explicit reviewed release. Fixed plugin
arguments, Pi/Codex/session routing and captured-mode evidence rules are unchanged.
Unknown historical mode still warns; contradictory evidence still fails.
Manifest default-injection, host-only controls and warning tests cover the source
change. Release, version bump and pins remain separate; no release or unattended
admission is claimed. Issue #44 remains open; cjr adoption #673 is separate.

Fixed: target-scoped home receive readiness (issue #34 / aweb-abny). A compatible
daemon or joined stream registration alone no longer establishes a complete
captured receive plan. The check validates the canonical broker target, retained
identity set and policies, running worker, admitted `streaming` streams and
target/worker/binding errors. Joined failures remain problems alongside a native
primary. Missing required worker telemetry remains unavailable, including the
status shape at the unchanged aw 1.36.13 floor.

Changed: `ready` means the configured supported route and observable broker
prerequisites pass. This deliberately supersedes the earlier unreleased
recent-observation claim and 30-second status gate. Native connection uncertainty,
old observations, absent optional inspection evidence and inspection in progress
now warn; age alone does not make readiness unavailable. The 30-second threshold
only labels an age warning. Known failures, including prior stopped/error evidence
during a new inspection, and malformed or contradictory supplied status remain
problems. No recent endpoint/native connection, current-start, uninterrupted
liveness, prompt readiness, model consumption or actual presentation is certified.

Fixed: a retained `channel_core.last_error` alongside completed nonfailure
inspection evidence now warns with bounded text when no other failure or malformed
evidence exists. Released aw does not timestamp that error or clear it on every
status update. The warning reports unproven currency, not proof that inspection
followed or resolved the error. Input-success timestamps do not decide this;
without completed observation, or with row/readiness/binding/stream/pause/worker
failure, readiness remains unavailable.

Changed: genuine legacy absence of captured delivery/runtime uses the documented
settings-based prerequisite fallback with an explicit incomplete ownership/set
warning. Valid retained facts and known joined paths still receive their checks;
malformed, unreadable or contradictory records cannot use this fallback. Complete
captured plans remain strict. Existing configuration/authentication/custody error
precedence and null-home prerequisite checks are preserved.

Claude/Pi native routes and Codex's supported external broker route remain.
Development-channel confirmation guidance applies to captured development mode.
The readiness change preserves the public joined receive enum, binding envelope
and four statuses. No probes, home writes, version bump or release.

## 1.21.1

Added: the warning `channel-dev-confirmation` (awebai/oats-aweb#44). Under `delivery: channel` a Claude Code start loads the aweb-channel plugin with `--dangerously-load-development-channels`, because the plugin is not on Claude Code's approved channel list. Claude Code then stops at its "Loading development channels" confirmation before the session starts, and waits until someone answers it in the instance's terminal. Unattended starts (Desktop starts and restarts, automations, successors) waited there with nothing saying so. Now:
- every hook answer that adds the flag says so on its warning line, after any other warning: the launch hook's (preview and real pass alike) and the spawn hook's, whose launch arguments the spawn's own start uses. Each start says it once.
- readiness reports it as a warning (status unchanged) for a home whose last recorded start was Claude Code under `channel`. Without a recorded start the runtime is unknown and nothing is reported.

Nothing answers the confirmation on the human's behalf (aweb-abmy). `--channels` registers only plugins on Claude Code's approved list; for a plugin not on it, Claude Code prints a startup warning and the channel does not register. That list is Anthropic's default (the channel plugins in `claude-plugins-official`), or a Team/Enterprise organization's managed `allowedChannelPlugins`, which replaces the default and requires `channelsEnabled: true` (whether other plans honour it is unverified). Launch arguments and settings are unchanged.

## 1.21.0

Added: `oats aweb connect <server-id> [--install-aw] [--name <alias>] [--json]` (awebai/oats#517). Run from a local deployment, it gives the deployment of the same workspace on a registered server (`oats server connect`) membership in that deployment's default team. Steps, in order, with the kernel's step statuses (`ok`, `done`, `needs-human`, `skipped`, `failed`):
- `aw`: the host's `oats aweb setup --check-only --json` through the kernel's capability route (`--server <id>`), with `--install-aw` when given. It reports aw, the host's default team and whether the host's root for that team is a member.
- `invite`: a host that is already a member is `ok` and nothing is minted. Otherwise the invite is minted from this deployment's root for the team (`roots[team]`, else `root`) with `aw team invite --team-id <team>`. This deployment not being a member is `failed` (`E_TEAM_NOT_MEMBER`), with the remedy. A token that is not a hosted invite (`aw_inv_`) is dropped and `invite` is `needs-human` (`E_INVITE_NOT_HOSTED`): local-controller invites work only on the machine that minted them, and the remedy names the `aw id team request` / `add-member` / `fetch-cert` flow.
- `join`: the routed `oats aweb setup --join <label> --invite-stdin --name <alias> [--service <url>]`, the token on its stdin.
- `readiness`: a second routed `--check-only`, `ok` when aw meets the floor and the host's root is a member.

Every runnable command in a step's `remedy` (and in `--check-only`'s `aw.remedy`) is in backticks, so a client can find and copy it. The host root's alias is the server id, or `--name <alias>` when the id does not fit the aweb alias rule. Every routed call carries the `--soul` connect was dispatched with. `--json` answers `{schemaVersion: 1, ok: true, result: {server, team, ready, steps}}`, with `ok: true` even when steps need a human. A `failed` step ends the run with `ok: false`, `error.code` = that step's code and `error.details.steps` = the steps so far. connect spawns nothing and mints for the deployment's root, never for an instance.

Added: `oats aweb setup --join <label> --invite-stdin` reads the invite token from stdin (the first line, trimmed) and otherwise behaves exactly as `--invite <token>`. `--invite` with `--invite-stdin` is a usage error.

Added: `oats aweb setup --install-aw [--aw-version <v>]`. Where aw is missing or below the floor (aw >= 1.36.13), it runs `npm install -g @awebai/aw@<v>`, where `<v>` defaults to `^1.36.13`, the newest aw of the floor's release line. It then re-checks the floor and continues. npm's failure is relayed with its exit status (`E_AW_INSTALL`); an install that still leaves aw below the floor is `E_AW_FLOOR`. Without the flag, a missing or old aw gives the same message as before.

Added: `oats aweb setup --check-only --json [--install-aw]` answers one line of JSON, `{aw: {status, version?, detail?, remedy?, code?}, defaultTeam: {label, team} | null, member: true | false | null, root: <abs> | null}`. `member` is `null` when aw cannot be asked; `root` is the root setup mints from for the default team (`roots[team]`, else `root`) when it exists. It exits 1 only when an aw install failed.

Fixed: `oats aweb setup --join <label>` recovers a per-team root that a join interrupted after `aw workspace connect` but before `roots[<team id>]` was recorded. When the root's identity holds the expected team's membership it records the root as it is, where before it refused, so a retried `connect` failed forever. A connected root that holds another team is still refused.

Security: the invite token travels only in memory and on the routed command's stdin. It never appears in oats argv, a file, a log, a result or an error, and a failed join leaves it nowhere. On the host, `aw id team accept-invite <token>` still takes the token as an argument, as `--invite` always has, so it is visible in the host's process list for the accept call's duration. The invite's lifetime and use count are aw's: aw 1.36.23 has no expiry or single-use flag for `aw team invite`.

## 1.20.0

Fixed: `oats aweb roster` missed the team's coordinator and did not say what each entry was (awebai/oats-aweb#46). It printed only the certificate listing (`aw id team members`). That listing omits identities whose membership the registry does not list, such as the retained global coordinator of aweb:juan.aweb.ai and dashboard humans. It also lists deployment roots and certificates with no workspace exactly like agents. Readers who took it as "who you can reach" contacted a deployment root.

Changed: the roster is the union of the team's membership certificates and its workspace presence (`aw workspace status --limit=200 --json`), both read from the minting root and never as the caller's identity. There is one entry per alias, and no entry is dropped for being offline. Each entry gives:
- its sources (`certificate`, `presence` or both);
- its status: `active`, `offline` (shown as `seen <when>`), or, for a certificate with no workspace, `no-workspace-record`, which becomes `presence-unknown` when presence is incomplete;
- its kind. `global identity` comes from the identity scope and is listed first, with its address when known. `human` and `hosted agent` are inferred from the session context; `instance` and `deployment root` (a per-team root `.aweb-roots/<label>/.aw`, or a root this deployment configures) from the workspace path. An inferred kind says so (`instance (from its workspace path)`). Anything else is `unknown`.

Nothing is labelled retired or historical: a certificate without a workspace record is stated as just that. The output says aw does not mark the team's coordinator (a workspace's role is its own setting) and that `aw workspace status` is the presence view.

Changed: when either source cannot be read, or presence reaches its 200-workspace cap (`team_has_more`, or 200 rows), the roster still lists what it has. It then prints `Incomplete: <source>: <why>.`, and `--json` reports `certificatesComplete` / `presenceComplete: false` with the reason in `problems`. A certificate failure no longer aborts the roster.

Changed (contract): `oats aweb roster --json` is an oats.aweb document, no longer aw's raw certificate listing: `{team, members: [{alias, kind, kindFrom, identityScope, address, role, status, sources, presence: {status, hostname, lastSeen} | null}], certificatesComplete, presenceComplete, problems: [{source, message}]}`. Nothing in OATS or the Desktop read the old shape.

Changed: the spawn brief, the inject and the oats-aweb skill say what the roster shows and what it can't tell you: who coordinates, whether an entry is retired, and the whole team when it prints `Incomplete:`. The skill no longer says every reachable name is on the roster: aw resolves names through its service, so a name can resolve without being listed.

Fixed: a large roster piped to a reader lost its tail at 64 KiB: it is now written synchronously. Also fixed: aw output parsing could take an indented object inside cut-off output for the answer. It now reads a top-level object (one opening at column 0) even when aw appends notes after it.

Fixed (tests): the real-aw admission table accepts aw's identity-home-aware `id team members` (aw 1.36.23 admits it), awebai/oats-aweb#39.

## 1.19.0

Added: team model 3 (OATS 0.38, awebai/oats#484). `OATS_DEFAULT_TEAM_FROM: workspace` (the workspace's fallback default team) is reported as `from: "workspace"` in `oats aweb teams --json` and the recorded meta, where it was mapped to `deployment`, and the spawn brief calls it the workspace's default team.

Changed: `oats aweb setup --create <label> --namespace <domain>` asks the kernel whether the workspace allows local teams (`oats teams --json`, `localTeams`) before it creates anything. Where it does not (team model 3 without `localTeams: true` in `oats-workspace.yaml`), `oats teams add` would be refused after the aweb team was created, so setup creates the team and its per-team root as before, records `roots[<team id>]`, records no local team, and prints what to commit: the `teams:` entry, `defaultTeam:` when the workspace has no default team, that souls join it only when a `souls:` entry lists it, and the `localTeams: true` alternative. If the kernel cannot answer, setup refuses before creating anything. A kernel without `localTeams` (OATS 0.36) behaves as before. `--username` and the setup verdicts give the same advice in place of `oats teams add|default` where local teams are closed.

Changed: the unmapped-default remedy (readiness, spawn, setup) reads ``…or choose another default: `oats teams default <label>`, or `defaultTeam:` in oats-workspace.yaml when the workspace doesn't allow local teams``.

Note: joining stays limited to the kernel's eligible rows (`OATS_TEAMS`); under team model 3 a workspace team that the soul's `souls:` entry does not list is refused with `E_TEAM_NOT_ELIGIBLE`, now covered by a test.

## 1.18.1

Fixed: the launch hook changed things when the kernel ran it for a preview (`oats launch-config preview`, used by Desktop's start dialog, and from OATS 0.37.0 the first pass of every start; awebai/oats#500). Previewing a running Claude home as Codex registered it with the host wake broker, which then typed into the live Claude pane (aweb-abmy), and previewing a running Codex home as Claude deregistered it. Under `OATS_LAUNCH_PREVIEW=1` the hook now makes no `aw` call: no `aw wake register`, `deregister` or status confirmation, no grant renewal, no joined-team leave or re-registration, and it returns no `meta`. It returns the env and launch arguments the real start returns, and refuses an invalid `identity.renew` as the real start does. Without the variable, behaviour is as in 1.18.0.

Added: the manifest declares `"launchPreview": true` (awebai/oats#504), so a kernel that supports it runs the launch hook as a preview during preflight and for real after it, and runs it for `oats launch-config preview`. Older kernels ignore the key and run the hook once per start, as before. `schemas/capability-manifest.schema.json` is revendored from the kernel.

Added: with `identity.mode: global` and `renew: launch`, the preview returns the current grant home as `AWEB_IDENTITY_HOME` and lists it in `volatileEnv`, since the renewed grant home exists only once the real pass has minted it (awebai/oats#504). The real pass renews as before: a fresh grant home, or the previous grant kept with a warning when renewal fails.

Note: the channel path's guard (`aw wake deregister`, then `aw wake status --json` no longer listing the home) confirms that the home is deregistered, not that terminal input has finished: aw removes the home from the broker's map before its runner stops (aweb-abna).

## 1.18.0

Changed: under `delivery: channel` (the default) the delivery path follows the runtime. Claude Code takes mail through the `aweb-channel` plugin and pi through the `@awebai/pi` extension, which push into the session; Codex and any other runtime without an aweb channel now go through the host wake broker (`aw wake register`, `AWEB_DELIVERY=session`, the session-delivery brief), where before a Codex home under `channel` got no wake at all. The broker types into the terminal pane, and in Claude Code that keystroke could answer a dialog on the human's behalf (aweb-abmy), so the broker is kept for the runtimes with no channel. `delivery: session` is unchanged: every runtime goes through the broker.

Changed: every start re-decides the path from the delivery setting (which now wins over the recorded meta) and the start's runtime, and leaves the home on exactly one path. The broker path registers the home. The channel path runs `aw wake deregister` and then requires `aw wake status --json` to no longer list the home, since `aw wake deregister` can exit 0 on a fallback before the daemon has stopped presenting. If either step fails the start is refused. The launch hook now returns `meta` recording the start's `delivery` and `runtime`, and retire deregisters a home whose last start was on the broker path.

Changed: readiness requires the host wake daemon (`wake-daemon-not-running`, `wake-daemon-outdated`, `wake-daemon-version-unknown`) for every home the broker delivers to, a Codex home under `channel` included, judged from the home's own record: its recorded delivery and the runtime of its last start, never the runtime of whoever runs the check. Without a record, only `delivery: session` relies on the daemon, as before.

Fixed: the provider read a home's runtime from an `instance.json` field the kernel does not write; it now reads its own recorded runtime, else the kernel's launched harness.

Changed: the spawn brief names the path for the spawn runtime: the session-delivery note for the broker, and `Notification delivery: the aweb channel plugin …` or `… the aweb pi extension (@awebai/pi) …` for the channels. The inject and the oats-aweb skill state the per-runtime rule, so a session restarted under another runtime can tell which path applies.

Changed: the channel-package requirements (`aweb-channel` for Claude, `@awebai/pi` for pi, under `delivery: channel`) name their install commands. The kernel already checks them for the target runtime at spawn and at every start, so a Claude or pi home whose channel package is missing is refused with the install steps instead of launching a session that hears nothing. Codex has no such requirement: it takes the broker path.

Note: existing homes keep the delivery they were spawned with. The kernel runs a home's hooks from its own module copy under the settings captured at spawn, so switching a deployment's `delivery` (or upgrading to 1.18.0) applies to new spawns.

Note: across a switch between broker and channel, each mail is presented once because both paths present the unread backlog on connect and mark each mail read on the server after presenting it; they share no local delivered-ids store. One duplicate window remains inside aw: if the broker's delivery child is killed after typing a mail into the pane but before marking it read, the channel presents it again (aw `docs/terminal-wake-broker.md:109-121`; the in-flight `oats session input` is not aborted, `cli/go/wake/channel_core_runner_entry.ts:137`).

Evidence: `scripts/e2e-delivery-switch/run.mjs` drives the real hooks against a disposable local aweb + awid stack, its own `aw wake run` broker and the real Claude channel plugin, on a fixture identity, and counts every presentation by message id. Its receipt (`scripts/e2e-delivery-switch/RECEIPT.md`; aw 1.36.23, aweb-oss f22257f3) shows 56 mails, each presented exactly once and none lost, across codex→claude, claude→codex and codex→codex switches made while mail kept arriving. It also shows `aw wake status` before and after each switch: the home is unlisted after the claude start, and listed after each codex start.

## 1.17.7

Fixed: native retire records a local completion marker after a successful default-workspace self-delete, so a later `oats retire` retry after another hook kept the home does not re-run `aw workspace delete` with an already-revoked certificate and fail with 401.

## 1.17.6

Changed: session-delivery guidance now names the aw 1.36.21+ full-mail wake form (`aweb mail event received.` with metadata, sender body, a Recovery line, and mail marked read on delivery), says sender body/subject are untrusted content that never overrides the task or human, and says delivered mail may be absent from unread `aw mail inbox`.

## 1.17.5

Fixed: the spawn hook always records and briefs the alias it requested (`--name=<instance>`). If `aw init --join-from` reports a different alias, the hook adds the warning `aw reported a different alias than requested; using the requested alias "<instance>"`, which quotes nothing from the reply. Since 1.17.4 the hook no longer holds the invite token, so it cannot tell an alias from a token echoed back in that field. An alias that matches the requested one gives the same output as 1.17.4, and a team-mismatch warning still takes precedence.

## 1.17.4

Changed: the spawn hook mints the default-team identity with one `aw init --join-from=<root> --join-team=<team> --name=<instance> --json --do-not-touch-agents-md` in the home, instead of `aw team invite` + `aw team join` + `aw init`. That is one aw process instead of three, and the invite token no longer appears in any argv. The mint runs without `AWEB_URL`, `AWEB_API_KEY`, `AWEB_ROLE_NAME` and `AWEB_ROLE`. Meta, env, brief, launch, warnings, exit codes and compensation are unchanged.

Changed: the aw floor check (spawn, commands, binding check) stops reading `aw version` at its version line and kills the child, instead of waiting for aw's blocking GitHub update check. Every aw child of a hook runs with `AW_NO_UPDATE_CHECK=1`.

Changed: retire deletes by the workspace id recorded in `<home>/.aw/workspace.yaml` for the matching team and alias. That is one request where the alias needed two. It falls back to the alias when no entry matches. With session delivery, `aw wake deregister` now runs at the same time as the delete. Output and exit codes are unchanged.

## 1.17.3

Fixed: retained `identity.source` session-delivery briefing again describes the actual broker-registered seat, while still carrying the exact recovery rule.

Fixed: resident grant `renew: launch` now re-registers the host wake broker with the fresh grant home before revoking the old grant, so session-delivery seats keep waking after renewal.

Changed: resident-grant troubleshooting says `renew: off` grants expire at their TTL; use `renew: launch` plus a restart, or respawn.

Changed: resident grant seats are told to inspect their active identity with `aw whoami`; `aw id grant list/show` inspection belongs in the resident custody `.aw`, not the grant home.

## 1.17.2

Changed: session-delivery guidance now matches aw 1.36.15+ host wake broker presentation. The broker may present either a waiting-items line or the full mail/chat event; recovery after uncertain crashes or compactions uses exact message ids (`aw mail show --message-id <id> --json`) or paginated `aw mail inbox --show-all --json` with `--cursor`, not read state or `--conversation-id`.

## 1.17.1

Fixed: joined-team accepts now explicitly run `aw workspace connect`, verify the workspace connection was written, and fail/clean up instead of recording an unusable joined identity when connect fails.

Fixed: `oats aweb setup`, `teams`, `join`, `leave`, and `roster` consume the kernel-forwarded `--soul <name>` dispatch flag, so deployment-scoped commands work on OATS 0.30 without the provider treating `--soul` as a label.

Fixed: launch reconciliation now appends an `aweb-team-leave-failed` instance event when a lost joined team cannot be left (for example BYOT `team_not_hosted` refusal), while keeping the still-member identity recorded as joined.

## 1.16.1

Fixed: setup creates the account on aw 1.36.13 by passing `--new-account` on the `oats aweb setup --username <u>` path.

Changed: requires aw >= 1.36.13, with a single floor and older-aw branches removed. The wake-daemon floor moves from 1.36.5 to 1.36.13; restart the daemon on aw 1.36.13.

Removed: `helperInjection`.

## 1.16.0

Changed (breaking wire names): personal → default team; E_TEAM_PERSONAL → E_TEAM_DEFAULT; teams JSON field personal → defaultTeam; receive label personal → default; roots.personal removed.

## 1.15.0

In:

- Live receive for joined teams through the host wake broker's multi-identity
  registration (`aw wake register --registration-json -`, aw >= 1.36.13):
  session homes register the primary plus every joined identity home; Claude
  and Pi channel homes use aw's mixed mode (`native-channel` / `native-pi`);
  Codex keeps polling. Readiness reports each joined team's actual mode
  (`joined-team-receive` / `joined-team-poll-only` with the reason).
- The `AWEB_IDENTITY_HOME` scrub: provider commands and nested spawns/retires
  no longer inherit the caller's identity home (it made aw refuse cwd-rooted
  commands and, on retire, delete the caller's workspace).
- Partial multi-label join/leave records every completed label; a failed spawn
  hands joined teams to compensation; `oats aweb join` refuses resident-grant
  homes (`E_TEAM_GLOBAL_MODE`).
- The `oats-aweb` agent playbook skill; a shorter inject pointing to it; the
  `aw chat send --to` crib fixed; `oats aweb roster --label <label>`.

Deferred to 1.16:

- Per-workspace personal-team enrollment (`aw team ensure` from the host's
  `aw auth` login). The login does not name its account, so enrollment could
  land in the wrong person's account. 1.15 makes no `aw auth` or `aw team
  ensure` call; the primary team resolves as in 1.14.2; a host-set
  `settings.oats.aweb.roots.personal` is ignored with the warning
  `personal-root-deferred`.
