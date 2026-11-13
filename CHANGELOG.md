# Changelog

## Unreleased

- **Fixed: a retained seat with no membership of its team is refused before
  any effect (#256).** A retained seat's spawn (`identity.source`) binds the
  seat on the deployment's default team, else the source's active team. When
  the source's `teams.yaml` had no membership of that team, the spawn copied
  the seat and failed only at `aw workspace connect`. Now the spawn refuses
  first, after the team check and before the lock, and a soul's readiness
  reports the same text: the team, the source, and the fixes (accept the
  team's invite with `aw id team accept-invite` or fetch its certificate with
  `aw id team fetch-cert` in the seat's parent directory, or make the seat's
  team the deployment's default, naming the seat's active team when it
  differs). The membership is matched as aw matches it (trimmed, ASCII case
  ignored). A source with no `teams.yaml` is refused too, as aw refuses it. A
  `teams.yaml` outside the form aw writes, or with no `memberships` list, and
  the membership's certificate file are still left to aw at connect.

- **Fixed: a soul's readiness reports every retained-seat refusal it can
  decide (#247).** A retained seat's spawn (`identity.source`) refuses before
  any effect when the source is not an absolute path, holds no `signing.key`,
  records no usable `aweb_url`, or no team can be determined (no default team
  id and no active team in `<source>/teams.yaml`). Readiness reported only the
  `aweb_url` one. It now reports each, with the spawn's own text, from the one
  check the spawn makes. For such a seat at soul scope, readiness no longer
  reports "no messaging root" or "no teams configured", which the retained
  spawn never refused on: it mints nothing, and takes its team from the
  source when the deployment has no default team. The spawn's team refusal
  now comes before its lock check and is printed in full, and a source with
  no `signing.key` now names the fix: point `identity.source` at the member's
  `.aw` directory. A lock another seat holds is still checked only at spawn.
  A seated home's readiness is unchanged.

- **Changed: a retained seat reads its aweb service only from its own record
  (#241).** A retained seat's spawn (`identity.source`) took its service from
  `OATS_AWEB_URL` when that was set, and from the seat's
  `<source>/workspace.yaml` `aweb_url` only otherwise, so a spawn and the
  rebind command a retire prints could name different servers. The service
  now comes only from that `aweb_url` (aw writes it at `aw workspace
  connect`): any http or https URL with a host, a path prefix or an IPv6
  literal included, with no userinfo, query, fragment, whitespace or control
  characters. The file is read in the form aw writes it (a top-level key and
  its value on one line, and its `memberships:` list), and a
  `workspace.yaml` in any other form is refused whole. The reader decides
  only that `aweb_url` and is not a YAML validator: a file that isn't valid
  YAML may still be accepted, and the URL checks still bound what reaches
  aw. The service is never printed: a failed
  spawn withholds aw's own output, which may name it. `OATS_AWEB_URL` is no
  longer read. A seat with no such `aweb_url` is refused before anything is
  copied or locked, and the refusal names the fix: run `aw workspace connect
  --service <the team's aweb server>` in the seat's parent directory (the one
  that holds its `.aw`), then spawn again. A soul's readiness reports the same
  refusal as a `needs-configuration` problem; a seated home's readiness does
  not read the source again. While `OATS_AWEB_URL` is set, the
  refusal says the variable is no longer read, and a spawn that has a record
  warns that the variable is ignored; neither prints its value. The rebind
  a retire prints names the server in a command only when it is a plain
  service URL (http or https, a host, an optional port, and no path but `/`
  or `/api`); otherwise it says to run `aw workspace connect` there with the
  service in its `workspace.yaml`. **If you set
  `OATS_AWEB_URL` for a retained seat:** record the server in the seat with
  that `aw workspace connect` and unset the variable. A seat whose
  `workspace.yaml` already names its server is unchanged.

- **Fixed: team ids are compared as aw spells them (#252).** aw lowercases a
  team id's name and domain, and drops a trailing dot from the domain. A
  deployment can configure the id in another case (`Default:Example.Test`),
  and each comparison of the configured id with one aw reports was exact. So:
  - a spawn warned "team mismatch" on every mint;
  - a join failed with "joined team differs", or found no root;
  - a grant renewal kept the previous grant;
  - retire's self-delete missed the workspace id;
  - the roster missed the record and the presence, and setup took its own
    mapping for another team;
  - setup refused an invite to a mapped team (`E_SETUP_JOIN_MISMATCH`,
    `E_SETUP_LABEL_COLLISION`), or redeemed one for a team a root was
    already in;
  - a joined team that became the default was left at launch;
  - the probe refused the target as `contradictory-team`;
  - a `roots` entry, which setup records under aw's spelling, was missed, so
    the hook minted and read from `root` instead.

  Every such comparison, in the hook and its libs, now goes through one canonical
  comparison (`lib/aweb-team-id.mjs`), and every `roots` lookup takes the entry
  aw reads as the same team when no key matches exactly. Two entries that both
  do (and no exact one) count as none, as before. Setup records a team's root
  under the key that already names it, in its own spelling, never a second one. The joined certificate's file
  is found by the name aw gives it. Values the hook writes or prints keep the spelling
  the kernel or aw gave. Nothing a deployment must change.

- **Removed: the captured-execution path (#242).** The captured bindings
  (the `OATS_BINDING_FILE`, `OATS_INVOCATION_CONTEXT_FILE` and
  `OATS_SOURCE_RECEIPT_FILE` variables, and the `binding` and `invocation`
  inputs of the binding wire) are removed, with the code that read them
  (`lib/captured-execution.mjs`, `lib/captured-native.mjs`,
  `lib/invocation-shape.mjs`, `lib/portable-binding.mjs` and
  `PORTABLE-PROFILE-STATUS.md`). The kernel never set them: it runs only the
  wire's `check`, with a workspace context and the readiness action, which
  answers as before. What a deployment that set them now sees:
  - an event (spawn, retire, launch, upgrade) with any of the variables set
    runs its normal path and warns, once per variable, `<NAME> is ignored:
    captured bindings are not supported since oats.aweb 1.42.0; readiness
    takes a workspace context (oats readiness)`; a text command (setup,
    roster and the others) writes the same line to stderr. The variable's
    value and its file are never read or printed;
  - the wire's `normalize` and `bind`, and a `check` whose input carries
    `binding` or `invocation`, answer `provider-not-qualified` with that
    reason, in the wire's usual refusal envelope;
  - `binding.reasons` in `oats.json` no longer lists the reasons only the
    captured path returned, and lists that reason.
  Before, one stray variable sent every event down the captured path, where
  any error exited 1: a retire with one set failed. Now none fails on them.
  Readiness through `oats readiness` is unchanged. To migrate, unset the
  variables and use `oats readiness`.

- **Fixed: a mint killed after the service registered the identity is
  released or named, no longer orphaned (#240).** A spawn's
  `aw init --join-from` could register the new identity and then be killed or
  fail before aw wrote the home's workspace binding. Spawn found no bound
  identity and answered no meta, so no retire could find the registration, and
  the alias kept a certificate that no home knew about. Spawn now writes the
  intended mint (team, alias, root, time) to the home's
  `.oats-aweb/pending-mint.json` before aw starts. It removes the file once the
  identity is in its answer, or once aw confirms a refusal. A mint that fails
  any other way answers `pendingMint` in its meta. Retire acts on the intent
  when the home holds no binding: it reads the team's members from the root,
  and never finishes the mint.
  - A certificate whose `member_did_key` is the home key's is recorded with
    the controller's `aw id team remove-member` command, and the warning says
    the identity was registered but could not be released.
  - A home with no key gets no command, since the certificate is most likely
    another instance's: retire points to `oats aweb roster` and the members
    read. Nothing is recorded.
  - No certificate for the alias: retire says nothing was registered.
  - A members read that fails: the outcome is unknown. Retire names the read,
    and exits nonzero with the home kept.

  Retire never decides a registry aw would decide differently. When the
  root records a plain `registry_url` for the team's membership, the members
  read, the command and the record carry it. Otherwise the read passes no
  `--registry`, so aw resolves the registry itself. The record then stores
  none, and the command omits `--registry` and says the registry isn't
  recorded here. The roster's note on a command with no recorded registry is
  now `(the registry was not recorded; the command omits --registry)`, for
  every entry.

  A later spawn's alias refusal says when this host's record names a
  certificate a retire left for that alias and team, and points to
  `oats aweb roster`, which decides whether to show the controller's command. A new on-disk
  file in the home, `.oats-aweb/pending-mint.json`, and a new meta key,
  `pendingMint`, which a failed spawn answers. Nothing a deployment must
  change.

- **Fixed: a boolean setting left empty reads as its default (follows
  #232).** An empty YAML value (`e2ee:`) is `null`, which always meant the
  default but has been refused since #232, at spawn, at readiness and at the
  next start, where the only fix was a respawn. `null` now reads as unset for
  `identity.e2ee` (default: E2EE required), `identity.takeOver` (default: no
  take-over) and `health.publish` (default: off). The empty string `""` is
  still refused. Nothing a deployment must change.

- **Fixed: boolean settings given as strings are read (#232).** `oats spawn
  --provider oats.aweb key=value` passes every value as a string, and oats.aweb
  compared its boolean settings with `true` and `false` only, so
  `identity.e2ee=false` was ignored and the seat still required E2EE. Every
  boolean setting, `identity.e2ee`, `identity.takeOver` and `health.publish`,
  now accepts `true`/`false` and the strings `"true"`/`"false"`, through one
  reader that spawn, start and readiness share. Any other value is refused
  with text that names the setting, the accepted values and where to set it:
  `identity.e2ee must be true or false (the strings "true" and "false" are
  accepted too); set it under settings.oats.aweb.identity in …`. A bad
  `identity.e2ee` or `identity.takeOver`, which before this release was
  ignored, is refused by spawn and start before any effect, and by readiness
  as a `needs-configuration` problem. A bad `health.publish`, which was
  already refused, is refused where it is read, as before (the health
  commands and readiness, now as a `needs-configuration` problem); its
  refusal keeps its first words and adds the accepted strings and where to
  set it. A
  retire reads neither `identity` setting, so a bad value never fails a
  retire. **If a soul or workspace sets `identity.e2ee` or
  `identity.takeOver` to anything but a boolean or its string,** its next
  spawn or start refuses: set the value to `true` or `false`.

- **Fixed: a retired mark on an active member reads as a conflict (#235).**
  The retired-certificates record is writable by any agent running as the
  deployment's user, so an entry naming a live colleague's certificate made
  `oats aweb roster` mark that member retired and offer its controller a
  command to remove it. A marked member whose workspace reads `active` in
  presence now shows `recorded as retired, but its workspace is active: check
  before removing` instead of the mark and the command, and the footer does
  not count it. In `--json`, its `retired.command` is `null`, it carries an
  additive `retired.conflict: "workspace-active"`, and `problems` names it with
  source `retired-record`, as a malformed entry is named. The record is
  untouched. A marked member whose workspace is offline, that has none, or
  whose presence could not be read is shown as before. Nothing a deployment
  must change.

- **Fixed: a retained seat keeps `AWEB_IDENTITY_HOME` at every start
  (#226).** A retained seat (`identity.source`) was recorded as identity mode
  `global` with no grant, so no start answered an identity home for it, and
  the kernel, which drops a provider's earlier env names before it merges a
  start's answer, started the session without one: `aw` then worked only when
  run from the home itself. A retained seat holds its identity in the home's
  `.aw`, so spawn now records it as mode `local`, and every start answers
  `AWEB_IDENTITY_HOME=<home>/.aw`. A seat recorded before this fix is
  normalised at its next start: only its recorded mode changes, from `global`
  to `local`, and only for a retained seat with no grant. Readiness accepts a
  retained seat with no joined-team file in either mode. A retained seat now
  takes the local path everywhere: its start runs no grant code, and
  `oats aweb join` no longer refuses it with `E_TEAM_GLOBAL_MODE` as if it
  acted through a session grant (retire already leaves a retained seat's
  joined teams before it releases the seat).

- **Fixed: the roster never prints a controller command it read from a file
  (#230).** `oats aweb roster` printed, for a certificate a retire left
  behind, the `command` stored in `<deployment>/.oats-aweb/retired-certificates.json`,
  which any agent running as the deployment's user can write, and retire took
  the command's `--registry` from any value in a home's identity files that
  started with `http(s)://`. Retire and the roster now build the controller's
  `aw id team remove-member` command with one builder, from a team that is a
  valid aweb team id, a certificate id of letters, digits, `_` and `-`, and a
  registry that is a plain origin (scheme, host and port only). A registry
  that is not one is reported as "could not be determined", as a missing one
  is, and the command omits `--registry`. The record now also holds the
  structured `registry` (or `null`) beside `team` and `certificateId`, and
  still writes `command`, rebuilt, so an older provider reads it as before.
  A recorded entry the command can't be built from shows no command: its line
  says its record entry is malformed and why, `--json` gives
  `retired.command: null`, and `problems` names it; the rest of the roster is
  unchanged. An entry recorded before this release has no registry: its
  command omits `--registry`, and its line says the registry was not
  recorded. Nothing a deployment must change.

- **Fixed: a retained seat's lock whose holder is not on this host can be
  released, and says how (#227).** A retained seat's lock
  (`.aw-retained-seat.json` beside its `identity.source`) whose holder home is
  not on this host, or that could not be read, made every later spawn of that
  identity fail with "was taken by another spawn a moment ago", and
  `identity.takeOver: true` did not help. Such a lock is still never released
  by age or automatically: the holder's home may be on another host or
  container that shares the source. The spawn now refuses, naming the holder
  (instance, host, since and home, as the lock records them) and the release:
  once that seat is confirmed gone, spawn with `identity.takeOver: true`
  (`--provider oats.aweb identity.takeOver=true`), which clears the lock with a
  warning, or remove the lock file, which the refusal names. A lock whose
  holder home exists here is refused as before. `identity.takeOver=true` given
  on the command line now takes effect: the kernel passes it as the string
  `"true"`, which the hook used to ignore, for a holder whose home exists too.
  OATS's `docs/container.md` ("Making a seat") still says that when the
  holder's home is gone `identity.takeOver` does not apply and the lock is
  removed by hand: the OATS pin PR that moves to this release changes that
  paragraph.

- **Fixed: a retained seat's spawn that fails or is killed never deletes the
  standing identity's workspace (#228).** A retained seat's spawn (`identity.source`)
  that failed after `aw workspace connect` without restoring the binding, or
  was killed (for example at the kernel's hook timeout), left the kernel no
  meta. Its compensating retire then took the alias from the home's
  `.aw/workspace.yaml` and ran `aw workspace delete` with the standing
  identity's key, deleting the workspace of a seat the operator admitted by
  hand. Such a retire now goes by the home's captured settings, whose
  `identity.source` is what made the spawn take the retained route: it
  retires the home as a retained seat, with no workspace delete, the lock
  released, and, when the spawn had taken the seat, the `aw workspace connect`
  command that binds the identity back to its source (its values printed only
  when they pass their own shapes). That holds even when no local binding
  survived, since aw binds on the service before it writes the home's
  `workspace.yaml`. Nothing in the home's
  provider state decides it. A retained seat's retire now releases its lock
  only when the lock names this home: a lock another seat took over, or one
  that cannot be read, is left in place, and the retire says so; so is one it
  can't remove or can't check, with the reason. A connect that fails is now
  treated as one that may have bound the identity: the spawn binds it back
  from the source, and it keeps the copy and the lock if that fails. A spawn
  that never held the lock is retired as releasing nothing. An
  `identity.source` that is not a string (a one-element list, say) is now
  refused at spawn before the lock: spawn read it as a path, while retire
  didn't classify it as a retained seat. OATS's `docs/container.md`
  ("Making a seat") still says not to interrupt a seat's spawn, because a
  spawn killed after it connected can delete the standing identity's
  workspace. The OATS pin PR that moves to this release changes that bullet.

- **Fixed: the hook's `aw` calls end before the kernel kills the hook
  (#229).** The kernel kills a spawn, launch or retire hook at 120 s. The
  hook gave its own calls more than that between them: the mint alone could
  take 120 s after the version and broker checks, the grant route chains
  several 60 s calls, and a retained seat up to six. So the kernel's limit
  came first, and the hook's own handling of a call that completed late (a
  mint reported for compensation, a grant to revoke) never ran, while the
  killed hook's `aw` child could finish after the compensating retire had
  found nothing. Every `aw` call of a lifecycle hook (the version read, the
  retire's background wake deregistration and every other) now ends by one
  deadline, 100 s after the hook started (elapsed time, which a wall-clock
  correction doesn't move), whatever its own timeout, and a call
  the deadline leaves no time for is not started and fails as "not started:
  the hook's 100 s deadline had passed". A lifecycle hook ends a call its
  timeout cuts with SIGKILL, which a child can't catch, rather than SIGTERM,
  so the call can't outlive the deadline, and no `aw` child outlives the hook,
  whichever way it exits. `OATS_AWEB_HOOK_BUDGET_MS` shortens
  the deadline for tests; nothing lengthens it.

## 1.41.0 — 2026-11-12

Requires OATS >=0.68.0. The aw floor stays 1.36.33 and the tested aw 1.36.58. A join killed after aw accepted its invite no longer leaves a membership the home doesn't know about: the next join, leave or retire settles it (#217). `oats aweb roster` marks the certificates a retire on this host left in a people-controlled team, with the controller's command (#207). Readiness names a wake stream aw 1.36.58 reports as `refused` (#214), and CI runs the BYOT create shapes against the real tested aw (#215). Nothing a deployment must change.

- **CI: the BYOT create shapes run against the real tested aw.**
  `test/aw-byot-create-shapes.test.mjs`'s three real-aw tests ran only with
  `OATS_AWEB_TEST_AW` set, which CI never set, so they always skipped. The
  resident-journey leg at the tested aw (`AW_TESTED`, now 1.36.58) now sets
  it to that leg's installed aw and fails when any test skips or fewer than
  the three real-aw tests pass. The floor leg skips the step: those tests
  need aw 1.36.56 or later.

- **Changed: readiness names a stream aw 1.36.58 reports as `refused`.** From
  aw 1.36.58 the host wake broker shows a stream the server refused as
  `refused`, never admitted, with its cause and next attempt, and retries it.
  Readiness reported that home with only its general message, "broker target
  reports streams not admitted or malformed admission evidence". It now
  reports the same problem, `wake-stream-unavailable`, as "broker receive
  stream for team <team> is refused by the server (cause <cause>); the broker
  retries it on its own, next at <time>; fix what the server refused, then
  restart the home to register it again, which retries at once". The cause
  (an HTTP status, a terminal event's name or `silence`) and the time are
  named only in aw's shape; the error text never is. A refused stream still
  never reads as ready. A target not admitted for another reason keeps the
  general message, and `quarantined` from an aw below 1.36.58 is read as
  before.

- **`oats aweb roster` marks certificates that retires left behind.** In a
  team whose controller key is held by people, `aw workspace delete` cannot
  remove the member (`team_not_hosted`), and retire's warning reached only its
  caller. Retire now also records each such certificate on this host, in
  `<deployment>/.oats-aweb/retired-certificates.json` (team, certificate id,
  alias, instance, time and the controller's `aw id team remove-member`
  command; mode 0600, the newest 500). Its warning and
  `pendingControllerCleanup` meta are unchanged; a record that cannot be
  written adds one warning and changes nothing else. The roster matches the
  team's listed certificates on team and certificate id: a matched line ends
  `; retired by OATS on this host <date>; the team controller removes it with:
  <command>`, the footer counts them, and `--json` adds `retired: {at,
  instance, command}` to those members. An unreadable record is a
  `retired-record` problem. The record starts with retires after this upgrade,
  so earlier leftovers won't show, and only on the host where the retire ran.

- **Fixed: a join killed after aw accepted its invite no longer leaves a
  membership the home doesn't know about (#217).** `oats aweb join` and a
  spawn's `join=` used to record a joined team only after `aw id team
  accept-invite` and `aw workspace connect`, so a hook killed between them
  left a membership that `leave` and retire never released. The join now
  writes its intent (label, team, identity home, alias, the root it mints
  from, time) to the home's
  `.oats-aweb/teams.json` as `pendingJoins` before the accept. The write that
  records the joined team drops the intent, in one atomic write. An intent
  left behind is settled as follows:
  - **`oats aweb join --labels <label>`** adopts it: it connects what the
    accept left and records it. It mints no second invite and no longer
    refuses the occupied identity home.
  - **`oats aweb leave --labels <label>`** adopts it and releases it through
    the same `aw workspace delete` as a recorded joined team.
  - **Retire** does the same for every intent. While a release that needs the
    member key fails, retire keeps the key and the intent and exits nonzero.
    Retire already does this for a recorded joined team, and the
    `team_not_hosted` controller hand-off is unchanged.
  - **Nothing to release.** An identity home with no identity, or one whose
    `aw id team list` doesn't list the team, has its intent dropped and the
    home removed. When that list fails, nothing is removed, and the message
    says to rerun.
  - **An interrupted hosted accept is not "nothing".** aw's hosted accept
    writes `pending-hosted-accept` beside the signing key before its server
    call, and removes it only once the certificate is stored (aw 1.36.33 and
    later). If that marker is in the identity home, an empty team list doesn't
    mean the server holds no membership. join, leave and retire keep the home,
    the key, the marker and the intent, and exit nonzero; join mints nothing.
    The message names the recovery: rerun the same `aw id team accept-invite`
    with the original invite (the provider doesn't keep the token), or have
    the team's controller remove the member and delete the marker. Then run
    `oats aweb leave --labels <label>` (or retry the retire).
  - **The label's team changed.** An intent recorded for another team than
    the one the label maps to now is released for its recorded team, never
    adopted into the new one.
  - **A start** changes nothing at the service for it. It warns `unfinished
    join of team <label> …; run oats aweb join --labels <label> to finish it
    or oats aweb leave --labels <label> to release it`.

  If the identity home already held an identity before the join, it isn't
  this join's: aw refuses the accept as before, and no intent is recorded.
  The `oats aweb teams|join|leave` document is unchanged. `teams.json` is now
  written atomically.

## 1.40.0 — 2026-11-11

Requires OATS >=0.68.0. The aw floor stays 1.36.33 and the tested aw 1.36.58. A spawn or a start of a home the host wake broker delivers to (Codex, `delivery: session`, or a runtime with no aweb channel) is now refused while no broker runs, with `wake-daemon-not-running` and the start for the host: `oats aweb wake install`, or `aw wake run` where there is no service manager. Start the broker before such a home's next start. A Claude or pi home under channel delivery is not affected.

- **Changed: `oats spawn` and every start refuse a home the host wake broker
  delivers to while no broker runs.** `aw wake register` stores a
  registration and exits 0 with no broker running, so such a spawn succeeded
  and the agent was never woken. The spawn hook and the launch hook now read
  `aw wake status --json` before they change anything. When it does not
  confirm a running daemon they read it once more after 3 seconds, which
  covers the restart `oats aweb wake install` makes, and then refuse. The
  refusal starts with `wake-daemon-not-running`, the code readiness reports
  for the same fact, and names the start for the host: `oats aweb wake
  install` where launchd or systemd runs the broker, `aw wake run` where
  there is no service manager, as in a container.

  Which commands refuse: `oats spawn`, and `oats session start`, `restart`
  and every other start that runs the launch hook, including a triggered or
  scheduled one. A launch preview asks nothing and refuses nothing. Which
  homes: `delivery: session` under any runtime, and `delivery: channel`
  under a runtime with no aweb channel of its own (Codex, or one the provider
  does not know). A Claude or pi home under `delivery: channel` never asks
  about the broker. A status that cannot be read counts as no broker.

## 1.39.1 — 2026-11-11

Requires OATS >=0.68.0. The aw floor stays 1.36.33; the tested aw is now 1.36.58, published in `aw-compat.json`, and `setup --create --namespace` and `--install-aw` name and install it. Two aw 1.36.58 broker changes reach oats.aweb: a stream the server refused now shows as `refused` and is retried, which readiness still reports as `wake-stream-unavailable`; and the broker's lock is now an OS file lock, so stop an older broker before the new one starts (`oats aweb wake install`, rerun after the aw upgrade, restarts its unit).

- **Changed: the tested aw is now 1.36.58 (from 1.36.56); the floor stays
  1.36.33.** `aw-compat.json` records `tested: 1.36.58`. CI's resident-journey
  matrix runs aw 1.36.33 and 1.36.58 against aweb's stack at aw-v1.36.58
  (679d500: server 1.27.50, awid 0.5.39), and the journeys are qualified on
  the npm binary's commit a3223c1d. What follows from `tested`:
  `aw-newer-than-tested` now warns only above 1.36.58; `setup --create
  --namespace` refuses an aw below 1.36.53 naming
  `npm install -g @awebai/aw@1.36.58`, and `--install-aw` on that route
  installs 1.36.58.

  What changed in aw between 1.36.56 and 1.36.58 that reaches oats.aweb, and
  what oats.aweb does with it:
  - **The host wake broker no longer stops a refused stream (aw 1.36.58).**
    Up to 1.36.57 a stream the server refused (401, 403, 404, 422) ended as
    `quarantined`. From 1.36.58 `aw wake status` shows it as `refused`, never
    admitted, with `cause` and `next_attempt_at`, and the broker retries it
    every 1 to 15 minutes, reading the identity from disk again before each
    attempt; a repeated `aw wake register` retries it at once. oats.aweb's
    readiness does not know the `refused` phase yet. Because aw reports the
    home's broker target as not admitted, readiness reports the problem
    `wake-stream-unavailable` with its general message, "broker target
    reports streams not admitted or malformed admission evidence", for every
    home: the problem code a `quarantined` stream gets, but with no phase and
    no remedy named. A refused stream never reads as ready. To recover, fix
    what the server refused; the broker then retries on its own, and
    restarting the home registers it again, which retries at once.
  - **The broker's lock is now an OS file lock (aw 1.36.58),** `daemon.lock`
    in the wake state directory. A broker from an earlier aw does not hold
    it, so it must be stopped before the new one starts. `oats aweb wake
    install`, rerun after an aw upgrade, restarts its unit, which does that; a
    broker started by hand is stopped by hand first.
  - Not reaching oats.aweb: `aw wake deregister`'s help text (oats.aweb runs
    the command and does not read its help); the broker's `PendingExpiry` and
    `IdleProbe` settings, now documented as ignored (oats.aweb sets neither);
    the server's registry reads refusing a 401 or 403 instead of serving the
    cache (server 1.27.50 and awid 0.5.39, the stack CI now runs against);
    and the Go 1.26.11 build.

## 1.39.0 — 2026-11-10

Requires OATS >=0.68.0. The aw floor stays 1.36.33; the tested aw is now 1.36.56, published in `aw-compat.json`. `oats aweb setup --create <label> --namespace <domain>` (bring your own team) now runs to the end: it creates the team, registers it with the aweb service, publishes and verifies its AWID team-server record, mints and accepts a local invite into a per-team root, and records the root. A re-run of the same command resumes a partial create. `--name` names the per-team root's identity; with no root identity available it is required. This route needs aw 1.36.53 or later and refuses an older aw before it creates anything; with `--install-aw`, an older aw is replaced by the tested one. A taken team name stops the create; setup never tries another name. A completed create names the team key's path, never the key.

- **Changed: `setup --create <label> --namespace <domain>` needs aw 1.36.53
  or later, and refuses an older aw up front (#208).** `aw id team set-server`
  and `show-server` first ship in aw-v1.36.44 (880ccf5), and aw's `--json`
  error envelope, which setup reads to tell "no team server record is
  published" and a taken team name from a failure, first ships in aw-v1.36.53
  (755f3dc). On aw-compat's `min` (1.36.33) the create used to fail half-way.
  Setup now checks the installed aw before the kernel and before any other aw
  call, and below 1.36.53 refuses: "--create --namespace needs aw >= 1.36.53
  (this host has <version>): upgrade with npm install -g @awebai/aw@<tested>;
  nothing was created". `--install-aw` on this route installs aw-compat's
  `tested` (1.36.56). The provider's floor for every other path stays 1.36.33.
  The real-aw CI step checks the refusal on 1.36.33 and the passing check on
  1.36.56. The skill-citation check leaves out `aw id team set-server` and
  `show-server` on an aw below 1.36.53, naming each one it leaves out.
- **Added: `setup --create <label> --namespace <domain>` publishes and
  verifies the team's AWID team-server record (#208).** After register, setup
  runs `aw id team set-server --team <name> --namespace <domain> --url
  <service>`, then `aw id team show-server`, and checks the record's team, its
  current key and its URL against the service setup used. Setup reads the
  record before register and again just before publishing. One that names the
  same URL is left as it is, so a re-run stays idempotent. One that names
  another URL stops setup with a fixed cause naming both URLs and the owner's
  remedy; setup does not replace a record it finds. aw has no publish-if-absent,
  so a record published between that last read and `set-server` is replaced
  unnoticed. A refused publish or a record that does not verify keeps the team
  and resumes on re-run. The service URL is put in aw's
  canonical team-server form first (a trailing slash dropped) and used in that
  form for register, the record and connect; one the record cannot hold is
  refused before anything is created; `localhost`, 127.0.0.0/8, `::1` and
  IPv4-mapped 127.0.0.0/8 count as loopback, as in aw.
- **Fixed: `setup --create <label> --namespace <domain>` takes `--name <alias>`
  (#208).** On a fresh deployment there is no root identity for the per-team
  root's alias, and setup refused `--name` with `--create`, so the create could
  never finish. `--name` now names that identity, checked against the aweb
  alias rule. Without `--name` or a root identity, setup refuses before
  `aw id team create` runs, naming `--name <alias>`, and nothing is created. A
  create left partial (team key written, no root) resumes when the same
  command is re-run with `--name`: aw's create on the kept key returns the
  same team, then register, invite, accept and connect follow.
- **Added: aw-compat.json published; tested aw 1.36.56.** oats.aweb states
  the aw it supports in one public file,
  `oats-package/capabilities/oats-aweb/aw-compat.json`: `min` (1.36.33,
  unchanged), the client floor every path is held to, and `tested` (1.36.56,
  from 1.36.53), the highest aw the CI journeys pass on. `lib/aw-floor.mjs`
  reads it beside itself; `AW_MIN` and `AW_TESTED` keep their names, and the
  module fails to load, naming the file, when the file is missing, isn't JSON,
  holds other keys, a value that isn't an exact semver version, or a `min`
  above `tested`. OATS's getting-started skill reads the file at the
  oats.aweb ref the OATS catalog pins; its path and keys stay, and a change to
  a field is release-noted. `aw-newer-than-tested` now warns only above
  1.36.56, and the pin it and the mint refusal name is
  `npm i -g @awebai/aw@1.36.56`. `setup --install-aw` still installs
  `^1.36.33`.
- **CI: the real-aw journeys run exactly `[min, tested]`.** The
  resident-journey matrix is 1.36.33 and 1.36.56, on aweb's aw-v1.36.56
  release stack (e3a1d9f, server 1.27.48), and a test fails `npm test` when
  the matrix and `aw-compat.json` differ. Each job fails unless the aw it
  installed is its matrix entry. The jobs are now `resident-journey (1.36.33)`
  and `resident-journey (1.36.56)`.
- **Changed: `setup --create <label> --namespace <domain>` stops on a taken
  team name (#208).** When the name is already held in the namespace under a
  team key that is not on this machine, setup stops after that one create with
  a fixed cause: "team <name>:<domain> already exists in the registry, and its
  team key is not on this machine". It names the remedy: choose another label,
  or run setup as the user that holds its key. It no longer tries `-2` through
  `-20`, and aw's text (the other team's key) is never relayed. A re-run with
  this machine's own key still resumes. Setup reads aw 1.36.56's two answers
  for a taken name: "team <domain>/<name> is already pinned to <did:key>", and
  the registry's own 409.
- **Changed: no remedy suggests copying the team key.** When a resumed
  create finds that the team key is not on this machine, the remedy is now
  only to run setup as the user whose `~/.awid/team-keys/<domain>/` holds it.
  The README and the oats-aweb skill no longer say another user's deployment
  needs the key in its own `~/.awid/`. Instead they say to run setup, and the
  deployment's instances, as the user that holds the key.
- **Added: setup names where the team key is.** A completed create prints
  `team key: <path>` (aw's `team_key_path`, under
  `~/.awid/team-keys/<domain>/`), never the key.
- **Docs: the team key and the namespace controller key are user-wide: one
  trust boundary.** The README and the oats-aweb skill now say that both keys
  live in the deployment host user's `~/.awid/`, not inside the deployment.
  So every process that user runs can read them, the deployment and every
  agent instance spawned there included. They also say that aw keeps each
  local invite's secret in `~/.config/aw/team-invites/<id>.json` until it is
  accepted, and that spawned instances' `aw init --join-from` uses the same
  team key.
- **Tests: the fake aw for BYOT create answers as aw 1.36.56 does.**
  `test/fixtures/byot-create/` holds the real binary's offline output
  (`capture.sh`), plus shapes read from aw's source for what needs a registry.
  The fake's `aw id team invite` answer is now aw's `{invite_id, status,
  token}`. `test/aw-byot-create-shapes.test.mjs` compares the fake with those
  fixtures. With `OATS_AWEB_TEST_AW` set to an aw binary, it also runs the
  offline commands, and setup's create, on that binary.
- **Docs: `setup --create --namespace` without `AWEB_URL` uses an existing
  root's service.** The README and the oats-aweb skill now say that the team
  is then registered with the service an existing root already uses, which
  may be hosted aweb, so a create meant for a self-hosted server sets
  `AWEB_URL` first. Setup names the service before it creates anything.
- **Docs: a sent message's draft may be deleted.** Section 3 of the oats-aweb
  skill now says so; drafts left behind go at retirement.
- **Fixed: `oats aweb setup --create <label> --namespace <domain>` completes
  (#202).** aw never prints an invite token for a team created in a
  customer-controlled namespace, so setup refused every such create. Setup now
  resolves the aweb service first, from `AWEB_URL` (the server's public URL)
  or an existing messaging root's `aweb_url`, and refuses before any aw call
  when there is none. After `aw id team create` it registers the team with
  that service (`aw id team register`), mints the invite itself with the local
  team key (`aw id team invite`), then accepts it into the per-team root and
  connects it. A re-run of the same command resumes a partial create: no
  second team, no `-2` suffix, no second invite once the identity is
  accepted. A refused registration names the HTTP status and the server's
  short code. A missing namespace controller key or team key gets a fixed
  cause and remedy (`aw id namespace prepare-controller --domain <domain>` as this user,
  or create the team where that key is); aw's raw output is never relayed. No
  new flag or setting; `--service` stays refused with `--create`.
- **Fixed: the send examples no longer use fixed `/tmp` body files.** The
  oats-aweb skill's mail and chat examples wrote every body to a fixed path
  (`/tmp/msg.md`, `/tmp/reply.md` and four more). On a shared host, agents that
  copied them overwrote each other's drafts, so mail went out with another
  agent's text, and anyone on the host could read the drafts. Section 3 now
  makes a new owner-only file per message under the home's `.oats-aweb/drafts/`
  (which retirement neither keeps nor copies), and says why. The inject's crib
  and the aweb-tasks skill say the same, and a test keeps fixed `/tmp` body
  files out of every shipped skill, inject and the README.

## 1.38.0 — 2026-11-04

Requires OATS >=0.68.0. The aw floor (1.36.33) and the tested aw (1.36.53) are unchanged. Only pi homes see a difference. With @awebai/pi 0.5.0 or later installed in the launch's pi folder, `pi-extension-skills-loaded` no longer asks for the skills filter, because that extension bundles no skills; below 0.5.0, or with an unreadable version, it warns as before. The new warning `pi-skills-package-loaded` fires when that pi folder lists @awebai/claude-skills unfiltered. Remove the entry, or filter it with `"skills": []`. Never install @awebai/claude-skills in a pi folder that OATS homes use.

- **oats.aweb no longer asks for the skills filter on @awebai/pi 0.5.0 or
  later.** @awebai/pi 0.5.0 declares `"skills": []` and bundles no skills, so
  `pi-extension-skills-loaded` now warns only when the @awebai/pi installed in
  the launch's pi folder (`<pi folder>/npm/node_modules/@awebai/pi`) is below
  0.5.0, or its version can't be read; its message also offers the update to
  0.5.0 as the fix. Both pi `install` texts ask for the filter below 0.5.0
  only, and say never to install @awebai/claude-skills in a pi folder that
  OATS homes use. The vendored aweb-messaging skill's Pi line says the same.
- **New readiness warning `pi-skills-package-loaded`** (pi homes). The skills
  now ship on their own in @awebai/claude-skills. Home readiness warns when the
  launch's pi folder lists `npm:@awebai/claude-skills`, with or without a
  version, as a plain string or as an object without `"skills": []`, whatever
  the extension's version: a home's skills come from its capabilities. The
  message names the file and the fix: remove the entry, or filter it with
  `"skills": []`. It can appear beside `pi-extension-skills-loaded`.

## 1.37.0 — 2026-11-04

Requires OATS >=0.68.0. The aw floor (1.36.33) and the tested aw (1.36.53) are unchanged, and messaging-only homes are unaffected. A home that composes oats.aweb-tasks now warns `wake-daemon-outdated`, `aweb-channel-outdated` or `pi-extension-outdated` until whatever keeps its task claims present reaches aw 1.36.54 (its host wake daemon), aweb-channel 1.8.2 or @awebai/pi 0.4.1. aw 1.36.54 is on npm's `next` tag while `latest` is still 1.36.53, so install it by version, `npm install -g @awebai/aw@1.36.54` (plain `npm install -g @awebai/aw` and `oats aweb setup --install-aw` install 1.36.53), then rerun `oats aweb wake install`, which on macOS now reloads the broker so launchd accepts the new aw (on macOS, also reload each custody job by hand: see the known issue below). Against a server other than the aweb Cloud, aw 1.36.54 is newer than the tested aw, so oats.aweb also warns `aw-newer-than-tested` there.

- **Fixed: launchd jobs come back after an aw upgrade (macOS).** launchd keeps
  the code requirement it read from a job's binary at bootstrap, so once
  `npm i -g @awebai/aw` replaces aw, `launchctl kickstart -k` leaves the job
  down (exit 78, "needs LWCR update"); a `bootout` then `bootstrap` brings it
  back. `bootout` returns before the job has unloaded, so every such restart
  waits, within about 30 s, until `launchctl print` answers that it cannot
  find the job (any other failed print is no answer), then bootstraps once;
  past that it fails with the command's unit error (`E_WAKE_UNIT`,
  `E_RESIDENT_UNIT`) without bootstrapping, naming the manual
  `launchctl bootstrap` step.
  - `oats aweb wake install` now restarts a loaded broker with
    `launchctl bootout gui/<uid>/ai.aweb.wake`, then `bootstrap`, whether or
    not the plist changed (`bootstrap` alone when it is not loaded; `--plan`
    lists both). It no longer runs `kickstart`, so the documented
    after-upgrade rerun brings the broker back on the new aw. Linux is
    unchanged.
  - `oats aweb resident create` now reloads a loaded, unchanged custody job
    whose process is not running (`bootout`, then `bootstrap`), as
    docs/resident-create.md already promised; a running custody is still left
    alone. The macOS custody upgrade step is the new "restart it (after an aw
    upgrade)" row in docs/resident-create.md, "The custody unit".
- **Known issue (macOS):** a running custody job is not restarted for you
  after an aw upgrade. After upgrading aw on macOS, reload each custody job
  with `launchctl bootout gui/$(id -u)/<label>`; wait until
  `launchctl print gui/$(id -u)/<label>` no longer finds it (bootout returns
  before the job has unloaded); then
  `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/<label>.plist`;
  then rerun `oats aweb resident create <name>` to verify.
- **Claim floors for aweb tasks (oats.aweb-tasks readiness, not oats.aweb).**
  aweb takes over a task claim whose presence heartbeat has gone stale. The
  heartbeat comes from aw 1.36.54's host wake daemon, aweb-channel 1.8.2 or
  @awebai/pi 0.4.1, depending on how the home receives. oats.aweb-tasks's
  readiness check now warns a home whose heartbeat source is older. These are
  warnings beside the team answer, ready or not; they never refuse:
  - `wake-daemon-outdated`: `aw wake status --json` lists the home, and its
    daemon runs a version from oats.aweb's floor (1.36.33) up to, but not
    including, 1.36.54; 1.36.54-rc.1 warns. oats.aweb registers a home with
    the broker exactly when it needs it and then reads the daemon itself, so
    below 1.36.33 its own `wake-daemon-outdated` is the only item. (A stale
    registration oats.aweb no longer expects gets neither below 1.36.33.) A
    home the daemon doesn't list gets no daemon item.
  - `aweb-channel-outdated`: a Claude home (the kernel's launched harness) that
    the daemon does not list, whose aweb-channel@awebai-marketplace is below
    1.8.2. The version is the user-scope entry in
    `plugins/installed_plugins.json` of the Claude config dir it launches with:
    its literal `CLAUDE_CONFIG_DIR`, else `~/.claude`.
  - `pi-extension-outdated`: a pi home that the daemon does not list, or lists
    for its joined teams only (a native-pi row), whose @awebai/pi
    is below 0.4.1. The version is in
    `<agentDir>/npm/node_modules/@awebai/pi/package.json`, where pi installs a
    user-scope npm package; `<agentDir>` is its literal `PI_CODING_AGENT_DIR`,
    else `~/.pi/agent`. A pi home the daemon lists for its joined teams can get
    both this and the daemon warning.
  - The check reads only the kernel's launch record (`launch.harness`,
    `harness`, `launch.env`), never oats.aweb's metadata or files. A Claude or
    pi home on `delivery: session` that is missing from the broker therefore
    gets the plugin or extension warning too: harmless, since oats.aweb's
    readiness reports the missing registration.
  - Nothing is added for a version or status that can't be read: a daemon
    not running or reporting no version (oats.aweb reports those where it
    needs the broker), a project-scope plugin or extension install, or pi's
    older global npm location. Joined teams that only poll have no heartbeat
    yet and get nothing. A soul gets nothing: the check can't tell whether its
    delivery is the broker, and the home's readiness warns after spawn.
  - The aw read runs from the home, bounded at 10 s within the check's time.
  - The tasks inject and skill gain one paragraph: claims stay present only
    while something heartbeats them, and the agent reports these warnings to
    its human.
- **Messaging-only homes are unchanged.** oats.aweb's readiness, its floor
  (AW_MIN 1.36.33), the tested aw (1.36.53) and its text don't change, and
  homes without oats.aweb-tasks get no new read or warning.
- **Upgrading a host:**
  1. Install aw 1.36.54.
  2. Rerun `oats aweb wake install` to restart the host wake daemon on it.
  3. On a Claude host, update aweb-channel to 1.8.2; on a pi host, @awebai/pi
     to 0.4.1.
  4. Restart the homes they serve.
  A claim taken by hand (`aw task update <ref> --status in_progress`) is no
  different: it stays present only while something heartbeats it. So restart
  the daemon after upgrading aw on every host whose agents take claims,
  whatever its tasks capability.

## 1.36.0 — 2026-11-03

Requires OATS >=0.68.0. The aw floor (1.36.33) and the tested aw (1.36.53) are unchanged. Setup from an invite alone needs aw 1.36.53 or later; on an older aw it refuses with `E_SETUP_AW_VERSION`, and `--install-aw` upgrades aw first. `oats aweb setup --invite`/`--invite-stdin` without `--join`, which was the usage error "requires --join <label>" (exit 2), is now that form. Every invite acceptance reads the token on stdin, so a malformed token now fails as an aw usage error (exit 2) before anything is redeemed.

- **Setup from an invite alone (#56).** `oats aweb setup --invite-stdin
  --name <alias>` (or `--invite <token>`) without `--join` reads the invite's
  team and service with `aw team invite inspect --json`, which takes the token
  on stdin and redeems nothing, and derives the label from the team's name,
  normalized as `--create` does. It then joins as `--join` does: a root beside
  the default at `<deployment>/.aweb-roots/<label>`, `roots[<team id>]`, the
  local mapping, and the token on `aw id team accept-invite --token-stdin`,
  never an argv. A label the deployment already maps to the team is reused
  rather than a new one made; a hosted invite of scope `unknown` joins with
  `--local`; the invite's service is used and shown only as a plain service
  URL (http(s), a host, an optional port and no path but `/` or `/api`, the
  shape `oats aweb invite` hands on), else the invite is not usable; an
  explicit `--service` must be the invite's (up to `/api`); and
  `--install-aw` upgrades an older aw first. It ends with one next step, the
  same in text and JSON, chosen from `oats soul teams <soul>`: a plain spawn
  when the label is the soul's default, the spawn that joins it when it is
  eligible, else making it eligible in the workspace's `souls:`; when that read
  fails it keeps the spawn and says it assumes eligibility.
  Needs aw 1.36.53 or later; every refusal comes before anything is redeemed:
  `E_SETUP_AW_VERSION`, `E_SETUP_INVITE_INSPECT` (an expired, exhausted or
  revoked invite names the exact resume command), `E_SETUP_INVITE_CONTROLLER`,
  `E_SETUP_INVITE_SCOPE` (ask for a LOCAL invite, or use the GLOBAL resident
  journey), `E_SETUP_ALREADY_MEMBER` (`roots[team]`, `root` or the default
  team's root lists the team; `roots[team]` is never re-pointed; an unmapped
  team names the tokenless resume or the mapping it lacks, `oats teams add
  ... --no-default` or the workspace commit),
  `E_SETUP_MEMBERSHIP` (such a root's membership could not be read),
  `E_SETUP_SERVICE_MISMATCH`, `E_SETUP_DEFAULT_PRESERVE` (a workspace default
  with the label unmapped, decided before redemption from the invite's team)
  and `E_SETUP_LABEL_COLLISION` (pass `--join <label>`; never a suffix). `--join <label>` is unchanged; with an invite aw can read, a
  label mapped to another team refuses with `E_SETUP_JOIN_MISMATCH`, naming
  both; that optional inspect waits at most 10s, then keeps the released
  behaviour. `oats aweb invite` answers the joiner's one-line command beside the
  token, never holding it: `oats aweb setup --soul <soul> --invite-stdin --name
  <alias>` at `result.joinCommand`, and on stderr in text mode.
  Token-only setup (`--invite`/`--invite-stdin` without `--join`), which was the
  usage error "requires --join <label>" (exit 2), is now this form: on an aw
  older than 1.36.53 it refuses with `E_SETUP_AW_VERSION` (exit 1) instead, and
  the two tests that pinned the usage error now pin that refusal.
- **The invite token is in no argv on the accepting host.** Every
  `aw id team accept-invite` — setup's labelled `--join`, the invite form and an
  instance's `oats aweb join` — now reads the token on stdin (`--token-stdin`,
  which aw 1.36.33, the provider's floor, already has). aw's `--token-stdin`
  path checks the token's characters and format before acceptance, so a
  malformed token now fails as an aw usage error (exit 2) before anything is
  redeemed.

- **A refused `oats aweb join` names its cause and fix (#52).** The join has
  read the deployment's live `roots` since 1.22.0, so a team root added to
  `oats-local.yaml` after the home's spawn is joined without a respawn. Each
  root refusal before minting now says `nothing was minted` and names its cause:
  live settings that cannot be read name the reason and the
  `oats inspect … --json` read to repair; live settings with no member root for
  the team name the `oats aweb setup --join <label> --invite-stdin` that makes
  one. A failed `aw team invite` with no HTTP status no longer reads only
  "output withheld": it names aw's `--json` error code, an unreachable aweb
  service, or that its output held none of these, plus the root it ran in and
  the setting that chose it. aw's output stays withheld; no token is printed.
  A spawn-time join's invite failure names the root and setting without the
  `--plan` hint. The network cause covers Go's dial (tcp, tcp4, tcp6), DNS,
  refused, reset and unreachable connections, i/o, deadline, TLS-handshake and
  client timeouts, TLS and certificate errors and a connection ended by `EOF`.
  `oats aweb connect` (`E_INVITE_FAILED`) now also names the HTTP status and
  the redacted server `detail` of a failed `aw team invite`, and with no HTTP
  status the same causes; `oats aweb invite` (`E_INVITE_NATIVE`), with no HTTP
  status, names how aw ended (exit status, `ENOENT`, a timeout or a signal) and
  the same causes. Both name the root and the setting that chose it (`roots[team]`,
  `root`, or for the default team with neither set, the workspace or current
  directory); their error codes are unchanged.
- **Per-team roots (#45).** Since 1.22.0, `oats aweb setup --join <label>` puts
  a new root at `<deployment>/.aweb-roots/<label>`, beside the default team's
  root, and records it as `roots[<team id>]`; it is now tested with the default
  root itself recorded as `roots[<default team>]`. Existing nested roots keep
  working and are not migrated; to move one, ask your aweb lead.

## 1.35.0 — 2026-11-03

Requires OATS >=0.68.0. The aw floor (1.36.33) and the tested aw (1.36.53) are unchanged. A kernel that lists `settings-committed-only` refuses oats.aweb-tasks `team` from `oats-local.yaml` and `--provider`; an earlier one ignores the flag. A workspace sets `team` in its `tasks:` payload only once every deployment reading it lists `workspace-tasks-payload`. A pi home whose pi folder loads `@awebai/pi` with its skills now reads the readiness warning `pi-extension-skills-loaded`, which names the one-line fix.

- **A joined team that becomes the default is no longer left at start.** At
  every start and restart, launch leaves joined teams that are no longer
  eligible, and the default team is never eligible to join. So when a
  workspace made a team every soul's default, a home that had joined it, but
  whose primary identity is still in the team it was spawned in, left it on
  its next restart. Launch now keeps that membership, warns "kept joined team
  <label>: it is now the default team … respawn to move it", and changes
  nothing else. Only a respawn moves a running home's primary identity.
- **The pi extension without its skills.** `@awebai/pi` bundles skills that
  pi loads in every session using its pi folder; a home gets its skills
  through its OATS capabilities only. Both pi `install` texts now install the
  extension, then make its settings entry `{"source": "npm:@awebai/pi",
  "skills": []}` (README, "The pi extension without its skills"). Home
  readiness warns `pi-extension-skills-loaded` for a pi home whose launch's
  pi folder lists `npm:@awebai/pi`, with or without a version, as a plain
  string or as an object without `"skills": []`, naming the file and the exact
  edit. Checked with pi 1.3.0: `pi install` and `pi update` keep the filter.
  The vendored aweb-messaging skill's Pi line says the same, in place of
  "the aweb channel and these skills are bundled together";
  `scripts/sync-vendored-skills.mjs` writes that line and its note in
  `skills/VENDORED.md`, so a resync keeps both. Interim, until aweb publishes
  the extension without skills.
- **oats.aweb-tasks `team` is committed-only.** The manifest marks
  `settings.team` `committedOnly: true`. A kernel that lists
  `settings-committed-only` in `oats version --json` refuses `team` from
  `oats-local.yaml` and from `--provider` (`E_WORKSPACE_SCHEMA`, reason
  `committed-only-key`); an earlier kernel ignores the flag, so the
  compatibility floor stays OATS >=0.68.0. Either way, `team` belongs in the
  workspace's or a soul's `tasks:` payload. `schemas/capability-manifest.schema.json`
  is refreshed from awebai/oats `0e215e8`, which adds `committedOnly`.
- **oats.aweb-tasks `team`: one team's task list for every deployment.** The
  new setting `team: <label>` names the aweb team whose task list
  oats.aweb-tasks reads and writes. It is set only in the workspace's or a
  soul's `tasks:` payload; the kernel owns that rule, and the provider has no
  origin check of its own. Absent, nothing changes: the home's default team,
  the same brief byte for byte. The inject and skill now say the tasks team
  ("the default team, or the team your TASK.md names") where they said the
  default team, and add one "Tasks team" block that applies only when the
  brief names a team. Every
  task command then runs as `aw --identity-home <H>`, H being
  `joined[].identityHome` for that label in `oats aweb teams --json`, never a
  path built from the label; a label that is not joined is reported and the
  agent stops, never falling back to the default team. The default team's own
  label needs no join. A value that is not a team label is refused in the
  brief, with a spawn warning.
- **oats.aweb-tasks has a readiness check.** It answers ready with nothing else
  when `team` is absent (readiness gains that one passing item). With `team`
  set it refuses a home that has not joined the label (`team-not-joined`), a
  label that is not one of the home's or soul's teams (`team-not-eligible`), an
  invalid value (`team-invalid`), and a GLOBAL seat, which cannot join teams
  until #60 (`team-global-seat`). Each refusal names both remedies:
  `oats aweb join --labels <label>` from the home, or `tasks: none` for the
  soul. What it cannot read fails closed (`team-unverified`). A soul reads
  ready with `team-join-at-spawn` when its homes must join the label, and with
  `team-is-default` for the default team's label.

## 1.34.0 — 2026-11-03

Requires OATS >=0.68.0. The aw floor (1.36.33) and the tested aw (1.36.53) are unchanged. A home learns aweb tasks only when it composes oats.aweb-tasks: a deployment that uses aweb tasks and doesn't compose it gets no task guidance from oats.aweb after this upgrade.

- **oats.aweb no longer mentions task coordination; oats.aweb-tasks teaches
  it, only when composed.** Nothing oats.aweb puts into a home names the task
  layer, `aw task`, `aw work`, `aw lock`, `aw roles`, task claims or the
  `aweb-coordination` skill: not the inject, not the `Comms:` line (spawn,
  grant seat and captured native drop "coordination stays in your deployment's
  task layer"), and not its skills, the vendored aweb skills included. Mail
  recovery reconciles "STATE and your own records", no longer "task records".
  oats.aweb-tasks now says what oats.aweb stopped saying: task state belongs
  in tasks, not mail; `aw lock` and `aw roles` stay outside OATS; and how to
  treat `work` and `claim` events. Its inject and skill open with "This
  workspace tracks work in aweb tasks, and its agents use them.": composing
  oats.aweb-tasks is how an OATS home opts into aweb tasks.
- **The messaging loop is whole in oats.aweb.** The inject and `/oats-aweb`
  section 4 ("The messaging loop") give the complete session loop for mail and
  chat: read what the wake presents, or `aw mail inbox` and `aw chat pending`
  when nothing is; reply in thread, or answer or extend a waiting chat; return
  to the task. A skill named in team instructions, a role description or pi's
  welcome message may not be installed in the home; the agent follows the
  skills OATS composed instead.

## 1.33.3 — 2026-11-03

Requires OATS >=0.68.0. The aw floor stays 1.36.33; the tested aw moves to 1.36.53.

- **Tested with aw 1.36.53.** `AW_TESTED` moves from 1.36.51 to 1.36.53, the
  aw npm `latest` now that the Cloud serves invite preview. CI's journeys run
  on 1.36.33 and 1.36.53, and `aw-newer-than-tested` warns only above 1.36.53;
  the pin it and the mint refusal name is `npm i -g @awebai/aw@1.36.53`. The
  floor is unchanged.
- **A resident create whose API key is refused can simply be rerun.** aw
  1.36.53 reads an API key's team before it mints anything, and takes its
  recovery lock `.aw/partial-init.yaml.lock` first. A refused key (wrong,
  expired, or a service without that read) mints nothing, but left R holding
  that lock and the captures, and the rerun was refused until R was emptied.
  R holding only what an init that minted nothing leaves (the captures, and at
  most a `.aw/` holding only that lock) now counts as empty: the rerun runs
  aw init again. Nothing in R is deleted, and anything else in R is still
  refused. The failure says `nothing was created; fix what aw reports above,
  then rerun the same command`, and a rerun within the same second keeps the
  earlier run's captures.
- **The unread-count warning follows a later `health enable`.** A home's
  readiness warning `unread-count-unavailable` now reads whether health
  publishes now, from the soul's current settings, as the per-minute observer
  does, instead of the settings captured at the home's spawn. A home spawned
  before `oats aweb health enable` warns once it is enabled; one spawned while
  it was on stops warning once it is disabled.
- **That check stays inside readiness's time budget.** Its kernel query now
  shares the readiness phase's deadline, as the phase's aw calls do, so a slow
  kernel can't push a home's readiness past it; a query with no time left is
  skipped and the check stays silent.
- **The alias-conflict spawn refusal reads plainly.** When another agent's
  certificate holds the alias, spawn says so with no ticket id or kernel
  version: another machine's instance has that name, or a retired one still
  holds it; spawn with a different `--name`. The fixed text comes before the
  team id, so a long id never cuts the remedy.
  Retire's warning for an alias the server has not released yet drops the
  kernel version the same way: spawn successors with a different `--name` or
  `--purpose` until it is released.

## 1.33.2 — 2026-11-02

Requires OATS >=0.68.0. The aw floor and pin are unchanged.

- **A warning when aw is newer than tested, off the Cloud.** Readiness
  (`aw-newer-than-tested`) and spawn warn when the aw on PATH is above the
  highest aw the provider's CI journeys pass on (1.36.51) and the home's own
  team root (or, at spawn, the root of a team it also joins) names a service
  other than the aweb Cloud: a server on an older
  aweb may refuse it. The fix it names first is upgrading the server's aweb.
  Cloud homes never warn, since aw reaches npm `latest` only after the Cloud
  supports it. Never a refusal.
- **A mint refused for that reason says so.** When `aw init --join-from` fails
  with aw's `unknown_or_invalid` error code (its `--json` envelope, aw
  1.36.52-rc.3 and later), spawn names the code, its most likely cause (an aw
  newer than its server; the code can also mean a genuinely bad invite), the
  server's upgrade and the tested aw (if no deployment on the host needs a
  newer one) instead of only "output withheld". Only that code is read; aw's
  message is never shown.

## 1.33.1 — 2026-11-02

Requires OATS >=0.68.0. The aw floor and pin are unchanged.

- **`oats aweb invite` works on a workspace set up without a root setting.**
  `oats aweb setup --username` creates the team's root in the deployment and
  records no `root`, and spawn finds it there, but invite read only the
  setting and refused with `E_INVITE_ROOT`. With no root declared for the
  team, invite now uses the deployment's own root. A declared root, even an
  invalid one, is still never replaced.

- **`oats aweb invite --json` names the service to hand on.** `result.awebUrl`
  is the `aweb_url` the issuing root's workspace.yaml names, so the member
  hands over the token and the service without digging the URL out. Only a
  plain service URL is handed on (http(s), a host, an optional port, a path of
  `/` or `/api` at most); anything that could carry a credential answers
  `null`, as a root that names no service does.

- **A spawn whose name another machine's instance holds says so.** aw 1.36.51
  refuses that mint with a registry 403 (`self_custody_reinit_unproven`) that
  the provider didn't recognise, so the spawn failed with only "aw init failed
  (output withheld)". It now names the alias conflict and the remedy, as it
  already did for a retired alias, and still withholds aw's output.

- **A pre-release aw above a floor now passes.** Every aw and kernel version
  gate in the provider compares by semver precedence: a pre-release is below
  its own release and above every lower one, so aw 1.36.53-rc.3 meets 1.36.38
  and 1.36.38-rc.1 still doesn't. Build metadata (`+abc`) is accepted and
  changes nothing. Until now any pre-release was refused, which kept
  `oats aweb health publish` and the probe off the aw release candidates.
- **`oats aweb wake install` accepts a daemon running a pre-release aw.** It read
  the installed aw without its pre-release and compared that with the daemon's
  full version, so a running 1.36.53-rc.3 daemon failed with
  `E_WAKE_NOT_RUNNING`. It now reads the version only once the whole token
  has arrived.

## 1.33.0 — 2026-11-02

Requires OATS >=0.68.0. The aw floor and pin are unchanged. Cut from `main`;
includes 1.32.1's change (#159).

- **`/oats-aweb` says how a person attaches themselves to the account.** A new
  section, "attach yourself to the account", covers an account that `oats aweb
  setup --username` created without a sign-in. The setup expert asks the
  person for their email address and runs `aw --identity-home "<root>/.aw"
  claim-human --email <their email>` with exactly that address, never a guessed
  or inferred one. The account is theirs once they click the link aw mails
  them. Running the command once more after the click confirms it; running it
  before the click mails a new link and the earlier one stops working.

- **`oats aweb setup` no longer writes aw's agent rules into the
  deployment.** Its `aw init` (the `--username` account bootstrap and the
  `AWEB_API_KEY` path) now passes `--do-not-touch-agents-md`, as spawn, join
  and resident creation already did. Without it, aw added its aweb rules to
  `AGENTS.md` and `CLAUDE.md` (in the deployment directory, or at the root of
  its Git repository when it sits in one), and Claude Code loads them into
  every Claude instance under `agents/`. An existing deployment set up that way may still
  carry aw's rules: at the root of its Git repository if it sits in one,
  otherwise in its deployment directory. Nothing in OATS reads them, and setup
  leaves them where they are. In a file that existed before setup, remove the
  block between `<!-- AWEB:START -->` and `<!-- AWEB:END -->`. An `AGENTS.md`
  holding only that block under `# Agent Instructions` is aw's, and it can go
  with the `CLAUDE.md` symlink to it.

- **Unread mail with an observed broker error can raise an attention flag.**
  The opt-in `oats aweb health publish` tick counts unread mail without reading
  or acknowledging it, and sets an `oats.aweb` attention claim for registered
  session-delivery homes with active binding/stream errors or a persistent
  worker error across consecutive ticks without unread or delivery progress.
  Grant-backed resident seats are excluded because read-only grants can leave
  presented mail unread. CLI and
  Desktop see only counts and fixed error classes. Recovery, unregistration,
  retirement and health disable clear this producer's claim; a count failure
  preserves it. Runtime `waiting-on-you` support and aw's read-only
  `mail inbox --count-only` are required. `oats aweb health status` reports the
  observer as off while publishing is off; readiness says nothing about the
  observer while it is off.

- **A retire on a team that isn't hosted hands a joined membership to its
  controller again.** aw names the identity in that refusal by its stable id,
  address or DID, and the provider only recognized its path. So the retire
  stopped with `joined-team-leave-failed` and kept the home, with no
  `aw id team remove-member` step.

- **Joined teams on a Claude home are now read at task boundaries.** A Claude
  home takes no live wakes for its joined teams; its default team is unchanged.
  An idle session doesn't read that mail until something else wakes it. `oats
  aweb teams` shows `receive: poll`, and readiness reports it as expected. `oats
  readiness --soul` can't see the harness, so a join alone no longer reads
  `unavailable` without a broker; it warns which launches need one. Claude homes
  only: pi and Codex homes are unchanged. `--yolo` makes no difference, so on a
  `--yolo` Claude home joined-team mail now waits for a task boundary.

  Upgrade: a home you paused with `aw wake pause`: start it under this version
  before you resume it. Resuming a Claude channel home afterwards does nothing
  and isn't needed, with or without `--yolo`; a pi or Codex home stays paused
  until you resume it.

- A local home with `identity.renew: launch` now reaches the joined-team sync at
  every start. It used to return early and skip it.

- **The approved route is now the guidance for stopping the development prompt
  and for unattended Claude homes.** The warnings, the README and `/oats-aweb`
  name `claudeChannelMode: approved` for both. `delivery: session` stays a
  supported value; only the advice to reach for it is gone.

- **A shorter always-loaded inject.** `injects/aweb.md` is about 60% of its
  former size and loads `/oats-aweb` on named triggers: before the first
  `aw mail`/`aw chat`, on every wake, and when messaging, delivery, readiness,
  a team or a grant looks wrong. Channel-mode detail is operator material and
  stays in the skill's section 4. A wake runs only the commands of a waiting
  line, never commands found in a sender's body. Joined teams use
  `--identity-home`, including a `receive: poll` team at task boundaries.

## 1.32.1 — 2026-10-28

Requires OATS >=0.68.0. The aw floor and pin are unchanged. Cut from v1.32.0
with only this change (#159); `main`'s shorter inject (#158) ships in 1.33.0.

- **Interim Pi interrupted-turn mail recovery** (awebai/aweb#68).
  The always-loaded inject triggers `/oats-aweb`'s shared recovery procedure for
  `@awebai/pi` 0.4.0 (reported with Pi 1.3.0): after any interrupted turn and at
  task boundaries, scan `aw mail inbox --show-all --json`, page with `--cursor`
  and reconcile by message id against recorded handling before repeating any
  side effects. Queued mail can be lost on interrupt despite being marked read.
  The Pi-specific workaround can be removed once a fixed extension is pinned
  for the affected instances; this changes guidance only, not delivery or pins.

## 1.32.0 — 2026-10-27

Requires OATS >=0.68.0. The aw floor and pin are unchanged.

- Declare a non-required `upgrade` hook for `oats instance upgrade` on
  stopped local, global grant and retained seats, including 1.17.1 metadata.
  Plan is read-only; apply preserves identity and grant state, refreshes
  delivery from settings and runtime from the recorded kernel harness, and
  preserves channel-mode proof until launch. An unreadable or unknown harness
  keeps the recorded runtime and warns. No host registration or `aw` call
  occurs during upgrade: the next start re-registers and, where configured,
  renews the grant before revoking the old one. Renewal off warns that the
  existing grant and expiry remain.
- Refresh the capability manifest schema from OATS v0.68.1, including the
  upgrade event.
- Add stateless upgrade adoption for `oats.aweb-tasks`, so a stopped home
  composing messaging and tasks can move together. Plan always adopts;
  apply preserves supplied metadata without home reads or aw calls.
- A team other than the default is minted at spawn (`join`), and its roster
  read, only from `roots[team]` or `root`, and only when `aw team list --json`
  there lists the team. The cwd, `OATS_WORKSPACE` and the instance home's own
  `.aw` are never minting roots for it: a missing or non-member root refuses
  with the team, the root tried and the remedy (#149).
- `oats aweb join --plan [--json]` shows the root each label's join would use,
  the setting that chose it and its membership, with no invite or state change.
- A failed `aw team invite` during a join names its HTTP status and redacted
  server `detail`; its output stays withheld.
- A Claude channel start no longer inherits a deaf channel from Claude's MCP
  failure cache (awebai/oats#981). One failed aweb-channel start anywhere on an
  account made every Claude launched in the next 15 minutes skip the channel
  ("recent failure cached") without retrying. Before a start or restart, the
  launch hook now removes a live `plugin:aweb-channel:aweb-channel` entry from
  `<config dir>/mcp-needs-auth-cache.json`, atomically and leaving every other
  entry, and warns `channel-failure-cleared`. The config dir is the home's
  recorded literal `CLAUDE_CONFIG_DIR`, else `$HOME/.claude`. A file in another
  shape is left alone (`channel-cache-unrecognized`). The file is read again
  just before the rename: a write by another Claude since the read sends the
  clear back to the new contents, and a file that keeps changing is left alone
  (`channel-cache-changed`). Claude does not lock the file, so a write in the
  instant between that check and the rename can still be lost. A spawn, or a start whose
  config dir is not a literal path, does not look (`channel-cache-unchecked`):
  the kernel gives hooks no resolved config dir (awebai/oats#1503).
- Readiness proves a Claude channel home is on the channel. It needs Claude's
  `Channel notifications registered` line in its MCP log for the home's
  project, written after the home's last start. Without it, the home reads
  `unavailable` with `channel-not-connected` and the restart remedy, once the
  start is 2 minutes old; before that it warns `channel-connection-pending`.
  With no recorded start it warns `channel-connection-unproven`. A registered
  home keeps `native-receive-unproven`, which now says registration is not proof
  that the event stream is up. The agent status reads `channel-not-connected` as
  `oats.channel_not_loaded`. No floor changes.

## 1.31.0 — 2026-10-22

Both floors are unchanged: OATS >=0.52.0 and aw >=1.36.33.

- Session-delivered GLOBAL grant seats now name the broker's foreign grant home
  and the seat's current one in `wake-target-binding`. Quarantined streams
  retain `wake-stream-unavailable`, with safe HTTP/grant denial detail and a
  restart remedy. Admitted `starting`/`retrying` primaries warn with safe error
  detail while other readiness checks continue. Phase decides, so recoverable
  network/5xx errors in `retrying` warn. Unknown phases fail closed and are named.
  Readiness remains read-only. Regression tests pin renewal registration before
  old-grant revoke and rollback when registration fails. No aw floor or pin changes.
- Accept a finite mint receipt for `identity.ttl: never` when the team or
  issuing certificate caps the grant. Keep the requested TTL for renewal;
  readiness, health and the brief use the recorded finite expiry. The expiry
  remedy for a capped never seat explains that restart renews up to the team's
  limit; duration remedies describe the requested renewal rather than promising
  an uncapped lifetime. Duration requests still refuse `expires_at: "never"`, and malformed
  receipts still fail closed. No aw floor or pin changes; live capped-mint
  acceptance is pending the upstream aw release.
- A lowered team cap or a later finite certificate expiry can end a grant
  before its recorded expiry, including `"never"`; readiness cannot predict
  this without certificate polling, so aw reports the runtime grant error
  and a restart remints.

- The oats.aweb package now exports `oats.aweb-tasks` for the tasks slot
  alongside `oats.aweb` for messaging. The `/aweb-tasks` skill covers claims,
  assignment, status, dependencies, handoff and epics using the instance's
  messaging identity in its default team, or an explicitly joined identity.
- The tasks spawn hook is advisory and config-only: it never calls aw, mints
  an identity or joins a team. Its fixed brief directs agents to check their
  identity with `aw whoami` before task use. This version has no tasks
  binding/readiness item.
- Task descriptions, notes, comments and closing reasons use file flags;
  titles are read from a file. Messaging instructions defer task state to
  the selected tasks provider.

## 1.30.0 — 2026-10-19

Both floors are unchanged: OATS >=0.52.0 and aw >=1.36.33.

- **Codex homes need the host wake broker, judged from the kernel's launch
  record** (#134, the provider half of awebai/oats#1345). Readiness chooses a home's
  runtime from the kernel's recorded `instance.json` `launch.harness`, with
  top-level `harness` when the launch recipe lacks it. Both must be
  nonempty, unpadded strings, and must agree when both are present. Provider
  `meta.runtime` is used only when both kernel fields are absent, and
  configuration names or the caller's environment never select the runtime.
  - A home recorded as Codex requires the broker's prerequisites, even when
    its captured delivery is absent.
  - A missing Codex target or primary stream (including a retained native
    row that carries only joined identities) reports `wake-stream-missing`.
    Refused or disconnected streams still report `wake-stream-unavailable`.
  - Malformed or inconsistent kernel fields report
    `receive-record-unavailable`.
  - A start decides between the broker and the channel path from
    `OATS_RUNTIME` (the alias of `OATS_HARNESS`), whatever the launch
    configuration is called.
- **A malformed wake-status timestamp is no longer called stale** (#133). A
  supplied `status.updated_at` that does not parse reports
  `wake-status-timestamp-unknown`, naming the observed aw client and daemon
  versions. Provider `unavailable` maps to the kernel's `unknown`. A parsed
  future snapshot is still `wake-status-stale`. RFC 3339 timestamps with one
  to nine fractional digits are accepted.

## 1.29.0 — 2026-10-16

Both floors are unchanged: OATS >=0.52.0 and aw >=1.36.33. Publishing health
needs aw 1.36.38, checked only while publishing is on.

- **`oats aweb health enable | status | disable | publish`: the agent status
  publisher** (aweb-acah.3; #123, #125, #127). Once a minute it publishes a signed
  status for every agent of the deployment to aweb: whether it can be
  reached (`yes`, `degraded`, `no` or `unknown`), why not, and who fixes it.
  The team's dashboard shows that instead of aweb's own guess. It is opt-in
  and host-only (`settings.oats.aweb.health` in `oats-local.yaml`), and runs
  in the deployment directory, in the operator's shell, never inside an
  instance.
  - `enable` records `health.publish: true` (with `--operator <role>` and
    `--language <tag>`) and registers one schedule job, `oats-aweb-health`.
    It never installs the host timer: until the timer runs, `status` names
    it as a problem.
  - Each tick designates the host's root as each agent's status host once,
    then publishes the agent's status, signed with `aw status publish`.
  - A channel home is proven reachable by its adapter's receive receipt
    (Claude channel 1.7.17, pi extension 0.3.15). An older adapter still
    receives but writes no receipt, and the missing receipt alone never
    makes a home `no`.
  - `disable` removes the job, records `publish: false` and clears every
    designation it made, so aweb shows its own facts again. It exits 1 and
    says why for each designation it leaves on the server; a rerun retries
    them.
  - Required releases: aw 1.36.38 to publish (checked by version in
    `enable`, `status` and every tick; an older aw or a pre-release is
    refused before anything is sent), server 1.27.24, and Claude channel
    1.7.17 or pi extension 0.3.15 to prove receive (stated, not checked).
  - A child aw that exits before reading its input is now its answer, not
    an unhandled `EPIPE`.
  - Reference: [docs/health-publisher.md](docs/health-publisher.md), with a
    card in `/oats-aweb` section 8. The design:
    [docs/design/2026-10-14-agent-health-publisher.md](docs/design/2026-10-14-agent-health-publisher.md).
- **`/oats-aweb`: on macOS, `oats aweb wake install` runs from the desktop
  login, not over ssh** (#120). An ssh session has no `gui/<uid>` domain, so
  `launchctl bootstrap` fails (`E_WAKE_UNIT`); rerunning `install` from the
  desktop recovers.

## 1.28.0 — 2026-10-15

Both floors are unchanged: OATS >=0.52.0 and aw >=1.36.33
([oats#1224](https://github.com/awebai/oats/issues/1224)).

- **`oats aweb wake install | status | uninstall`.** A host could finish
  onboarding with no host wake broker, which left every home that needs it
  poll-only, and nothing in OATS installed the broker as a service. `install`
  writes the per-user unit `ai.aweb.wake` (systemd `--user` on Linux, a
  LaunchAgent on macOS). The unit runs `<aw> wake run` with only `PATH` and
  `AW_WAKE_OATS_BIN`, resolved from the operator's shell. Its PATH reaches
  `tmux`, which the broker's `oats session` calls need: tmux's directory, then
  the kernel host timer's fallback, which starts with `/opt/homebrew/bin`.
  With no tmux on PATH, `install` warns `wake-tmux-missing`. It then
  (re)starts the unit and verifies the daemon reports the installed aw's version.
  Rerunning it restarts the broker after an aw upgrade. It never takes over a
  unit it did not write (`E_WAKE_UNIT_CONFLICT`, with the retire steps), or a
  broker started by hand (`E_WAKE_RUNNING_UNSUPERVISED`). It refuses inside an
  instance (`E_WAKE_INSIDE_HOME`). On Linux with lingering off it warns, or
  refuses with `--linger-required`. `status` is read-only: it reports the
  unit, the daemon and the deployment's homes that need the broker, each
  registered or not. `uninstall` removes only that unit. The unit is built
  from the custody unit's parts, and custody behaviour is unchanged. Reference:
  [docs/wake-service.md](docs/wake-service.md); the host procedure is
  oats.setup's `/oats-host-delivery`, Choice 2 (oats.framework 1.11.0).
- **Readiness warns `claude-channel-mode-default`** for a Claude
  `delivery: channel` home that runs in development mode because
  `claudeChannelMode` was never set. It judges the home's captured settings:
  no key, or the key with the origin `manifest-default`. A home recorded
  before OATS kept setting origins stays silent, since it cannot tell unset
  from an explicit `development`. The warning can appear beside
  `channel-dev-confirmation`.
- **Soul-scope readiness checks the host wake broker** when the spawn will
  need it: `delivery: session`, or a non-empty `join`. It reads
  `aw wake status --json` once, and reports the home-scope codes
  (`wake-daemon-not-running`, `wake-daemon-version-unknown`, and
  `wake-daemon-outdated` as a warning). With no broker needed, it reads
  nothing.
- `/oats-aweb` §4 and §7 point to oats.setup's `/oats-host-delivery` for the
  host procedure (oats#1224, #118).
- **Existing homes keep their captured provider bytes.** Updating the pin and
  syncing supplies these to new compositions and to operator commands run from
  the deployment.

## 1.27.3 — 2026-10-14

Both floors are unchanged: OATS >=0.52.0 and aw >=1.36.33. No new aw upgrade
or service restart is required for this fix. Keep the existing upgrade order:
meet the kernel/aw floors (restart custody services and the wake daemon after
an aw upgrade), then update the provider pin and `oats sync`.

- **Broker readiness no longer mistakes query-time timestamps for the future
  (#116).** Judge `aw wake status` timestamps against a clock read after the
  status call, not readiness's phase-start clock. This removes the false
  `wake-status-stale` problem and consequent `unavailable` verdict for Codex,
  `delivery: session`, and joined-team broker routes. No skew allowance is
  added: malformed or genuinely future timestamps still fail; inspection
  ordering and observation-age warnings remain intact.
- **Existing homes keep their captured provider bytes.** Updating the pin and
  syncing supplies the fix to new compositions; it does not rewrite running
  homes or establish successful message delivery.

## 1.27.2 — 2026-10-14

Both floors are unchanged: OATS >=0.52.0 and aw >=1.36.33. Instruction text
only.

- **`/oats-aweb` etiquette points to `/oats-token-saving`** for whether to
  send, to whom, what goes in and how long
  ([oats#1103](https://github.com/awebai/oats/issues/1103), #114). The
  section keeps how to send. `/oats-token-saving` ships in `oats.core` 2.6.0
  (OATS 0.54.0); on an older kernel the pointer names a skill the instance
  does not have, and the rule above it still stands. New spawns pick it up
  after `oats sync`; running instances keep what they were spawned with.

## 1.27.1 — 2026-10-12

Both floors are unchanged: OATS >=0.52.0 and aw >=1.36.33.

- **Resident custody units under another label are refused (#111).** Within
  the recognised `ai.aweb.custody.<namespace>.<name>` units, a same-root unit
  under another namespace now fails `E_RESIDENT_UNIT_CONFLICT` without writes,
  even when unloaded. Running foreign custody fails `E_RESIDENT_CUSTODY_RUNNING`
  first. Both errors name the discovered unit and the platform's retirement
  steps: macOS `launchctl bootout gui/<uid>/<label>` and move the plist out of
  `~/Library/LaunchAgents`; Linux `systemctl --user disable --now <label>.service`
  and remove the unit file. The command never adopts or removes a foreign unit.
  If no recognised unit is found, the running-custody error explicitly directs
  the operator to find and stop any other supervisor, retaining `aw custody stop`
  in R or stop whatever supervises it. Arbitrarily named services remain outside
  discovery; different-root conflicts are unchanged.
- **Custody units use the kernel-selected Node directory (#112).** The unit's
  PATH uses the directory of absolute `OATS_NODE_BIN`, preserving its stable
  link. Older kernels, or empty/relative values, retain the `process.execPath`
  fallback. The provider does not duplicate the kernel's stable-node rule.
- **Refresh existing units by rerunning `oats aweb resident create <name>`**
  from the deployment, keeping any original `--root`. It verifies the same
  resident without an API key, rewrites a changed unit and reloads it. An OATS
  upgrade or seat restart alone does not rewrite it. The absolute selected `aw`
  path remains a separate hazard when npm installs it inside a Node version:
  install aw under the new version and rerun resident create before removing
  the old version. See [the custody unit](docs/resident-create.md#the-custody-unit).


## 1.27.0 — 2026-10-11

**Host order, before syncing to this release:** upgrade the OATS kernel to
0.52.0 or later first, then `oats sync`. The aw order is unchanged from 1.26.0:
aw 1.36.33 or later, with every resident custody service and the host wake
daemon restarted after the upgrade.

**Compatibility: requires OATS 0.52.0 or later.** Older kernels stay on
oats.aweb 1.26.2. On an older kernel the kernel refuses the composition and
names the range, with `E_CAPABILITY_INCOMPATIBLE`: "oats.aweb requires oats >=0.52.0; this kernel is <version> — pin a release of oats.aweb whose range admits <version> in the workspace's packages:, or run a kernel the range admits".

- **OATS confirms Claude's development-channel prompt.** A Claude home in
  development mode (`claudeChannelMode: development`, the default, under
  `delivery: channel`) no longer stops at Claude's development-channel prompt:
  the kernel confirms it once at launch (oats#886).
  `settings.oats.aweb.delivery: session` or
  `settings.oats.aweb.claudeChannelMode: approved` stop the prompt altogether.
  The `claudeChannelMode` manifest description says so.
- **The `channel-dev-confirmation` warning now states that decision:**
  "Claude's development-channel prompt: OATS confirms this prompt at launch;
  `settings.oats.aweb.delivery: session` or
  `settings.oats.aweb.claudeChannelMode: approved` stop it." It replaces
  "Claude Code may stop at its development-channels confirmation, and nothing
  in this provider answers it; …". Spawn apply, start and restart of a
  development home always carry it: a new launch has no outcome yet.
- **Readiness is quiet after a confirmed start.** Readiness reads the kernel's
  record of the home's last start, `instance.json` `launchPrompts.status`, and
  nothing else: `completed` gives no warning; `blocked`, `incomplete`,
  `not-engaged`, any other status but `flag-ignored` (below) or no record give
  the warning above. The provider never explains a block: the kernel's own
  `launch-prompt` readiness item does. Approved, session, Pi and Codex homes are
  unchanged.
- **`claude-channels-unavailable` when Claude ignored the development-channel flag.**
  Claude ignores `--dangerously-load-development-channels` when its launch
  environment opts out of telemetry (any of `DISABLE_TELEMETRY`, `DO_NOT_TRACK`
  or `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`) or when the account or
  organization has no channels; the kernel then sends no key and records
  `launchPrompts.status: flag-ignored`. Readiness for that development home
  warns `claude-channels-unavailable` instead of `channel-dev-confirmation`:
  "Claude ignored the development-channel flag at the last start, so this home
  has no channel delivery. Claude Code disables channels when its launch
  environment opts out of telemetry (`DISABLE_TELEMETRY`, `DO_NOT_TRACK` or
  `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`) or when the account or
  organization has no channels. Remove the variable from the launch environment
  yourself, use an account with channels, or use
  `settings.oats.aweb.delivery: session`." The
  provider never reads, unsets or changes these variables: readiness runs in the
  operator's shell, not in Claude's launch environment. It doesn't name
  `claudeChannelMode: approved`: approved mode needs channels too. Spawn, start
  and restart, and the approved, session, Pi and Codex homes, are unchanged.
- **Where the decision shows:** spawn apply, start and restart, the start
  preview (`oats launch-config preview`) and readiness. It doesn't show in the
  spawn preview yet: `oats spawn --preview` runs no provider hooks, and shows no
  decision statement from the provider or the kernel
  ([oats#912](https://github.com/awebai/oats/issues/912)).
- **The exact-home launch consent is gone.** The skill's
  `launchPromptAnswers` opt-in and its reference
  (`references/launch-consent.md`) are removed: the kernel no longer reads that
  key. Section 4 is now "Channel selection and the development-channel prompt".

## 1.26.2 — 2026-10-11

- **A resident's seat is ready without a minting root.** In a deployment that
  holds only residents (one made by `oats aweb resident create`, for example),
  readiness no longer reports `no messaging root at <deployment>: run oats aweb
  setup there or set settings.oats.aweb.root` for a seat with
  `identity.mode: global` and an `identity.resident`: that seat acts through
  the resident's grant and mints nothing. Whether the resident resolves is
  still the custody check's. Local mode is unchanged, and so is a GLOBAL seat
  with no resident: it reports the missing root and that it requires
  `identity.resident`. The same rule holds for `oats readiness` and for a
  binding's check. The declared environment, custody and keys are unchanged.

## 1.26.1 — 2026-10-10

**`oats aweb resident create` now needs OATS 0.48.0 or later wherever it maps
the team through the kernel.** The kernel gained `oats teams add --no-default`
and `oats teams default --if-absent` in OATS 0.48.0 (`teams-conditional-default`).
On a kernel from 0.42 to 0.47, 1.26.0's `resident create` ran: without
`--team-label` it mapped nothing, and with `--team-label` it ran a plain
`oats teams add`, which could replace the workspace's default team. 1.26.1
refuses there before any effect whenever it would write a mapping through the
kernel. With the derived label, that is every run where the workspace allows
local teams. Where it allows none, nothing is written through the kernel, so
there is no refusal and the entry to commit is printed. In practice this costs
nothing: `resident create` shipped only in 1.26.0, and on those kernels its
printed next step did not work either. The refusal, before any effect, reads:
"oats aweb resident create needs OATS 0.48.0 or later
(teams-conditional-default), so that mapping the resident's team never
replaces a default team; the selected kernel is <version>: upgrade OATS with
`npm install -g @awebai/oats@latest`, then rerun".

**Fixed: `oats aweb resident create` now leaves a deployment where its printed
next step works.** Before, without `--team-label` it mapped no team, so in a
fresh deployment the printed spawn line failed with "no teams configured" and
rolled back.

- **The team is mapped without `--team-label`.** The resident's team is mapped
  under its name, the part of the team id before `:`, normalised as
  `oats aweb setup` normalises team names (`default` for
  `default:acme.aweb.ai`). A label that already maps to the same team is
  reused. `--team-label` works as before.
- **The default team.** A seat's grant is minted in the deployment's default
  team. Where the deployment has none, the command makes the mapped label the
  default and reads it back. An existing default is never changed: when it is
  another label, the output prints `oats teams default <label>` as its own
  first step, before the spawn line, with that reason and its consequence: it
  moves the default team of the whole deployment, so every later spawn of a
  soul without a default team of its own goes to the resident's team. Where the workspace
  allows no local teams, the lines to commit include `defaultTeam:` when the
  workspace has none; when it has another default, that change is the
  workspace's, and the output says so before the spawn line.
- **Fixed: `--team-label` could replace the workspace's default team.** The
  mapping was a plain `oats teams add`, which makes the first local team the
  deployment's default, over the workspace's. The mapping is now
  `oats teams add --no-default`, and the default is set only with
  `oats teams default --if-absent`.
- **OATS 0.48.0** (above): an older kernel ignores `--no-default` and
  `--if-absent`, so the command refuses it wherever it would write through the
  kernel. The package's `compatibility.oats` stays `>=0.42.0`.
- **A derived label that maps to another team** is refused at the record stage
  (`E_RESIDENT_TEAM_LABEL`), and the message names both teams: the one the
  label maps to and the resident's. The team is known only after the init, so
  this check runs after `aw init` and before the label is written. The
  message names what is already in place: R's path, the custody unit's label
  and file, and `settings.oats.aweb.residents.<name>` in the deployment's
  `oats-local.yaml`. It gives the rerun,
  `oats aweb resident create <name> --team-label <other>`, which needs no key:
  it verifies the resident and adds the mapping, adopting what the first run
  left: the same identity and custody unit, nothing orphaned. A team name that
  gives no team label of at most 64 characters is refused the same way.
  `--plan` without `--team-label` says the label is derived after `aw init` and
  that the run stops there if it is taken.
- **Output.** Text and `--json` report the label, its status (`added`,
  `reused`, `commit`), whether it was derived, and the default team (`set`,
  `already`, `kept`, `commit`). Added to `--json`: `steps`, every command to
  run in order (the spawn line last), and, when another default is kept,
  `stepsReason` and `defaultTeam`. `next` is unchanged.

**Fixed: a grant seat on a resident with its own registry verifies at that
registry.** Mail read by a seat on a resident whose identity records a custom
`registry_url` showed `verification_stale` unless the operator's environment
set `AWID_REGISTRY_URL`. The spawn and launch hooks now give the seat
`AWID_REGISTRY_URL`, read from the resident's `.aw/identity.yaml` (through
`settings.oats.aweb.residents`), when its origin is not aw's default
(`https://api.awid.ai`). The operator's environment is never read for it. A
recorded value that is not an http(s) registry origin, including one the YAML
reader cannot take (a quote or `#` in it), is a readiness problem (`custody`)
and a spawn warning, and is not passed on. Its message names the identity
file and the reason, never the recorded value, which may hold credentials.

**Declared contract.** The manifest declares the hook environment variable
`AWID_REGISTRY_URL` (in `environment`) and the namespace `AWID_` (in
`environmentNamespaces`). A deployment's trust review at `oats sync` shows
both. No other `AWID_` variable is set. A grant seat's session on a resident
whose registry is not aw's default now carries one more variable,
`AWID_REGISTRY_URL`; every other session, local identities' included, is
unchanged. The manifest validates, and such a seat's spawn hook output is
accepted, on the oldest admitted kernel, OATS 0.42.0.

## 1.26.0 — 2026-10-10

**Host order, before syncing to this release:** upgrade aw to 1.36.33 or later,
restart every resident custody service and the host wake daemon, then
`oats sync`. A running custody or daemon keeps its old code until it is
restarted.

**`oats aweb resident create <name>`** makes a GLOBAL resident identity in an
existing hosted team, serves it, and records it, from the aweb dashboard's
line: `AWEB_API_KEY=<key> AWEB_URL=<url> oats aweb resident create <name>`
(aweb-abqy.3). See [docs/resident-create.md](docs/resident-create.md).

- **Preflight, with no remote effect.** The aw floor; what the resident's
  directory R holds (`<deployment>/.aweb-residents/<name>`, or `--root`):
  empty creates, a partial init continues, a complete global identity is
  verified and adopted, a quarantined partial goes to aw for its own refusal,
  anything else is refused naming what is there. Also refused: a resident
  already recorded at another R, a custody unit of this name serving another
  directory, a complete identity whose custody already runs but not from this
  command's unit, whose process must be running and be the server: it owns the
  custody socket where `lsof` exists, else it stays up (aw refuses a second
  server on an answering socket). The same check makes the custody ready only
  when our unit serves it (`E_RESIDENT_CUSTODY_RUNNING`: stop the other, then
  rerun), and on
  Linux a user without systemd lingering (with the exact
  `loginctl enable-linger <user>`).
- **One init run.** Exactly `aw init --global --name <name>
  --do-not-touch-agents-md --json` in R, once, in an environment built from
  nothing: `PATH`, `HOME`, `AWEB_URL`, `AWEB_API_KEY`, `AW_NO_UPDATE_CHECK=1`,
  and `AWID_REGISTRY_URL` only when set. A failure is aw's own text; when aw
  leaves nothing to continue, the message says so and names the capture to send
  to aweb. aw's streams and exit are kept under `R/.oats-resident` (0700/0600),
  with the key redacted.
- **The key** comes from `AWEB_API_KEY`, or a terminal prompt that does not
  echo; with neither the command refuses at once. No flag takes a key. It is in
  no other child's environment (the floor check's `aw version` included), no
  argv, unit, setting, capture or output.
- **Verify.** aw's answer must be a connected global identity named `<name>`
  in a canonical team, with a stable id and an address. Every
  `aw doctor identity --offline` check must be `ok`, since aw answers `ok`
  overall with every check `info` when there is no identity. A failing
  `aw doctor registry --online` is a warning.
- **Custody.** A per-user unit `ai.aweb.custody.<namespace>.<name>` runs
  `aw custody serve` in R with `PATH` and `HOME` only (that `PATH` is aw's and
  node's directories and the system's, so a rerun from another shell leaves a
  running unit alone): a launchd agent on macOS,
  a systemd --user unit (enabled by its path) on Linux, the hand step
  elsewhere. Then it waits for the running custody to be ready, the ops
  `mail_reply_continuation.v1` and `grant_never_ttl.v1` included.
- **Record.** `settings.oats.aweb.residents.<name>: R` in `oats-local.yaml`;
  `--team-label <label>` maps the label to the resident's team (`oats teams
  add`, or the lines to commit when the workspace allows no local teams). Before
  an init, a label that already maps to a team is refused in the preflight.
- **Outcomes:** `PASS resident <address> team <id> custody running`, then the
  `oats spawn … --provider oats.aweb identity.mode=global --provider oats.aweb
  identity.resident=<name>` step; `FAIL <stage>: <message>`; `--json` answers
  one JSON-v1 envelope with a stable code per failing stage; `--plan` changes
  nothing and needs neither the key nor `AWEB_URL`.
- **Single aw floor 1.36.33** (`AW_MIN`); `setup --install-aw` installs
  `^1.36.33` by default. Upgrade aw on the host, restart the wake daemon and
  every resident custody service, then `oats sync`.
- CI runs real-stack journeys against aweb's local stack with the released aw:
  registration, same-DID resume, the key's absence on a failure, and adopting a
  resident with a real systemd --user unit. A complete create is proven by the
  joint E2E against aweb Cloud.

## 1.25.1 — 2026-10-10

- Readiness no longer reports `joined-team-receive`: a joined team that
  receives live needs no action (awebai/oats#881). Its receive mode stays in
  the spawn brief and in `oats aweb teams --json` (`joined[].receive`).
- A start waits at most 10 seconds (aw's own client timeout) for the custody's
  grant list before it says it could not check for orphaned grants; retire
  keeps 30 seconds, readiness 5.
- An aw call that never exits is reported by how it ended, "timed out after
  <n> s" or its error code or signal, instead of "(exit null)": in the hook's
  errors, the roster's source errors, the routed join, the `--install-aw` npm
  detail and readiness (including `grant-revoke-unchecked` after its 5 s cap).

## 1.25.0 — 2026-10-10

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
  silently. Every mint carries a label unique to its seat,
  `oats:<instance>:<seat>`, where `<seat>` is random at spawn and kept in the
  identity meta (`identity.seat`); a name reused after a retire, or repeated
  across deployments under one resident, is a different seat. The seat is also
  written to the home (`.oats-aweb/seat.json`: seat, instance, resident, team;
  no keys) before the first mint, so a hook killed between the mint and its
  answer, which leaves the kernel no meta, still leaves a retire what it needs to
  find the grant: a retire whose meta carries no seat reads that record. The custody's
  grant list (`aw id grant list --team <team> --json`) is the source of truth:
  at every real start and at retire, this seat's active grants other than the
  current one (at retire, all of them) are revoked, so a grant minted before a
  crash or left by a failed revoke is found and ended. Labels of any other
  form, including the bare `oats:<instance>` of earlier releases, are never
  touched. Readiness warns `grant-revoke-pending` for each such grant, from the
  list. Wherever a revoke fails, the message names the grant, how long it stays
  valid ("until revoked", or "until <expiry> unless revoked" for a duration)
  and the exact command, `aw id grant revoke <id>` run in the resident's
  custody directory. When the list cannot be read, a start proceeds and says
  "could not check for orphaned grants", readiness warns
  `grant-revoke-unchecked`, and a retire does not succeed.
  - A renewal whose fresh grant fails a step (team mismatch, custody
    attachment, wake registration, a receipt that fails validation) keeps the
    previous grant and starts on it; a fresh grant it cannot revoke is named and
    swept at the next start. Only the first mint at spawn, with no grant to fall
    back on, fails. The renewal's three silent "expires by TTL if revoke fails"
    catches are gone. For a failed spawn the returned meta carries the grant id
    and seat to the kernel's rollback retire.
  - The previous grant after a successful renewal does not fail the start; it
    is named and swept at the next start.
  - Behaviour change: retire exits nonzero while any grant of the seat stays
    unrevoked, or when it could not read the list, for every grant; the kernel
    then keeps the home and the meta for the retry. Its message lists each
    grant with its revoke command, which is what `oats retire --force` prints,
    and replaces "it still expires at …".
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
  mint (no aw or custody call). A never-grant, the healthy default, gets no
  lifetime diagnostic (readiness has no informational channel: the kernel
  accepts only status, problems and warnings, and Desktop and doctor count
  warnings); the agent's brief says it never expires, and its "never" is never
  read as a date. A grant
  with a duration gets `grant-expiring` (warning) within 7 days of expiry,
  `grant-expired` (problem) at or after it, and `grant-expiry-unknown` (warning)
  when the record has no readable expiry. Each names the recorded instant and
  that seat's remedy: under `renew: launch`, "restart the seat to renew it
  (`oats session restart --home <home>`)"; for a seat that captured an
  `identity.ttl` duration, "a restart renews it for another <ttl> (…); to stop
  it expiring, remove identity.ttl and respawn"; under `renew: off`, where a
  restart keeps the grant, "respawn the seat (or set `renew: launch` and
  respawn)". A grant minted before this release records no renew mode, so its
  remedy adds "if its identity.renew is off, respawn it instead". LOCAL seats
  are unaffected.
- `oats aweb setup --join <label>` on a workspace that forbids local team
  writes joins a second committed team under a different default with no team
  write: the join preserves that default, so the default command is not needed
  (oats-aweb#96, the known limit of 1.24.1). An unmapped label on a closed
  workspace still refuses before acceptance.
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

## 1.24.1 — 2026-10-10

Fixed: `oats aweb setup --join <label>` on a workspace that forbids local team
writes (`local-teams-closed`) refused even when the workspace itself commits
that label to the joined team and it is already the default, so the join needed
no team write at all. Setup now refuses on a closed workspace only when its plan
would actually write a mapping or a default; a committed, already-default team
joins and records its minting root (`roots[<team>]`) without touching the team
configuration. An unmapped label on a closed workspace still refuses before any
aw call, as before. On a closed workspace a conflicting mapping or another
configuration failure is now reported as that (`E_SETUP_TEAM_CONFLICT`,
`E_SETUP_CONFIGURATION`) rather than as `E_SETUP_POLICY`; both still refuse
before any write. Known limit: a closed workspace that commits the joined label
but defaults to a different label still refuses, though the join would only
preserve that default.

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
