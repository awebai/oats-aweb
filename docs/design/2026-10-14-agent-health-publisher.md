# Agent health publisher (aweb-acah.3, OATS half)

Status: **SPEC FOR AGREEMENT. No code.** Owner: oats-aweb-expert. Direction and
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
| Signing and sending | **open, see decision D1** | |
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
| 23 | warning `native-receive-unproven` | **D2** | `oats.native_receive_unproven` | `unknown` |
| 24 | none of the above | `yes` | — | — |

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

## 5. Decisions needed from you

- **D1. Who signs and sends.** Designation needs team-auth v2 as the agent.
  Designation at resident create needs root identity auth as the resident.
  Publishing needs team-auth v2 as the root. `aw` 1.36.36 has none of these
  commands, and the aweb slices list no client work.
  - **(a) Recommended: aw grows the commands.** They would be
    `aw status-host set|clear|show` and
    `aw status publish --alias <a> --document -`; aw canonicalizes, signs with
    the identity's key, and PUTs. With (a) there is one auth implementation,
    and oats.aweb keeps its rule that it never reads key material. oats.aweb
    still builds and validates the document against the vector, and the aw
    command's output is checked against the vector's signatures. This needs
    the aw owner, which is an aweb-side slice.
  - **(b)** oats.aweb implements team-auth v2 and identity auth in node,
    reading `signing.key` and the team certificates directly. Both are
    pinned by vectors (`team-auth-envelope-v2.json`, `agent-status-v1.json`).
    There is no cross-repo wait, but it duplicates aw's auth and couples the
    package to aw's key-file format.
- **D2. `native-receive-unproven`.** oats.aweb emits it on every channel home
  that has no other problem: every Claude and pi home under the default
  delivery. If it maps to `degraded`, as agreed, nearly every agent reads
  "degraded" all the time. If it maps to `yes`, that breaks "yes means delivery
  proven".
  - **Recommended:** `degraded` in v1, plus an aweb-side ask that the channel
    plugin and the pi extension leave a local receipt of an open stream, which
    the publisher can read as proof. The alternative is `yes` on a loaded
    channel with a live harness, which is weaker.
- **D3. Doctor.** A capability cannot make `oats doctor` fail.
  - **Recommended:** the missing tick fails `oats readiness`, and fails
    `oats aweb health status` (both are in oats.aweb). A kernel doctor check is
    a separate ask, which I do not make.
- **D4. Stop.** There is no stop hook.
  - **Recommended:** a stop shows at the next tick, within 60 s, with no kernel
    change. The alternative is a `stop` hook event, which is kernel.
- **D5. `fixing.by` for custody and expired grants.**
  - Custody restarts under KeepAlive are quick. A custody fault still present
    at a tick is not recovering by itself: the two-day outage is the
    precedent.
  - Grant renewal happens only at launch. A running seat with an expired grant
    stays broken until someone restarts it.
  - So I propose `operator` for both, not the draft's `automatic`.
  - `automatic` is kept for nothing in v1. When a later change adds something
    that does recover by itself (for example a wake job that restarts a home),
    it gets `automatic` then.
- **D6. Vector count.** The task says 44 cases. At `9e2d4e255` the vector
  holds 7 valid and 31 invalid cases, plus 1 cross-type entry: 39. Which 44 do
  you mean?
