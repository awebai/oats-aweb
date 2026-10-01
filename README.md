# oats-aweb

Official [OATS](https://github.com/awebai/oats) messaging-layer integration for
[aweb](https://aweb.ai). It provides per-instance native identities, mail/chat
skills, team roster discovery and session/channel delivery integration. Messaging
is separate from durable task tracking; the selected tasks provider owns tasks.

## 1.17.5 — team model v2 provider

Requires OATS >=0.30.0 and aw >= 1.36.13. This is the provider side of OATS
team model v2 (kernel 0.30): the kernel supplies the default team and eligible
teams, and oats.aweb never reads a provider `team` setting or the root's active
team as a fallback.

### Changed (breaking)

- Removed `settings.oats.aweb.team` and legacy `OATS_TEAM_ID` /
  `OATS_TEAM_LABEL(S)` semantics.
- The default comes from `OATS_DEFAULT_TEAM` (label), `OATS_DEFAULT_TEAM_ID`
  (provider id) and `OATS_DEFAULT_TEAM_FROM` (`deployment` or `soul`).
- `OATS_TEAMS` rows are exactly `{ label, team, default, from }`; eligible join
  targets are rows with `default: false`.
- The teams JSON field `defaultTeam` is `{ label, team, from } | null`; `oats aweb teams --json` emits it with
  `eligible`, `joined`, `left`, and `at`. `left[]` records visible live-read
  leaves (`reason: "no-longer-eligible"`, last 20).
- No default configured refuses readiness/spawn with
  `no teams configured: run \`oats aweb setup\``. An unmapped default has label
  + from but no id and refuses with
  `the default team <label> has no provider id yet: its owner runs oats aweb setup, then commits the id, or choose another default with oats teams default`.

Wider teams are still joined explicitly with `settings.oats.aweb.join` at spawn
or `oats aweb join` while live.

### Provider settings

Host-owned settings live under `settings.oats.aweb` (normally in
`oats-local.yaml`). The provider settings are:

- `delivery`: `channel` (default) or `session`. `channel` lets Pi/Claude aweb
  channel packages wake the session. `session` sets `AWEB_DELIVERY=session` and
  uses the host wake broker instead. With session delivery, the broker may
  present either a waiting-items line or the full mail/chat event; recovery
  after an uncertain crash or compaction uses `aw mail show --message-id <id> --json`
  or paginated `aw mail inbox --show-all --json` with `--cursor`, not
  mail read state or `--conversation-id`.
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
  release exists.
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
  `the default team <label> has no provider id yet: its owner runs oats aweb setup, then commits the id, or choose another default with oats teams default`.
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
`AWEB_IDENTITY_HOME`, so the service comes from the invite. With session
delivery the hook then runs `aw wake register`. The recorded alias is always
the requested one: if aw reports another, the hook keeps the instance name and
adds a warning that quotes nothing from aw's reply. Joined teams still use
invite + `aw id team accept-invite` under `--identity-home`.

Retire self-deletes with `aw workspace delete <workspace_id>`, taking the id
from the membership in `<home>/.aw/workspace.yaml` whose team and alias match
the recorded ones. It falls back to the alias when no entry matches. With
session delivery, `aw wake deregister` runs at the same time as the delete.
