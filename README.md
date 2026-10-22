# oats-aweb

Official [OATS](https://github.com/awebai/oats) messaging and tasks integrations for
[aweb](https://aweb.ai). It provides per-instance native identities, mail/chat
skills, team roster discovery and session/channel delivery integration. Messaging
is separate from durable task tracking; the selected tasks provider owns tasks.

## 1.32.0 — upgrade a stopped seat

Requires OATS >=0.68.0; the aw floor stays >=1.36.33. Upgrade the kernel
first, then select and sync the package version in the workspace.

A stopped seat moves to the locked package with `oats instance upgrade`:
stop it, inspect `oats instance upgrade <instance> --plan`, then apply with
the returned plan revision and an idempotency key. Start it again with
`oats session start`. Upgrade preserves the identity, grant, seat and joined
teams. It makes no `aw` calls: the next start re-registers the wake broker
and renews grants according to the seat's settings. With `identity.renew: off`,
that start keeps the existing grant and its expiry.

The hook adopts metadata from local, global grant and retained seats,
including 1.17.1. Plan is read-only; apply refreshes only delivery from settings
and runtime from the home's recorded `instance.json` harness. An unreadable or
unsupported harness keeps the recorded runtime and warns. Recorded
`claudeChannelMode` stays unchanged until a launch can prove it. A plan that
cannot recognize the metadata names the respawn remedy.

## Tasks

One `oats.aweb` package release supplies two independently selected capabilities:

| Capability | Slot | Responsibility |
| --- | --- | --- |
| `oats.aweb` | messaging | identities, mail/chat, roster and receive delivery |
| `oats.aweb-tasks` | tasks | assignment, claims, status, blockers and handoff |

To opt an existing workspace into aweb tasks, pin the package and select both
slots in `oats-workspace.yaml`, then run `oats sync`:

```yaml
packages:
  oats.aweb: v1.31.0
defaults:
  messaging: { oats.aweb: { from: package } }
  tasks: { oats.aweb-tasks: { from: package } }
```

Selection without a catalog alias is verified on OATS 0.67.1 and main
`593255d9`. Once `oats.aweb` is pinned and synced, its exported
`oats.aweb-tasks` resolves through the lock. Scratch spawn previews select both
capabilities without `E_SLOT_CONFLICT`.

A soul can instead select `oats.aweb-tasks: { from: package }` in its
`capabilities:` map. Its `tasks:` key is a provider payload (or `none`), not a
capability selection. Replace the workspace's existing tasks selection; each
soul has at most one tasks provider. Messaging and tasks occupy different slots.

Tasks use the instance's own messaging identity in its default team. For an
already joined team, use its explicit identity home as taught by
[/aweb-tasks](oats-package/capabilities/oats-aweb-tasks/skills/aweb-tasks/SKILL.md).
The tasks capability creates no identities or memberships. Its spawn hook emits
a fixed advisory brief and makes no reads or aw calls. Before using tasks, the
agent checks `aw whoami`; if that fails, it reports the failure to its human and
does not use tasks. Conversation stays with the messaging provider.

Readiness has no tasks-slot item for this provider, by design, in this version.
The messaging package's OATS >=0.52.0 and aw >=1.36.33 floors are unchanged.
The task protocol and file flags are verified against aw 1.36.47.

### Developing the tasks capability

The distributed payload lives in `oats-package/`; both capabilities are copied
whole into separate instance modules. Keep hooks self-contained within their
own capability. The manifest validator checks the two exported IDs and their
shared package version and kernel floor. No npm dependencies are needed for
provider tests or validation.

```bash
env -i HOME="$HOME" PATH="$PATH" node --test test/aweb-tasks.test.mjs test/aweb-tasks-skill.test.mjs
env -i HOME="$HOME" PATH="$PATH" npm run validate
env -i HOME="$HOME" PATH="$PATH" node scripts/check-aweb-tasks-argv.mjs
```

The argv checker parses the skill and runs only help against aw 1.36.47.
`test/aweb-tasks-kernel.test.mjs` is an opt-in real-kernel selection check:
set `OATS_TASKS_KERNEL_ROOT` to the kernel source and
`OATS_TASKS_SCRATCH_ROOT` to a scratch parent, then run that test file. It creates
local bare package/workspace repositories, an isolated HOME and cache, and
previews a soul with both providers. It calls no live service or aw command.

## 1.30.0 — Codex readiness from the kernel's launch record

Readiness now takes a home's runtime from the kernel's recorded launch
(`instance.json` `launch.harness`), not from provider metadata. A home that
launched under Codex therefore needs the host wake broker: a missing Codex
target or primary stream reports `wake-stream-missing`. A malformed
`status.updated_at` from `aw wake status` reports
`wake-status-timestamp-unknown`, no longer `wake-status-stale`. Both floors are
unchanged. See [the changelog](CHANGELOG.md#1300--2026-10-19).

## 1.29.0 — the agent status publisher

`oats aweb health enable | status | disable | publish` publishes a signed
status for every agent of a deployment to aweb once a minute (can it be
reached, why not, who fixes it), which aweb's dashboard shows instead of its
own guess. It is opt-in and host-only: a deployment that never enables it
behaves as before. Publishing needs aw 1.36.38. Both floors are unchanged.
See [docs/health-publisher.md](docs/health-publisher.md) and
[the changelog](CHANGELOG.md#1290--2026-10-16).

## 1.28.0 — the host wake broker as a service

`oats aweb wake install | status | uninstall` installs, reports and removes
the per-user unit (`ai.aweb.wake`) that keeps `aw wake run` going: see
[docs/wake-service.md](docs/wake-service.md). Readiness warns
`claude-channel-mode-default` for a Claude channel home that runs in
development mode because nobody chose it, and checks the broker at soul scope
when the spawn will need it. Both floors are unchanged. See
[the changelog](CHANGELOG.md#1280--2026-10-15).

## 1.27.3 — broker readiness uses a post-status clock

Fixes false `wake-status-stale` / `unavailable` on broker-required homes
(Codex, `delivery: session`, and native-channel homes with joined teams).
Broker timestamps are judged after the status read, with no skew allowance;
invalid and genuinely future timestamps still fail. Both floors are unchanged:
OATS >=0.52.0 and aw >=1.36.33. See [the changelog](CHANGELOG.md#1273--2026-10-14).

## 1.27.2 — etiquette points to `/oats-token-saving`

Instruction text only. The `/oats-aweb` skill's etiquette defers whether to
send, to whom and how long to `/oats-token-saving` (`oats.core` 2.6.0, OATS
0.54.0) and keeps how to send. Both floors are unchanged.

## 1.27.1 — custody unit conflicts and Node paths

`resident create` refuses recognised same-root custody units under another
label, naming the unit and platform retirement steps. Its unit PATH now uses
the kernel's absolute `OATS_NODE_BIN`, with the previous node path as fallback
on older kernels. Both floors are unchanged. Rerun `oats aweb resident create <name>` from the deployment to rewrite an existing unit; see
[the custody unit and upgrade steps](docs/resident-create.md#the-custody-unit).

## 1.27.0 — OATS confirms Claude's development-channel prompt

Requires OATS 0.52.0 or later: upgrade the kernel first, then `oats sync`.
Older kernels stay on oats.aweb 1.26.2.

- **Development mode no longer stops at the prompt.** A Claude home in
  `claudeChannelMode: development` (the default) under `delivery: channel` shows
  Claude's development-channel prompt, and OATS confirms it once at launch.
  `settings.oats.aweb.delivery: session` or
  `settings.oats.aweb.claudeChannelMode: approved` stop the prompt.
- **`channel-dev-confirmation` states that decision** at spawn apply, start and
  restart, the start preview (`oats launch-config preview`) and readiness.
  Readiness is quiet once the kernel recorded the home's last start as
  `launchPrompts.status: completed`. The spawn preview shows no decision
  statement yet ([oats#912](https://github.com/awebai/oats/issues/912)).
- **`claude-channels-unavailable`** replaces it at readiness when Claude ignored
  the flag (the kernel recorded `flag-ignored`): its launch environment opts out
  of telemetry (`DISABLE_TELEMETRY`, `DO_NOT_TRACK` or
  `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`), or the account or organization
  has no channels. Remove the variable from the launch environment, use an
  account with channels, or use `settings.oats.aweb.delivery: session`.
- **The exact-home launch consent recipe is gone** from the skill: the kernel
  no longer reads that key.

## 1.26.2 — a resident's seat is ready without a minting root

- In a deployment that holds only residents (one made by `resident create`,
  for example), a GLOBAL seat no longer reports "no messaging root" at
  readiness. Local mode still needs its minting root, as does a GLOBAL seat
  with no resident configured.

## 1.26.1 — the printed next steps work in a fresh deployment

- **`resident create` maps the team without `--team-label`.** The resident's
  team is mapped under the team's name (`default` for `default:acme.aweb.ai`)
  and becomes the deployment's default team where there is none, so the
  printed spawn line works as printed. An existing default is never changed:
  the command prints `oats teams default <label>` as the first step instead.
  It needs OATS 0.48.0 or later and refuses an older kernel before any effect.
- **A seat verifies at its resident's registry.** A grant seat gets
  `AWID_REGISTRY_URL` from the resident's `.aw/identity.yaml` when that
  registry is not aw's default.
- Details: [docs/resident-create.md](docs/resident-create.md).

## 1.26.0 — one command for a GLOBAL resident

- **`oats aweb resident create <name>`** makes a GLOBAL resident identity in an
  existing hosted team from the aweb dashboard's line:

  ```
  AWEB_API_KEY=<key> AWEB_URL=<url> oats aweb resident create <name> [--dir <deployment>] [--root <dir>] [--team-label <label>] [--plan] [--json]
  ```

  It runs exactly one `aw init --global` in the resident's directory
  (`<deployment>/.aweb-residents/<name>` by default) and verifies the identity.
  It then installs a per-user custody unit, a launchd agent on macOS or a
  systemd --user unit on Linux, that runs `aw custody serve` there, waits for
  that custody to be ready, and records `settings.oats.aweb.residents.<name>`.
  The next step it prints spawns a grant seat on the resident.
- **The key.** It is read from `AWEB_API_KEY`, or, with no key in the
  environment, from a terminal prompt that does not echo. With neither, the
  command refuses at once. It is in the environment of the init run only (built
  from nothing: `PATH`, `HOME`, `AWEB_URL`, the key, `AW_NO_UPDATE_CHECK`, and
  `AWID_REGISTRY_URL` when set), and in no argv, unit, setting, capture or
  output. No flag takes a key.
- **Re-runs.** After a failure, a rerun continues aw's own partial init, so the
  DID is the same. After success, a rerun only verifies. A quarantined partial
  is refused with aw's own message, and R is never deleted.
- **Customer-held (BYOT) teams** are aw's to refuse: its message passes through.
- **One client floor, 1.36.33** (`AW_MIN`). `setup --install-aw` installs
  `^1.36.33` by default.
- The whole contract, every `--json` envelope, the custody unit's controls and
  what CI proves against what only the joint E2E proves:
  [docs/resident-create.md](docs/resident-create.md).

## 1.25.0 — grants that never expire; replies to senders outside the roster

- **New grant seats never expire.** A GLOBAL seat spawned on 1.25.0 gets a
  grant that ends only when it is revoked (oats-aweb#80).
- **One setting keeps a duration:** `identity.ttl`, for example
  `identity: { ttl: 720h }` in the seat's settings (`never`, or a Go duration
  from 60s to 720h). A renewal keeps the seat's duration: the captured
  `identity.ttl`, else the ttl the renewed grant recorded, else 720h for a grant
  minted before 1.25.0, so an existing seat never silently stops expiring.
- **What bounds a grant now:** its scopes, revocation at retire, and revocation
  by the resident's owner. A revoked grant's next request is refused at once;
  an open notification stream ends within about 30 seconds.
- **Host order, before syncing to 1.25.0:** upgrade aw to 1.36.32 or later,
  restart every resident custody service and the host wake daemon, then
  `oats sync`. A running custody or daemon keeps its old code until it restarts.

The rest:

- **One client floor, 1.36.32** (`AW_MIN` in `lib/aw-floor.mjs`). Spawn,
  commands, `setup --check-only`, readiness and the probe refuse an older aw
  with one message naming the installed version, the floor and
  `npm i -g @awebai/aw@latest` (or the exact version). `setup --install-aw`
  installs `^1.36.32` by default. aw 1.36.31 lets an agent reply to a sender
  who is not on its team roster, such as a dashboard human in aweb Cloud's agent
  chat; aw 1.36.32 mints grants that never expire.
- **Every mint states its ttl** (`--ttl=never` or the duration), though aw's own
  default is now never. A minted grant's `expires_at` must answer its request:
  `"never"` or a finite timestamp for a never request (the team or issuing
  certificate may cap it), a finite timestamp for a duration. Anything else
  fails the mint closed: the grant is revoked and nothing is kept. When the
  aweb service refuses a never mint (a server without never-grants answers 422,
  or 404 before the grants endpoint), aw mints nothing: the error shows aw's
  message, nothing is kept and nothing is retried with a duration.
- **Custody ops, probed from `aw custody status --json`.** A never seat needs its
  custody to list `grant_never_ttl.v1`; an E2EE grant seat (the default) needs
  `mail_reply_continuation.v1`, listed beside the E2EE ops. When one is
  missing, readiness and the mint preflight say "required custody operations
  are missing: …; restart the custody on aw 1.36.32 or later (upgrade aw,
  restart the custody service and the wake daemon, then oats sync)". It is an
  op probe, not a version check. A seat with an explicit duration does not need
  the never op; one with `identity.e2ee: false` does not need the reply op and
  cannot send the encrypted reply to a sender outside the roster. When the
  custody status cannot be read, the message says "custody status could not
  be read: …", never that an op is missing.
- **No grant is left unrevoked silently.** Revocation is the only end of a
  never-grant. Every mint is labelled `oats:<instance>:<seat>`, with a random
  seat id kept in `identity.seat` and written to the home
  (`.oats-aweb/seat.json`) before the first mint, so a hook killed after the
  mint still leaves a retire the seat; the custody's grant list is the source of
  truth: every real start and every retire revokes this seat's other active
  grants (at retire, all of them), including one minted before a crash. Other
  labels, including pre-1.25.0 `oats:<instance>`, are never touched. A failed
  revoke names the grant, how long it stays valid ("until revoked", or "until
  <expiry> unless revoked") and `aw id grant revoke <id>` run in the resident's
  custody directory; readiness warns `grant-revoke-pending` from the list, or
  `grant-revoke-unchecked` when it cannot read it. A renewal that fails keeps
  the previous grant and starts on it; only a failed first mint at spawn fails.
  A retire exits nonzero while a grant stays unrevoked or the list cannot be
  read, and lists each grant with its revoke command, as `--force` prints it.
- **`wake-daemon-outdated` is a warning.** A running wake daemon below the floor
  still receives, so readiness reports it with the remedy "upgrade aw, then
  restart the host wake daemon" and goes on to assess the target. A daemon that
  is not running or reports no version is still a problem.
- **Grant scopes.** Custody re-reads the source message to reply, so a reply
  needs `mail.read` as well as `mail.send`. The NORMAL grant profile carries
  both; a send-only custom grant fails closed with `grant_scope_denied`.
- **Late replies.** A reply to a human whose key in the original message has
  expired fails by design ("source sender key is missing, expired or invalid;
  ask them to send a new message"): ask them to send a new message.
- **Grant lifetime in readiness.** Readiness reads a grant seat's recorded grant
  and asks neither aw nor custody. A never-grant, the healthy default, gets no
  lifetime diagnostic (readiness has no informational channel; the brief says it
  never expires), and its `"never"` is never read as a date. A grant with a
  duration gets `grant-expiring` (warning) within 7 days of expiry,
  `grant-expired` (problem; messaging unavailable) at or after it, and
  `grant-expiry-unknown` (warning) when no expiry can be read, never a guessed
  one. Each names the instant as recorded and that seat's remedy, from the
  renew mode the grant recorded (`identity.grant.renew`) and the
  `identity.ttl` the seat captured: under `renew: launch`, "restart the seat
  to renew it (`oats session restart --home <home>`)"; for a seat that
  captured an `identity.ttl` duration, "a restart requests another <ttl>
  (…); removing identity.ttl and respawning requests never; team or certificate
  limits still apply"; for a capped never request, "restart the seat to renew
  it up to the team's limit (…)"; under
  `renew: off`, where a restart keeps the grant, "respawn the seat (or set
  `renew: launch` and respawn)". A grant minted before 1.25.0 records no renew
  mode, so its remedy adds "if its identity.renew is off, respawn it instead".
  LOCAL seats get none of these.

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
  `npm install -g @awebai/aw@<v>` (default `^<aw floor>`, today `^1.36.33`)
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

  New Claude/channel compositions default to
  `--dangerously-load-development-channels plugin:aweb-channel@awebai-marketplace`.
  aweb-channel is not on Anthropic's default channel allowlist. The recommended
  unattended route is explicit host-local `claudeChannelMode: approved`, which
  selects `--channels plugin:aweb-channel@awebai-marketplace` (no development
  prompt). Claude admits the plugin when its managed policy sets
  `channelsEnabled: true` and lists `{plugin: "aweb-channel", marketplace:
  "awebai-marketplace"}` in `allowedChannelPlugins`; on hosts without
  server-managed settings or MDM that is a root-owned file a human admin writes
  once (`/etc/claude-code/managed-settings.json` on Linux,
  `/Library/Application Support/ClaudeCode/managed-settings.json` on macOS).
  The skill's section 4 summarises the host steps; the procedure, its checks and
  failure remedies are oats.setup's `/oats-host-delivery` (oats.framework 1.11.0).
  Without that policy the channel does not register. Readiness reads the
  machine file read-only and warns one verdict: `claude-channel-policy-admitted`,
  `claude-channel-policy-not-admitted` (naming the missing key),
  `claude-channel-policy-malformed` (Claude Code documents that it refuses to
  start while a managed-settings file is unparseable, in
  code.claude.com/docs/en/managed-settings.md) or
  `claude-channel-enrollment-unverified` (absent, unreadable or an unsupported
  platform). An approved launch warns the same
  verdict, and nothing when the file admits the plugin. The file is evidence,
  not proof: server-managed settings or MDM override it, and only the nonce
  exchange proves receive. Where broker delivery is authorized, an operator may
  select `delivery: session` for an unattended home; this must not override an
  explicit native-channel requirement.

  Both modes contribute exactly one fixed plugin argument;
  `settings.oats.aweb.claudeChannelMode` selects argv, never consent. No automatic
  migration, consent inference, approved-to-development fallback or flip-back
  occurs. A future default change requires an explicit reviewed release.

  Development selection shows Claude Code's development-channel prompt, and
  OATS 0.52.0 and later confirm it once at launch;
  `settings.oats.aweb.delivery: session` or
  `settings.oats.aweb.claudeChannelMode: approved` stop the prompt. The kernel
  records the outcome in `instance.json` `launchPrompts.status` and explains a
  blocked start in its own `launch-prompt` readiness item;
  `channel-dev-confirmation` states the
  decision at spawn apply, start and restart, the start preview (`oats
  launch-config preview`) and readiness, where it is quiet only after a
  `completed` start. `oats spawn --preview` runs no provider hooks, so it shows
  no decision statement yet ([oats#912](https://github.com/awebai/oats/issues/912)). See the skill's
  [Channel selection and the development-channel prompt](oats-package/capabilities/oats-aweb/skills/oats-aweb/SKILL.md#4-how-messages-reach-you-delivery-and-wakes).
  A blocked result can retain an active session after Enter; inspect first, never
  automatically resend input or relaunch. A confirmed prompt does not prove
  admission or receive readiness.

  The provider never observes or answers a prompt: its readiness reads only the
  status the kernel recorded, and actual prompt outcomes belong to the kernel
  launch result and durable receipt. Passing confirmation does not prove native
  receive; `native-receive-unproven` remains.

  Readiness uses the captured mode or an exact retained provider launch
  contribution, including historical development arguments. Missing evidence
  produces `claude-channel-mode-unproven`; current settings do not rewrite a
  home's history. Malformed or conflicting supplied evidence is a problem.
  Frozen homes keep their captured modules and arguments. The default applies
  only to new compositions; it does not enroll the plugin or recover an existing
  runtime. [Issue #44](https://github.com/awebai/oats-aweb/issues/44) remains open;
  [cjr adoption #673](https://github.com/awebai/oats/issues/673) is separate.

  A home is on exactly one path. Every start decides the path afresh from the
  setting and the kernel-selected target runtime (`OATS_RUNTIME`, the
  compatibility alias of `OATS_HARNESS`; a home can restart under another
  harness), regardless of a retained launch configuration's name: the broker
  path registers the home, the channel path runs `aw wake deregister` and confirms with `aw wake status --json` that the home is no
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
  Home readiness reports whether the configured supported route and observable
  broker prerequisites pass. It uses the home's captured delivery and final
  credential locator, plus retained joined membership. The kernel's recorded
  `instance.json.launch.harness` governs runtime selection, with top-level
  `harness` accepted when the launch recipe lacks it. Each supplied field must
  be a nonempty, unpadded string; if both are supplied they must agree. Malformed
  or inconsistent evidence reports
  `receive-record-unavailable`. Provider `meta.runtime` is a legacy fallback
  only when both kernel fields are absent. A launch hook can run before a later
  launch failure, so provider metadata alone must not override the kernel's
  published launch receipt. Configuration names and the readiness caller's
  environment never select the target runtime. Claude Code and pi use native
  channels by default; Codex requires the supported external broker. An absent
  Codex target or missing primary stream (including a retained native row
  carrying only joined identities) reports `wake-stream-missing`. Refused or
  disconnected supplied streams retain `wake-stream-unavailable`; malformed
  bindings and route/policy mismatches retain `wake-target-binding`. A `ready`
  result does not certify recent endpoint observation, native
  connection, current start, uninterrupted liveness, automatic presentation or
  model consumption.

  Native plugin/extension installation, launch flags and the development-channel
  confirmation do not prove a connected native receiver. Missing connection
  telemetry produces the `native-receive-unproven` warning; confirmation
  guidance applies to captured development mode. Joined broker paths independently contribute failures even
  when the primary is native. The public joined `receive: native` enum remains
  unchanged for compatibility; it denotes broker-managed joined delivery, not
  a harness-native connection or readiness attestation.

  Broker readiness reads one `aw wake status --json` snapshot. It checks the
  canonical target, a running daemon that reports its version, active/unpaused target, complete
  captured identity set and its delivery/ownership/event/control policy,
  admitted streams in the released `streaming` phase, running worker, and
  target/worker/binding errors. Missing required daemon, worker or stream
  evidence is a problem. A running daemon below the aw floor is the
  `wake-daemon-outdated` warning, and the target is still assessed; a daemon
  whose status lacks worker evidence cannot establish the broker prerequisites.

  Observation age, absent optional inspection evidence and an inspection in
  progress warn without making otherwise satisfied prerequisites unavailable.
  The 30-second threshold only labels old evidence with its age; it is not a
  readiness gate, broker guarantee or command timeout. Quiet workers inspect at
  startup and on events, so their observations can age without a transport
  failure. Missing observation evidence is unproven, never an invented
  successful inspection. Supplied timestamps must still be valid, nonfuture
  and consistently ordered; malformed or contradictory status is a problem.
  A supplied malformed `status.updated_at` reports
  `wake-status-timestamp-unknown`, naming the observed client and daemon versions
  (or `unknown` when unavailable). Provider `unavailable` maps to kernel
  `unknown`; malformed time is not evidence of staleness. A parsed future
  snapshot remains `wake-status-stale`. The parser accepts RFC 3339 timestamps
  with attached fractional seconds of one through nine digits, as emitted by
  supported aw releases; it does not infer compatibility from a version alone.
  Known stopped/shell/unusable endpoint state, failed inspection and explicit
  errors remain problems even when old or followed by `inspect_start`, which
  can retain prior state and errors. `last_inspect_at` also updates on errors;
  neither it nor historical input/success timestamps establish success.

  One worker field needs a narrower interpretation: released aw can retain
  `channel_core.last_error` across subsequent status updates. Node can re-emit
  that text on ordinary status updates; a new status line does not date the
  failure. A new worker run can reset the field. With `inspect_done`,
  a supplied nonfailure worker state, no `readiness_error` and no other failure
  or malformed evidence, `wake-worker-error-retained` warns with bounded error
  text. Its currency is unproven. There is no error timestamp or common ordering
  token to establish that inspection followed the error or resolved it;
  `last_success_at` records input and is not the deciding signal. Without that
  completed observation, the worker error remains a problem. Row, readiness,
  binding, stream, conflict, pause and nonrunning failures remain problems.

  OATS reports nonshell inspection as `unknown`, not `idle`. Public status does
  not independently attest endpoint presence or identify the current start.
  Readiness does not refresh the broker, send input, register, resume or modify
  the home. A soul check with no home remains prerequisite-only. Existing
  configuration/authentication and applicable custody failures retain their
  diagnostics and skip receive evaluation until prerequisites pass.

  A genuinely absent legacy delivery/runtime record uses the settings-based
  prerequisite fallback for missing facts and warns that receive ownership and
  complete-set assurance are unproven. It does not replace valid captured facts
  with current settings or infer ownership from a broker row or caller runtime.
  Only absent captured delivery falls back to `settings.delivery`; `session`
  requires broker checks. Captured `session` requires them even without runtime;
  captured `channel` without runtime leaves primary ownership unproven, including
  when current settings say `session`. An explicit Codex runtime requires broker
  prerequisites even when captured delivery is absent, while complete-set
  ownership remains unproven. A retained empty runtime string keeps its
  existing external-broker meaning. Any known joined path requires broker checks.
  Retained joined identities still receive target/worker/stream and known-policy
  checks. Malformed JSON, unreadable records, wrong types, invalid values and
  contradictory retained facts are problems, not legacy absence.

  Valid `.oats-aweb/teams.json` is authoritative over launch metadata because
  later join/leave commands update it. Complete captured local plans require
  valid membership state. Legacy metadata-only joined state is retained with
  the fallback qualification; a missing file is not evidence that known joins
  disappeared. If both legacy membership sources are absent, there are no known
  joined entries, not a certified empty set. Otherwise valid unmatched bindings
  can remain in a partial legacy projection; every supplied binding must be
  well-formed and healthy, but the result cannot certify full-set matching.
  Global grant/retained-root spawn paths may omit this file only
  when recorded provenance consistently establishes an empty joined set.
  Grant readiness uses the final recorded `identity.grant.home`, never the newest
  directory or the caller's `AWEB_IDENTITY_HOME`.
  For a GLOBAL grant seat captured with `delivery: session`, a foreign broker
  binding reports `wake-target-binding` with both grant-home basenames. A
  quarantined primary reports
  `wake-stream-unavailable`, including the HTTP status and recognized grant
  denial detail when supplied. Arbitrary error text, headers and response bodies
  are not echoed. Both diagnostics explain that restarting the seat re-registers
  the broker with its current grant home; readiness itself never re-registers.
  An admitted primary in aw's `starting` or `retrying` phase gives a
  `wake-stream-unavailable` warning, including safe HTTP/service detail or a
  recognized network failure phrase from its error text. The broker reconnects
  automatically. Phase determines the outcome even when `stream_error` is set.
  Worker, binding and all other readiness checks still apply; stopped, unknown
  or missing phases remain problems; an unknown phase is named in the problem.

- `claudeChannelMode`: `development` (default) or explicit `approved`, **host-only** in
  `oats-local.yaml` under `settings.oats.aweb`. Committed soul/workspace settings
  and spawn-provider overrides are rejected by the kernel. Explicit null, empty,
  wrong-type or unknown values fail before provider effects. This setting changes
  only Claude/channel arguments; Pi, Codex and `delivery: session` are unchanged.
- `root`: absolute directory whose `.aw` is the default team's minting root.
  This root is for one aweb team only. A seat with `identity.mode: global` and
  an `identity.resident` acts through that resident's grant and needs no
  minting root, so readiness does not ask for one.
- `roots`: map `{ <team id>: <absolute directory> }`. `roots[team]` wins over
  `root` and is required when a deployment mints into more than one aweb team.
  Each mapped directory owns its own `.aw` identity for exactly that team.
- `residents`: map of resident name to absolute custody directory for
  `identity.mode: global`; host-only because it points at custody material.
  `oats aweb resident create <name>` records its resident here.
- `join`: comma-separated eligible labels to join at spawn.
- `identity`: local by default; `global` uses a named resident grant. For fresh
  GLOBAL creation in an existing hosted team versus resident reuse, follow the
  [existing-team GLOBAL resident journey](oats-package/capabilities/oats-aweb/skills/oats-aweb/references/existing-team-global-resident.md).
  Global spawn consumes a provisioned resident; it does not create one:
  `oats aweb resident create` does.
  A new GLOBAL seat requests `identity.ttl: never` by default, with
  `identity.renew: launch`: each actual launch re-mints, while preview makes
  no changes. A renewal keeps the seat's duration (its captured ttl, else the
  ttl the grant recorded, else 720h for a grant minted before 1.25.0).
  `identity.ttl` may instead set a Go duration from 60s to 720h;
  `E_GRANT_TTL` refuses anything else before grant or launch effects,
  including retained-grant paths. Explicit `renew: off` retains the existing
  grant. The team grant cap or issuing-certificate expiry can impose a finite
  deadline even on a never request. The mint receipt's `expires_at`, recorded
  as `identity.grant.expiresAt`, determines expiry diagnostics and the brief;
  renewal preserves the requested TTL. Scopes and revocation still apply.
  Existing homes retain their captured provider/settings until explicitly
  recomposed; publishing this version does not update them automatically.

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

The general OATS >=0.42.0 compatibility floor applies to the remaining provider
behavior; explicit wider-team LOCAL join additionally requires the selected same
kernel to support `inspect --home` for recorded soul provenance, then
`inspect --soul --dir --json` with live teams and current `oats.aweb` root settings,
and to dispatch `OATS_TEAM_SCOPE` as the selected deployment. Missing or invalid
results refuse before invite minting; ambient soul names or settings are no
workaround. The pinned public fixture at `bb2ba8c9` (OATS 0.42 source) verifies
these features, not the earliest compatible release. Older homes need the fixed
provider composition; ordinary lifecycle keeps its captured settings.

Explicit `oats aweb join` resolves current host-owned minting roots through the
same kernel's public inspect API. It first validates the selected home's recorded
soul, then reads that soul in the selected deployment, consuming only `root` and
`roots`. The exact team's explicit entry wins, including when invalid; otherwise
a shared current root must prove membership in that team. Query, configuration,
compatibility or membership failures refuse before an invite is minted. Captured
module, identity and delivery settings remain unchanged; spawn, launch and retire
do not use this current-root lookup.

Setup selects the deployment from `OATS_TEAM_SCOPE`, with `OATS_WORKSPACE` as an
older-dispatch fallback. Supplied deployment facts must agree and the selected
directory must contain a readable `oats-local.yaml`. New team roots are siblings
under that deployment's `.aweb-roots`, even when the minting root is nested or
outside the deployment. Previously recorded roots retain their exact locations.

### Setup acts

`oats aweb setup` handles the provider's deployment-root onboarding acts below;
it is not the fresh GLOBAL resident creation path. Global spawn consumes a
pre-existing resident and mints a worker grant. Use the
[existing-team GLOBAL resident journey](oats-package/capabilities/oats-aweb/skills/oats-aweb/references/existing-team-global-resident.md)
for authority, destination, native creation/reuse, custody and acceptance boundaries.
From a deployment directory (outside an instance home), dispatch setup through any
soul that uses the messaging provider, for example `oats aweb setup --soul <any soul with messaging>`; the provider consumes the kernel-forwarded `--soul` flag and does not use it as team policy.
Supported acts:

- `oats aweb setup --username <u> --name <alias> [--label L] [--plan] [--json]`:
  provider 1.23.0 (#70) automatically records the LOCAL team mapping and deployment
  default through the selected kernel after verifying the root membership.
  Missing/invalid names refuse before effects; the explicit native name fix is
  present in the 1.22.2 composition. Earlier behavior only printed mapping advice.
  Use the [username setup procedure](oats-package/capabilities/oats-aweb/skills/oats-aweb/references/username-setup.md)
  for plan, policy, matching-root resume and partial-write recovery. This is not
  an installation or timed onboarding claim.
- `oats aweb setup` with the selected team API key supplied only through the
  operator's protected child environment (`AWEB_API_KEY`): runs plain `aw init`
  for that hosted team. `--service` stays join-only; `--name` is supported for
  join and additionally required for `--username`. Neither flag extends the
  API-key flow or provides GLOBAL setup; no `setup --global` exists. Do not
  place the key in a literal command or history.
- `oats aweb setup --create <label> --namespace <domain>`: owner/admin act for
  a customer-controlled namespace. It normalizes `<label>` to aweb's team-name
  rule, runs `aw id team create --name <normalized> --namespace <domain>`,
  requires the returned `team_id` and invite token, accepts the invite into a
  new per-team root, records `roots[<team id>]`, then records the local mapping
  with `OATS_CLI_BIN teams add <label> --team <id>`. Without `--namespace`,
  setup refuses hosted additional-team creation: the provider has no wrapper.
  Native aw 1.36.24 supports `id team create --hosted`; aw 1.36.23 does not.
  Native JSON contains an invite token and must be captured privately. Before creating anything it reads `OATS_CLI_BIN teams --json`:
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

Every path requires `aw >= 1.36.33` (`AW_MIN` in `lib/aw-floor.mjs`, the one
client floor; the probe and grant seats' custody use it too). A missing, older or unreadable `aw` is a
readiness problem, a refused command and a required spawn-hook failure, all with
one message naming the installed version, the floor and the install command,
for example `aw 1.36.31 is older than required 1.36.33; upgrade with
\`npm i -g @awebai/aw@latest\` (or \`npm i -g @awebai/aw@1.36.33\`)`. The host
wake daemon and a resident's custody service run their own code until they
restart (see 1.25.0 above). The floor is read from the first line
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

## Isolated hostOnly contract verification

`test/claude-channel-host-only.test.mjs` imports the real generic `resolveSoul`
validator from the public OATS source pinned in `.github/workflows/ci.yml`,
using this checkout's actual provider manifest. It checks both
mode values at soul, workspace and spawn-provider layers, the existing
`host-only-key` diagnostic and `oats-local.yaml` remedy, plus host-local origin
and omission controls. Unexpected fixture remote reads fail.

CI provisions that exact source outside test discovery and installs its
locked dependencies with lifecycle scripts disabled. It runs `OATS_HOST_ONLY_REQUIRED=1` with `OATS_HOST_ONLY_KERNEL_ROOT`
pointing to the pinned checkout. Missing roots/dependencies and import failures
fail this required gate. Local `npm test` explicitly skips this opt-in file when
the root is absent; to exercise it, provision the same source/dependency and run
`OATS_HOST_ONLY_REQUIRED=1 OATS_HOST_ONLY_KERNEL_ROOT=/absolute/pinned/checkout node --test test/claude-channel-host-only.test.mjs`.
This verifies the pinned source contract, not every kernel version, a host
installation, Claude admission or live delivery.

### Labelled join configuration (provider 1.23.1, #78/#82)

setup is an operator act: run one setup at a time per deployment.
The selected provider composition must include provider 1.23.1; existing captured
homes do not adopt them automatically. Labelled join verifies exactly one LOCAL
membership before recording its canonical team. The selected public kernel's
teamsApi 2 query/add/default/readback features are required, as for username setup.
It records a missing label mapping and establishes a default only when no
deployment or workspace default exists. A local default is preserved while
adding a mapping; an exact existing shared/local mapping is reused.

When the effective default comes from the workspace and the mapping is missing,
setup retains the admitted root but returns `E_SETUP_DEFAULT_PRESERVE` without
team writes. Its exact `oats teams add` remedy is an operator decision: that
command also creates a local default, shadowing the workspace default. With a
preserved different default, the result instead gives the exact optional
`oats teams default` command to select the joined label.

Closed policy when the plan needs a team write, conflicting/unmapped
declarations and invalid queries refuse before acceptance when knowable. Later
policy/mapping changes or failed writes remain typed failures with observed
partial state (or unavailable readback).
Retain the root and retry the same labelled command without an invite; matching
membership resumes without redemption. Setup rechecks before writes and reads
back afterward, but public verbs are not an atomic transaction: do not change
configuration concurrently. Soul-specific defaults do not establish a local
default and may still control that soul's selection after deployment setup.

LOCAL launch and no-effect preview now return the same explicit instance
`<home>/.aw` identity selector as spawn. GLOBAL grant locators and delivery/joined
metadata remain unchanged. This corrects a pre-existing omission, not a new
1.23.0 regression.

### Member invitation (provider 1.23.0, #71)

From the selected deployment, `oats aweb invite --soul S [--label L]
[--plan] [--json]` selects a declared label (or the selected soul's default),
checks its canonical team and root membership, then asks native/server authority
to issue a LOCAL hosted member invitation. There is no recipient argument:
the accepting side chooses its own alias. This is not a dashboard human invite,
GLOBAL invitation or local-controller/BYOT issuance.

`--plan` only reads team/root/membership and states what would be requested; it
neither mints nor proves permission. Apply uses `roots[T]`, or `root` only when
that override is absent; invalid explicit roots refuse. Native invocation uses
the selected root as cwd, explicit team ID, isolated disposable HOME and no
inherited credentials, controller state, external identity home or routing.
Membership is not an owner/admin claim; the server decides issuance authority.

Success prints the token once (plain stdout), or once at `result.token` inside
`{schemaVersion:1,ok:true,result}` with `--json`. Capture it privately and pass
only to the intended accepting operator's labelled `setup --invite-stdin`
procedure in `/oats-aweb` §8, **Invitations and certificate ownership**. Never
log, echo, put in argv/history, or send it as ordinary mail. Native acceptance
still exposes its token argument in the target host's process list temporarily.
A token is not bound to the future alias. Issuance is never automatically retried.

`E_INVITE_ARGUMENT`, `E_INVITE_DEPLOYMENT`, `E_INVITE_TEAM_QUERY`,
`E_INVITE_TEAM`, `E_INVITE_ROOT` and `E_INVITE_MEMBERSHIP` refuse before issuance.
Repair the selected input/context/root rather than substitute an ambient identity.
Unrelated kernel warnings do not block invitation; all failure-severity problems
and selected-label warnings do. Refusals name only known safe problem codes,
never arbitrary diagnostic text. Membership reads and issuance both isolate
native HOME; plans discard temporary state without changing the selected root.
For pinned aw 1.36.23, only its anchored CLI-generated HTTP 401/403 prefix maps
to `E_INVITE_DENIED`; details are statically withheld, never matched as role or
body prose. Other statuses, transport and unknown native errors are
`E_INVITE_NATIVE`. Invalid successful native output is `E_INVITE_OUTPUT`.
Inspect an uncertain issuance before any deliberate retry. No mandatory authority
query or extra Cloud version floor is introduced. This act additionally requires
the selected kernel to dispatch `OATS_TEAM_SCOPE` and expose public
`teams --dir D --json` with `schemaVersion: 1`, `teamsApi: 2`, the selected
deployment, declarations and problems. The public fixture pins OATS 0.42 source
`bb2ba8c9a254edb745913b9c5a9d9b833fda932d`; it does not establish the earliest
compatible release. Unsupported/malformed query schemas refuse before minting.
The package-wide OATS >=0.42.0 floor applies to other behavior.
This source feature needs a
future provider release/composition and is not installed by this documentation.

### Isolated team-root verification

`test/setup-team-roots.test.mjs` exercises placement, parser remedies and current
join authority using controlled native and kernel JSON substitutes. The opt-in
`test/public-kernel-team-roots.test.mjs` executes public dispatch and inspect from
the same pinned kernel checkout used by the hostOnly gate. Run it with
`OATS_HOST_ONLY_REQUIRED=1 OATS_HOST_ONLY_KERNEL_ROOT=/absolute/pinned/checkout`.
It uses isolated local Git repositories and a fake aw; it does not verify live
service behavior or perform host onboarding.

The opt-in `test/username-native.test.mjs` checks #66 with an explicitly selected
real aw 1.36.23 executable (commit `61c38162596d1af9085741d70d15900ff9894257`).
Run `OATS_TEST_AW_1_36_23=/absolute/path/to/aw OATS_USERNAME_NATIVE_REQUIRED=1
node --test test/username-native.test.mjs`. It records the executable path,
version/build and SHA-256; isolated HOME and loopback service fixtures prevent
use of ambient accounts. Signup is deliberately refused: the test proves native
argument/wire acceptance, secret-output withholding and no root after refusal,
not successful hosted bootstrap or live membership.

`test/invite.test.mjs` covers selection and output failures. The opt-in
`test/invite-native.test.mjs` uses the same pinned executable above; run with
`OATS_TEST_AW_1_36_23=/absolute/path/to/aw OATS_INVITE_NATIVE_REQUIRED=1
node --test test/invite-native.test.mjs`. It exercises provider-to-native argv,
selected-root certificate routing, synthetic loopback success and plain-detail
HTTP denials, withheld hostile bodies, no-write plan and foreign controller-state
isolation. Generated keys/certificates and invite strings are fixtures, not live
authority or usable tokens. Native JSON decoding/missing-token failures exit
nonzero and remain `E_INVITE_NATIVE`; malformed exit-zero output is tested with
a substitute. The public-kernel fixture also dispatches invite planning through
the selected messaging soul. These checks do not prove a timed operator journey.

### Username mapping/default verification

Username setup and labelled join share the configuration/readback adapter in
`lib/setup-team-default.mjs`; `lib/setup-join-default.mjs` owns join membership and
preserve-default policy. The provider 1.23.0 (#70) username flow uses the selected
`OATS_CLI_BIN` with explicit deployment and sanitized kernel selectors for public
`teams --json`, `teams add` and `teams default`. It accepts `teamsApi: 2`, including
standalone `localTeams: null`; only explicit false/`local-teams-closed` is a policy
refusal, and only when the plan needs a team write. This act needs those public
query/mutation/readback features and selected deployment dispatch. The pinned OATS 0.42 source
`bb2ba8c9a254edb745913b9c5a9d9b833fda932d` is exercised evidence, not proof of an
earliest compatible release. The general package floor remains unchanged.

`test/setup-default.test.mjs` covers preflight, retained membership and injected
partial failures. The stateful public-CLI substitute is in
`test/helpers/fake-kernel-team-config.mjs`; the public-kernel fixture separately
executes real team mutations only in disposable deployments. The pinned username
native test also reads a generated retained certificate through actual aw and
resumes mapping without signup. Its deliberately refused loopback signup still
does not prove successful hosted account creation. Neither fixture is a timed
M3 operator journey. Run the existing full suite with the explicit public/native
test variables above; no service install or customer operation is part of testing.

### Grant duration and renewal verification

GLOBAL spawn and launch use the shared `lib/grant-duration.mjs` resolver.
It preserves absent/null/empty default aliases and Go duration syntax, including
component-wise nanosecond truncation. Launch validates before preview, broker
registration or retained-grant returns. LOCAL launch must keep its ordinary
joined-team lifecycle instead of entering the GLOBAL renewal early return.

Mint receipt validation lives in `lib/grant-expiry.mjs`: a never request
accepts `"never"` or a finite RFC3339 timestamp; a duration requires a finite
timestamp. Downstream code uses the recorded expiry, independently of the
requested TTL. Run `node --test --test-concurrency=1 test/minted-expiry.test.mjs
test/never-grant.test.mjs test/grant-expiry.test.mjs test/health-vocabulary.test.mjs`
for receipt validation, capped-seat startup and renewal, custody preflight,
expiry diagnostics and health classification. The fake-aw harness checks the
provider's contract; it does not establish live capped-mint acceptance.

Run `node --test test/grant-duration.test.mjs test/oats-aweb-hook-1-13.test.mjs`
for duration boundaries, mint arguments, default/explicit renewal and retained
failure/preview controls. With `OATS_TEST_AW_1_36_23` pointing at the pinned
1.36.23 executable, `test/grant-duration-native.test.mjs` checks version, help
and duration flag parsing in an isolated home. It always passes `--help`:
no mint executes, and syntactically valid out-of-range values can pass this
help check. The 60s..720h range and `never` are separately enforced by provider tests and
qualified against native source `61c38162596d1af9085741d70d15900ff9894257`
(`cmd/aw/id_grant.go`). These checks are not live custody, grant or expiry
acceptance. With `AW_REAL_CLI_BIN` pointing at a real aw 1.36.32 or later,
native or the npm JS shim, `test/never-grant.test.mjs` checks that it parses
`--ttl=never` and the durations OATS passes, in an empty directory where aw
stops before any network call.


For an isolated build of the exact native source pin, the same opt-in fixtures
also require `OATS_TEST_AW_SOURCE_RECEIPT=/absolute/path/to/receipt.json`.
The receipt must identify `kind: "exact-source-build"`, the exact source commit,
`sourceClean: true`, binary path, SHA256 and matching version output. Only
`1.36.23-source-fixture` at the pinned commit is accepted in this mode.
Record the build command/toolchain/platform separately; this is exact-source
contract evidence, not the historical published binary. Without that receipt,
the original published-version checks remain mandatory. The receipt validator
has wrong-version/source/hash/path controls. No fixture authorizes live requests.

The root recorder preserves block-style YAML around a replaced scalar, including
kernel-wrapped quoted paths; ambiguous continuations refuse rather than consuming
neighboring settings. Public dispatch tests cover first join followed by tokenless
resume through actual kernel serialization. Focused setup tests cover neighboring
roots/comments, partial failures, policy changes and explicit-default preservation.

### Resident create verification

`oats aweb resident create` lives in `lib/resident.mjs` (stages, key handling,
verify, record) and `lib/custody-unit.mjs` (the launchd and systemd units);
the shared `oats-local.yaml` writer is `lib/local-settings.mjs`. Its contract,
envelopes and coverage are in [docs/resident-create.md](docs/resident-create.md).

- Run `node --test <file>` separately for `test/resident-create.test.mjs`,
  `test/custody-unit.test.mjs`, `test/resident-custody-regressions.test.mjs`,
  `test/resident-docs.test.mjs` and `test/resident-cloud-captures.test.mjs`
  for the unit tests. The custody regressions exercise both platforms, including
  foreign-unit refusal without writes and rewriting an existing unit after
  the kernel-selected node path changes. Their fake aw (`test/helpers/fake-aw-resident.mjs`) replays only
  real captures from `test/fixtures/resident`, and fake launchctl, systemctl and
  loginctl record their calls under a temporary HOME. The prompt tests drive a
  real pseudo-terminal through `python3`. `test/resident-docs.test.mjs` fails
  when an envelope in the doc differs from the command's real output.
- `test/resident-journey.test.mjs` runs real aw against aweb's local stack. Bring
  the stack up from an aweb checkout with `docker compose -f
  docker-compose.e2e.yml up -d --build --wait postgres redis awid aweb`, then set
  `OATS_RESIDENT_JOURNEY_AW` (an aw 1.36.33 executable),
  `OATS_RESIDENT_JOURNEY_AWEB_URL=http://127.0.0.1:18000` and
  `OATS_RESIDENT_JOURNEY_AWID_URL=http://127.0.0.1:18010`, and
  `OATS_RESIDENT_JOURNEY_KERNEL` (a checkout of an OATS kernel with
  `teams-conditional-default`, its dependencies installed with `npm ci`). Its
  adopt journeys load a real custody unit for a random test namespace (launchd
  on macOS, systemd --user on Linux, which needs lingering and
  `XDG_RUNTIME_DIR`) and remove it afterwards. The last three run the printed
  next steps through that kernel in a fixture workspace: the spawn mints a real
  grant at the resident's custody, and the retire revokes it. CI's
  `resident-journey` job runs them with `OATS_RESIDENT_JOURNEY_REQUIRED=1`.
- When aw's output contract changes, refresh the fixtures with
  `test/fixtures/resident/capture.sh <aw> <scratch dir>` against the same stack,
  and update its README's version, commit and date.

### Wake service verification

`oats aweb wake install|status|uninstall` lives in `lib/wake-service.mjs`. It
builds its unit from `lib/custody-unit.mjs`'s parts: the unit directory and
quoting, `searchPath`, the manager runner, linger and the running pid. Change
those parts only with both commands' tests green. Its contract, unit text and
errors are in [docs/wake-service.md](docs/wake-service.md).

- `node --test test/wake-service.test.mjs` covers both platforms against a fake
  host (`test/helpers/fake-wake-host.mjs`): fake aw, oats, systemctl,
  launchctl, loginctl and ps on a PATH holding nothing else, under a temporary
  HOME and XDG_CONFIG_HOME, with a fake kernel for `status`'s home walk.
- Never run `install` or `uninstall`, or a manager command, against a real
  user's units to test it. `systemctl --user` reaches the real user manager
  whatever HOME is, so a live systemd proof needs a disposable machine or
  user.

### GLOBAL grant app inventory (provider 1.23.2, #76)

The selected provider composition records the successful native mint's actual
`apps` and `skipped_apps` under `identity.grant`, bound to that grant ID. Native
aw 1.36.26 supplies this receipt; earlier receipts without both fields have
unavailable inventory, not an empty delegation. Valid empty arrays mean a known
empty snapshot. Malformed optional inventory produces `E_GRANT_APP_INVENTORY`
and unavailable metadata while preserving an otherwise-valid grant and its
existing lifecycle. This informational check is not an authority gate.

Comms describes the snapshot at spawn, not a dynamically refreshed grant.
All inventory briefs/advisories show only app IDs, tool counts and skip codes;
tool names, origins and digests stay out of instruction-bearing text. Read
`oats inspect --home <home> --json` for the current recorded identity/grant.
Launch preview's warning describes the retained snapshot; a pending renewal's
inventory is unknown until its receipt. Preview never mints. Successful
`renew: launch` records the new snapshot and emits an advisory; `renew: off`
retains the old one, including on restart. Failed renewal retains the previous
grant and snapshot under the existing recovery rules. No inventory implies
receive readiness, live app acceptance or automatically updated captured homes.

Preview requires selected-kernel warning projection: tested at OATS 0.47.0
source `e6e75ed8ba5a0a07a4b3e26fc627cac9064c730b`. OATS 0.42 source
`bb2ba8c9a254edb745913b9c5a9d9b833fda932d` persists the spawn snapshot through
inspect but omits preview warnings. Missing inventory in that older preview is
unreported/unsupported, not empty or no authority. These samples do not establish
the earliest supported release or change the package-wide floor.

The tested newer public kernel exposes the preview advisory in warnings, not a new
structured inventory field, and does not refresh spawn's Comms on renewal.
Kernel [#773](https://github.com/awebai/oats/issues/773) tracks those projection
limits. Provider code does not rewrite TASK or use environment/argv as a
metadata channel. No appTools setting, extra mint, discovery or new native flag
is introduced.

Implementation: `lib/grant-app-inventory.mjs` validates the optional pair as a
whole before persistence/display, copies only recognized fields, and bounds it
to 256 app entries, 1024 tools per app, 2048 characters per string and 64 KiB
of serialized inventory. Tool names in the recorded inventory must match
`^[A-Za-z0-9_][A-Za-z0-9_-]*$` without normalization. This is a deliberately
narrower informational contract than the native tool validator, not an authority
restriction. Unsupported/ambiguous display data becomes unavailable
without changing native authority; it is never trimmed or expanded. Current
receipt fixtures are byte copies of aw source873ed2bf; local substitute tests
do not prove live grant or Folio authority.

## Explicit round-trip probe

`oats aweb probe --home /absolute/canonical/home [--timeout 60] [--json]`
reports a verified nonce round trip when qualified CLI **and** server support
are available. It is an explicit send action, never a readiness/lifecycle check.
Admission requires the provider aw floor (1.36.33; the probe was
source-qualified at aw 1.36.28) and the exact selected hosted service `/meta`
`build.aweb_version` >=1.27.12; unavailable support refuses before sending.
There is no legacy fallback. The
selected-service guarantee holds modulo redirects issued by the selected origin
for unauthenticated heartbeat discovery only; signed mail and metadata refuse redirects. See [probe proof, JSON, compatibility and acceptance](docs/probe.md).

### Runtime delivery regression verification

`node --test test/oats-aweb-1-18.test.mjs test/codex-delivery-wire.test.mjs`
checks stale provider runtime, missing Codex target/primary stream, inconsistent
kernel receipts and retained native/joined routing. Readiness remains read-only.
With `OATS_PREVIEW_KERNEL_ROOT` selecting a real kernel installation or checkout,
`node --test test/public-kernel-codex-delivery.test.mjs` executes its
`prepareLaunchHooks` producer for preview, preflight and real provider hooks in
disposable homes. Ambient Claude selectors and a retained Claude recipe cannot
override the selected Codex runtime. This fixture uses fake aw for registration;
it does not start a harness or prove live receive. CI requires it against the
same pinned kernel as the launch-preview tests.

The sanitized live status sample and limits are recorded in
[test/fixtures/codex-delivery/README.md](test/fixtures/codex-delivery/README.md).

### Upgrade regression verification

`node --test test/oats-aweb-upgrade.test.mjs` checks literal historical and
current metadata, read-only planning, idempotent apply, safe runtime reads and
dispatch without `aw`. It shares the delivery fake-home fixture with the
1.18 tests. `test/oats-aweb-hook-1-13.test.mjs` checks the historical grant
upgrade followed by launch: registration precedes old-grant revocation, and a
failed registration keeps the old grant. All lifecycle effects use fake `aw`
and temporary homes. Run `npm run validate` for the manifests and schema.

CI also requires `test/public-kernel-upgrade.test.mjs` against the kernel at
`OATS_KERNEL_COMMIT`, with `OATS_PREVIEW_KERNEL_ROOT` selecting its checkout
and `OATS_PREVIEW_KERNEL_REQUIRED=1`. It uses the scratch-deployment helper,
fake aw and a sleeping harness: acquire the local v1.17.1 package bytes,
spawn a global-grant session seat, re-lock to this branch, stop, plan/apply
upgrade, and start again. It checks the module, migrated metadata, previous
version, upgrade event and registration-before-revocation ordering. CI fetches
the provider tags at checkout; the test never fetches or uses a live identity.
