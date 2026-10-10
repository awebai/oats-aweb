# `oats aweb resident create`

`oats aweb resident create <name>` makes a GLOBAL resident identity in an
existing hosted aweb team from the team's dashboard API key. It serves the
resident with a per-user custody service and records it in the deployment, so
that grant seats can be spawned on it. It ships in oats.aweb 1.26.0 and needs
aw 1.36.33 or later (the provider's single floor).

## Invocation

```
AWEB_API_KEY=<key> AWEB_URL=<url> oats aweb resident create <name> [--dir <deployment>] [--root <dir>] [--team-label <label>] [--plan] [--json]
```

This is the line the aweb dashboard gives, with the team's key. Run it in the
OATS deployment (or pass `--dir`).

- `AWEB_API_KEY` is the team's provisioning key. When it is not in the
  environment and the command runs on a terminal, it asks for the key without
  echoing it. With no key and no terminal it refuses at once. No flag takes a
  key.
- `AWEB_URL` is the aweb service. `AWID_REGISTRY_URL` is passed on only when
  it is set (a local stack uses it; hosted aweb does not need it).
- `<name>` is the resident's name, an aweb alias; its address is
  `<namespace>/<name>`.
- `--root <dir>` is the resident's directory, R. It defaults to
  `<deployment>/.aweb-residents/<name>`.
- `--team-label <label>` maps a team label to the resident's team: with
  `oats teams add` where the workspace allows local teams, else by printing the
  lines to commit in `oats-workspace.yaml`.
- `--plan` runs the preflight and prints what would run and be written. It
  changes nothing and needs no key.
- `--json` answers one JSON-v1 envelope (examples below).

## What it does

| Stage | What runs | Effect |
| --- | --- | --- |
| arguments | Parses the command line. | None. |
| deployment | Finds the deployment and its `oats-local.yaml`. | None. |
| aw | `aw version` must be 1.36.33 or later. | None. |
| preflight | Reads R and the custody units; on Linux, `loginctl show-user <user> --property=Linger`. | None, local or remote. |
| key | Takes the key from `AWEB_API_KEY`, or the prompt. | None. |
| init | Exactly `aw init --global --name <name> --do-not-touch-agents-md --json` in R, once. | aw registers the identity at awid and asks aweb to create it in the key's team. |
| verify | `aw doctor identity --offline --json` and `aw doctor registry --online --json` in R. | None. |
| custody | Writes and loads the custody unit, then waits for `aw custody status --json` to be ready. | A per-user service. |
| record | Writes `settings.oats.aweb.residents.<name>: R` in `oats-local.yaml`; maps `--team-label`. | Deployment configuration. |

Init is skipped when R already holds a complete global identity: the command
then verifies it, ensures its custody and records it (adopt). The preflight
decides from what R holds:

| R holds | Then |
| --- | --- |
| nothing, or does not exist | init creates the resident |
| `.aw/partial-init.yaml` (an earlier init that failed part way) | init continues it: aw reuses the saved key, so the DID is the same |
| `.aw/partial-init.yaml.<time>.<n>.rejected` (aw quarantined the key) | init runs once, and aw refuses with its own reconciliation message; there is no rerun |
| a complete global identity (`.aw/identity.yaml`, `signing.key`, `workspace.yaml`) | no init: verify, custody and record (adopted), or a pure verify when it is already recorded |
| anything else | refused, naming what is there; R is never deleted and init never runs into it |

**Verify** fails unless aw's answer (or, when adopting, `aw whoami`) shows
`status: connected`, `identity_scope: global`, the alias `<name>`, a
canonical `<name>:<namespace>` team id, a `did:aw` stable id and the
`<namespace>/<name>` address. Every check `aw doctor identity --offline` runs
must be `ok`: with no identity at all, aw answers `status: ok` with every
check `info`, so the overall status is not enough. A failing
`aw doctor registry --online` is a warning only, because registry publication
can lag.

**Custody** must be running, with the resident's team ready, signing and E2EE
keys ready, and both floor ops listed: `mail_reply_continuation.v1` and
`grant_never_ttl.v1`. A custody whose status cannot be read, one that lacks
the ops and one that is not ready each fail with their own message.

## The key

- It is read only from `AWEB_API_KEY` or the no-echo prompt.
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
  `DBUS_SESSION_BUS_ADDRESS`; the kernel, for `--team-label`, no `AWEB_*` or
  `AWID_*` variable.
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

## The custody unit

aw has no install verb: `aw custody serve` takes no flags and serves the
identity home of its working directory. The command writes a per-user unit
that runs `<aw> custody serve` with working directory R and an environment of
`PATH` and `HOME` only. Its label is `ai.aweb.custody.<namespace>.<name>`,
where `<namespace>` is the address's (`juan.aweb.ai` for
`juan.aweb.ai/alice`). It never serves a grant home and copies no keys.

The unit is idempotent: a re-run leaves an unchanged unit as it is and loads it
if it is not running. A unit of that label that serves another directory is
refused, naming both, and so is any `ai.aweb.custody.*.<name>` unit that
serves another directory, before any init.

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

## Output

Text: `PASS resident <address> team <team id> custody running`, with
`(resumed)`, `(adopted)` or `(already exists)` when that is what happened,
then any warnings, the unit, the recorded setting and the next step:

```
Next: spawn a seat on this resident: oats spawn <soul> --provider oats.aweb identity.mode=global --provider oats.aweb identity.resident=<name>
```

A failure is `FAIL <stage>: <message>` on stderr. An init failure's message
is aw's own text (with the key redacted), so aw's "rerun the same command in
this directory" appears only when aw left a resumable partial. When an init
leaves neither a partial nor an identity, the message adds
`provisioning left nothing to continue; R contains …; contact aweb with
<capture path>`.

Exit status: 0 on success, 2 for a usage error, 1 for any other failure.

| Code | Stage | Meaning |
| --- | --- | --- |
| `E_RESIDENT_ARGUMENT` | arguments, preflight | usage, an invalid name or label, or no `AWEB_URL` for an init |
| `E_RESIDENT_DEPLOYMENT` | deployment | no readable deployment |
| `E_RESIDENT_AW_FLOOR` | aw | aw missing or older than 1.36.33 |
| `E_RESIDENT_ROOT` | preflight | R holds something else, or the name is recorded at another R |
| `E_RESIDENT_UNIT_CONFLICT` | preflight, custody | a custody unit of this name serves another directory |
| `E_RESIDENT_LINGER` | preflight | Linux user without systemd lingering |
| `E_RESIDENT_RECORD` | preflight, record | `oats-local.yaml` cannot be updated safely |
| `E_RESIDENT_KEY` | key | no key and no terminal, an empty answer, or a malformed key |
| `E_RESIDENT_INIT` | init | aw init failed; aw's text |
| `E_RESIDENT_NOTHING_TO_CONTINUE` | init | aw init failed and left nothing to continue |
| `E_RESIDENT_VERIFY` | verify | the identity is not the connected global `<name>`, or an offline check is not ok |
| `E_RESIDENT_UNIT` | custody | a launchctl or systemctl command failed |
| `E_RESIDENT_UNIT_UNSUPPORTED` | custody | no unit on this host and custody is not running: the hand step |
| `E_RESIDENT_CUSTODY` | custody | custody not ready in 30 s: not running, team not ready, or ops missing |
| `E_RESIDENT_TEAM_LABEL` | record | `--team-label` already maps to another team, or the kernel refused |

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
    "warnings": [
      "aw doctor registry --online: awid.address.delivery_origin is warn (this can be publication lag)"
    ],
    "captures": [
      "/srv/deploy/.aweb-residents/carol/.oats-resident/init-20261010T120000Z.stdout",
      "/srv/deploy/.aweb-residents/carol/.oats-resident/init-20261010T120000Z.stderr",
      "/srv/deploy/.aweb-residents/carol/.oats-resident/init-20261010T120000Z.exit"
    ],
    "next": "spawn a seat on this resident: oats spawn <soul> --provider oats.aweb identity.mode=global --provider oats.aweb identity.resident=carol"
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
    "warnings": [
      "aw doctor registry --online: awid.address.delivery_origin is warn (this can be publication lag)"
    ],
    "captures": [
      "/srv/deploy/.aweb-residents/carol/.oats-resident/init-20261010T120000Z.stdout",
      "/srv/deploy/.aweb-residents/carol/.oats-resident/init-20261010T120000Z.stderr",
      "/srv/deploy/.aweb-residents/carol/.oats-resident/init-20261010T120000Z.exit"
    ],
    "next": "spawn a seat on this resident: oats spawn <soul> --provider oats.aweb identity.mode=global --provider oats.aweb identity.resident=carol"
  }
}
```

A complete identity adopted, then the same on a re-run once it is recorded (a
pure verify: no init, no new key, custody only re-ensured):

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
    "warnings": [
      "aw doctor registry --online: awid.address.delivery_origin is warn (this can be publication lag)"
    ],
    "captures": [],
    "next": "spawn a seat on this resident: oats spawn <soul> --provider oats.aweb identity.mode=global --provider oats.aweb identity.resident=carol"
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
    "warnings": [
      "aw doctor registry --online: awid.address.delivery_origin is warn (this can be publication lag)"
    ],
    "captures": [],
    "next": "spawn a seat on this resident: oats spawn <soul> --provider oats.aweb identity.mode=global --provider oats.aweb identity.resident=carol"
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
    "record": "settings.oats.aweb.residents.carol: /srv/deploy/.aweb-residents/carol in /srv/deploy/oats-local.yaml"
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

No key and no terminal:

<!-- envelope: key -->
```json
{
  "schemaVersion": 1,
  "ok": false,
  "error": {
    "code": "E_RESIDENT_KEY",
    "message": "no AWEB_API_KEY in the environment and no terminal to ask for it on: run AWEB_API_KEY=<key> AWEB_URL=<url> oats aweb resident create carol",
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

## The joint real-stack E2E

Acceptance is the joint E2E against aweb Cloud's local stack (local Cloud,
AWID, PostgreSQL, Redis) with the published aw and the **released**
oats.aweb 1.26.0: the commit tagged `v1.26.0`. It runs the dashboard's line
verbatim:

```
AWEB_API_KEY=<key> AWEB_URL=<local Cloud url> AWID_REGISTRY_URL=<local AWID url> oats aweb resident create <name> --team-label <label>
```

`AWID_REGISTRY_URL` is needed only because the local stack's registry is not
the default one.

**Fixture contract.**

1. A fresh OATS deployment D with oats.aweb 1.26.0 pinned, and aw 1.36.33 or
   later on PATH. Nothing about the resident is configured in advance.
2. The command, run in D, creates the resident in R
   (`D/.aweb-residents/<name>`), its custody unit, and
   `settings.oats.aweb.residents.<name>`. `--team-label <label>` maps the
   label to the resident's team. Make that label D's default team
   (`oats teams default <label>`): a seat's grant is minted in its default team.
3. A minimal soul for the seat: `soul.yaml` with `schemaVersion: 2`, a `name`,
   a `description` and `work: directory`, and nothing about identity.
4. The seat: `oats spawn <soul> --provider oats.aweb identity.mode=global
   --provider oats.aweb identity.resident=<name>`, with `--preview` first.
   Spawn mints the seat's grant from the resident's custody.

What each acceptance item exercises here:

| Item | This command's part |
| --- | --- |
| 1. the dashboard line runs verbatim in a fresh deployment | the env form above; the key also works from the prompt |
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
| The child environment, argv, the prompt, refusals, the unit files, the custody op checks, the envelopes | Unit tests replaying real aw 1.36.33 captures (`test/resident-create.test.mjs`, `test/custody-unit.test.mjs`, `test/resident-docs.test.mjs`) |
| The hosted init's success answer, the trees a success and a killed run leave, and two hosted refusals that keep the partial (a different `--name`; a name taken since, aweb's 409) | Unit tests replaying aweb's captures from its local Cloud preview (`test/resident-cloud-captures.test.mjs`) |
| A complete create from the API key | Only the joint E2E: aweb Cloud's `/api/v1/workspaces/init` is not in the OSS stack |
| Continuing a partial to a complete identity | Only the joint E2E |
| A quarantined (`.rejected`) partial made by aw | No stack: aw makes one only when aweb answers with a different identity than it registered, which no honest server does. Unit tests replay aw's real refusal of a quarantine file |
| A customer-held (BYOT) team's refusal | Only the joint E2E, once aw's preflight is released |
| A seat spawned on the resident, and mail | Only the joint E2E |

## Fixtures

The unit tests read aw output from `test/fixtures/resident`. Every fixture
there is captured verbatim from a real aw run by `capture.sh` and labelled
with the aw version and commit and the capture date (its README). They are
never acceptance evidence: acceptance is the joint E2E. They are refreshed with
`capture.sh` whenever aw's output contract changes.
