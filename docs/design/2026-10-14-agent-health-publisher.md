# Agent health publisher (aweb-acah.3, OATS half)

Status: **AGREED 2026-10-14 with oats-expert-juan (decisions in §5).** Owner: oats-aweb-expert. Direction and
second read: oats-expert-juan. Anything in the kernel needs a second read from
Pepe's side as well.

Pinned contract:

- aweb `docs/drafts/agent-health.md` at `6fdbe8251`: "The status document",
  "Publishing" and "Designating the status host".
- The additions agreed after that commit:
  - `reason.code` is at most 64 B and matches `^[a-z][a-z0-9]*\.[a-z0-9_]+$`;
  - `fixing` is required when `reachable` is not `yes`;
  - timestamps are `YYYY-MM-DDTHH:MM:SSZ`;
  - the check order is size, then canonical bytes, then type.
- The vector: aweb `docs/vectors/agent-status-v1.json` at `9e2d4e255`.

Facts were checked against oats.aweb 1.27.3 (`5b8aa6e`), OATS kernel 0.56.0 and
aw 1.36.36.

## 1. Where each piece lives

**Summary: everything lives in oats.aweb, and no kernel change is required.**
The kernel already has the tick hook we need: a local `command` schedule job.

| Piece | Where | Mechanism |
|---|---|---|
| Per-minute run | kernel, unchanged | A local schedule job `kind: command`, `cron: * * * * *`, `cwd: <deployment>`, `argv: ["oats","aweb","health","publish"]`. The host tick runs it once a minute. A dispatched capability command is a valid `argv` (`lib/schedule.mjs:385-387`). |
| Registering the job | oats.aweb | `oats aweb health enable` runs `oats schedule add oats-aweb-health --spec-json …` with a `description`. Removal is `oats aweb health disable`. |
| Host timer | operator | `oats schedule host install`. Kernel policy since 0.53 is that an agent never installs the timer. `health enable` reads `oats schedule host status --json` and refuses to report "enabled" while the timer is not installed and active. |
| Collecting state | oats.aweb, through the public kernel CLI | `oats status --json` lists the homes. For each publishing home: `oats session inspect --home` (harness alive), `oats instance events --json` (last event: `stopped` versus `launched`), `instance.json.launchPrompts`, and `oats readiness --home --json` (the provider's own `binding.check` problems and warnings). |
| Mapping to a document | oats.aweb | The vocabulary table (§2) and a phrase table per language. |
| Validation | oats.aweb | A validator that passes the vector's 7 valid and 31 invalid cases, red first. |
| Signing and sending | aw (D1) | `aw status-host set\|clear\|show` and `aw status publish --alias <a> --document -`, an aw slice requested from aweb. oats.aweb puts the call behind one function; when the installed aw lacks the command it reports "aw <version> has no status publish; needs aw >= X". |
| Designation | oats.aweb hooks (superseded by D7: the tick designates) | Three call sites: the spawn hook after it mints the identity; the launch hook once per existing instance that has not been designated; and `oats aweb resident create`. |
| Immediate publish on change | oats.aweb launch hook (start/restart); retire hook (resident seats only) (superseded by D7: no hook publishes) | There is no stop hook. A stop is published at the next tick, within 60 s. See D4. |

The parent agreement also says "oats setup installs it and `oats doctor` fails
without it". Two kernel facts stand in the way:

- `oats setup` is the turn-record script.
- A capability cannot make doctor fail. Doctor runs no capability code, and its
  warnings never change the exit status.

So inside oats.aweb, a missing tick is reported in three places:

- `oats aweb health status` exits non-zero.
- `oats aweb setup` prints it.
- The binding check of every home in a publishing deployment carries a
  `health-tick-missing` problem, so `oats readiness` reports that home as not
  ready.

Making doctor itself fail is a kernel ask. I do not propose it (D3).

## 2. Vocabulary table

The inputs are the kernel's instance state and the provider readiness codes
oats.aweb already emits. There are no new readiness items, except
`grant-revoked` (below).

A correction to the agreed note: **readiness items have no `remedy` field.**
The provider answers `{code, message}`, with the remedy written into the
message, and the kernel's provider item always has `remedy: null`
(`lib/instance-inspect.mjs:768-771`). So `fixing.by` cannot be read from a
remedy. This table assigns it per code.

Evaluation order: the first row that matches wins.

| # | Condition (source) | reachable | reason.code | fixing.by |
|---|---|---|---|---|
| 1 | Retired local or joined identity | not published: retire deletes the workspace, and aweb deletes the designation and the row | — | — |
| 2 | Resident seat retired or being retired (`retirePending`), and no other live seat of that resident on the host | `no` | `oats.retired` | `nobody` |
| 3 | Harness not alive, and the last event is `stopped` | `no` | `oats.stopped` | `nobody` |
| 4 | Never launched (`--no-launch`, no `launched` event) | `no` | `oats.not_started` | `operator` |
| 5 | Harness not alive, and the last event is `launched` or `restarted`. This covers a crash, and a tmux server lost to a reboot. | `no` | `oats.not_running` | `operator` |
| 6 | Session not observable (`E_SESSION_UNAVAILABLE`, `runtimeState: unreachable`) | `unknown` | `oats.session_unobservable` | `unknown` |
| 7 | `launchPrompts.status: blocked` | `no` | `oats.launch_prompt_waiting` | `operator` |
| 8 | `launchPrompts.status: flag-ignored` (warning `claude-channels-unavailable`) on a channel home | `no` | `oats.channel_not_loaded` | `operator` |
| 9 | `oats readiness` failed or timed out, or no provider item | `unknown` | `oats.readiness_unavailable` | `unknown` |
| 10 | problem `needs-configuration` | `no` | `oats.needs_configuration` | `operator` |
| 11 | provider status `authorization-required` | `no` | `oats.authorization_required` | `operator` |
| 12 | problem `custody` | `no` | `oats.custody_down` | `operator` (D5) |
| 13 | problem `grant-expired` | `no` | `oats.grant_expired` | `operator` (D5) |
| 14 | problem `grant-revoked` (**new item**, read from the grant status that `aw id grant show` reports in the custody root) | `no` | `oats.grant_revoked` | `operator` |
| 15 | problem `wake-daemon-not-running`, `wake-status-unavailable`, `wake-stream-unavailable` or `wake-worker-unavailable` | `no` | `oats.wake_broker_down` | `operator` |
| 16 | problem `wake-target-missing`, `wake-target-inactive`, `wake-target-binding` or `receive-record-unavailable` | `no` | `oats.wake_not_registered` | `operator` |
| 17 | problem `wake-target-paused` | `no` | `oats.wake_paused` | `operator` |
| 18 | problem `receive-inspection-unproven`, `wake-status-stale`, `wake-status-timestamp-unknown` or `wake-daemon-version-unknown` | `unknown` | `oats.receive_unknown` | `unknown` |
| 19 | any other problem code (forward-tolerant) | `unknown` | `oats.unclassified` | `unknown` |
| 20 | warning `grant-expiring`, with expiry within 24 h | `degraded` | `oats.grant_expiring` | `operator` |
| 21 | warning `joined-team-poll-only` (on the joined identity's own status) | `degraded` | `oats.joined_team_poll_only` | `operator` |
| 22 | warning `receive-ownership-unproven`, `receive-observation-aged` or `receive-observation-unproven` | `degraded` | `oats.receive_unproven` | `unknown` |
| 22a | native channel home (Claude or pi, `delivery: channel`) whose receipt `<identity dir>/receive/stream.json` names this agent (did:key; a resident's did:aw), with a live pid and a heartbeat within 90 s | `yes` (receive proven) | — | — |
| 22b | native channel home whose receipt names this agent but whose pid is gone or heartbeat is older than 90 s | `no` | `oats.channel_stream_down` | `operator` |
| 23 | warning `native-receive-unproven` with the channel loaded (`launchPrompts.status` is not `flag-ignored`) and the harness alive | `yes` | — | — |
| 23a | warning `native-receive-unproven` without that evidence | `unknown` | `oats.receive_unknown` | `unknown` |
| 24 | none of the above | `yes` | — | — |

A home under session delivery (every Codex home, and any home set to
`delivery: session`) never has a receipt; the broker rows judge it, and the
absence of a receipt is not a missing proof. A receipt naming another identity
is ignored.

**Limitation (v1).** Without a receipt, `yes` means "running, with its channel loaded and nothing
known wrong", not "delivery proven". The receipt ships in Claude channel 1.7.17
and pi extension 0.3.15. An older adapter writes none and still receives, and
the receipt names its adapter's kind, not its version. So oats.aweb cannot tell
an older adapter from one that has not read yet, and a channel home with no
receipt stays on rows 23 and 23a.

**Required releases.** Publishing needs aw 1.36.38 (`aw status-host`,
`aw status publish`) and server 1.27.24. Whenever publishing is on, `health`
checks `aw version` against 1.36.38 in `enable`, in `status` and on every tick.
An aw below it is refused even if it lists the commands. `disable` is the off
path: it clears designations with any aw that has `status-host clear` (no
released aw below 1.36.38 has it). A designation it cannot clear stays
recorded, is reported with why, and makes `disable` exit 1. The provider's own aw
floor stays 1.36.33, so a deployment that never enables health needs nothing
newer. Proving receive needs Claude channel 1.7.17 or pi extension 0.3.15.
`health status` states all three as required (`required: aw 1.36.38 to publish;
Claude channel 1.7.17 or pi extension 0.3.15 to prove receive`) but checks no
adapter's version, for the reason above. For the same reason the manifest gives
the channels no minimum version.

Notes:

- Warnings that do not affect receive are ignored and stay `yes`:
  `e2ee-disabled`, `wake-daemon-outdated`, `grant-revoke-*`, the Claude
  channel-policy warnings, and `channel-dev-confirmation`.
- `reason.text` and `fixing.text` come from a fixed phrase table per code and
  language. A readiness message never reaches the document, because it carries
  paths and hostnames.
- A role in `fixing.text` comes from deployment settings (§3).
- The codes are an OATS contract. They are additive, and a renamed code is a
  new code.
- **Joined teams.** Each joined-team identity is its own agent and gets its own
  row. Its publisher is that team's root (`roots[team]`).
- **Resident seats.** One resident is one agent per team. Several seats of one
  resident on this host are combined into one document: the best seat wins
  (`yes` > `degraded` > `no` > `unknown`), with that seat's reason. A resident
  with seats on two hosts is out of scope, because residents are a host fact.

## 3. Configuration

This is a new `hostOnly` key in the manifest, `settings.health`, set only in
`oats-local.yaml`:

```yaml
settings:
  oats.aweb:
    health:
      publish: true            # absent or false: nothing in this spec runs
      language: en             # BCP 47; unknown or missing phrases fall back to en
      operator: "Nactiva's operator"   # fixing.text when fixing.by is operator; default "Its operator"
```

- The key is host-only because publishing is a fact about the host. A soul or
  the workspace must not be able to turn it on.
- Only `en` ships in v1. Adding a language means adding a phrase file to the
  package. Do Pepe's users need `es` from day one?
- `oats aweb health enable|disable|status` writes the key, adds or removes the
  schedule job, and reports the job, the host timer, the last tick's counts
  (published, refused, skipped, failed), what stops publishing, and the
  required releases. Each tick's own `--json` lists every agent's result,
  including the homes it skipped and why (aw gave no agent id, no minting
  root, a retained seat).

**Recording the agent DID.** The agreement says the DID is "read from the
instance record, never guessed", but today nothing records one. On the local
path `capabilityMeta` has no DID; resident seats record an address but no
`did:aw`; `resident create` returns `stableId` and drops it.

D7 settles this: nothing is recorded in meta or in the `residents` setting,
and the hooks are unchanged. Each tick reads the id from aw itself and caches
it (§5, D7). A home whose id aw does not give is not published, and the tick
lists it as skipped.

**Clock and sequence.**

- One `Date.now()` reading per document gives `seq`, as a safe integer.
- `observed_at` is that reading truncated to seconds.
- `valid_until` is `observed_at` + 300 s.

A publish runs on every tick, even when nothing changed, which refreshes
`valid_until`. The aweb rate limit is 1 publish per 5 s per agent; the tick
publishes once per 60 s (D7: no hook publishes).

## 4. Errors and existing deployments

**What does not change.** With `health` absent, oats.aweb behaves exactly as
1.27.3:

- no designation;
- no extra `aw` call in any hook;
- no schedule job;
- no new readiness item.

The new manifest key and the `health` command are additive. Pepe's deployments
change only if their operator runs `oats aweb health enable`.

**Enabling on an existing deployment.**

- The first tick designates every agent it sees, as the agent, through its
  own credential (D7), whether its session is running or not; new spawns are
  designated at the next tick.
- Until an agent is designated, aweb shows it on its own fallback.

**Designation failure.** A refused designation is logged like any refusal
and the agent is not published that tick; the next tick tries again. Nothing
in spawn, launch or retire depends on it (D7).

**Refusals when publishing.** Each refusal is logged with its exact HTTP status
and message to `<deployment>/.oats-aweb/health/log.jsonl`, one line per refusal:

- **409 `stale_seq`:** logged. The next tick sends a newer `seq`. A clock that
  stepped back recovers once it passes the stored value.
- **429:** logged with `Retry-After`. That agent is skipped until then.
- **403 "not the status host for <alias>":** logged, and the home is marked
  undesignated in its cache. The next tick designates it again.
- **Any other status, or a transport error:** logged.

**The tick's envelope.**

- It is `ok: true` whenever the run completed, listing results per agent.
- It is `ok: false` only when the publisher could not run at all (no root, or
  aw missing or below the floor). Its message avoids the words that make the
  scheduler record `unknown` and hold the job (`/INCOMPLETE|quarantin|retain|could not verif/`).
- It never carries a top-level `home` or `instance`, which would make the
  scheduler hold the job lock.

**The time budget.** Calling `oats readiness --home` once per home is the costly
part (up to 30 s per check). The publisher runs at most 4 homes at once, with a
45 s budget. A home not assessed within the budget is published as `unknown` /
`oats.readiness_unavailable`. The rehearsal measures this on a real deployment.

**A slow tick.** The budget bounds readiness only; a hung kernel or aw call
is bounded by its own timeout, so a tick can outlast its minute. It never
overlaps the next: the kernel takes the job's lock for each run and skips a
minute whose lock is still held (`lib/schedule.mjs`, `acquireJobLock`). A slow
tick costs the minutes it spans; documents stay valid for 5 minutes.

**One failure stays one.** An observation that throws makes that home
`unobservable`; an agent whose bookkeeping throws (an unwritable cache, an
answer of the wrong shape) is listed under `failed`, possibly after its
document was sent, and every other agent is still published.

**Retry-After.** aw reports it as `retry_after`, whole seconds, or `null`
when the header is not an integer (an HTTP date); with `null` the agent is
tried again at the next tick. A log write that fails is listed under
`failed` and never costs the agent its designation or Retry-After record.

**Disable.** It clears the designations it cached for the homes and residents
it sees. A home already retired needs none: retire deletes its workspace and
aweb drops the designation with it.

**What the job prints.** The scheduled job runs without `--json` and prints
only counts. Server and aw messages appear only in `--json` output, in
`refused[].message`, as aw passes them through.

## 5. Decisions (oats-expert-juan, 2026-10-14)

- **D1: aw grows the commands** (`aw status-host set|clear|show`,
  `aw status publish --alias <a> --document -`). One auth implementation, and
  oats.aweb never reads key material. Everything else is built now; the send
  sits behind one function with a clear missing-aw refusal.
- **D2:** `native-receive-unproven` is `yes` only with positive evidence (channel
  loaded, harness alive, nothing else matched), else `unknown` /
  `oats.receive_unknown` (rows 23, 23a). An always-on warning teaches people to
  ignore it. The receipt ask goes to aweb with D1.
- **D3:** a missing tick fails `oats readiness` and `oats aweb health status`;
  no kernel doctor ask.
- **D4:** a stop shows at the next tick; the launch hook publishes at once on
  start and restart.
- **D5:** `operator` for custody and expired grants; nothing is `automatic` in v1.
- **D6:** the vector holds 39 entries (7 valid, 31 invalid, 1 cross-type); all 39 pass.
- **Language:** `en` only in v1; a phrase file per language is additive.
- **Cost:** measure CPU seconds per home per `oats readiness --home` on a scratch
  deployment. Above about 1 s per home: liveness (session inspect, events) every
  tick, readiness cached per home for at most 5 minutes and refreshed early when
  liveness changes. The measurement and the choice are recorded here.
  - **Measured 2026-10-15** on a scratch deployment of 4 launched homes (kernel
    0.58.0, macOS, load about 4; median CPU s, user + sys, of 5 runs):
    `oats status` 0.20 once per tick; per home `session inspect` 0.16,
    `instance events` 0.15, `readiness --home` 0.20. A live home skips
    `instance events` (its last event only tells a stop from a crash), so a
    tick costs about 0.2 + 0.36 s per live home.
  - **Choice: no readiness cache.** That is below 1 s per home. A tick over 30
    live homes still costs about 11 s of CPU a minute, so a deployment that size
    is where to measure again.
  - **Not measured:** the provider's own readiness work on a real oats.aweb
    home (`aw` wake status) and `aw doctor identity --offline` per identity.
    Scratch homes carry no aweb identity, and real deployments were out of
    bounds for this measurement.
- **DID recording** when `health.publish` is on: additive meta, never guessed;
  homes without it are listed and not published.
- **D7 (supersedes the hook rows of §1 and D4's immediate publish): the tick
  does everything; hooks stay byte-identical.** A launch hook runs under the
  settings recorded at spawn, so a home spawned before `health enable` could
  never designate at launch. Each tick, per home:
  - identity.mode comes from the recorded meta;
  - the agent id is aw's own answer, `aw doctor identity --offline --json`
    (`aw whoami` asks the server, a request per identity per tick; the offline
    doctor makes none): `did` in the local identity home, `stable_id` in the
    resident's custody root;
  - the id is cached in `<home>/.oats-aweb/health.json` (provider state, a
    cache of aw's answer, not a record of ours);
  - designation runs `aw status-host set`: as the agent with its own identity
    home, or as the resident in its custody root. It runs only when there is no
    cached success for (agent id, host_did), when either changed, or after a
    403 `not_status_host`. An id that differs from the cache drops the cache.
  - A newly started or restarted agent appears within a minute; `health
    status` and the docs say so. `resident create` and the `residents`
    setting do not change.

## 6. Follow-ups, outside the first PR

- **Live designation and publish against a server: done** (2026-10-15).
  `test/health-live.test.mjs` (opt-in, `OATS_AWEB_HEALTH_LIVE=1`) ran against
  a throwaway local aweb 1.27.24, with released aw 1.36.38 and pi extension
  0.3.15, in a throwaway team of its own. Its scratch deployment spawns a pi
  agent minted into that team. Each step is read back as the agent (the
  designation) and from the team's dashboard route (the stored health):
  - before enable: the aweb fallback;
  - a tick with the extension's real receipt fresh: `yes`, stored with
    `source: host` and `verified: true`; the signed payload names the agent's
    did:key and the root as publisher;
  - with pi stopped (SIGSTOP), so its pid lives and its heartbeat ages past
    90 s: `no` / `oats.channel_stream_down` (row 22b);
  - `disable`: the designation is cleared and aweb shows its own facts again.
  The test retires its agent, which deletes the identity on the server.
- **A real adapter's receipt: done**, the pi extension 0.3.15's own
  `stream.json`, in the same run. No Claude channel 1.7.17 seat was used
  (oats-expert-juan kept live Claude seats out of it).
- **The cost of the provider's readiness and `aw doctor`** per home on a real
  deployment (§5, Cost).
- **Required releases pinned** (aw 1.36.38, Claude channel 1.7.17, pi extension
  0.3.15, server 1.27.24): see "Required releases" in §2.
