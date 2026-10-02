# Changelog

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
