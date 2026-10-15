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
| Designation | oats.aweb hooks | Three call sites: the spawn hook after it mints the identity; the launch hook once per existing instance that has not been designated; and `oats aweb resident create`. |
| Immediate publish on change | oats.aweb launch hook (start/restart); retire hook (resident seats only) | There is no stop hook. A stop is published at the next tick, within 60 s. See D4. |

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
| 2 | Resident seat retired, and no other live seat of that resident on the host | `no` | `oats.retired` | `nobody` |
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
| 18 | problem `receive-inspection-unproven`, `wake-status-stale` or `wake-daemon-version-unknown` | `unknown` | `oats.receive_unknown` | `unknown` |
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
known wrong", not "delivery proven": oats.aweb has no proof of an open
native stream. aweb has been asked for a local receipt from the channel plugin
and the pi extension; once it exists, `yes` on a channel home requires it.

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
  schedule job, and reports:
  - the timer;
  - the homes that publish;
  - the homes that do not publish yet, with the reason: no agent DID recorded,
    or not designated;
  - the last result for each agent.

**Recording the agent DID.** The agreement says the DID is "read from the
instance record, never guessed", but today nothing records one. On the local
path `capabilityMeta` has no DID; resident seats record an address but no
`did:aw`; `resident create` returns `stableId` and drops it.

When `health.publish` is on:

- The spawn and launch hooks add `identity.did` to meta:
  - the `did:key` for local and joined identities, from `aw whoami --json` in
    the identity home;
  - the resident's `did:aw` for global identities.
- `resident create` records the stable id beside the resident's root in the
  `residents` setting.
- A home without a recorded DID is not published, and `health status` lists
  it.

**Clock and sequence.**

- One `Date.now()` reading per document gives `seq`, as a safe integer.
- `observed_at` is that reading truncated to seconds.
- `valid_until` is `observed_at` + 300 s.

A publish runs on every tick, even when nothing changed, which refreshes
`valid_until`. The aweb rate limit is 1 publish per 5 s per agent; the tick
publishes once per 60 s, plus the launch hook's publish.

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

- New spawns designate at once.
- Existing instances designate at their next launch, as the agent, through its
  own credential.
- A seat that is already dead is designated when it is repaired, or by the
  team controller. The controller path is not in v1; `health status` lists such
  seats.
- Until then aweb shows them on its own fallback.

**Designation failure.** At spawn, a failed designation is a warning and never
fails the spawn, because messaging works without it. The launch hook tries
again at the next start.

**Refusals when publishing.** Each refusal is logged with its exact HTTP status
and message to `<deployment>/.oats-aweb/health/log.jsonl`, one line per refusal:

- **409 `stale_seq`:** logged. The next tick sends a newer `seq`. A clock that
  stepped back recovers once it passes the stored value.
- **429:** logged with `Retry-After`. That agent is skipped until then.
- **403 "not the status host for <alias>":** logged, and the home is marked
  undesignated in `health status`. The next launch designates it again.
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
- **DID recording** when `health.publish` is on: additive meta, never guessed;
  homes without it are listed and not published.
- **D7 (supersedes the hook rows of §1 and D4's immediate publish): the tick
  does everything; hooks stay byte-identical.** A launch hook runs under the
  settings recorded at spawn, so a home spawned before `health enable` could
  never designate at launch. Each tick, per home:
  - identity.mode comes from the recorded meta;
  - the agent id is aw's own answer, `aw whoami --json`: `did` in the local
    identity home, `stable_id` in the resident's custody root;
  - the id is cached in `<home>/.oats-aweb/health.json` (provider state, a
    cache of aw's answer, not a record of ours);
  - designation runs `aw status-host set`: as the agent with its own identity
    home, or as the resident in its custody root. It runs only when there is no
    cached success for (agent id, host_did), when either changed, or after a
    403 `not_status_host`. An id that differs from the cache drops the cache.
  - A newly started or restarted agent appears within a minute; `health
    status` and the docs say so. `resident create` and the `residents`
    setting do not change.
