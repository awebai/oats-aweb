# Changelog

## Unreleased

**New grant seats never expire.** A GLOBAL seat spawned on this release gets a
grant that ends only when revoked (oats-aweb#80).

**One setting keeps a duration:** `identity.ttl`, for example
`identity: { ttl: 720h }` (`never`, or a Go duration from 60s to 720h).

**What bounds a grant now:** its scopes, revocation at retire, and revocation by
the resident's owner. A revoked grant's next request is refused at once; an open
notification stream ends within about 30 seconds.

**Host order, before syncing to this release:** upgrade aw to 1.36.32 or later,
restart every resident custody service and the host wake daemon, then
`oats sync`. A running custody or daemon keeps its old code until it is
restarted, so a custody started before the upgrade fails a grant seat's
readiness and spawn (below), and an old daemon is reported as a warning.

- `identity.ttl` defaults to `never` for a new mint at spawn. A renewal keeps the
  seat's duration: the captured `identity.ttl`, else the ttl the renewed grant
  recorded, else 720h for a grant minted before this release, so an existing
  seat never silently stops expiring. Every mint passes its ttl explicitly
  (`--ttl=never` or the duration), though aw's own default is now never, and
  records it and the renew mode (`identity.grant.ttl`, `identity.grant.renew`).
- A minted grant's `expires_at` must answer its request: the string `"never"`
  for a never-grant (recorded as `expiresAt: "never"`), a timestamp for a
  duration. Anything else fails the mint closed: the grant is revoked and
  nothing is kept. A renewal now also revokes a new grant whose receipt fails
  validation. When the aweb service refuses a never mint (a server without
  never-grants answers 422, or 404 before the grants endpoint), aw mints
  nothing: the error carries aw's message, nothing is kept, nothing is revoked
  and nothing is retried with a duration. A named "not supported yet" message
  waits on an aw-side diagnostic (oats-aweb#97).
- The aw floor is 1.36.32, the one client floor (`AW_MIN`): spawn, commands,
  `setup --check-only`, readiness and the probe refuse an older aw with one
  message naming the installed version, the floor and
  `npm i -g @awebai/aw@latest` (or `npm i -g @awebai/aw@1.36.32`).
  `setup --install-aw` installs `^1.36.32` by default. aw 1.36.31 lets an agent
  reply to a sender outside its team roster (a dashboard human in aweb Cloud's
  agent chat); aw 1.36.32 mints grants that never expire. Hosts on aw 1.36.28
  to 1.36.31 lose the probe, whose CLI floor was 1.36.28.
- Grant seats probe their running custody's ops (`aw custody status --json`),
  never its version. A never seat requires `grant_never_ttl.v1`; an E2EE seat
  (the default) requires `mail_reply_continuation.v1`, beside its E2EE ops. When
  either is missing, readiness reports the `custody` problem and the spawn and
  renewal mint preflight fail before any mint, with "required custody
  operations are missing: <ops>; restart the custody on aw 1.36.32 or later
  (upgrade aw, restart the custody service and the wake daemon, then oats
  sync)". A seat with an explicit duration does not require the never op. A
  seat with `identity.e2ee: false` does not require the reply op and cannot send
  the encrypted reply to such a sender. A custody status that cannot be read
  says "custody status could not be read: …", never that an op is missing.
- Revocation is the only end of a never-grant, and no grant is left unrevoked
  silently. Wherever a revoke fails, the grant is recorded in the home
  (`.oats-aweb/pending-revokes.json`: grant id, custody directory, team and
  recorded expiry, never keys), the message names it, how long it stays valid
  ("until revoked", or "until <expiry> unless revoked" for a duration) and the
  exact command, `aw id grant revoke <id>` run in the resident's custody
  directory, and readiness warns `grant-revoke-pending` until it clears. Every
  later start and retire retries the record; a successful revoke clears it.
  - A new grant that renewal or spawn does not keep (team mismatch, custody
    attachment, wake registration, a receipt that fails validation) and cannot
    revoke fails that start or spawn. The renewal's three silent catches
    ("expires by TTL if revoke fails") are gone. For a failed spawn the
    durable carrier is the returned meta, not the record: the kernel's
    rollback runs retire with that meta (`identity.grant.id`), and a record
    written in a home the rollback removes does not survive it.
  - The previous grant after a successful renewal does not fail the start: the
    seat runs on its new grant, and the previous one is recorded.
  - Behaviour change: retire exits nonzero while any grant remains unrevoked,
    for every grant, keeps the record in the home and the grant's identity in
    its meta for the retry, and its message replaces "it still expires at …".
- `wake-daemon-outdated` is now a readiness warning, not a problem: a running
  wake daemon below the floor still receives, readiness goes on to assess the
  target, and the remedy is "upgrade aw, then restart the host wake daemon".
  `wake-daemon-not-running` and `wake-daemon-version-unknown` stay problems.
  This supersedes the decision that a daemon below the floor is a readiness
  problem.
- A renewing launch (`renew: launch`) now reports the custody preflight's
  warnings (`e2ee-disabled`), as spawn does.
- Replies need `mail.read` with `mail.send`, because custody re-reads the source
  message; the NORMAL grant profile has both, and a send-only custom grant fails
  closed (`grant_scope_denied`). A late reply to a human whose key in the
  original message has expired fails by design: ask them to send a new message.
- Grant lifetime in readiness, from the grant recorded at a grant seat's last
  mint (no aw or custody call). A never-grant gets the informational
  `grant-never-expires`, and the agent's brief says it never expires. A grant
  with a duration gets `grant-expiring` (warning) within 7 days of expiry,
  `grant-expired` (problem) at or after it, and `grant-expiry-unknown` (warning)
  when the record has no readable expiry. Each names the recorded instant and
  that seat's remedy: `renew: launch` with a never or unrecorded ttl gets
  "restart the seat to renew it (`oats session restart --home <home>`)"; a
  duration, which a restart would mint again, gets "respawn the seat";
  `renew: off`, where a restart keeps the grant, gets "respawn the seat (or set
  `renew: launch` and respawn)". A grant minted before this release records
  neither and gets a remedy true for both. LOCAL seats are unaffected.
  neither and gets a remedy true for both: restart, or respawn if renew is off
  or the ttl is short. LOCAL seats are unaffected.
- Grant seats still default to `identity.ttl: 720h` and `identity.renew:
  launch`, and every mint (spawn and renewing launch) passes an explicit
  `--ttl`; tests now pin both. Non-expiring grants are not available yet: aw and
  the aweb server cap a grant at 30 days (oats-aweb#80).
- Forward port of 1.24.1 (released from release/1.24, oats-aweb#95): `oats aweb
  setup --join <label>` and username setup on a workspace that forbids local
  team writes (`local-teams-closed`) refuse only when the plan needs a team
  write. A label the workspace commits to the predicted or joined team, already
  the default, needs none: the join records its minting root
  (`roots[<team>]`), and username setup proceeds to the account bootstrap,
  without touching the team configuration. An unmapped label on a closed
  workspace still refuses before any aw call. On a closed workspace a
  conflicting mapping or another configuration failure is reported as that
  (`E_SETUP_TEAM_CONFLICT`, `E_SETUP_CONFIGURATION`) rather than as
  `E_SETUP_POLICY`; both still refuse before any write. Known limit: a closed
  workspace that commits the label but defaults to a different label still
  refuses, though the join would only preserve that default.
- Add explicit `aweb probe --home` command and offline round-trip implementation:
  one nonce send, exact signed plaintext/decrypted-v2 reply proof, bounded
  deadlines and public diagnostic projections. No lifecycle/readiness probe,
  identity provisioning, terminal input or uncertain-send retry.
- Probe admission checks the provider aw floor (above; the probe was
  source-qualified at aw 1.36.28) and the exact selected hosted service `/meta`
  build.aweb_version >=1.27.12, a probe-only server floor, with bounded
  unauthenticated observation, explicit-root config checks and no legacy
  fallback. The selected-service guarantee holds modulo
  redirects issued by the selected origin for unauthenticated heartbeat discovery
  only; signed mail and metadata refuse redirects.
  No live acceptance is claimed.
  See `docs/probe.md` for proof limits, JSON timing semantics and separate live
  acceptance requirements.

## 1.24.0 — 2026-10-09

Docs (#87): the oats-aweb skill's section 4 documents the approved Claude channel
route as the recommended unattended setup. `claudeChannelMode: approved` passes
`--channels plugin:aweb-channel@awebai-marketplace` (no development prompt), and
Claude admits the plugin when the host's managed policy sets `channelsEnabled`
and lists it in `allowedChannelPlugins`. On hosts without server-managed settings
or MDM that is a root-owned `managed-settings.json` a human admin writes once.
Host steps, the startup check, failure remedies and the precedence caveat are
in the skill; development mode with the kernel's exact-home consent remains the
fallback, qualified only for Claude 2.1.289 darwin-arm64. The default stays
development. The approved launch warning no longer cites a future approval;
see Added for the verdict it now warns.

Added (#88, #89): readiness of a home whose captured `claudeChannelMode` is approved reads
the machine managed-settings file (`/etc/claude-code` on Linux,
`/Library/Application Support/ClaudeCode` on macOS: `managed-settings.json`,
then `managed-settings.d/*.json`) read-only and warns one verdict:
`claude-channel-policy-admitted` (`channelsEnabled` true and the
`aweb-channel@awebai-marketplace` entry), `claude-channel-policy-not-admitted`
(naming the missing key or the wrong marketplace), `claude-channel-policy-malformed`
(a file is not a JSON object; per code.claude.com/docs/en/managed-settings.md, Claude Code refuses
to start while a managed-settings file cannot be parsed) or
`claude-channel-enrollment-unverified` (absent, unreadable or an unsupported
platform). An approved launch reads the same file and warns the same verdict,
and nothing when the file admits the plugin, so admitted hosts no longer see
`claude-channel-enrollment-unverified` at every start. The file is evidence,
not proof: server-managed settings or MDM override it, and only the nonce
exchange proves receive. No environment variable moves the path.

Fixed (#91): retire's recovery copy no longer keeps the instance's aweb private
keys. The capability declares `retirement.disposable.home`: `.aw` (the local
identity, or the retained seat's copy of a standing identity), `.aweb-identity`
(the global grant home; the prefix form does not match the bare name),
`.aweb-identity-*` (joined-team and stamped grant homes) and `.oats-aweb`
(provider state: `teams.json` and the default-retire marker; declaring it also
stops the retire hook's own marker write from forcing an `after-hooks/home/`
copy). All four are provider state, not the instance's work. The kernel leaves
them in the home until it removes the home, retire hooks see them, an
incomplete cleanup keeps the home with them, and a retry reads them from the
home, never from recovery. `recovery.json` and the retire result's
`workRecovery.notCopied` name each excluded entry with owner `oats.aweb`. The
OATS floor rises from `>=0.30.0` to `>=0.42.0`: kernels 0.30–0.41 accept the
declaration but do nothing with `home`, so they would keep copying keys while
the package says otherwise; 0.42.0 is the first that excludes declared home
entries. Homes spawned before this version are still copied whole at retire,
because the kernel records the declaration at spawn. A failed spawn's
preservation (directory mode) is the exception: it copies the whole home, keys
included. `oats retire --force` past an incomplete aweb cleanup now leaves no
copy of the key; the outstanding membership is cleaned up by the team's
controller or owner (the emitted controller command, or member removal in the
hosted dashboard).

Changed (#91): retire exits nonzero when a joined-team leave fails for any reason but
`team_not_hosted` (whose controller cleanup needs no member key), on every way
out after the joined-team loop: a completed self-delete, the completed
default-retire marker on a retry, and a retained seat. The kernel then keeps
the home, and with it the `.aweb-identity-<label>` key that alone can leave the
team. The meta keeps what it reported before (`joinedTeams` still lists the
team, `pendingControllerCleanup`, the warning) and adds `retired: false`,
`reason: "joined-team-leave-failed"` and `failedLeaves` (the labels); an
already incomplete result (`self-delete-failed`, `no-local-identity-key`) keeps
its own reason. `aliasReusable` and `aliasReason` still describe the default
identity. On the retry the default-retire marker stops a second self-delete,
the leave runs again with its key, and a successful leave exits 0. A
`team_not_hosted` leave failure keeps exit 0 with its warning and controller
command. `team_not_hosted` is now recognized only as aw states it: its whole
external-home refusal (exit 2, the one stderr line naming this identity home as
the principal and ending `(reason: team_not_hosted)`) or
`alias_released_reason`. Text elsewhere in an error (the identity home's path,
an HTTP error's prose) no longer passes for a controller refusal; an
unrecognized refusal keeps the home and its key.

## 1.23.2 — 2026-10-07

Added (#76): GLOBAL grant metadata records validated actual
app snapshots from successful native mint receipts at spawn and renewal.
Comms labels its immutable at-spawn snapshot; public inspect exposes current
recorded metadata and preview warnings distinguish retained inventory from
unknown pending renewal. Malformed optional inventory is unavailable with a
fixed diagnostic, without invalidating a valid grant. Brief/advisory text contains
only app IDs, tool counts and skip codes; recorded tools require plain identifiers.
No appTools setting,
extra mint, live app acceptance or captured-home adoption is implied.

## 1.23.1 — 2026-10-07

Fixed (#78): first labelled LOCAL join records its verified canonical mapping
and default through the selected public kernel. Setup is operator-serialized;
existing defaults are preserved, with an explicit no-write refusal when adding
a mapping would shadow a workspace default. Partial failures retain the root
and report observed state; tokenless retry verifies membership without another
redemption. Root recording handles kernel-wrapped scalar paths on resume while
preserving neighboring settings. No atomic configuration guarantee is added.

Fixed (#82): LOCAL launch and no-effect preview return the explicit instance
identity-home selector, matching spawn. GLOBAL grant locators and delivery/joined
metadata are unchanged. The omission predates 1.23.0.

## 1.23.0 — 2026-10-07

Changed: GLOBAL grants default to the aw maximum of 720h (30 days) and are
renewed at each actual launch by default (previously 8h and renewal off).
Shared native-compatible duration validation refuses values outside 60s..720h
before grant/launch effects, including retained paths; explicit shorter valid
TTLs and `renew: off` remain supported. Preview never mints; LOCAL behavior and
renewal failure/custody/cleanup rules are unchanged. Existing captured homes
are not automatically updated. 720h still expires: a seat running beyond it
without a successful re-mint can expire. Non-expiring grants have been requested
from aw (oats-aweb#80); that requirement is not solved by this change.

Documentation (#72): add the released kernel 0.44.0 exact-home operator consent
recipe, narrow launch qualification, receipt interpretation and retained-session
recovery. Preserve the released completion limitation tracked in oats#754;
source progress or issue closure does not establish a released general fix or
local adoption. No provider prompt automation or live qualification is added.

Added (#71): `oats aweb invite [--label L] [--plan] [--json]` issues a LOCAL
hosted member invite from the selected deployment team root. No recipient alias
is accepted; the accepting side chooses its name. Plans read without minting or
claiming permission. Native/server authority decides issuance, with isolated
credentials/controller state, deliberate token-once output and secret-safe
HTTP denial/error handling. Unsupported controller-only routes do not borrow
ambient authority. Unrelated kernel team warnings do not block issuance;
failures and selected-label warnings refuse with safe codes. Membership reads
also isolate native HOME and clean temporary state, including plans. Paired labelled stdin acceptance guidance and pinned native
loopback/public dispatch regressions accompany the source change; no live
issuance, timed journey or installed qualification is claimed.

Added (#70): hosted username setup selects a normalized default team label or
explicit `--label`, verifies exactly one matching LOCAL membership and alias,
then applies mapping/default through the selected public kernel and reads back
the result. Exact mappings and retained roots resume without another signup;
conflicts never overwrite shared declarations. `--plan` has no bootstrap,
installation or configuration effects. Closed policy refuses before bootstrap;
other failures remain typed errors. Partial writes preserve the root and report
observed configuration, including a default implicitly set by `teams add`.
This release does not establish local adoption or timed onboarding.

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
