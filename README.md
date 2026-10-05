# oats-aweb

Official [OATS](https://github.com/awebai/oats) messaging-layer integration for
[aweb](https://aweb.ai). It provides per-instance native identities, mail/chat
skills, team roster discovery and session/channel delivery integration. Messaging
is separate from durable task tracking; the selected tasks provider owns tasks.

## 1.21.0 — connect a deployment on another machine

After `oats server connect` has created the workspace's deployment on another
machine, one command from the local deployment gives that deployment messaging:

```bash
oats aweb connect <server-id> --soul <any soul with messaging> [--install-aw] [--name <alias>] [--json]
```

It runs the host's steps through the kernel's capability route
(`oats aweb … --server <id>`, OATS feature `capability-route`). The steps are:

| Step | What it does |
|---|---|
| `aw` | `oats aweb setup --check-only --json [--install-aw]` on the host: aw, its default team, membership |
| `invite` | `ok` if the host is already a member (nothing minted); else `aw team invite --team-id <team>` from THIS deployment's root for the team |
| `join` | `oats aweb setup --join <label> --invite-stdin --name <alias> [--service <url>]` on the host, the token on stdin |
| `readiness` | a second `--check-only` on the host: `ok` when aw meets the floor and its root is a member |

Statuses are `ok`, `done`, `needs-human` (with `remedy`), `skipped` (`detail`
names the step it waits for) and `failed` (`code`, `detail`). Every runnable
command in a `remedy` is in backticks. With `--json`
the answer is `{schemaVersion: 1, ok: true, result: {server, team: {label,
team}, ready, steps}}`. A `failed` step ends the run with `ok: false`,
`error.code` = that step's code and `error.details.steps` = the steps so far.
Failures: `E_TEAM_NOT_MEMBER` (this deployment cannot invite to the host's
team: join it here first), a kernel route code such as `E_SSH`,
`E_INVITE_FAILED`, `E_JOIN_FAILED`, and the host's `E_AW_INSTALL` /
`E_AW_FLOOR`. A team that is not hosted (a local-controller BYOT team) is
`needs-human` (`E_INVITE_NOT_HOSTED`), because its invites only work on the
machine that minted them. The host root's alias is the server id, or `--name`
when the id is not a valid aweb alias. connect spawns nothing: it mints for the
deployment's root, never for an instance.

The join half works on its own when someone else mints the invite:

- `oats aweb setup --join <label> --invite-stdin` reads the token from stdin
  (the first line, trimmed) and behaves exactly as `--invite <token>`. The two
  flags cannot be combined.
- `oats aweb setup --install-aw [--aw-version <v>]` runs
  `npm install -g @awebai/aw@<v>` (default `^<aw floor>`, today `^1.36.13`)
  where aw is missing or below the floor, re-checks the floor, then continues.
- `oats aweb setup --check-only --json` answers, as one line:

```json
{"aw": {"status": "ok", "version": "1.36.23"},
 "defaultTeam": {"label": "aweb", "team": "aweb:juan.aweb.ai"},
 "member": true, "root": "/Users/juanre/Agents/aweb/.aweb-roots/aweb"}
```

  `aw.status` is `ok`, `done` (installed now: `detail` says from what),
  `needs-human` (`detail`, `remedy`) or `failed` (`code`, `detail`; exit 1).
  `member` is `null` when aw cannot be asked, and `root` is the root that mints
  for the default team (`roots[team]`, else `root`) when one exists.

**The invite token** exists only in connect's memory and on the routed join's
stdin. It never appears in oats argv, a file, a log, the result or an error
message, and a failed join leaves it nowhere. On the host, `aw id team
accept-invite` takes it as an argument, so it is visible in the host's
process list for the accept call's duration. Its lifetime and use count are aw's: aw
has no expiry or single-use flag for invites yet.

## 1.20.0 — a roster that says what each entry is

`oats aweb roster` lists the union of the team's membership certificates
(`aw id team members`) and its workspaces (`aw workspace status`, the presence
view), one entry per alias, each with its sources, status and kind:

```text
aweb team aweb:juan.aweb.ai — 9 entries (membership certificates and workspaces):
  aweb — global identity, active, antares, juan.aweb.ai/aweb [presence]
  juan-reyero — human (from its session context), seen 2d ago [presence]
  oats-expert-juan — instance (from its workspace path), active, antares [certificate, presence]
  altair-aweb — deployment root (from its workspace path), seen 3h ago, altair [certificate, presence]
  cli-dev-review-servers — unknown, certificate only: no workspace record [certificate]
```

- Kinds: `global identity` (from the identity scope, listed first),
  `human` / `hosted agent` (from the session context), `instance` /
  `deployment root` (from the workspace path), else `unknown`. Inferred kinds
  say so. Nothing is called retired: a certificate with no workspace record is
  reported as that.
- aw does not mark the team's coordinator; the roster says so and points at
  the global identities.
- If a source cannot be read, or presence is past its 200-workspace cap, the
  roster lists what it has and prints `Incomplete: <source>: <why>.`
- `--json`: `{team, members: [{alias, kind, kindFrom, identityScope, address,
  role, status, sources, presence}], certificatesComplete, presenceComplete,
  problems}`. Status is `active`, `offline`, `no-workspace-record` or
  `presence-unknown`.

## 1.19.0 — team model 3

Works with OATS 0.36 (team model v2) and OATS 0.38 (team model 3, where the
workspace commits the teams a soul may join and its default, and
`oats-local.yaml` may declare teams only when `oats-workspace.yaml` says
`localTeams: true`).

- `OATS_DEFAULT_TEAM_FROM` may be `workspace` (the workspace's fallback
  default); it is reported as itself in `defaultTeam.from` and named in the
  spawn brief.
- `oats aweb setup --create` asks the kernel (`oats teams --json`,
  `localTeams`) before creating anything. Where local teams are closed it
  creates the aweb team and its per-team root, records no local team, and
  prints what to commit in `oats-workspace.yaml`. `--username` and the setup
  verdicts give the same advice there instead of `oats teams add|default`.
- The unmapped-default remedy names both ways to choose another default.

## 1.17.7 — team model v2 provider

Requires OATS >=0.30.0 and aw >= 1.36.13. This is the provider side of OATS
team model v2 (kernel 0.30): the kernel supplies the default team and eligible
teams, and oats.aweb never reads a provider `team` setting or the root's active
team as a fallback.

### Fixed

- Native retire writes a local completion marker after the default workspace is
  self-deleted, so a later retire retry after another hook kept the home does
  not call `aw workspace delete` again with an already-revoked certificate.

### Changed (breaking)

- Removed `settings.oats.aweb.team` and legacy `OATS_TEAM_ID` /
  `OATS_TEAM_LABEL(S)` semantics.
- The default comes from `OATS_DEFAULT_TEAM` (label), `OATS_DEFAULT_TEAM_ID`
  (provider id) and `OATS_DEFAULT_TEAM_FROM` (`deployment`, `soul`, or, from
  OATS 0.38, `workspace`).
- `OATS_TEAMS` rows are exactly `{ label, team, default, from }`; eligible join
  targets are rows with `default: false`.
- The teams JSON field `defaultTeam` is `{ label, team, from } | null`; `oats aweb teams --json` emits it with
  `eligible`, `joined`, `left`, and `at`. `left[]` records visible live-read
  leaves (`reason: "no-longer-eligible"`, last 20).
- No default configured refuses readiness/spawn with
  `no teams configured: run \`oats aweb setup\``. An unmapped default has label
  + from but no id and refuses with
  ``the default team <label> has no provider id yet: its owner runs oats aweb setup, then commits the id, or choose another default: `oats teams default <label>`, or `defaultTeam:` in oats-workspace.yaml when the workspace doesn't allow local teams``.

Wider teams are still joined explicitly with `settings.oats.aweb.join` at spawn
or `oats aweb join` while live.

### Provider settings

Host-owned settings live under `settings.oats.aweb` (normally in
`oats-local.yaml`). The provider settings are:

- `delivery`: `channel` (default) or `session`. It picks the delivery path per
  runtime:

  | runtime | `channel` | `session` |
  |---|---|---|
  | Claude Code | the `aweb-channel` plugin (launch flag) | host wake broker |
  | pi | the `@awebai/pi` extension | host wake broker |
  | Codex, or any runtime without an aweb channel | host wake broker | host wake broker |

  The channel packages push events into the session. The host wake broker
  presents them by typing into the session's terminal pane, and in Claude Code
  that keystroke can answer a dialog on the human's behalf (aweb-abmy), so a
  runtime with a channel uses it by default and the broker covers only the
  runtimes that have none. The broker path sets `AWEB_DELIVERY=session` (which
  also keeps any ambient channel package silent) and registers the home with
  `aw wake register`.

  Claude Code loads the plugin with
  `--dangerously-load-development-channels plugin:aweb-channel@awebai-marketplace`,
  because `aweb-channel` is not on Claude Code's approved channel list. Claude
  Code's `--channels` registers only plugins on that list; a plugin that is not
  on it gets a startup warning and its channel does not register. The list is
  Anthropic's default (the channel plugins in `claude-plugins-official`), or,
  in a Team/Enterprise organization, the managed `allowedChannelPlugins`, which
  replaces the default and requires `channelsEnabled: true` (whether other plans
  honour it is unverified). The development flag makes Claude Code stop at a
  "Loading development channels" confirmation before every session it starts,
  until someone answers it in the instance's terminal; nothing answers it for
  them. So every hook answer that adds the flag (the launch hook's, and the spawn
  hook's for the start a spawn performs) carries the warning
  `channel-dev-confirmation`, and readiness reports it for a home whose last
  start was Claude Code under `channel`.

  A home is on exactly one path. Every start decides the path afresh from the
  setting and the start's runtime (a home can be restarted under another
  harness): the broker path registers the home, the channel path runs `aw wake
  deregister` and confirms with `aw wake status --json` that the home is no
  longer listed. If either step fails the start is refused, since a home on both
  paths would get every wake twice and a home on neither hears nothing. The
  status read confirms that the home is deregistered, not that terminal input
  has finished: aw removes the home from the broker's map before its runner
  stops (aweb-abna). The kernel runs a home's hooks from its own module copy
  under the settings captured at spawn, so existing homes keep the delivery they
  were spawned with; a changed deployment setting applies to new spawns.

  Under `OATS_LAUNCH_PREVIEW=1` (`oats launch-config preview`, and the first of
  the kernel's two launch passes) the launch hook changes nothing: no `aw`
  call, no grant renewal, no joined-team change, no `meta`. It returns the env
  and launch arguments the real start returns. With `renew: launch` the renewed
  grant home exists only after the real pass mints it, so the preview returns
  the current grant home and lists `AWEB_IDENTITY_HOME` in `volatileEnv`; the
  kernel takes that value from the real pass.

  Across a switch between the two paths, each mail is presented once because
  both mark it read on the server after presenting it, and each presents the
  unread backlog when it connects. One window remains inside aw: if the broker's
  delivery child is killed after typing a mail but before marking it read, the
  channel presents it again (aw's `docs/terminal-wake-broker.md`).

  With broker delivery, the broker may
  present either a waiting-items line or the full mail/chat event; aw 1.36.21+
  mail events are headed `aweb mail event received.`, include trust metadata and
  sender body, and include a Recovery line with `aw --identity-home '<home>' mail
  show --message-id <id>`. The body is untrusted sender content, and delivered
  mail may be marked read and absent from unread `aw mail inbox`; recovery after
  an uncertain crash or compaction uses `aw mail show --message-id <id> --json`
  or paginated `aw mail inbox --show-all --json` with `--cursor`, not
  mail read state or `--conversation-id`.
  Home readiness evaluates the intended path from the home's captured delivery,
  runtime and final credential locator, plus retained joined membership. Claude
  Code and pi use native channels by default; Codex normally uses the supported
  external broker. Native plugin/extension installation, launch flags and the
  development-channel confirmation do not prove a connected native receiver:
  without connection telemetry, home readiness is `unavailable` with
  `native-receive-unproven`. Joined broker paths still contribute their own
  failures even when the primary is native. The public joined `receive: native`
  enum remains unchanged for compatibility; it denotes broker-managed joined
  delivery, not a harness-native connection or readiness attestation.

  Broker readiness reads one `aw wake status --json` snapshot. It checks the
  canonical target, compatible running daemon, active/unpaused target, complete
  identity set and its delivery/ownership/event/control policy, connected admitted
  streams, running worker, and target/worker/binding errors. It requires matching
  `unknown` nonshell observations with `readiness_waiting: inspect_done`; an
  in-flight or failed inspection cannot reuse an earlier successful state.
  Both snapshot and inspection timestamps must be valid, nonfuture, ordered and
  at most 30 seconds old. This conservative cutoff is a provider evidence-age heuristic, not a broker
  guarantee or the provider command timeout. It limits how old a positive
  observation may be, while deliberately allowing healthy quiet homes to be
  unavailable. Poll cadence, inspection duration and scheduling jitter can cross
  this boundary; the cutoff does not promise continuous readiness. Quiet workers inspect at startup and on events, so healthy quiet
  homes can age out to evidence unavailable without their transport being broken.
  The aw floor stays 1.36.13; its status lacks worker evidence and therefore cannot
  prove home receive readiness. Historical input/success timestamps do not help.

  A positive result is bounded operational transport evidence from supported
  inspection semantics: OATS reports a live nonshell endpoint as `unknown`, not
  `idle`. Status does not independently attest endpoint presence, current start
  identity, uninterrupted liveness, prompt readiness, model consumption or actual
  presentation. Readiness does not refresh the broker, send input, register,
  resume or modify the home. A soul check with no home remains prerequisite-only.
  Existing configuration/authentication failures retain their status; uncertain
  runtime receive evidence yields `unavailable` with a provider problem.

  Valid `.oats-aweb/teams.json` is authoritative over launch metadata because
  later join/leave commands update it. Missing or malformed local membership
  state is unavailable. Global grant/retained-root spawn paths may omit this file
  only when recorded provenance consistently establishes an empty joined set.
  Grant readiness uses the final recorded `identity.grant.home`, never the newest
  directory or the caller's `AWEB_IDENTITY_HOME`.

- `root`: absolute directory whose `.aw` is the default team's minting root.
  This root is for one aweb team only.
- `roots`: map `{ <team id>: <absolute directory> }`. `roots[team]` wins over
  `root` and is required when a deployment mints into more than one aweb team.
  Each mapped directory owns its own `.aw` identity for exactly that team.
- `residents`: map of resident name to absolute custody directory for
  `identity.mode: global`; host-only because it points at custody material.
- `join`: comma-separated eligible labels to join at spawn.
- `identity`: local by default; `global` uses a named resident grant.

There is deliberately **no** `settings.oats.aweb.team` in 1.17. Team selection
belongs to the OATS team model (`oats teams`, `oats soul teams`) and reaches the
provider as `OATS_DEFAULT_TEAM*` and `OATS_TEAMS`. If a `team` setting is present
at any layer, oats.aweb refuses it instead of treating provider payloads as team
configuration.

### One root per team

A local aweb root holds one local identity and therefore one team membership.
Accepting a second local team into the same `.aw` would overwrite
`identity.yaml` and is refused by aw. For every created or joined non-default
team, setup creates a real per-team root such as
`<deployment>/.aweb-roots/<label>`, accepts the invite into
`<root>/.aw`, connects the workspace, and records
`settings.oats.aweb.roots[<team id>] = <root>` in `oats-local.yaml`. Minting for
team `T` uses `roots[T]` when present, otherwise `root`.

### Setup acts

`oats aweb setup` is the only onboarding path; spawn/mint/retire never onboard.
From a deployment directory (outside an instance home), dispatch setup through any
soul that uses the messaging provider, for example `oats aweb setup --soul <any soul with messaging>`; the provider consumes the kernel-forwarded `--soul` flag and does not use it as team policy.
Supported acts:

- `oats aweb setup --username <u>`: for a missing hosted root, runs
  `aw init --new-account --username <u>` and reports the created default team.
- `AWEB_API_KEY=<key> oats aweb setup`: runs `aw init` for the hosted team behind
  the API key; the key is never printed.
- `oats aweb setup --create <label> --namespace <domain>`: owner/admin act for
  a customer-controlled namespace. It normalizes `<label>` to aweb's team-name
  rule, runs `aw id team create --name <normalized> --namespace <domain>`,
  requires the returned `team_id` and invite token, accepts the invite into a
  new per-team root, records `roots[<team id>]`, then records the local mapping
  with `OATS_CLI_BIN teams add <label> --team <id>`. Without `--namespace`,
  setup refuses hosted additional-team creation until the hosted-team aweb
  release exists. Before creating anything it reads `OATS_CLI_BIN teams --json`:
  where `localTeams` is `false` (team model 3: the workspace does not allow
  local teams), it records no local mapping and prints the `teams:` entry, and
  `defaultTeam:` when the workspace has none, to commit in
  `oats-workspace.yaml`, how to let souls join it (a `souls:` entry's teams),
  and the `localTeams: true` alternative. A kernel without `localTeams` (OATS
  0.36) takes the local mapping. If the kernel cannot answer, setup refuses
  before creating anything.
- `oats aweb setup --join <label> --invite <token>`: accepts an existing/shared
  team's invite into a new per-team root and records `roots[<team id>]`. It
  never accepts into the existing default root.
- Owner-creates-shared flow: when a committed/shared team has no provider id,
  its owner explicitly runs `oats aweb setup --create <label> --namespace
  <domain>`. Setup creates the provider team, accepts it into a per-team root,
  records the root locally, and prints the id to commit. Plain `oats aweb setup`
  does not create shared teams; it asks for the owner-provided id or invite.

For a committed/shared team whose provider id exists but whose root is not a
member, setup/readiness tells the operator it is shared: ask the owner for an
invite, then run `oats aweb setup --join <label> --invite <token>` (or use
`--create` if this host is the owner creating it). When a joined team is removed
from the live team set, hosted teams are left automatically; on a namespace team
you control (BYOT), a failed leave is reported as an instance event and the team
owner removes the member.

### Readiness messages

- No default configured: `no teams configured: run \`oats aweb setup\``.
- Unmapped default (label/from set, provider id absent):
  ``the default team <label> has no provider id yet: its owner runs oats aweb setup, then commits the id, or choose another default: `oats teams default <label>`, or `defaultTeam:` in oats-workspace.yaml when the workspace doesn't allow local teams``.
- Shared team root missing or not a member: the remedy names the team/root and
  tells the operator to run setup, create it, or ask the owner for an invite.

### aw floor

All 1.17 paths require `aw >= 1.36.13`. Older or unreadable `aw` is a readiness
problem and a required spawn-hook failure. The floor is read from the first line
of `aw version`; the reader stops there instead of waiting for aw's update
check. Every aw command a hook runs has `AW_NO_UPDATE_CHECK=1`.

### What spawn and retire run

A local spawn mints the default-team identity with one command in the instance
home: `aw init --join-from=<root> --join-team=<team> --name=<instance> --json
--do-not-touch-agents-md`. aw creates the invite from the root, accepts it and
connects the workspace, so the invite token never reaches the hook. The mint
runs without `AWEB_URL`, `AWEB_API_KEY`, `AWEB_ROLE_NAME`, `AWEB_ROLE` or
`AWEB_IDENTITY_HOME`, so the service comes from the invite. On the broker
delivery path the hook then runs `aw wake register`. The recorded alias is always
the requested one: if aw reports another, the hook keeps the instance name and
adds a warning that quotes nothing from aw's reply. Joined teams still use
invite + `aw id team accept-invite` under `--identity-home`.

Retire self-deletes with `aw workspace delete <workspace_id>`, taking the id
from the membership in `<home>/.aw/workspace.yaml` whose team and alias match
the recorded ones. It falls back to the alias when no entry matches. For a home
whose last start was on the broker path, `aw wake deregister` runs at the same
time as the delete.
