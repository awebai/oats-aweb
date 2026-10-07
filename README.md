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

  New Claude/channel compositions default to
  `--dangerously-load-development-channels plugin:aweb-channel@awebai-marketplace`.
  Development is selected to avoid a silent missing receiver: aweb-channel is
  currently not on the default approved list. Explicit host-local
  `claudeChannelMode: approved` selects
  `--channels plugin:aweb-channel@awebai-marketplace`, which registers no aweb
  channel unless applicable managed `allowedChannelPlugins` for this identity
  lists the plugin and marketplace, or a future approval exists. Installation or
  a trusted marketplace is not approval. Launch and readiness retain
  `claude-channel-enrollment-unverified`: effective admission remains unverified,
  and Claude may run with no channel wake, potentially without a diagnostic.
  Where broker delivery is authorized, an operator may select `delivery: session`
  for an unattended home; this must not override an explicit native-channel
  requirement.

  Both modes contribute exactly one fixed plugin argument;
  `settings.oats.aweb.claudeChannelMode` selects argv, never consent. No automatic
  migration, consent inference, approved-to-development fallback or flip-back
  occurs. A future default change requires an explicit reviewed release.

  Development selection may stop at Claude Code's confirmation; nothing in this
  provider answers it. OATS 0.44.0 releases a narrowly qualified kernel controller
  under explicit exact-home operator consent in host-local configuration. Verify
  the selected kernel and exact executable/frame guards; a tag is not adoption.
  See the skill's [Channel selection and launch consent](oats-package/capabilities/oats-aweb/skills/oats-aweb/SKILL.md#4-how-messages-reach-you-delivery-and-wakes)
  recipe and [retained-result recovery](oats-package/capabilities/oats-aweb/skills/oats-aweb/references/launch-consent.md).
  A blocked result can retain an active session after Enter; inspect first, never
  automatically resend input or relaunch. Neither opt-in nor completion proves
  admission or receive readiness.

  Provider warnings describe selection, never an observed answer. Actual prompt
  outcomes belong to the kernel launch result and durable receipt, where
  supported; provider mode, consent and readiness do not establish them. Passing
  confirmation does not prove native receive; `native-receive-unproven` remains.

  Readiness uses the captured mode or an exact retained provider launch
  contribution, including historical development arguments. Missing evidence
  produces `claude-channel-mode-unproven`; current settings do not rewrite a
  home's history. Malformed or conflicting supplied evidence is a problem.
  Frozen homes keep their captured modules and arguments. The default applies
  only to new compositions; it does not enroll the plugin or recover an existing
  runtime. [Issue #44](https://github.com/awebai/oats-aweb/issues/44) remains open;
  [cjr adoption #673](https://github.com/awebai/oats/issues/673) is separate.

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
  Home readiness reports whether the configured supported route and observable
  broker prerequisites pass. It uses the home's captured delivery, runtime and
  final credential locator, plus retained joined membership. Claude Code and pi
  use native channels by default; Codex normally uses the supported external
  broker. A `ready` result does not certify recent endpoint observation, native
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
  canonical target, compatible running daemon, active/unpaused target, complete
  captured identity set and its delivery/ownership/event/control policy,
  admitted streams in the released `streaming` phase, running worker, and
  target/worker/binding errors. Missing required daemon, worker or stream
  evidence is a problem. The aw floor stays 1.36.13; its status lacks worker
  evidence, so that shape cannot establish the required broker prerequisites.

  Observation age, absent optional inspection evidence and an inspection in
  progress warn without making otherwise satisfied prerequisites unavailable.
  The 30-second threshold only labels old evidence with its age; it is not a
  readiness gate, broker guarantee or command timeout. Quiet workers inspect at
  startup and on events, so their observations can age without a transport
  failure. Missing observation evidence is unproven, never an invented
  successful inspection. Supplied timestamps must still be valid, nonfuture
  and consistently ordered; malformed or contradictory status is a problem.
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
  when current settings say `session`. A retained empty runtime string keeps its
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

- `claudeChannelMode`: `development` (default) or explicit `approved`, **host-only** in
  `oats-local.yaml` under `settings.oats.aweb`. Committed soul/workspace settings
  and spawn-provider overrides are rejected by the kernel. Explicit null, empty,
  wrong-type or unknown values fail before provider effects. This setting changes
  only Claude/channel arguments; Pi, Codex and `delivery: session` are unchanged.
- `root`: absolute directory whose `.aw` is the default team's minting root.
  This root is for one aweb team only.
- `roots`: map `{ <team id>: <absolute directory> }`. `roots[team]` wins over
  `root` and is required when a deployment mints into more than one aweb team.
  Each mapped directory owns its own `.aw` identity for exactly that team.
- `residents`: map of resident name to absolute custody directory for
  `identity.mode: global`; host-only because it points at custody material.
- `join`: comma-separated eligible labels to join at spawn.
- `identity`: local by default; `global` uses a named resident grant. For fresh
  GLOBAL creation in an existing hosted team versus resident reuse, follow the
  [existing-team GLOBAL resident journey](oats-package/capabilities/oats-aweb/skills/oats-aweb/references/existing-team-global-resident.md).
  Global spawn consumes a provisioned resident; it does not create one.
  GLOBAL grants default to `identity.ttl: 720h` (30 days, the native maximum)
  and `identity.renew: launch`: each actual launch re-mints, while preview
  makes no changes. Explicit `renew: off` retains the finite grant; explicit
  shorter valid TTLs remain supported. Durations must use Go syntax and fall
  between 60s and 720h; `E_GRANT_TTL` refuses invalid/out-of-range values
  before grant or launch effects, including retained-grant paths.
  Do not configure shorter TTLs for customer seats. A seat running beyond its
  expiry without a successful re-mint can still expire; non-expiring grants
  are requested upstream in [#80](https://github.com/awebai/oats-aweb/issues/80).
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

The general OATS >=0.30.0 compatibility floor applies to the remaining provider
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

## Isolated hostOnly contract verification

`test/claude-channel-host-only.test.mjs` imports the real generic `resolveSoul`
validator from public OATS source `bb2ba8c9a254edb745913b9c5a9d9b833fda932d`
(package 0.42.0), using this checkout's actual provider manifest. It checks both
mode values at soul, workspace and spawn-provider layers, the existing
`host-only-key` diagnostic and `oats-local.yaml` remedy, plus host-local origin
and omission controls. Unexpected fixture remote reads fail.

CI provisions that exact source outside test discovery and installs only its
required `yaml@2.9.1` dependency in a separate directory, with lifecycle scripts
disabled. It runs `OATS_HOST_ONLY_REQUIRED=1` with `OATS_HOST_ONLY_KERNEL_ROOT`
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

Closed policy, conflicting/unmapped declarations and invalid queries refuse
before acceptance when knowable. Later policy/mapping changes or failed writes
remain typed failures with observed partial state (or unavailable readback).
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
The package-wide OATS >=0.30.0 floor stays unchanged for other behavior.
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
refusal. This act needs those public query/mutation/readback features and selected
deployment dispatch. The pinned OATS 0.42 source
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

Run `node --test test/grant-duration.test.mjs test/oats-aweb-hook-1-13.test.mjs`
for duration boundaries, mint arguments, default/explicit renewal and retained
failure/preview controls. With `OATS_TEST_AW_1_36_23` pointing at the pinned
1.36.23 executable, `test/grant-duration-native.test.mjs` checks version, help
and duration flag parsing in an isolated home. It always passes `--help`:
no mint executes, and syntactically valid out-of-range values can pass this
help check. The 60s..720h range is separately enforced by provider tests and
qualified against native source `61c38162596d1af9085741d70d15900ff9894257`
(`cmd/aw/id_grant.go`). These checks are not live custody, grant or expiry
acceptance.


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
