# `oats aweb health`: the agent status publisher

`oats aweb health enable | status | disable | publish` publishes a signed
status for every agent of a deployment to aweb, once a minute. Under aweb's
agent-health contract (aweb `docs/agent-health.md`), the team's dashboard
renders that status instead of aweb's own facts about the agent:

- whether the agent can be reached (`yes`, `degraded`, `no` or `unknown`);
- why not, in one sentence ("Its message channel is not connected.");
- who fixes it: the deployment's operator, or nobody known.

It ships in oats.aweb 1.29.0. It is **opt-in** and **host-only**: nothing
publishes until an operator runs `enable`, and a deployment that never does
behaves exactly as before. Why it works this way (the vocabulary, the receipt,
the decisions) is in the design,
[docs/design/2026-10-14-agent-health-publisher.md](design/2026-10-14-agent-health-publisher.md).
This page is the operator's reference.

## Required releases

| What | Version | Needed for |
| --- | --- | --- |
| aw | 1.36.38 or later | publishing at all: `aw status-host` and `aw status publish` |
| aweb server | 1.27.24 or later | the agent-health routes |
| Claude channel (`aweb-channel`) | 1.7.17 or later | proving a Claude channel home receives |
| pi extension (`@awebai/pi`) | 0.3.15 or later | proving a pi channel home receives |

- **aw** is checked. While publishing is on, `enable`, `status` and every tick
  compare `aw version` with 1.36.38. An older aw, or a pre-release such as
  1.36.38-rc.1, is refused, and nothing is sent: `aw 1.36.37 has no status
  publish; needs aw >= 1.36.38 (aweb-acah.3.1)`. The provider's own aw floor
  stays 1.36.33, so a deployment that does not publish needs nothing newer.
- **The server** is not checked. An older server refuses the requests, and the
  refusals are logged.
- **The channels** are not checked. An older channel or extension still
  receives, but it writes no receive receipt
  (`<identity dir>/receive/stream.json`), so its home cannot be proven
  reachable. The missing receipt alone never makes it `no`: the design's other
  rows judge such a home. With nothing else found, it is `yes` when its channel
  is loaded and its harness alive, and `unknown` otherwise. The receipt names the adapter's kind but not its
  version, which is why OATS cannot tell an old adapter from one that has not
  connected yet.

`status` states the aw and channel releases: `required: aw 1.36.38 to publish; Claude channel
1.7.17 or pi extension 0.3.15 to prove receive`.

## Where to run it

Run every command **in the deployment directory, in your own shell**, as the
user who runs the instances. Never run them inside an instance: publishing is
a fact about the host, which is why the setting is host-only. Nothing in the
command checks for this, so it is yours to keep.

```
oats aweb health enable [--operator <role>] [--language <tag>] [--json]
oats aweb health status [--json]
oats aweb health disable [--json]
oats aweb health publish [--json]
```

All four also take the kernel's `--dir <deployment>` and `--soul <soul>`. When
several souls of the deployment provide oats.aweb and none is given, the
kernel says which one it used.

## Turn it on: `enable`

```
oats aweb health enable --operator "Acme's operator"
```

It does two things, and changes nothing else:

1. Records the setting in `oats-local.yaml`, keeping your other lines and
   comments:

   ```yaml
   settings:
     oats.aweb:
       health:
         "publish": true
         "operator": "Acme's operator"
   ```

2. Registers one local schedule job, `oats-aweb-health`: every minute
   (`* * * * *`, UTC), in this deployment, it runs `oats aweb health publish`.
   It is registered once; running `enable` again changes nothing.

It does **not** install the host timer that runs schedule jobs. That is the
operator's own step, as for every schedule job: `oats schedule host install`
(see `oats schedule host status`). Until the timer runs, `enable` and
`status` say so, and exit 1.

Then it prints what `status` prints. The first tick after the timer runs
designates every agent and publishes it. A newly started or restarted agent
appears within a minute.

### Settings

| Setting (`settings.oats.aweb.health`) | Default | Meaning |
| --- | --- | --- |
| `publish` | off | `true` publishes; absent or `false` publishes nothing |
| `language` | `en` | a BCP 47 tag for the reason and fixing texts. Only `en` ships, and an unknown tag or a missing phrase falls back to it |
| `operator` | `Its operator` | the words shown as who fixes it, when a person must: one line of at most 120 bytes |

Set them with `enable --operator <role> --language <tag>`, or by hand in
`oats-local.yaml` (only there: a soul or the workspace cannot set them). A
value that breaks these rules stops `status` and every tick with
`E_HEALTH`, naming the setting.

## What is published

Every instance that `oats status` lists, except those being retired:

- **its own identity**, and each joined team's identity whose team has a
  minting root (`settings.oats.aweb.root`, or `roots[<team>]`). The root's
  identity signs the status, so the root is the agent's designated *status
  host*.
- **a resident (GLOBAL) seat**, as the resident, signed by the resident's own
  custody root, when the resident is in `settings.oats.aweb.residents`. Several
  seats of one resident make one status.

A seat that holds a resident's identity itself, without a grant, is skipped.
So is any agent whose id aw cannot read, a home whose team has no minting
root, a seat whose resident is not in `settings.oats.aweb.residents`, a joined
team with no identity home recorded, and a rate-limited agent. Each of these
is listed in the tick's `--json`
with its reason. Two are left out without a line: an instance that does not
compose oats.aweb, and a joined team that has no minting root.

Each status is valid for 5 minutes, and every tick sends a new one. If ticks
stop, aweb marks the status stale once that time passes. Its contract has the
dashboard say "No report from its server since <time>", never "online"
(aweb `docs/agent-health.md`, Reading). The states and their reasons are the
design's vocabulary table (§2).

## Check it: `status`

Read-only.

```
publishing: on, ready
last tick: 2026-10-15T23:20:01.000Z (published 4, refused 0, skipped 1, failed 0)
required: aw 1.36.38 to publish; Claude channel 1.7.17 or pi extension 0.3.15 to prove receive
note: a newly started or restarted agent appears within a minute
```

When something stops publishing, each cause is a `problem:` line with its
remedy, and the first line says `NOT ready`:

| Problem | Remedy |
| --- | --- |
| the job `oats-aweb-health` is not registered | `oats aweb health enable` |
| the job does not run `oats aweb health publish` every minute from this deployment | `oats schedule remove oats-aweb-health`, then `oats aweb health enable` |
| the host timer is not installed, or this deployment is not registered with it | `oats schedule host install` (an operator step) |
| the host timer is installed but not running | `oats schedule host status` |
| aw below 1.36.38 | upgrade aw |
| no tick for over 3 minutes | `oats schedule show oats-aweb-health` |

`status` exits 1 when publishing is on and not ready, and 0 otherwise.
`--json` carries the same facts: `publish`, `language`, `operator`, `job`,
`timer`, `lastTick`, `floors`, `ready`, `problems` and `note`.

## Turn it off: `disable`

```
oats aweb health disable
```

1. Removes the job `oats-aweb-health`.
2. Records `"publish": false`, keeping `operator` and `language` for the next
   `enable`.
3. **Clears every designation it made**, as each agent, so aweb goes back to
   its own facts instead of waiting on a host that has stopped reporting. It
   needs an aw with `aw status-host clear`: aw 1.36.38 or later (a released aw
   below that has no `status-host`). The output counts what was cleared and
   what was not (`designations cleared: 3, not cleared: 0`). A designation
   that could not be cleared stays recorded, so running `disable` again
   retries it. A home that was already retired needs none, because retire
   deletes its identity.

   With an aw that cannot clear, `disable` still removes the job and turns
   publishing off, but every designation stays on the server. Each one is
   counted as not cleared, and a line says why:

   ```
   designations cleared: 0, not cleared: 3
   designations not cleared: aw 1.36.37 has no status-host clear; upgrade aw to 1.36.38 or later and run `oats aweb health disable` again
   ```

   A designation the server refused to clear gets the same kind of line, with
   the server's message (or its HTTP status). `--json` lists each one under
   `designations.failed`, with its alias, team, status, code and message.

`disable` exits 1 when any designation is left on the server, so a script
notices, and 0 otherwise. The job is gone and publishing is off either way.

## One tick: `publish`

This is the command the job runs. You can also run it by hand to see a tick
at once. It prints counts, `published 4, refused 0, skipped 1, failed 0`. With
`--json` it prints each agent's result:

```json
{"schemaVersion": 1, "ok": true, "result": {
  "published": [{"alias": "dev-1", "team": "acme:acme.example", "reachable": "no", "code": "oats.channel_stream_down"}],
  "refused": [], "skipped": [], "failed": []}}
```

- **published:** the status aweb accepted.
- **refused:** what the server or aw refused, with its HTTP status, code and
  message.
- **skipped:** agents not published this tick, with the reason.
- **failed:** an agent whose bookkeeping failed; the others are still
  published.

`ok: false` means the tick could not run at all: aw below 1.36.38
(`E_HEALTH_AW`), or `E_HEALTH` (a setting that breaks its rules, no deployment
selected, `oats status` giving no roster). With publishing off it does
nothing.

## Unread mail that broker delivery cannot land

The opt-in `publish` tick also observes **session-delivery homes registered
with the host wake broker**, including their registered joined-team identities.
It produces an `oats.aweb` waiting claim with reason `attention`, visible in
`oats status` and Desktop. It never holds a wake or acknowledges mail.
Channel-delivery homes (including mixed native registrations) are outside this
observer.

The tick requires the runtime kernel's `oats version --json` features to include
`waiting-on-you`; otherwise it skips claims. For every registered identity it
reads `aw --identity-home <identityHome> mail inbox --count-only --json`, a
read-only count that acknowledges nothing. The command must succeed and return
`{"unread_count": N}` with a nonnegative integer. Older aw builds without this
flag yield unknown counts; the observer never falls back to reading the inbox.

A positive fresh aggregate unread count plus a broker error sets the claim.
Errors are `channel_core.last_error`, a `channel_core.binding_errors` entry,
or a registered `receive_identities[].stream_error` in `aw wake status --json`.
Cached stream unread counts and trace ids are never used. Errors become fixed
classes (`broker-worker-error`, `broker-binding-error`, `broker-stream-error`),
so no sender, subject, body, raw diagnostic or trace identifier reaches clients:

```
aweb: 3 unread, not delivered (broker-worker-error)
```

The next tick clears only this producer's claim when unread reaches zero,
the error disappears after delivery, or the home is unregistered. Retirement
also clears it; session start, restart and stop already void waiting claims.
`disable` clears this producer's claims as it removes the tick. Count failures,
malformed broker state and unavailable observations preserve an existing claim
and cannot set a new one. One failing home does not prevent sibling observations.
The tick's JSON includes `unreadAttention` counters (`set`, `cleared`, `unknown`,
`failed`); these count operations requested, including idempotent ones.

**Without `health.publish: true` and a running per-minute host timer, no such
attention claim appears.** Provider readiness states this opt-in requirement;
`health status` reports live observer coverage, missing count-only support and
timer/job failures. This is a periodic observation,
not proof that a model acted on a delivered message. The underlying broker
owns its retry budget; the observer neither retries input nor changes that budget.

## Files

| Path | What |
| --- | --- |
| `oats-local.yaml`, `settings.oats.aweb.health` | the settings |
| `<deployment>/.oats-aweb/health/last.json` | the last tick's time and counts, which `status` reads |
| `<deployment>/.oats-aweb/health/log.jsonl` | one line per refusal, with its HTTP status, message and `retry_after`; at 1 MiB it becomes `log.jsonl.1` |
| `<home>/.oats-aweb/health.json` | per home: the agent id, its host and whether it is designated, a cache of aw's answers |
| `<custody>/.oats-resident/health.json` | the same for a resident |

The command writes each of them owner-only (0600), and creates their
directories 0700. A directory that already exists keeps its mode.

## Errors

| Code | Meaning | Remedy |
| --- | --- | --- |
| `E_HEALTH_ARGUMENT` | unknown action or flag | the usage line |
| `E_HEALTH_AW` | aw below 1.36.38, or its version unreadable | upgrade aw |
| `E_HEALTH` | anything else: a setting that breaks its rules, no deployment selected, a kernel call that failed | the message |

The server's refusals (409 `stale_seq`, 429 with `Retry-After`, 403 `not the
status host`) are not errors of the command. They are logged and retried by
the next tick, as the design's §4 describes.

## What the tests prove

- `test/health-*.test.mjs` cover the vocabulary, the documents (against aweb's
  frozen vector) and the tick's isolation and bookkeeping.
- With `OATS_AWEB_HEALTH_NATIVE=1`, they run these commands through the real
  kernel and scheduler in a scratch deployment, and sign the vector with a real
  aw.
- `test/health-live.test.mjs` (opt-in, `OATS_AWEB_HEALTH_LIVE=1`) publishes to
  a real aweb server, in a throwaway team. A pi agent's real receipt makes it
  `yes`. A stopped pi, whose receipt goes stale, makes it `no`. `disable`
  clears the designation. Each step is read back from the server. It passed
  against aweb 1.27.24, with aw 1.36.38 and pi extension 0.3.15.
