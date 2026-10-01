# Changelog

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
