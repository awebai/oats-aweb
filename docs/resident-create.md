# `oats aweb resident create`

`oats aweb resident create <name>` makes a GLOBAL resident identity in an
existing hosted aweb team. It serves the resident with a per-user custody
service and records it in the deployment, so that grant seats can be spawned
on it. It ships in oats.aweb 1.26.0 and needs aw 1.36.33 or later (the
provider's single floor) and OATS 0.48.0 or later.

Two routes create the identity:

- **The root route** (aw 1.36.48 or later): with no API key,
  the deployment's team root authorizes `aw id create` for the resident. This
  is the route for a deployment made by `oats aweb setup --username`: the team
  root is its signup principal, the owner of the namespace's organization. It
  asks the person for nothing.
- **The key route:** with `AWEB_API_KEY` set, `aw init --global` runs with the
  team's dashboard API key.

## Invocation

```
oats aweb resident create <name> [--dir <deployment>] [--root <dir>] [--authority-root <dir>] [--org <slug or id>] [--team-label <label>] [--plan] [--json]
AWEB_API_KEY=<key> AWEB_URL=<url> oats aweb resident create <name> [--dir <deployment>] [--root <dir>] [--team-label <label>] [--plan] [--json]
```

The first line is the root route; the second, the line the aweb dashboard
gives with the team's key, is the key route. Run it from the OATS deployment
directory (or pass `--dir`). Run inside an instance home, the kernel hands the
command that home's recorded settings instead of the deployment's.

- `AWEB_API_KEY` selects the key route: it is the team's provisioning key.
  Nothing ever prompts for a key, and no flag takes one. With no key and no
  team root the command refuses at once, naming both routes
  (`E_RESIDENT_KEY`).
- `AWEB_URL` is the aweb service of the key route. `AWID_REGISTRY_URL` is
  passed on only when it is set (a local stack uses it; hosted aweb does not
  need it).
- `--authority-root <dir>` names the team root of the root route, a directory
  holding the root's `.aw`. Without it the root is
  `settings.oats.aweb.roots[<team>]` for the resident's team (the team
  `--team-label` maps to, else the default team), else `settings.oats.aweb.root`.
  It does not combine with `AWEB_API_KEY`.
- `--org <slug or id>` names the organization of the root route's
  `aw id create --org`, as its slug or its UUID, never a domain. Without it the
  slug is derived from the team root's namespace (see [The root route](#the-root-route)).
  Like `--authority-root`, it does not combine with `AWEB_API_KEY`.
- `<name>` is the resident's name, an aweb alias; its address is
  `<namespace>/<name>`.
- `--root <dir>` is the resident's directory, R. It defaults to
  `<deployment>/.aweb-residents/<name>`.
- `--team-label <label>` names the label the resident's team is mapped under.
  Without it the label is derived from the team's name (see
  [The team and the default team](#the-team-and-the-default-team)). Before an
  init, a `--team-label` that already maps to a team is refused: the new
  resident's team is known only after the init, and if it is that team the
  label is already mapped.
- `--plan` runs the preflight and prints what would run and be written. It
  changes nothing and needs neither the key nor `AWEB_URL` (without it, the
  plan shows `AWEB_URL from your dashboard line`).
- `--json` answers one JSON-v1 envelope (examples below).

## What it does

| Stage | What runs | Effect |
| --- | --- | --- |
| arguments | Parses the command line. | None. |
| deployment | Finds the deployment and its `oats-local.yaml`. | None. |
| aw | `aw version` must be 1.36.33 or later. | None. |
| preflight | Reads R and the custody units; on Linux, `loginctl show-user <user> --property=Linger`; the kernel's `oats --version --json`, and with `--team-label` before an init, its teams; for a complete identity, `aw whoami --json` and `aw custody status --json` in R. | None, local or remote. |
| key | Chooses the route: the key route with `AWEB_API_KEY`, else the root route. For the root route: its aw floor, then `aw inbound-mode --json` and, without `--org`, `aw whoami --json` in the team root. | None, local or remote. |
| init | Key route: exactly `aw init --global --name <name> --do-not-touch-agents-md --json` in R, once. Root route: exactly the `aw id create` of [The root route](#the-root-route), once. | aw registers the identity at awid and asks aweb to create it in the team. |
| verify | `aw whoami --json` (adopting, and after the root route's create), `aw inbound-mode --json` (root route), `aw doctor identity --offline --json` and `aw doctor registry --online --json` in R. | None. |
| custody | Writes and loads the custody unit, then waits for `aw custody status --json` to be ready. | A per-user service. |
| record | Writes `settings.oats.aweb.residents.<name>: R` in `oats-local.yaml`; maps the resident's team under its label, and makes that label the default team where there is none. | Deployment configuration. |

Init is skipped when R already holds a complete global identity: the command
then verifies it, ensures its custody and records it (adopt). The preflight
decides from what R holds:

| R holds | Then |
| --- | --- |
| nothing, or does not exist | init creates the resident, by either route |
| `.aw/partial-init.yaml` (an earlier init that failed part way) | the key route's init continues it: aw reuses the saved key, so the DID is the same. Without a key it is refused (`E_RESIDENT_KEY`): only the key route continues a partial |
| `.aw/partial-init.yaml.<time>.<n>.rejected` (aw quarantined the key) | init runs once, and aw refuses with its own reconciliation message; there is no rerun |
| a complete global identity (`.aw/identity.yaml`, `signing.key`, `workspace.yaml`) | no init: verify, custody and record (adopted), or verification and unit refresh when it is already recorded. With the root route's pending marker, the inbound mode must read back first |
| only the root route's pending marker, and at most aw's `.aw/hosted-identity-create.json.lock` (aw refused the create before writing its recovery state) | the root route creates the resident |
| `.aw/hosted-identity-create.json` (an `aw id create` that was refused or interrupted, before or after it installed the identity), whatever else R holds | the root route's create runs again with the same arguments (resumed), and aw resumes it with the same key and removes that file on success. With a key it is refused (`E_RESIDENT_KEY`): only the root route resumes it. Never empty R: the identity may already exist |
| a complete global identity whose custody already runs, not from this command's unit | refused before any effect (`E_RESIDENT_CUSTODY_RUNNING`): stop that custody, then rerun |
| anything else | refused, naming what is there; R is never deleted and init never runs into it |

**Verify** fails unless aw init's answer shows `status: connected`,
`identity_scope: global`, the alias `<name>`, a canonical `<name>:<namespace>`
team id, a `did:aw` stable id and the `<namespace>/<name>` address. When
adopting there is no init answer: `aw whoami` gives the scope, alias, stable
id and address, and `aw doctor identity --offline` gives the team (its
subject's `team_id`) and the connection (its subject's `workspace_id`). In
every case the doctor's subject must be the global `<name>`, in a canonical
team, with a workspace. Every check `aw doctor identity --offline` runs
must be `ok`: with no identity at all, aw answers `status: ok` with every
check `info`, so the overall status is not enough. A failing
`aw doctor registry --online` is a warning only, because registry publication
can lag.

**Custody** must be running, with the resident's team ready, signing and E2EE
keys ready, and both floor ops listed: `mail_reply_continuation.v1` and
`grant_never_ttl.v1`. A custody whose status cannot be read, one that lacks
the ops and one that is not ready each fail with their own message.

## The root route

With no `AWEB_API_KEY`, the team root T (from `--authority-root`, else the
settings above) authorizes the create. It holds no API key: aw signs the
request with T's own identity, which aweb accepts when T owns the organization
of the namespace (for a deployment made by `oats aweb setup --username`, T is
the signup principal). The run is exactly:

```
aw --identity-home R/.aw id create --owner-identity-home T/.aw --org <org> --team-id <team id> --name <name> --inbound-mode contacts-only --json
```

- Both `--identity-home` and `--owner-identity-home` take the credential
  directory itself: R's `.aw` (fresh) and T's `.aw`. R is created, empty, first.
- It runs in T, once, with an environment built from nothing: `PATH`, `HOME`,
  `AW_NO_UPDATE_CHECK=1`, and `AWID_REGISTRY_URL` when set. No key, and no
  `AWEB_URL`: aw takes the service from T's workspace binding.
- `<team id>` is the `team_id` of `aw --identity-home T/.aw inbound-mode --json`,
  passed unchanged: aweb Cloud resolves it, whether it is the canonical
  `<name>:<namespace>` id (what aw answers) or a service UUID. An answer with
  no `team_id` is refused (`E_RESIDENT_VERIFY`, stage `preflight`).
- `<org>` is `--org`, else the slug of T's namespace: the `domain` of
  `aw --identity-home T/.aw whoami --json` when it is `<slug>.aweb.ai`, with
  exactly one label before `.aweb.ai`. Any other namespace (a customer-held
  domain, say) is refused, asking for `--org` (`E_RESIDENT_VERIFY`, stage
  `preflight`). aweb still checks that T owns that organization.
- The requested inbound mode is `contacts-only`. After the create,
  `aw inbound-mode --json` in R must read back `contacts_only`; anything else,
  `team_and_contacts` included, is a downgrade and fails `E_RESIDENT_VERIFY`
  before custody.
- Its aw floor is 1.36.48, the first aw whose `id create` takes
  `--owner-identity-home` and keeps `contacts_only` distinct. Below it the
  route refuses (`E_RESIDENT_AW_FLOOR`, stage `aw`), and so does its plan. The
  key route keeps the provider's floor.
- Before the create it writes `R/.oats-resident/root-route-pending`, and
  removes it once the inbound mode has read back. While it is there, a rerun
  that finds a complete identity in R reads the mode back before custody and
  record, so a refused or interrupted read-back is never adopted silently.
- A refusal is aw's text, as `E_RESIDENT_INIT`. The route keeps no captures.
  The rerun is the same command. aw writes `R/.aw/hosted-identity-create.json`
  (its recovery state, holding the signing seed) and its `.lock` before any
  remote call. While that file is there, the rerun runs the same create, never
  an adopt, even when the identity files are installed; aw checks that the
  parameters are the original ones, resumes with the same key, and removes
  the file once its own inbound read-back succeeds. The lock stays. So the
  rerun needs the same team root, `--org` and `--team-label`.
- Then verify, custody and record run as on the key route.

The root route's tests replay a fake aw whose answers for `id create` and the
team root's reads have the JSON shape of aw 1.36.49's source, not captures
(`test/helpers/fake-aw-resident.mjs`): no test runs the create against a real
server. Its live acceptance is a real run on the released aw.

## The key

- It is read only from `AWEB_API_KEY`. Nothing prompts for it.
- It is in the environment of one child process only: the init run. That
  environment is built from nothing: `PATH`, `HOME`, `AWEB_URL`,
  `AWEB_API_KEY`, `AW_NO_UPDATE_CHECK=1`, and `AWID_REGISTRY_URL` when set. No
  `AWEB_IDENTITY_HOME`, no other variable.
- Every other child gets no key and no `AWEB_*` variable. aw's reads in R
  (`aw version`, `whoami`, the doctors, `custody status`) run with `PATH`,
  `HOME`, `AW_NO_UPDATE_CHECK=1` and, when it is set, the init's
  `AWID_REGISTRY_URL`. (A global identity also keeps its registry in
  `.aw/identity.yaml`: aw's offline identity checks answer the same with and
  without it.) The unit managers get `PATH`, `HOME`, `XDG_RUNTIME_DIR` and
  `DBUS_SESSION_BUS_ADDRESS`; the kernel (its version, its teams and the team
  verbs) no `AWEB_*` or `AWID_*` variable.
- The command never opens, copies, moves or deletes a file under R's `.aw`:
  `.aw/partial-init.yaml` holds the identity's private signing key. It only
  lists the directory's names and reruns aw.
- It is never in argv, the custody unit, `oats-local.yaml`, the captures or
  any output, error paths included. aw's stdout, stderr and exit are kept only
  in `R/.oats-resident/init-<time>.{stdout,stderr,exit}` (directory 0700,
  files 0600), with the key's value replaced by `<redacted>` before they are
  written.
- After the init run the command drops it.

aw also adds `.aw/` to `.git/info/exclude` when R is inside a git worktree.
That is aw's own behaviour and touches no committed file.

## The team and the default team

The record stage maps the resident's team (the canonical id aw init returned,
or the one the doctor shows when adopting) under a team label:

- **The label** is `--team-label` when given. Without it, it is the team's
  name, the part of the id before `:`, normalised as `oats aweb setup`
  normalises team names: lowercase, `_` and `.` as `-`, no leading or trailing
  `-`. `default:acme.aweb.ai` gives `default`. A name that gives no team label
  of at most 64 characters is refused like a taken label (below).
- **The mapping** is `oats teams add <label> --team <id> --no-default` where
  the workspace allows local teams, read back. A label that already maps to
  the same team is reused. Where the workspace allows no local teams, the
  command changes nothing and prints the lines to commit in
  `oats-workspace.yaml`.
- **The default team.** A seat's grant is minted in the deployment's default
  team, so the label must be that default before a seat is spawned. Where the
  deployment has no default team, the command makes the label the default
  (`oats teams default <label> --if-absent`, read back); a workspace without
  local teams gets `defaultTeam: <label>` in its lines to commit. An existing
  default, the deployment's or the workspace's, is never changed: when it is
  another label, the output prints `oats teams default <label>` as its own
  first step, before the spawn line, with that reason and its consequence:
  it moves the default team of the whole deployment, so every later spawn of
  a soul without a default team of its own goes to the resident's team. That
  step is the operator's decision; the command never runs it. Where the workspace
  allows no local teams, that change is the workspace's, and only the mapping
  is printed to commit, and the output gives the reason before the spawn line
  (`Before spawning: …`; `stepsReason` in `--json`).

A plain `oats teams add` makes the first local team the deployment's default,
which wins over the workspace's, so it could replace a default. The kernel's
`--no-default` and `--if-absent` (feature `teams-conditional-default`, OATS
0.48.0) never do, and a kernel without that feature ignores those flags. So
the preflight asks the kernel (`oats --version --json`). Without the feature,
it refuses before any effect wherever the record stage would write through
the kernel, which is everywhere but a workspace that allows no local teams
(there the command writes nothing through the kernel and prints what to
commit). The refusal (`E_RESIDENT_TEAM_LABEL`, stage `preflight`) reads:
"oats aweb resident create needs OATS 0.48.0 or later
(teams-conditional-default), so that mapping the resident's team never
replaces a default team; the selected kernel is <version>: upgrade OATS with
`npm install -g @awebai/oats@latest`, then rerun".

**A label that maps to another team.** With `--team-label`, before an init,
any mapping of the label is refused in the preflight. A derived label can only
be checked at record: the team is known only once the key has been used. The
check runs after `aw init` and before the label is written. By then the
identity, its custody and `settings.oats.aweb.residents.<name>` are in place,
so the refusal (`E_RESIDENT_TEAM_LABEL`, stage `record`) names both teams, the
one the label maps to and the resident's, and what is in place in terms an
operator can check: R's path, the custody unit's label and file (the plist on
macOS), and `settings.oats.aweb.residents.<name>` in the deployment's
`oats-local.yaml`. It gives the rerun: `oats aweb resident create <name> --team-label <other>` (with
the run's `--dir` and `--root`, when it gave them). That rerun needs no API
key: it verifies the resident and adds the mapping; it is not a second create.

## The custody unit

aw has no install verb: `aw custody serve` takes no flags and serves the
identity home of its working directory. The command writes a per-user unit
that runs `<aw> custody serve` with working directory R and an environment of
`PATH` and `HOME` only. Its `PATH` is aw's directory (and its target's, when
aw is a link), the directory of the absolute `OATS_NODE_BIN` supplied by the
kernel (an npm-installed aw may need it) and `/usr/local/bin:/usr/bin:/bin`.
The kernel owns the node-path selection rule; the provider keeps that path,
including its stable link, without resolving it. If `OATS_NODE_BIN` is absent,
empty or relative, the provider falls back to `process.execPath`, retaining
compatibility with older kernels without increasing the package's kernel floor.
An unchanged selection leaves the unit running. Its label is `ai.aweb.custody.<namespace>.<name>`,
where `<namespace>` is the address's (`juan.aweb.ai` for
`juan.aweb.ai/alice`). It never serves a grant home and copies no keys.

A custody that already serves R, started by hand or by another supervisor, is
refused before any effect (`E_RESIDENT_CUSTODY_RUNNING`): aw refuses a second
server on a socket that answers, so a unit started beside it would restart in
a loop while the other custody answered. When another recognised unit for R is
found, the error names its label and file and gives the retirement steps below.
Otherwise it explicitly says no recognised unit was found (or no other unit,
when this command's own unit exists but is not the server): find and stop any
supervisor outside the recognised units (`aw custody stop` in R, or stop
whatever supervises it), then rerun. This command's own unit counts as
what serves R only when its process is running (launchd's `state = running`
with a pid; systemd's `active`/`running` with a main pid) and is the server. A
unit that is merely loaded, restarting against another custody, does not
count. The same check runs after the command starts its unit: the custody is
ready only when our unit's process serves it, and another process answering
fails `E_RESIDENT_CUSTODY_RUNNING`. Where `lsof` exists, the process must own
the custody socket (`lsof -t <socket>`). Where it does not, the same pid must
still be running a second later: aw refuses a second custody server on a socket
that answers, before it listens (aw 1.36.33, `cmd/aw/custody.go:235-238`), so
a process that stays up is the server, while a crash-looping aw exits within
milliseconds and launchd and systemd wait seconds before restarting it. A host
without `lsof` is never refused for that. The unit is idempotent: a re-run
leaves an unchanged unit as it is and loads it if it is not running. R reached through a symlink is the same directory. A unit of that label that serves another directory is
refused, naming both, and so is any `ai.aweb.custody.*.<name>` unit that
serves another directory, before any init. A same-root unit under another
label is also refused (`E_RESIDENT_UNIT_CONFLICT`) before any write, including
when unloaded. A running foreign custody is reported first as
`E_RESIDENT_CUSTODY_RUNNING`, with the same retirement steps. Discovery covers
`ai.aweb.custody.<namespace>.<name>` for this resident across namespaces;
arbitrarily named services are outside it. The command never adopts or removes
another unit. On macOS the operator runs `launchctl bootout gui/<uid>/<label>`
and moves the named plist out of `~/Library/LaunchAgents`. On Linux the operator
runs `systemctl --user disable --now <label>.service`, removes the named unit
file and runs `systemctl --user daemon-reload`. Then rerun resident create.

**macOS (launchd).** The agent is
`~/Library/LaunchAgents/ai.aweb.custody.<namespace>.<name>.plist` (`RunAtLoad`,
`KeepAlive`; its log is `R/.oats-resident/custody.log`).

| To | Run |
| --- | --- |
| see it | `launchctl print gui/$(id -u)/<label>`, and `aw custody status --json` in R |
| stop it | `launchctl bootout gui/$(id -u)/<label>` (a killed process is restarted) |
| start it | `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/<label>.plist` |
| remove it | `launchctl bootout gui/$(id -u)/<label>`, then delete the plist |

**Linux (systemd --user).** The unit is
`~/.config/systemd/user/ai.aweb.custody.<namespace>.<name>.service`
(`Restart=on-failure`, `WantedBy=default.target`), enabled by its path.
A user unit stops at logout unless the user lingers. Without lingering the
command stops in the preflight with the exact admin command,
`loginctl enable-linger <user>`.

| To | Run |
| --- | --- |
| see it | `systemctl --user status <label>.service`, `journalctl --user -u <label>.service`, and `aw custody status --json` in R |
| stop it | `systemctl --user stop <label>.service` |
| start it | `systemctl --user start <label>.service` |
| remove it | `systemctl --user disable --now <label>.service`, delete the unit file, then `systemctl --user daemon-reload` |

**Elsewhere** there is no unit. The command creates and verifies the resident,
then fails at the custody stage with the hand step: run `aw custody serve` in
R under a supervisor that keeps it running (working directory R, environment
`PATH` and `HOME` only), then rerun the command, which then verifies.

Removing the unit does not remove the resident: R and
`settings.oats.aweb.residents.<name>` stay until you remove them.

### After changing Node or aw

An existing unit is rewritten only by rerunning
`oats aweb resident create <name>` from the deployment, with the same `--root`
if one was used. It needs no API key for a complete identity, keeps the resident,
and rewrites and reloads a changed unit. Run it after updating the provider to
pick up `OATS_NODE_BIN`, or after changing a recorded executable path. Updating
OATS or restarting a seat alone does not rewrite the custody unit.

The kernel's node choice can survive a Homebrew upgrade through an `opt` link;
a version manager's selected version path still lasts only while that version
exists. See OATS's [After a change of Node version](https://github.com/awebai/oats/blob/main/docs/upgrading.md#after-a-change-of-node-version).

The unit also records the absolute first executable `aw` on the command's
`PATH`, without replacing it with its real path. If npm's global prefix is
inside a Node version, that `aw` path and its directory disappear when that
version is removed, even when the unit's node directory is stable. Before
removing the old version, install aw in the new version (for example,
`npm install -g @awebai/aw@latest`), ensure that aw is first on `PATH`, and rerun
resident create to refresh the recorded path. There is no separate stable-aw
selection rule. These path hazards are established from the unit-writing code;
the fixture tests do not prove live service-manager behaviour or what aw itself
retains of its inherited environment.

## A seat's registry

A grant seat on the resident verifies senders at an awid registry. Its grant
home records none, so aw would fall back to `AWID_REGISTRY_URL`, else to its
default registry (`https://api.awid.ai`), and mail from a resident on another
registry would read as `verification_stale`. So the spawn and launch hooks of a
seat (`identity.mode` global) give it `AWID_REGISTRY_URL`, set to the
`registry_url` that the resident's `.aw/identity.yaml` records (R, found
through `settings.oats.aweb.residents.<name>`), when that registry's origin is
not aw's default. When it is the default, or the identity records none, they
set nothing. The operator's own `AWID_REGISTRY_URL` is never passed on. A
recorded value that is not an http(s) registry origin is a readiness problem
(`custody`), and a spawn warning, and is not passed on. That message names
the identity file and the reason, never the value, which may hold
credentials.

## Output

Text: `PASS resident <address> team <team id> custody running`, with
`(resumed)`, `(adopted)` or `(already exists)` when that is what happened,
then any warnings, the unit, the recorded setting, the team label (whether it
was derived, mapped or already mapped), the default team when this command set
it or kept another, and the next step:

```
Next: spawn a seat on this resident: oats spawn <soul> --provider oats.aweb identity.mode=global --provider oats.aweb identity.resident=<name>
```

When another default team is kept, the steps are numbered, in the order to run
them, after the reason:

```
Next, in order (a seat's grant is minted in the deployment's default team, which is core (core:acme.aweb.ai), not default. Running oats teams default default moves the default team of the whole deployment: every later spawn of a soul without a default team of its own goes to default (default:acme.aweb.ai)):
  1. oats teams default default
  2. oats spawn <soul> --provider oats.aweb identity.mode=global --provider oats.aweb identity.resident=<name>
```

In `--json`, `result.teamLabel` is `{label, team, status, derived, default}`:
`status` is `added`, `reused` or `commit` (lines to commit, in `lines`), and
`default` is `set`, `already`, `kept` or `commit`. `result.steps` is every
command to run, in order (the spawn line last), with `result.stepsReason` and
`result.defaultTeam` when another default is kept. `result.next` is the spawn
step as a sentence.

A failure is `FAIL <stage>: <message>` on stderr. An init failure's message
is aw's own text (with the key redacted), so aw's "rerun the same command in
this directory" appears only when aw left a resumable partial. When an init
leaves neither a partial nor an identity, the message adds
`provisioning left nothing to continue; R contains …; contact aweb with
<capture path>`.

Exit status: 0 on success, 2 for a usage error, 1 for any other failure.

| Code | Stage | Meaning |
| --- | --- | --- |
| `E_RESIDENT_ARGUMENT` | arguments, preflight | usage, an invalid name, label or `--org`, no `AWEB_URL` for a key-route init, or `--authority-root` with `AWEB_API_KEY` |
| `E_RESIDENT_DEPLOYMENT` | deployment | no readable deployment |
| `E_RESIDENT_AW_FLOOR` | aw | aw missing or older than 1.36.33; for the root route, older than 1.36.48 |
| `E_RESIDENT_ROOT` | preflight | R holds something else, R is the team root, or the name is recorded at another R |
| `E_RESIDENT_UNIT_CONFLICT` | preflight, custody | a custody unit of this name serves another directory, or serves R under another label |
| `E_RESIDENT_LINGER` | preflight | Linux user without systemd lingering |
| `E_RESIDENT_CUSTODY_RUNNING` | preflight, custody | a custody already serves R, and not from this command's unit |
| `E_RESIDENT_RECORD` | preflight, record | `oats-local.yaml` cannot be updated safely |
| `E_RESIDENT_KEY` | key | no key and no team root (naming both routes), a team root without `.aw`, a partial without a key, aw id create's recovery state with a key, or a malformed key |
| `E_RESIDENT_INIT` | init | aw init or aw id create failed; aw's text |
| `E_RESIDENT_NOTHING_TO_CONTINUE` | init | aw init failed and left nothing to continue |
| `E_RESIDENT_VERIFY` | preflight, verify | the team root gives no team id or no `<org>.aweb.ai` namespace (preflight); the identity is not the connected global `<name>`, an offline check is not ok, or the root route's inbound mode reads back other than `contacts_only` |
| `E_RESIDENT_UNIT` | custody | a launchctl or systemctl command failed |
| `E_RESIDENT_UNIT_UNSUPPORTED` | custody | no unit on this host and custody is not running: the hand step |
| `E_RESIDENT_CUSTODY` | custody | custody not ready in 30 s: not running, team not ready, or ops missing |
| `E_RESIDENT_TEAM_LABEL` | preflight, record | the kernel lacks `teams-conditional-default` (OATS older than 0.48.0); `--team-label` already maps to a team (before an init); the label, given or derived, maps to another team (at record: rerun with `--team-label <other>`); or the kernel refused |

### The `--json` envelopes

Each envelope below is the command's real output for that outcome. The aw
answers it read are real aw 1.36.33 captures, and the paths and namespace are
replaced by placeholders: the deployment `/srv/deploy`, the home `/home/me`,
the namespace `acme.aweb.ai`. `test/resident-docs.test.mjs` produces each one
again and fails if it differs from this page.

Created:

<!-- envelope: created -->
```json
{
  "schemaVersion": 1,
  "ok": true,
  "result": {
    "outcome": "created",
    "name": "carol",
    "root": "/srv/deploy/.aweb-residents/carol",
    "address": "acme.aweb.ai/carol",
    "team": "default:acme.aweb.ai",
    "stableId": "did:aw:<stable id>",
    "custody": {
      "status": "running",
      "manager": "<launchd or systemd>",
      "label": "ai.aweb.custody.acme.aweb.ai.carol",
      "path": "<unit path>"
    },
    "recorded": {
      "file": "/srv/deploy/oats-local.yaml",
      "setting": "settings.oats.aweb.residents.carol"
    },
    "teamLabel": {
      "label": "default",
      "team": "default:acme.aweb.ai",
      "status": "added",
      "derived": true,
      "default": "set"
    },
    "warnings": [
      "aw doctor registry --online: awid.address.delivery_origin is warn (this can be publication lag)"
    ],
    "captures": [
      "/srv/deploy/.aweb-residents/carol/.oats-resident/init-20261010T120000Z.stdout",
      "/srv/deploy/.aweb-residents/carol/.oats-resident/init-20261010T120000Z.stderr",
      "/srv/deploy/.aweb-residents/carol/.oats-resident/init-20261010T120000Z.exit"
    ],
    "next": "spawn a seat on this resident: oats spawn <soul> --provider oats.aweb identity.mode=global --provider oats.aweb identity.resident=carol",
    "steps": [
      "oats spawn <soul> --provider oats.aweb identity.mode=global --provider oats.aweb identity.resident=carol"
    ]
  }
}
```

Continued from a partial (an earlier init failed after it saved its key):

<!-- envelope: resumed -->
```json
{
  "schemaVersion": 1,
  "ok": true,
  "result": {
    "outcome": "resumed",
    "name": "carol",
    "root": "/srv/deploy/.aweb-residents/carol",
    "address": "acme.aweb.ai/carol",
    "team": "default:acme.aweb.ai",
    "stableId": "did:aw:<stable id>",
    "custody": {
      "status": "running",
      "manager": "<launchd or systemd>",
      "label": "ai.aweb.custody.acme.aweb.ai.carol",
      "path": "<unit path>"
    },
    "recorded": {
      "file": "/srv/deploy/oats-local.yaml",
      "setting": "settings.oats.aweb.residents.carol"
    },
    "teamLabel": {
      "label": "default",
      "team": "default:acme.aweb.ai",
      "status": "added",
      "derived": true,
      "default": "set"
    },
    "warnings": [
      "aw doctor registry --online: awid.address.delivery_origin is warn (this can be publication lag)"
    ],
    "captures": [
      "/srv/deploy/.aweb-residents/carol/.oats-resident/init-20261010T120000Z.stdout",
      "/srv/deploy/.aweb-residents/carol/.oats-resident/init-20261010T120000Z.stderr",
      "/srv/deploy/.aweb-residents/carol/.oats-resident/init-20261010T120000Z.exit"
    ],
    "next": "spawn a seat on this resident: oats spawn <soul> --provider oats.aweb identity.mode=global --provider oats.aweb identity.resident=carol",
    "steps": [
      "oats spawn <soul> --provider oats.aweb identity.mode=global --provider oats.aweb identity.resident=carol"
    ]
  }
}
```

A complete identity adopted, then the same on a re-run once it is recorded (a
verification: no init, no new key, custody re-ensured and its unit refreshed if changed):

<!-- envelope: adopted -->
```json
{
  "schemaVersion": 1,
  "ok": true,
  "result": {
    "outcome": "adopted",
    "name": "carol",
    "root": "/srv/deploy/.aweb-residents/carol",
    "address": "acme.aweb.ai/carol",
    "team": "default:acme.aweb.ai",
    "stableId": "did:aw:<stable id>",
    "custody": {
      "status": "running",
      "manager": "<launchd or systemd>",
      "label": "ai.aweb.custody.acme.aweb.ai.carol",
      "path": "<unit path>"
    },
    "recorded": {
      "file": "/srv/deploy/oats-local.yaml",
      "setting": "settings.oats.aweb.residents.carol"
    },
    "teamLabel": {
      "label": "default",
      "team": "default:acme.aweb.ai",
      "status": "added",
      "derived": true,
      "default": "set"
    },
    "warnings": [
      "aw doctor registry --online: awid.address.delivery_origin is warn (this can be publication lag)"
    ],
    "captures": [],
    "next": "spawn a seat on this resident: oats spawn <soul> --provider oats.aweb identity.mode=global --provider oats.aweb identity.resident=carol",
    "steps": [
      "oats spawn <soul> --provider oats.aweb identity.mode=global --provider oats.aweb identity.resident=carol"
    ]
  }
}
```

<!-- envelope: already-exists -->
```json
{
  "schemaVersion": 1,
  "ok": true,
  "result": {
    "outcome": "already-exists",
    "name": "carol",
    "root": "/srv/deploy/.aweb-residents/carol",
    "address": "acme.aweb.ai/carol",
    "team": "default:acme.aweb.ai",
    "stableId": "did:aw:<stable id>",
    "custody": {
      "status": "running",
      "manager": "<launchd or systemd>",
      "label": "ai.aweb.custody.acme.aweb.ai.carol",
      "path": "<unit path>"
    },
    "recorded": {
      "file": "/srv/deploy/oats-local.yaml",
      "setting": "settings.oats.aweb.residents.carol"
    },
    "teamLabel": {
      "label": "default",
      "team": "default:acme.aweb.ai",
      "status": "added",
      "derived": true,
      "default": "set"
    },
    "warnings": [
      "aw doctor registry --online: awid.address.delivery_origin is warn (this can be publication lag)"
    ],
    "captures": [],
    "next": "spawn a seat on this resident: oats spawn <soul> --provider oats.aweb identity.mode=global --provider oats.aweb identity.resident=carol",
    "steps": [
      "oats spawn <soul> --provider oats.aweb identity.mode=global --provider oats.aweb identity.resident=carol"
    ]
  }
}
```

`--plan` on an empty R:

<!-- envelope: plan -->
```json
{
  "schemaVersion": 1,
  "ok": true,
  "result": {
    "outcome": "plan",
    "name": "carol",
    "root": "/srv/deploy/.aweb-residents/carol",
    "state": "create",
    "init": {
      "route": "key",
      "argv": [
        "aw",
        "init",
        "--global",
        "--name",
        "carol",
        "--do-not-touch-agents-md",
        "--json"
      ],
      "cwd": "/srv/deploy/.aweb-residents/carol",
      "awebUrl": "<AWEB_URL>",
      "env": [
        "PATH",
        "HOME",
        "AWEB_URL",
        "AWEB_API_KEY",
        "AW_NO_UPDATE_CHECK"
      ]
    },
    "verify": [
      "aw whoami --json (in /srv/deploy/.aweb-residents/carol, environment PATH and HOME only)",
      "aw doctor identity --offline --json (in /srv/deploy/.aweb-residents/carol, environment PATH and HOME only)",
      "aw doctor registry --online --json (in /srv/deploy/.aweb-residents/carol, environment PATH and HOME only)"
    ],
    "custody": {
      "manager": "<launchd or systemd>",
      "label": "ai.aweb.custody.<domain of the returned address>.carol",
      "path": "<unit path>",
      "runs": "/usr/local/bin/aw custody serve",
      "workingDirectory": "/srv/deploy/.aweb-residents/carol",
      "env": [
        "PATH",
        "HOME"
      ]
    },
    "record": "settings.oats.aweb.residents.carol: /srv/deploy/.aweb-residents/carol in /srv/deploy/oats-local.yaml",
    "teamLabel": "derived from the returned team's name after aw init, mapped with oats teams add --no-default where the workspace allows local teams, and the default team only where there is none; if that label already maps to another team, the run stops there, after aw init, with the identity, its custody and the residents setting in place, and names the --team-label rerun"
  }
}
```

An init that failed after saving its partial (here the local stack's 404 for
aweb Cloud's `workspaces/init`): rerunning the same command continues it.

<!-- envelope: init-partial -->
```json
{
  "schemaVersion": 1,
  "ok": false,
  "error": {
    "code": "E_RESIDENT_INIT",
    "message": "workspace init target was not found or the team was deleted (404): category=hosted_http_failure status=404 error_code=unknown request_id=unknown (response body omitted; remote effects unknown)\nrerun the same command in this directory; do not delete .aw/partial-init.yaml",
    "details": {
      "stage": "init",
      "root": "/srv/deploy/.aweb-residents/carol",
      "captures": [
        "/srv/deploy/.aweb-residents/carol/.oats-resident/init-20261010T120000Z.stdout",
        "/srv/deploy/.aweb-residents/carol/.oats-resident/init-20261010T120000Z.stderr",
        "/srv/deploy/.aweb-residents/carol/.oats-resident/init-20261010T120000Z.exit"
      ],
      "partial": "/srv/deploy/.aweb-residents/carol/.aw/partial-init.yaml"
    }
  }
}
```

A quarantined partial: aw's refusal, with no rerun.

<!-- envelope: init-quarantined -->
```json
{
  "schemaVersion": 1,
  "ok": false,
  "error": {
    "code": "E_RESIDENT_INIT",
    "message": "partial_init_reconciliation_required: rejected signing material at /srv/deploy/.aweb-residents/carol/.aw/partial-init.yaml.20261010T000000.000000000Z.1.rejected; use a different directory for a new identity or obtain operator reconciliation; rejected material is never restored automatically",
    "details": {
      "stage": "init",
      "root": "/srv/deploy/.aweb-residents/carol",
      "captures": [
        "/srv/deploy/.aweb-residents/carol/.oats-resident/init-20261010T120000Z.stdout",
        "/srv/deploy/.aweb-residents/carol/.oats-resident/init-20261010T120000Z.stderr",
        "/srv/deploy/.aweb-residents/carol/.oats-resident/init-20261010T120000Z.exit"
      ],
      "partial": null
    }
  }
}
```

An init that left nothing to continue:

<!-- envelope: nothing-to-continue -->
```json
{
  "schemaVersion": 1,
  "ok": false,
  "error": {
    "code": "E_RESIDENT_NOTHING_TO_CONTINUE",
    "message": "AWID_REGISTRY_URL=local is not supported by `aw init`; use an explicit localhost URL such as http://localhost:8010\nprovisioning left nothing to continue; /srv/deploy/.aweb-residents/carol contains .oats-resident; contact aweb with /srv/deploy/.aweb-residents/carol/.oats-resident/init-20261010T120000Z.stderr",
    "details": {
      "stage": "init",
      "root": "/srv/deploy/.aweb-residents/carol",
      "captures": [
        "/srv/deploy/.aweb-residents/carol/.oats-resident/init-20261010T120000Z.stdout",
        "/srv/deploy/.aweb-residents/carol/.oats-resident/init-20261010T120000Z.stderr",
        "/srv/deploy/.aweb-residents/carol/.oats-resident/init-20261010T120000Z.exit"
      ],
      "partial": null
    }
  }
}
```

A customer-held (BYOT) team: OATS makes no BYOT check of its own. aw refuses
such a team in a preflight before it registers anything, and its message
passes through unchanged as an `E_RESIDENT_INIT` failure, like the two above.
The aw release with that preflight is pending; when the floor moves to it, its
captured text joins these examples.

`--plan` on an empty R by the root route, with `settings.oats.aweb.root` at
`/srv/deploy/.aweb-roots/default`:

<!-- envelope: plan-root -->
```json
{
  "schemaVersion": 1,
  "ok": true,
  "result": {
    "outcome": "plan",
    "name": "carol",
    "root": "/srv/deploy/.aweb-residents/carol",
    "state": "create",
    "init": {
      "route": "root",
      "argv": [
        "aw",
        "--identity-home",
        "/srv/deploy/.aweb-residents/carol/.aw",
        "id",
        "create",
        "--owner-identity-home",
        "/srv/deploy/.aweb-roots/default/.aw",
        "--org",
        "acme",
        "--team-id",
        "default:acme.aweb.ai",
        "--name",
        "carol",
        "--inbound-mode",
        "contacts-only",
        "--json"
      ],
      "cwd": "/srv/deploy/.aweb-roots/default",
      "authorityRoot": "/srv/deploy/.aweb-roots/default",
      "authorityFrom": "settings.oats.aweb.root",
      "env": [
        "PATH",
        "HOME",
        "AW_NO_UPDATE_CHECK"
      ]
    },
    "verify": [
      "aw whoami --json (in /srv/deploy/.aweb-residents/carol, environment PATH and HOME only)",
      "aw inbound-mode --json, which must read back contacts_only (in /srv/deploy/.aweb-residents/carol, environment PATH and HOME only)",
      "aw doctor identity --offline --json (in /srv/deploy/.aweb-residents/carol, environment PATH and HOME only)",
      "aw doctor registry --online --json (in /srv/deploy/.aweb-residents/carol, environment PATH and HOME only)"
    ],
    "custody": {
      "manager": "<launchd or systemd>",
      "label": "ai.aweb.custody.<domain of the returned address>.carol",
      "path": "<unit path>",
      "runs": "/usr/local/bin/aw custody serve",
      "workingDirectory": "/srv/deploy/.aweb-residents/carol",
      "env": [
        "PATH",
        "HOME"
      ]
    },
    "record": "settings.oats.aweb.residents.carol: /srv/deploy/.aweb-residents/carol in /srv/deploy/oats-local.yaml",
    "teamLabel": "derived from the returned team's name after aw id create, mapped with oats teams add --no-default where the workspace allows local teams, and the default team only where there is none; if that label already maps to another team, the run stops there, after aw id create, with the identity, its custody and the residents setting in place, and names the --team-label rerun"
  }
}
```

No key and no team root:

<!-- envelope: key -->
```json
{
  "schemaVersion": 1,
  "ok": false,
  "error": {
    "code": "E_RESIDENT_KEY",
    "message": "no AWEB_API_KEY in the environment and no team root to authorize the resident: for the root route, set settings.oats.aweb.root (or settings.oats.aweb.roots[<team>]) to the directory holding the team root's .aw, or pass --authority-root <dir>; for the key route, run AWEB_API_KEY=<key> AWEB_URL=<url> oats aweb resident create carol",
    "details": {
      "stage": "key",
      "root": "/srv/deploy/.aweb-residents/carol"
    }
  }
}
```

R holds something else:

<!-- envelope: root -->
```json
{
  "schemaVersion": 1,
  "ok": false,
  "error": {
    "code": "E_RESIDENT_ROOT",
    "message": "/srv/deploy/.aweb-residents/carol is neither empty, a partial aw init nor a complete global identity: it contains notes.txt; never init into it: choose another --root or empty it yourself",
    "details": {
      "stage": "preflight",
      "root": "/srv/deploy/.aweb-residents/carol"
    }
  }
}
```

A custody unit of this name already serves another directory:

<!-- envelope: unit-conflict -->
```json
{
  "schemaVersion": 1,
  "ok": false,
  "error": {
    "code": "E_RESIDENT_UNIT_CONFLICT",
    "message": "custody unit <other unit path> already serves /srv/other, not /srv/deploy/.aweb-residents/carol; remove that unit or choose another name",
    "details": {
      "stage": "preflight",
      "root": "/srv/deploy/.aweb-residents/carol"
    }
  }
}
```

An offline identity check that is not ok (here, no identity at all):

<!-- envelope: verify -->
```json
{
  "schemaVersion": 1,
  "ok": false,
  "error": {
    "code": "E_RESIDENT_VERIFY",
    "message": "aw doctor identity --offline: identity.local.context is info, not ok (No identity.yaml was found.); identity.local.identity_scope is info, not ok (Identity class is unavailable because no identity context was found.); identity.local.did_key_format is info, not ok (Identity did:key is unavailable because no identity context was found.); identity.local.signing_key_matches_did is info, not ok (Signing key comparison is unavailable because no identity context was found.); identity.local.stable_id_expected is info, not ok (Stable ID expectation is unavailable because no identity context was found.); identity.local.address_expected is info, not ok (Address expectation is unavailable because no identity context was found.); identity.local.registry_url_source is info, not ok (Registry URL source is unavailable because no identity context was found.)",
    "details": {
      "stage": "verify",
      "root": "/srv/deploy/.aweb-residents/carol",
      "captures": [
        "/srv/deploy/.aweb-residents/carol/.oats-resident/init-20261010T120000Z.stdout",
        "/srv/deploy/.aweb-residents/carol/.oats-resident/init-20261010T120000Z.stderr",
        "/srv/deploy/.aweb-residents/carol/.oats-resident/init-20261010T120000Z.exit"
      ]
    }
  }
}
```

A custody already running, started by hand, when adopting:

<!-- envelope: custody-running -->
```json
{
  "schemaVersion": 1,
  "ok": false,
  "error": {
    "code": "E_RESIDENT_CUSTODY_RUNNING",
    "message": "custody for carol is already running in /srv/deploy/.aweb-residents/carol, and not from this command's unit ai.aweb.custody.acme.aweb.ai.carol: no recognised unit was found; find and stop any supervisor outside the recognised units: run `aw custody stop` in /srv/deploy/.aweb-residents/carol (or stop whatever supervises it), then rerun; a unit started beside it would restart in a loop against it",
    "details": {
      "stage": "preflight",
      "root": "/srv/deploy/.aweb-residents/carol"
    }
  }
}
```

A custody without the floor ops:

<!-- envelope: custody -->
```json
{
  "schemaVersion": 1,
  "ok": false,
  "error": {
    "code": "E_RESIDENT_CUSTODY",
    "message": "custody preflight failed for carol: status=running; required custody operations are missing: mail_reply_continuation.v1, grant_never_ttl.v1; restart the custody on aw 1.36.33 or later (upgrade aw, restart the custody service and the wake daemon, then oats sync)",
    "details": {
      "stage": "custody",
      "root": "/srv/deploy/.aweb-residents/carol",
      "captures": [
        "/srv/deploy/.aweb-residents/carol/.oats-resident/init-20261010T120000Z.stdout",
        "/srv/deploy/.aweb-residents/carol/.oats-resident/init-20261010T120000Z.stderr",
        "/srv/deploy/.aweb-residents/carol/.oats-resident/init-20261010T120000Z.exit"
      ]
    }
  }
}
```

Created where the workspace's default team is another (`core`), which is kept:

<!-- envelope: default-kept -->
```json
{
  "schemaVersion": 1,
  "ok": true,
  "result": {
    "outcome": "created",
    "name": "carol",
    "root": "/srv/deploy/.aweb-residents/carol",
    "address": "acme.aweb.ai/carol",
    "team": "default:acme.aweb.ai",
    "stableId": "did:aw:<stable id>",
    "custody": {
      "status": "running",
      "manager": "<launchd or systemd>",
      "label": "ai.aweb.custody.acme.aweb.ai.carol",
      "path": "<unit path>"
    },
    "recorded": {
      "file": "/srv/deploy/oats-local.yaml",
      "setting": "settings.oats.aweb.residents.carol"
    },
    "teamLabel": {
      "label": "default",
      "team": "default:acme.aweb.ai",
      "status": "added",
      "derived": true,
      "default": "kept"
    },
    "warnings": [
      "aw doctor registry --online: awid.address.delivery_origin is warn (this can be publication lag)"
    ],
    "captures": [
      "/srv/deploy/.aweb-residents/carol/.oats-resident/init-20261010T120000Z.stdout",
      "/srv/deploy/.aweb-residents/carol/.oats-resident/init-20261010T120000Z.stderr",
      "/srv/deploy/.aweb-residents/carol/.oats-resident/init-20261010T120000Z.exit"
    ],
    "next": "spawn a seat on this resident: oats spawn <soul> --provider oats.aweb identity.mode=global --provider oats.aweb identity.resident=carol",
    "steps": [
      "oats teams default default",
      "oats spawn <soul> --provider oats.aweb identity.mode=global --provider oats.aweb identity.resident=carol"
    ],
    "stepsReason": "a seat's grant is minted in the deployment's default team, which is core (core:acme.aweb.ai), not default. Running oats teams default default moves the default team of the whole deployment: every later spawn of a soul without a default team of its own goes to default (default:acme.aweb.ai)",
    "defaultTeam": {
      "label": "core",
      "team": "core:acme.aweb.ai"
    }
  }
}
```

The label derived from the team's name already maps to another team:

<!-- envelope: team-label-taken -->
```json
{
  "schemaVersion": 1,
  "ok": false,
  "error": {
    "code": "E_RESIDENT_TEAM_LABEL",
    "message": "the team label default, derived from the name of team default:acme.aweb.ai, already maps to default:other.example. This check runs after aw init and before the label is written. Already in place: the resident's identity in /srv/deploy/.aweb-residents/carol, its custody unit ai.aweb.custody.acme.aweb.ai.carol (<unit path>), and settings.oats.aweb.residents.carol in /srv/deploy/oats-local.yaml; only the team mapping is missing. Rerun with another label: oats aweb resident create carol --team-label <other>. That rerun needs no API key: it verifies the resident and adds the mapping; it is not a second create",
    "details": {
      "stage": "record",
      "root": "/srv/deploy/.aweb-residents/carol",
      "captures": [
        "/srv/deploy/.aweb-residents/carol/.oats-resident/init-20261010T120000Z.stdout",
        "/srv/deploy/.aweb-residents/carol/.oats-resident/init-20261010T120000Z.stderr",
        "/srv/deploy/.aweb-residents/carol/.oats-resident/init-20261010T120000Z.exit"
      ]
    }
  }
}
```

## The joint real-stack E2E

Acceptance is the joint E2E against aweb Cloud's local stack (local Cloud,
AWID, PostgreSQL, Redis) with the published aw and the oats.aweb release
under test, at its **tagged** commit. It runs the dashboard's line
verbatim:

```
AWEB_API_KEY=<key> AWEB_URL=<local Cloud url> AWID_REGISTRY_URL=<local AWID url> oats aweb resident create <name>
```

`AWID_REGISTRY_URL` is needed only because the local stack's registry is not
the default one.

**Fixture contract.**

1. A fresh OATS deployment D with the release under test pinned, OATS 0.48.0
   or later, and aw 1.36.33 or later on PATH. Nothing about the resident is
   configured in advance.
2. The command, run in D, creates the resident in R
   (`D/.aweb-residents/<name>`), its custody unit, and
   `settings.oats.aweb.residents.<name>`. It maps the resident's team under
   the label derived from its name and, D having no default team, makes that
   label D's default: a seat's grant is minted in the default team.
3. A minimal soul for the seat: `soul.yaml` with `schemaVersion: 2`, a `name`,
   a `description` and `work: directory`, and nothing about identity.
4. The seat: the printed steps, in order (the spawn line, with `<soul>`
   replaced), with `--preview` first. Spawn mints the seat's grant from the
   resident's custody, and the seat's environment carries the resident's
   registry (`AWID_REGISTRY_URL`, the local AWID).

What each acceptance item exercises here:

| Item | This command's part |
| --- | --- |
| 1. the dashboard line runs verbatim in a fresh deployment | the env form above |
| 2. custody serves the resident; a seat spawn mints a grant | the custody unit and its readiness check |
| 3. the seat sends and receives verified mail | none (the seat's grant and custody) |
| 4. kill during init, rerun, same DID | init continues aw's own `.aw/partial-init.yaml`; OATS has no fault hook (the kill point is below) |
| 5. rerun after success: no change, no new key | the pure verify (`already-exists`) |
| 6. the key in no file or environment | the key rules above |
| 7. the plain command still works | none (the dashboard's) |

**The kill point (item 4).** aw writes `.aw/partial-init.yaml` before it
registers the identity at awid, and both happen before it posts to aweb's
workspace init. The E2E kills the init after the registration is observed at
awid and before the workspace-init POST completes. A partial may hold a
registered or a not-yet-registered DID: either way the rerun is the same
command, and aw continues it. OATS adds no registration check of its own. A
partial can also survive a later hosted, certificate or connect failure, and
the same rerun applies. When aweb answers with a different identity, aw removes
the partial or quarantines it as `.rejected`, and its text, with no rerun, is
the answer.

## What CI covers, and what only the E2E covers

| Behaviour | Proven by |
| --- | --- |
| Registration at awid, a forced failure with the key in no output and no file, and a rerun with the same DID | CI: real aw 1.36.33 against aweb's local stack (`test/resident-journey.test.mjs`) |
| aw's refusal when `AWID_REGISTRY_URL` changes, passed through unchanged | CI: the same journeys |
| Adopting a complete identity, a real custody unit (systemd --user on Linux, launchd on macOS) until custody is ready, and a pure-verify rerun | CI: the same journeys (macOS when run locally) |
| The child environment, argv, refusals, the unit files, the custody op checks, the envelopes | Unit tests replaying real aw 1.36.33 captures (`test/resident-create.test.mjs`, `test/custody-unit.test.mjs`, `test/resident-docs.test.mjs`) |
| The hosted init's success answer, the trees a success and a killed run leave, and two hosted refusals that keep the partial (a different `--name`; a name taken since, aweb's 409) | Unit tests replaying aweb's captures from its local Cloud preview (`test/resident-cloud-captures.test.mjs`) |
| A complete create from the API key | Only the joint E2E: aweb Cloud's `/api/v1/workspaces/init` is not in the OSS stack |
| The root route's argv, environment, route selection, floor, `--org` derivation, inbound read-back and plan | Unit tests against a fake aw answering in the JSON shape of aw 1.36.49's source (`test/resident-root-route.test.mjs`) |
| Resuming aw's recovery state (refused, lost response, interrupted after installation) and the lock-only root | Unit tests against a fake aw that follows aw 1.36.49's recovery file layout (`test/resident-root-route.test.mjs`) |
| A complete create by the root route | Only a live run against the released aw 1.36.48 and aweb Cloud |
| Continuing a partial to a complete identity | Only the joint E2E |
| A quarantined (`.rejected`) partial made by aw | No stack: aw makes one only when aweb answers with a different identity than it registered, which no honest server does. Unit tests replay aw's real refusal of a quarantine file |
| A customer-held (BYOT) team's refusal | Only the joint E2E, once aw's preflight is released |
| The printed steps run verbatim through a real kernel with `teams-conditional-default`: no default (set), the workspace's default (kept, `oats teams default` first), and a reused label; each reaches a passing `--preview` and a `--no-launch` scaffold whose grant is recorded on the resident, and its retire leaves no active grant of that seat | CI: the same journeys |
| The derived label, its refusal and the `--team-label` rerun, lines to commit, an older kernel's refusal | Unit tests with a fake kernel whose answers follow the real kernel's (`test/resident-create.test.mjs`) |
| A seat's `AWID_REGISTRY_URL` from the resident's identity, never the operator's | Unit tests on a real aw 1.36.33 `identity.yaml` (`test/resident-seat-registry.test.mjs`) |
| Mail between seats | Only the joint E2E |

## Fixtures

The unit tests read aw output from `test/fixtures/resident`: runs against
aweb's local stack, captured verbatim by `capture.sh`, and in `cloud/`, runs
against aweb Cloud's local preview stack, captured by aweb. Each is labelled
with the aw version and commit, the capture date and its source (the README
there). The one file that is not aw's output is the empty quarantine file aw's
real refusal is captured against; the README says so. `identity-global.yaml`
is a resident's `.aw/identity.yaml` as aw wrote it, which holds no key. They are
never acceptance evidence: acceptance is the joint E2E. They are refreshed with
`capture.sh` whenever aw's output contract changes.
