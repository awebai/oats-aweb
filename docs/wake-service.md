# `oats aweb wake`: the host wake broker service

`oats aweb wake install | status | uninstall` keeps the host wake broker
(`aw wake run`) running as a per-user service: a launchd agent on macOS, a
systemd `--user` unit on Linux, labelled `ai.aweb.wake`. The broker delivers to
every home that needs it (`delivery: session`, a Codex home, a joined team).
Without it, those homes are poll-only. aw has no install verb, so OATS writes
the unit. It ships in oats.aweb 1.28.0 and needs aw 1.36.33 or later (the
provider's single floor).

The whole host procedure (when a host needs the broker, in what order, and how
to check delivery) lives in oats.setup: `/oats-host-delivery`, Choice 2
(oats.framework 1.11.0). This page is the command's reference.

## Invocation

```
oats aweb wake install [--plan] [--linger-required] [--json]
oats aweb wake status [--dir <deployment>] [--json]
oats aweb wake uninstall [--plan] [--json]
```

Run it from the deployment directory, in your own shell, as the user who runs
the instances. `install` and `uninstall` refuse inside an instance
(`E_WAKE_INSIDE_HOME` when `OATS_INSTANCE_HOME` or `OATS_HOME` is set). An
agent's shell carries a session's PATH, and the unit would record it, which is
also why `oats schedule host install` is the operator's step
([oats#967](https://github.com/awebai/oats/issues/967)).

## The unit

`install` resolves `aw` and `oats` from the invoking shell's PATH. It takes
`node` the way the custody unit does: `OATS_NODE_BIN` when it is absolute, else
the node running the command. The unit records the resolved absolute paths:

- it runs `<aw> wake run`, with aw's default state directory (no
  `--state-dir`);
- its environment is exactly `PATH` and `AW_WAKE_OATS_BIN=<oats>`;
- its `PATH` is the directories of `aw` and its link target, of `oats` and its
  link target, of `node`, and of `tmux`, then the kernel host timer's fallback
  `/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`
  (awebai/oats `lib/schedule-host.mjs`), with duplicates dropped. The broker
  runs `oats session inspect` and `oats session input`, which exec `tmux` and
  `ps` from it. Homebrew's prefix comes first in the fallback, so an Apple
  Silicon Mac's `tmux` is found.

Linux, `$XDG_CONFIG_HOME/systemd/user/ai.aweb.wake.service` (else
`~/.config/systemd/user/`):

```ini
# Written by oats aweb wake install; rerun it to update this unit, and oats aweb wake uninstall to remove it.
[Unit]
Description=aweb host wake broker

[Service]
Type=simple
Environment="PATH=/home/me/.local/bin:/home/me/.local/lib/node_modules/@awebai/aw/bin:/home/me/.local/lib/node_modules/@awebai/oats/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin" "AW_WAKE_OATS_BIN=/home/me/.local/bin/oats"
ExecStart="/home/me/.local/bin/aw" wake run
Restart=always
RestartSec=10

[Install]
WantedBy=default.target
```

macOS, `~/Library/LaunchAgents/ai.aweb.wake.plist`: the same program and
environment, `RunAtLoad` and `KeepAlive` true, and stdout and stderr to
`~/Library/Logs/ai.aweb.wake.log` (an absolute path). The marker is an XML
comment after the doctype.

Values are quoted as the custody unit's are (`lib/custody-unit.mjs`): `%` is
written `%%` in every systemd setting, and `$` is written `$$` in `ExecStart=`.
Plist strings are XML-escaped.

### Which unit is ours

The first line (an XML comment in the plist) is the marker
`Written by oats aweb wake install`. A file at the `ai.aweb.wake` path that
carries it is ours. Every other unit in the user unit directory that runs the
broker is foreign: a systemd unit whose `ExecStart=`, or a plist whose
`Program`/`ProgramArguments`, is an `aw` binary (by name, or by its link
target) followed by `wake run`. A file at our path without the marker is also
foreign. `install` and `uninstall` never change, adopt or remove a foreign
unit. `ExecStart=` is read as a logical line (a trailing backslash continues
it), and plists are read in both forms launchd accepts: XML, and binary
(`bplist00`, decoded by the command itself on every platform). Units outside
the user unit directory, and systemd drop-ins, are not read.

## `install`

Every check runs before anything is written. `--plan` runs the same read-only
checks (`loginctl show-user`, `launchctl print`, `systemctl --user show`,
`aw wake status --json`) and changes nothing.

| Step | Refusal |
| --- | --- |
| Not inside an instance | `E_WAKE_INSIDE_HOME` |
| A supported platform (macOS, Linux) | `E_WAKE_UNSUPPORTED` |
| `AW_WAKE_STATE_DIR` unset (the unit would not carry it) | `E_WAKE_STATE_DIR` |
| `aw`, `oats` and `node` found | `E_WAKE_PATH`, naming the missing command |
| aw at or above the floor (`awFloorMessage`) | `E_AW_FLOOR` |
| No foreign unit | `E_WAKE_UNIT_CONFLICT`, naming each unit's path and its retire steps |
| Linux, with `--linger-required`: lingering on | `E_WAKE_LINGER` |
| No daemon running outside our unit | `E_WAKE_RUNNING_UNSUPERVISED`, naming `daemon_pid` |

A daemon counts as ours when its `daemon_pid` is our unit's running process,
or that process's child. `aw wake run` exits 0 when a daemon already runs, so
our unit would restart forever beside a daemon started by hand.

With no `tmux` on the shell's PATH it installs anyway and warns
`wake-tmux-missing`, because the broker cannot reach OATS sessions until `tmux`
is on the unit's PATH. It is not a refusal, since a deployment may use another
session backend.

Linux with lingering off and no `--linger-required` installs anyway. It warns
`wake-linger-off`, because the service stops when the user's last session
ends. The remedy is `loginctl enable-linger <user>`, which may need an
administrator.

Then it writes the unit when the text differs (or there is none) and restarts
the broker. Its manager commands:

| | Linux | macOS |
| --- | --- | --- |
| New or changed text | `systemctl --user daemon-reload`, `enable <path>`, `restart ai.aweb.wake.service` | `launchctl bootstrap gui/<uid> <plist>` (after `bootout gui/<uid>/ai.aweb.wake` when it was loaded) |
| Unchanged text | `enable <path>`, `restart ai.aweb.wake.service` | `kickstart -k gui/<uid>/ai.aweb.wake` (`bootstrap` when not loaded) |

A bootstrap starts the job, because of `RunAtLoad`. A rerun always restarts
the broker, so **rerunning `install` after an aw upgrade is how to restart the
broker on the new aw**. There is no `restart` verb.

It then verifies, reading `aw wake status --json` for up to about 10 seconds.
It passes when `daemon_running` is true, `daemon_version_state` is `reported`,
and `daemon_version` equals the resolved aw's version. Otherwise it fails with
`E_WAKE_NOT_RUNNING`, keeps the unit, and names the log:
`journalctl --user -u ai.aweb.wake.service -n 50`, or
`~/Library/Logs/ai.aweb.wake.log`.

Text output: `PASS wake broker <version> (<launchd|systemd> unit <path>)`,
then a `WARN <code>: <message>` line for each warning. A failure prints
`FAIL <code>: <message>` on stderr and exits 1.

`--json`:

```json
{"ok": true,
 "unit": {"manager": "systemd", "label": "ai.aweb.wake", "path": "/home/me/.config/systemd/user/ai.aweb.wake.service", "written": true},
 "daemon": {"running": true, "version": "1.36.35", "versionState": "reported", "pid": 4242},
 "warnings": [{"code": "wake-linger-off", "message": "..."}]}
```

Warnings: `wake-tmux-missing` (no `tmux` on the shell's PATH) and
`wake-linger-off` (Linux, lingering off).

`written` is false when the unit's text was already current. With `--plan`:
`{"ok": true, "plan": true, "unit": {..., "written": false, "changed": true}, "text": "<unit text>", "actions": ["write <path>", "systemctl --user daemon-reload", ...], "warnings": [...]}`.
A refusal it would hit is `{"ok": false, "plan": true, "error": {...}}`, with
exit 1.

## `status`

Read-only, and it exits 0 even when something is wrong. `--json`:

```json
{"ok": true,
 "unit": {"manager": "systemd", "label": "ai.aweb.wake", "present": true, "path": "...", "aw": "/home/me/.local/bin/aw", "awOnPath": "/home/me/.local/bin/aw", "awCurrent": true, "others": []},
 "daemon": {"running": true, "version": "1.36.35", "versionState": "reported", "pid": 4242, "readable": true, "floor": {"min": "1.36.33", "ok": true}},
 "homes": {"known": true, "items": [{"instance": "codex-1", "home": "...", "registered": true}], "unknown": []}}
```

- `unit.aw` is the `aw` the unit's `ExecStart`/`ProgramArguments` names.
  `awCurrent` says whether it is still the `aw` on PATH; when it is false,
  rerun `install`. `others` lists the foreign wake units.
- `daemon` is read with aw's default state directory, the one the unit uses,
  even when `AW_WAKE_STATE_DIR` is set. `floor.ok` checks the daemon's version
  against the provider's aw floor (`null` when it reports none).
- `homes.items` are the deployment's instance homes whose recorded composition
  needs the broker (`expectedReceive(...).brokerRequired`, the readiness rule),
  each `registered` when `aw wake status` lists it. `homes.unknown` are homes
  whose record cannot be judged.
- Homes come from one read-only `oats status --dir <deployment> --max-age 3600
  --json`, through the kernel that dispatched the command (`OATS_CLI_BIN`). It
  is capped at 15 seconds and 16 MB. When the deployment is not selected, or
  the kernel does not answer, `homes` is `{"known": false, "reason": "..."}`.

## `uninstall`

It removes only our unit: on Linux, `systemctl --user disable --now
ai.aweb.wake.service`, removing the file, then `systemctl --user
daemon-reload`; on macOS, `launchctl bootout gui/<uid>/ai.aweb.wake` (when it
is loaded), then removing the file. A foreign unit is never touched, and a
foreign file at our path is refused with `E_WAKE_UNIT_CONFLICT`. With no unit
it answers `{"ok": true, "unit": {..., "removed": false}}`. `--plan` lists the
actions and changes nothing.

## Errors

| Code | Meaning | Remedy |
| --- | --- | --- |
| `E_WAKE_ARGUMENT` | unknown verb or flag (exit 2) | the usage line |
| `E_WAKE_INSIDE_HOME` | `install`/`uninstall` run inside an instance | run it in your own shell, from the deployment |
| `E_WAKE_UNSUPPORTED` | no launchd/systemd, or its command is missing | run `aw wake run` under a supervisor yourself |
| `E_WAKE_STATE_DIR` | `AW_WAKE_STATE_DIR` is set | unset it, then rerun |
| `E_WAKE_PATH` | `aw`, `oats` or `node` not found | install it or fix PATH, then rerun |
| `E_AW_FLOOR` | aw below 1.36.33, or its version unreadable | upgrade aw (the message names the command) |
| `E_WAKE_UNIT_CONFLICT` | a foreign wake unit, or a foreign file at our path | retire it with the printed steps, then rerun |
| `E_WAKE_LINGER` | `--linger-required` and lingering is off | an administrator runs `loginctl enable-linger <user>` |
| `E_WAKE_RUNNING_UNSUPERVISED` | a daemon runs outside our unit | stop it (the message names its pid), then rerun |
| `E_WAKE_UNIT` | a manager command failed | its output is in the message |
| `E_WAKE_NOT_RUNNING` | the unit is in place but the daemon is not verified | read the named log, fix the cause, rerun `install` |
| `E_WAKE_FAILED` | anything else | the message |

## What the tests prove

`test/wake-service.test.mjs` runs every manager call against a fake host
(`test/helpers/fake-wake-host.mjs`): fake `aw`, `oats`, `systemctl`,
`launchctl`, `loginctl` and `ps` on a PATH that holds nothing else, with
`HOME` and `XDG_CONFIG_HOME` in a temporary directory. Both platforms' units
are rendered and checked with `plutil` and `systemd-analyze verify` where the
host has them. No test talks to a real user manager. `systemctl --user` would
reach the real one whatever `HOME` is, so systemd behaviour is proven only
through the fake.
