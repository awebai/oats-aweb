# oats-aweb

Official [OATS](https://github.com/awebai/oats) messaging-layer integration for
[aweb](https://aweb.ai). It provides per-instance native identities, mail/chat
skills, team roster discovery and session/channel delivery integration. Messaging
is separate from durable task tracking; the selected tasks provider owns tasks.

## 1.16.1 — onboarding and one aw floor

Requires OATS >=0.26.0 and aw >= 1.36.13. Setup creates hosted accounts on aw 1.36.13 with `aw init --new-account --username <u>`, and the package has one aw floor with older compatibility branches removed.

## 1.16.0 — the workspace's default team

Requires OATS >=0.26.0 and aw >= 1.36.13. No aweb service
change and no host enrollment call is needed.

### Changed (breaking wire names)

- `personal` is now **default team** in agent-facing prose and diagnostics.
- `E_TEAM_PERSONAL` is now `E_TEAM_DEFAULT`.
- The teams JSON field is `defaultTeam`: `{ defaultTeam: { team, source }, primary, eligible, joined, unmapped, at }`. `defaultTeam.source` is always present: `setting` when `settings.oats.aweb.team` named the team, otherwise `root` for the aweb root's active team.
- The wake broker's primary receive label is `default`.
- `roots.personal` is removed; `settings.oats.aweb.roots` stays a host-only map keyed by team id only.

The default team resolves exactly as before: `settings.oats.aweb.team`, else the
aweb root's active team. Wider workspace teams are still joined explicitly with
`oats aweb join` and have their own identity homes.

### Live receive for joined teams

- Joined identities are registered with the host wake broker
  (`aw wake register --registration-json -`, aw's multi-identity receive):
  session-delivery homes register the primary (with controls) plus every joined
  home; Claude and Pi channel homes use aw's mixed mode (`native-channel` /
  `native-pi`): the channel keeps the primary, the broker attaches only the
  joined homes. Codex has no broker surface and keeps polling.
- The registration follows join, leave (after a confirmed release), session
  start and retire. `receive` in the teams document is `native` when
  registered, else `poll`; readiness reports each joined team's actual mode from
  `aw wake status` (`joined-team-receive` / `joined-team-poll-only` with the
  reason, e.g. the wake daemon is not running).

### Agent guidance

- The `oats-aweb` skill covers identity, default/eligible/joined teams and
  `oats aweb teams|join|leave`, roster and addressing, mail/chat, acting as a
  joined team, delivery and wakes, etiquette, troubleshooting (readiness codes,
  `E_TEAM_*`, aw floors). The inject is short and points to it.
- Use `aw chat send-and-wait|send-and-leave <alias>` to start chats; `aw chat
  send` only continues an existing session.
- `oats aweb roster` lists the default team by default and an eligible team with
  `--label <label>`.

### Upgrading from 1.15

Consumers of teams JSON must read `defaultTeam` instead of `personal`; `defaultTeam.source` is a closed set, `setting` or `root`. Code that
handles leave refusals must expect `E_TEAM_DEFAULT`. Remove any
`settings.oats.aweb.roots.personal` setting; roots are keyed by concrete team id.
