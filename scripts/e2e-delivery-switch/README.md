# e2e-delivery-switch

End-to-end evidence for oats.aweb delivery by harness (`settings.delivery:
"channel"`): a home on a Codex runtime is delivered by the host wake broker, a
home on Claude Code by the aweb channel plugin, and every `launch` re-decides
the path from the runtime. This harness drives the real `oats-aweb.mjs` hook
against a real local aweb + awid stack, a real `aw wake run` broker and the
real channel plugin, and counts every presentation by message id.

## What it proves

1. **codex -> claude while mail arrives.** A disposable home is spawned under
   `OATS_RUNTIME=codex`, so the hook registers it with the broker. A fixture
   sender mails it at a steady rate (one mail every ~0.45 s). Mid-stream the
   `launch` hook runs as `claude` (`OATS_PREVIOUS_RUNTIME=codex`): it
   deregisters the home and refuses to start unless `aw wake status --json`
   no longer lists it. The channel plugin then starts and the sending goes on.
   Every message id is presented exactly once across the broker and the
   channel, none is lost, and the broker no longer lists the home.
2. **claude -> codex.** The channel plugin is stopped (stdin closed and
   SIGTERM, as Claude Code ends an MCP server) mid-stream and the `launch` hook
   runs as `codex`: the home is registered again and the broker presents the
   rest. Exactly once again.
3. **codex -> codex.** A relaunch as `codex` mid-stream keeps the
   registration; the broker presents every mail exactly once.

Each scenario also checks that the stream really was split between the two
presenters (otherwise exactly-once would be vacuous), and the receipt shows
`aw wake status --json`, trimmed, before and after each switch.

The broker presents through `oats session input`; the harness points it at a
fake `oats` (`AW_WAKE_OATS_BIN`) that answers `session inspect` with an idle
session and appends every input to a log. The channel plugin is driven by a
minimal MCP stdio client that collects `notifications/claude/channel`. Both
presenters fetch, present, mark read and ack on the server, with separate
local delivery stores (`<identity home>/channel-delivered-ids-<team>.json` for
the broker child, `<home>/.aw/channel-delivered-ids.json` for the plugin):
across a switch the server read flag is the only guard, which is what this
measures.

Known aw limitation, not hidden: if a presenter dies after typing a mail but
before its ack, the mail can be presented twice (aweb-oss
`docs/terminal-wake-broker.md`, "Reconnect and crash windows"). The receipt
lists any duplicate with its id.

## Prerequisites

- macOS with Docker Desktop installed (it may be stopped; the harness starts it).
- `aw` on PATH (or `AW_BIN=<path>`), `node`, `npm`, `git`.
- A checkout of aweb-oss with `origin/main` fetched. The harness never uses
  that checkout's working tree: it clones it into a temp dir and checks out
  the commit its `origin/main` points at.
- Network for `npm ci` and the Docker base images.

## Run

```bash
node scripts/e2e-delivery-switch/run.mjs /path/to/aweb-oss --receipt scripts/e2e-delivery-switch/RECEIPT.md
# or
AWEB_OSS_SRC=/path/to/aweb-oss node scripts/e2e-delivery-switch/run.mjs
```

It takes two to three minutes with warm Docker layers. The receipt (markdown)
is printed to stdout and, with `--receipt`, written to that file. Exit 0 means
every check passed and every cleanup check came back clean.

## Isolation

Everything lives under one fresh `mkdtemp` dir (`$TMP` in the receipt):

- the aweb-oss clone, from which `docker compose` runs `server/docker-compose.yml`
  (named volumes only, no bind mounts) under a unique project name, with an env
  file in `$TMP`;
- `HOME`, `AW_CONFIG_PATH` and `AW_WAKE_STATE_DIR` of every aw and node process
  (including `npm`, the hook, the broker and the plugin), so nothing touches
  `~/.config/aw`, the trust pin store or the host broker's state; the
  environment of those processes is built from scratch, so a caller's
  `AWEB_IDENTITY_HOME` or `AWEB_DELIVERY` never leaks in;
- its own `aw wake run --state-dir $TMP/wake` daemon;
- fixture identities (`alice`, who owns the team, is the minting root and the
  sender; `dev-1`, minted by the spawn hook) on the local stack only.

## Cleanup guarantees

Cleanup runs on success, failure and SIGINT/SIGTERM/SIGHUP, and the receipt
records each step and its check:

1. stop the channel plugin and the `aw wake run` daemon (process groups,
   SIGTERM then SIGKILL), then `pgrep -f $TMP` must find nothing (broker,
   channel-core runner, plugin);
2. `docker compose ... down -v --rmi local --remove-orphans`, then `docker ps -a`,
   `docker volume ls` and `docker network ls` filtered by the project label
   must be empty;
3. if the harness started Docker Desktop, quit it (`osascript -e 'quit app
   "Docker"'`, and `docker desktop stop` if the AppleScript quit is ignored
   for 30 s, which Docker Desktop 4.x does) and confirm `docker info` fails
   and no `com.docker.backend` process remains. A Docker Desktop that was
   already running is left running;
4. remove `$TMP` and confirm it is gone.
