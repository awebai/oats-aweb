# Provider history

What each oats.aweb release changed for the procedures in the `/oats-aweb`
skill, moved out of the skill so that it holds one current card per act
(awebai/oats-aweb#285). The skill links here, and the CHANGELOG has every
change. This page is a record: for what to do now, follow the skill's cards.
Where a row says "below", "above" or names a section, it points into the
skill, `oats-package/capabilities/oats-aweb/skills/oats-aweb/SKILL.md`.

## Selected version and supported boundary

| Selected version | Supported boundary |
|---|---|
| Released provider 1.21.1, OATS >=0.30, aw >=1.36.13 | Labelled setup/join/resume, LOCAL instance join/leave, existing GLOBAL resident grant consumption. OATS >=0.38 supplies `localTeams` policy. |
| Released provider 1.22.0 (PR61/#65) | New Claude/channel compositions default to development; explicit approved and captured histories remain distinct. From provider 1.27.0 (OATS >=0.52.0) the kernel confirms the development-channel prompt at launch (section 4); provider mode answers nothing itself. Verify the selected composition; a repository release is not an installation receipt. |
| Released provider 1.22.0 (#45/#52/#59, PR63) | Deployment-scoped sibling placement, current-root lookup for explicit join and corrected remedies are included. Older 1.21.1 compositions lack these fixes; verify the selected provider is 1.22.0 or later. |
| Native aw 1.36.24 | Hosted sibling create and exact external-home allowlist below; aw 1.36.23 lacks hosted create. Native source `32fe2d795780a8ba90260c631d84f5d5c6fc0190`; maintainer binary evidence `92abe3b43beb81562eafeb13b3f60d8f3c5d44c2` is separate, not our local trial. |
| Released provider 1.24.0 (#87–#89, #91), OATS >=0.42 | Approved Claude channel route documented in section 4, and approved spawn, launch and readiness read the machine managed-settings policy (section 7 verdicts). Retire's recovery copy holds no provider home state ("What retire's recovery keeps" below); homes spawned on earlier providers are copied whole. |
| Released provider 1.25.0, OATS >=0.42, aw >=1.36.32 | New grant seats never expire (`identity.ttl: never`; `identity: { ttl: 720h }` keeps a duration). Upgrade aw, restart every custody service and the wake daemon, then sync ("Upgrading a host to provider 1.25.0" below). One aw client floor, 1.36.32; the probe uses it too. Grant seats require the custody ops `grant_never_ttl.v1` (never ttl) and `mail_reply_continuation.v1` (E2EE). Seat-labelled grants are swept from the custody's grant list at every start and retire. `wake-daemon-outdated` is a warning. Readiness shows a grant's lifetime and unrevoked grants. |
| Released provider 1.25.1, OATS >=0.42, aw >=1.36.32 | Readiness warns only about what someone must act on: no `joined-team-receive` for a joined team that receives live. A start waits at most 10 s for the custody grant list; an aw call that never exits is reported as timed out or by its code or signal. |
| Released provider 1.26.0, OATS >=0.42, aw >=1.36.33 | `oats aweb resident create <name>` creates or adopts a GLOBAL resident in an existing hosted team from the dashboard's API key, installs its per-user custody unit and records `residents.<name>` ("GLOBAL residents and grant seats" below). One aw client floor, 1.36.33. |
| Provider 1.26.1, OATS >=0.48 for `resident create` | `resident create` maps the resident's team without `--team-label` (under the team's name) and makes it the default team where there is none; another default is kept and `oats teams default <label>` is printed as the first step. That step moves the whole deployment's default team (every later spawn of a soul without its own default goes to the resident's team), so it is the operator's decision: an agent prints it and asks, and never runs it on its own. A grant seat gets `AWID_REGISTRY_URL` from its resident's identity when that registry is not aw's default. |
| Provider 1.28.0, OATS >=0.52.0, aw >=1.36.33 | `oats aweb wake install`, `status` and `uninstall` install the host wake broker as a per-user service ("Host wake broker service" below). Readiness warns `claude-channel-mode-default` for a Claude channel home whose mode nobody chose, and checks the broker at soul scope when the spawn will need it (section 7). |
| Provider 1.32.0, OATS >=0.68.0, aw >=1.36.33 | A stopped seat moves to the locked package with `oats instance upgrade`. Upgrade preserves identity and grant state without host calls; the next start re-registers and renews according to the seat's settings. |
| Provider 1.36.0, OATS >=0.68.0, aw >=1.36.53 | Setup from an invite alone: `--invite-stdin` without `--join` reads the team and service with `aw team invite inspect` ("LOCAL team join and resume" below). Older aw refuses it with `E_SETUP_AW_VERSION`; labelled join is unchanged. |
| Future provider #60 | GLOBAL wider-team join is not an installed procedure here. Stop at its named owner boundary. |

## Upgrading a host to provider 1.26.0 (aw 1.36.33 floor)

Upgrade aw to 1.36.33 or later on the host, restart the host wake daemon (aw
1.36.33 writes its status atomically only once restarted) and every resident
custody service, then `oats sync` to provider 1.26.0. Below the floor, every
path refuses with the wording below. Provider 1.26.0 adds
`oats aweb resident create` (the skill's "GLOBAL residents and grant seats").

## Upgrading a host to provider 1.25.0 (aw 1.36.32 floor)

1. **New grant seats never expire.** A GLOBAL seat spawned on 1.25.0 gets a
   grant that ends only when revoked.
2. **One setting keeps a duration:** `identity.ttl`, for example
   `identity: { ttl: 720h }`. Existing seats keep theirs at renewal.
3. **What bounds a grant now:** its scopes, revocation at retire, and revocation
   by the resident's owner.
4. **Order on every host, done by a person: upgrade aw to 1.36.32 or later,
   restart every resident custody service and the host wake daemon, then
   `oats sync` to provider 1.25.0.** A running custody or daemon keeps its old
   code, and its old ops, until it restarts. In the other order a grant seat
   fails readiness and spawn with "required custody operations are missing:
   <op>; restart the custody on aw 1.36.33 or later (upgrade aw, restart the
   custody service and the wake daemon, then oats sync)", and readiness warns
   `wake-daemon-outdated` (the skill's section 7).

Every path that refuses an older aw says the same thing: `aw <installed> is
older than required 1.36.33; upgrade with \`npm i -g @awebai/aw@latest\` (or
\`npm i -g @awebai/aw@1.36.33\`)` (1.36.33 from provider 1.26.0). aw 1.36.31
lets an agent reply to a sender outside its team roster (a dashboard human in
aweb Cloud's agent chat); aw 1.36.32 mints grants that never expire.

A LOCAL seat needs the aw floor. A grant seat needs the worker's aw **and** a
running resident custody with the ops aw 1.36.32 brought (the client floor
itself is 1.36.33): readiness and the mint preflight
require the custody to list `grant_never_ttl.v1` for a never-ttl seat and
`mail_reply_continuation.v1` for an E2EE seat (the default). These are op
probes, not version checks. A seat with an explicit duration does not need the
never op; a seat with `identity.e2ee: false` does not need the reply op and
cannot send the encrypted reply to such a sender.

- Custody re-reads the source message to reply, so the grant needs `mail.read`
  with `mail.send`. The NORMAL profile has both; a send-only custom grant fails
  closed with `grant_scope_denied`.
- A late reply to a human whose key in the original message has expired fails
  by design ("source sender key is missing, expired or invalid; ask them to send
  a new message"): ask them to send a new message.
