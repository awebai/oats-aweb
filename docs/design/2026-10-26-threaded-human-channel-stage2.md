# The threaded human channel in `oats.aweb`, stage 2: verbs, the human's identity, the one-line wake

Status: specification, 2026-10-26, by the package's expert for the lane's coordinator
(`lane:ux`). Implements awebai/oats#1538 (`docs/design/2026-10-26-threaded-human-channel.md`
@ `bc774a3e`, its final head) §2–§4 for this package. Stage 1 (the `interaction` setting, brief and meta) is
merged in #154. **Nothing here is built until the coordinator relays (a) the `aw` release that
ships `aw mail conversations` and (b) the wake variable's final name and the client versions
that honour it.** Where the record fixes an interface (verb names, flags, answer shapes, the
meta key) this document repeats it and adds only what the implementation needs.

## 0. Contract conditions this stage must keep

1. A thread is an aweb mail conversation; the agent answers with `aw mail reply`.
2. The human's identity is minted by the capability, into a directory it owns, on first
   `threads send`, never at spawn, never by a read; the human never meets the word "identity".
3. The one-line wake is a delivery-contract change: its own release, release notes, raised
   floors; `terminal` souls keep the full body.
4. Viewers never consume for the agent: `inbox` verbs are plain reads (`aw mail show` /
   `aw mail conversations`), never `aw mail inbox`, never ack, never send.

## 1. Pieces and files

| Piece | Where |
|---|---|
| alias, directory, mint of the human identity | `lib/human-identity.mjs` (extends stage 1) |
| instance facts from `--home` (alias, team, interaction, identity home) | `lib/thread-subject.mjs` (new) |
| the five verbs | `lib/threads.mjs` (new), wired in `bin/oats-aweb.mjs` as commands `threads` and `inbox` |
| wake selector and floors | `bin/oats-aweb.mjs` (`retainedLaunchOutput`, spawn `env`), `oats.json` `requires` |
| docs | README "Provider settings" and a new "Threads and the agent's inbox" section; skill §4b grows; CHANGELOG; release notes |

## 2. The human's identity on a computer (record §2)

- **Alias**: `humanAlias()` from stage 1, unchanged (`<os-user>-<host>`; `host.name` of the
  deployment's `oats-local.yaml`, else the short hostname). awebai/oats#1540 may later supply the
  host name from the kernel; the derivation keeps the file read as fallback.
- **Directory**: `<deployment>/.oats-aweb/human/<team-dirsafe>/`, mode `0700`, where
  `<team-dirsafe>` is the team id with `:` replaced by `__` (the same rule `aw` applies to
  certificate file names, so one team always maps to one directory, reversibly). `<deployment>` is
  the scope the command runs in (`selectedDeployment`), never an instance home. The identity home
  passed to `aw` is `<dir>/.aw`.
- **Mint** (`ensureHumanIdentity({ deployment, team })`): if `<dir>/.aw/identity.yaml` exists →
  `{ alias, identityHome, created: false }` (the alias is read back from the mint record the
  capability writes, `<dir>/human.json` `{ alias, team, mintedAt }`, never from `.aw`; if the
  record is missing but `.aw` exists, `humanAlias()` is recomputed and recorded). Otherwise:
  resolve the team's root exactly as the spawn does (`settings.oats.aweb.roots[team]`, else
  `root`), and if absent answer the existing `oats aweb setup` remedy (`E_AWEB_ROOT`); run
  `aw init --join-from <root> --join-team <team> --name <alias> --json --do-not-touch-agents-md`
  with the spawn's secret-safe `run` (`MINT_UNSET_ENV`, 120 s), cwd `<dir>`; on success write
  `human.json` and answer `created: true`. A failed mint removes `<dir>` only if `.aw` holds no
  identity material (the same late-join check the spawn uses) and answers `aw`'s error as
  `E_HUMAN_MINT` with the aw message; a late-completed mint is kept and reported as created.
  An alias conflict (a previous human identity whose directory was lost, certificate still
  active) is answered as `E_HUMAN_ALIAS_HELD` with the remedy `aw` names; no automatic rename
  (the alias is the contract).
- **Only `threads send` mints.** `threads list` and `threads show` answer `human: null` (and
  an empty list) when `<dir>/.aw/identity.yaml` is absent. `inbox` verbs never touch it.
- **Nothing retires it**; nothing in `oats-local.yaml` records it. The retirement `disposable`
  list is unchanged (it is instance-home relative and does not reach the deployment directory).

## 3. The subject: `--home <abs>` (record §3)

Every verb takes `--home <abs instance home>` and reads `<home>/instance.json` only, and of it
only the fields `docs/desktop-cli-api.md` documents (`capabilityMeta`, `providers`); a kernel
JSON read (`oats inspect --home … --json`) is preferred at build time if it covers the need:

- `capabilityMeta["oats.aweb"]`: `alias`, `team`, `interaction`, `identity.mode`,
  `identity.grant.home` (global seats). Missing meta → `E_HOME_NOT_MESSAGING` ("this home has
  no oats.aweb record"); `interaction` absent (a home spawned before 1.32) counts as `terminal`.
- The agent's identity home: local → `<home>/.aw`; global → the recorded grant home; retained
  seat → `<home>/.aw` (the copied authority). The verbs never parse anything under `.aw`.
- The team is the meta's `team`; the human identity used is the one for that team.

## 4. The verbs

Declared in `oats.json` `operations` with `context: "scope"` and `args` (so `oats operation run
messaging:threads-list --home … --arg …` and Desktop's declared-operation gate work), and as
`commands` `threads` and `inbox` for the CLI form `oats aweb threads … --home …`. All answer the
standard envelope `{ schemaVersion: 1, ok, result | error }` via `operationOk/operationFail`;
all read `--json` (the CLI form without `--json` prints a short table; Desktop always passes it).

### 4.1 `threads list --home <h> [--limit n] [--cursor c]`

As the human. Runs `aw --identity-home <human> mail conversations --json [--limit n] [--cursor c]`
(the shipped CLI's flags, expected to mirror the Go client's `ConversationListParams`: `--limit`,
`--cursor`, `--conversation-type`, `--participant-did`, `--participant-address`; pinned at build
time) and keeps the conversations whose other participant **is the agent's identity**: matched on
the agent's did or address (`participant_dids[]` / `participant_addresses[]`, or the
`--participant-did|--participant-address` filter when the CLI has it), never on the alias
string, which is display only. The listing item is the client's `ConversationItem`
(`conversation_type`, `conversation_id`, `status`, `participants[]`, `participant_dids[]`,
`participant_addresses[]`, `subject`, `last_message_at`, `last_message_from`,
`last_message_preview`, `unread_count`; response `{ conversations[], next_cursor }`). The
agent's did/address come from a kernel or `aw` JSON read as the agent (`aw --identity-home
<agent> whoami --json`), never from parsing `.aw`. Answer:

```json
{ "human": { "alias": "<alias>" } | null,
  "agent": { "alias": "<alias>", "team": "<team id>" },
  "threads": [ { "conversationId": "…", "subject": "…", "lastMessageAt": "<RFC 3339>",
                 "lastMessageFrom": "human" | "agent", "preview": "<≤120 chars, one line>",
                 "unread": <int, messages from the agent the human has not acked> } ],
  "nextCursor": "…"? }
```

No human identity → `human: null, threads: []`, no `aw` call. Newest activity first. `preview`
is the last message's first line, sanitized (control characters removed) and truncated.

### 4.2 `threads show --home <h> --conversation-id <id> [--limit n]`

As the human. `aw --identity-home <human> mail show --conversation-id <id> --limit <n|200> --json`,
then, for every returned message **from the agent** with `read_at` null, `aw --identity-home
<human> mail ack <message-id>` (the human has seen them; this is the human's own mail, outside
condition 4). Answer, oldest first:

```json
{ "conversationId": "…", "subject": "…",
  "messages": [ { "messageId": "…", "from": "human" | "agent", "at": "<RFC 3339>", "body": "…",
                  "readAt": "<RFC 3339>" | null, "trust": "<aw's trust_status>" } ],
  "complete": true | false }
```

`complete` is false when the count equals the limit (the `aw` window is the OLDEST n and
has a 500 ceiling: that fact is surfaced, not hidden; Desktop raises `--limit`). `readAt` on a
human message is the agent's acknowledgement — under the one-line wake that means *presented*,
not read (record §4a); the README and the panel copy say so. `trust` is shown, never filtered on.
No human identity → `E_THREAD_NOT_FOUND` (there can be no thread).

### 4.3 `threads send --home <h> (--new --subject <s> | --conversation-id <id>) --body-file <f>`

As the human. Refuses first, before any mint: `interaction` not `threads` →
`E_INTERACTION_TERMINAL`; both or neither of `--new`/`--conversation-id` → `E_BAD_ARGS`; empty
body → `E_BAD_ARGS`. `--body-file -` reads stdin (routed `--server` commands forward stdin, so
a remote Desktop never names a host path); the text is written to a `0600` temp file under the
human directory and removed after. Then `ensureHumanIdentity` (§2), then:

- `--new`: `aw --identity-home <human> mail send --to <agent alias> --new-conversation --subject <s> --body-file <f> --json`
- `--conversation-id`: `aw --identity-home <human> mail send --to <agent alias> --conversation-id <id> --body-file <f> --json`
  (`--to` is passed in both forms; the rehearsal confirms whether the second needs it and the
  fake models exactly what the pinned `aw` accepts.)

Answer `{ "conversationId": "…", "messageId": "…", "human": { "alias": "…", "created": true|false } }`.
The body is sent as given; the verb adds nothing. A send failure after a successful first mint
keeps the identity (it is the computer's, not the message's) and answers `E_THREAD_SEND` with
`aw`'s message and `human.created` in `details`.

### 4.4 `inbox --home <h> [--limit n] [--cursor c]` and `inbox show --home <h> --conversation-id <id> [--limit n]`

As the agent, **read-only**: `aw --identity-home <agent> mail conversations --json …` and
`aw --identity-home <agent> mail show --conversation-id <id> --limit … --json`. No `ack`, no
`inbox`, no `send`, ever; the module exports no function that can. Shapes mirror 4.1/4.2 with
`from` as the sender alias (`"<alias>"`, or `"self"` for the agent's own) and no `human` key:

```json
{ "agent": { "alias": "…", "team": "…" }, "conversations": [ { "conversationId", "subject",
  "lastMessageAt", "lastMessageFrom": "<alias>", "preview", "unread" } ], "nextCursor"? }
```

A grant seat whose grant lacks the mail read scope gets `aw`'s own error relayed as
`E_INBOX_SCOPE` with the aw message. The live suite proves against the real binary that `inbox
show` leaves `read_at` null on the messages it returns (record §3).

### 4.5 Error codes (all `ok: false`, exit 1, never `unconfirmed` unless a mint's effect is unknown)

`E_BAD_ARGS`, `E_HOME_NOT_MESSAGING`, `E_INTERACTION_TERMINAL`, `E_AWEB_ROOT` (existing remedy
text), `E_HUMAN_MINT`, `E_HUMAN_ALIAS_HELD`, `E_THREAD_NOT_FOUND`, `E_THREAD_SEND`,
`E_INBOX_SCOPE`, `E_AW_FLOOR` (the installed `aw` is below the listing floor: names the floor and
the installed version), `E_AW` (any other `aw` failure, message relayed, token-safe).
A mint killed between `aw init` and its answer sets `error.details.unconfirmed: true`.

### 4.6 Manifest

```json
"commands": { "threads": "bin/oats-aweb.mjs threads", "inbox": "bin/oats-aweb.mjs inbox" },
"operations": {
  "threads-list": { "kind": "action", "command": "threads", "context": "scope",
                    "args": [ { "name": "home", "flag": "--home", "required": true }, { "name": "limit", "flag": "--limit" }, { "name": "cursor", "flag": "--cursor" } ] }
}
```

All five are `kind: "action"` (a JSON result, not a view document), `context: "scope"`, with
`args` `home` (required) plus, per verb, `limit`, `cursor`, `conversation-id`, `new`, `subject`,
`body-file`; each operation's `command` is `threads` or `inbox` with the subcommand fixed in the
manifest's command string (`bin/oats-aweb.mjs threads list` …). Names: `threads-list`,
`threads-show`, `threads-send`, `inbox`, `inbox-show`. Desktop gates the panel on the module
declaring these names (record §3), never on a version.

## 5. The one-line wake (record §4a) and floors

- **Selection**: for a home whose effective `interaction` is `threads`, the launch hook (every
  path: `retainedLaunchOutput`, the spawn's `env`, grant and retained seats) adds the channel-core
  variable (`AWEB_WAKE_PRESENTATION=line`, final name as relayed) to `env`; it is declared in the
  manifest's `environment`. `terminal` homes get no variable (and the hook never sets it to any
  other value). Launch preview reports the same env as the real start.
- **Floors**, in `oats.json` `requires` with `"when": { "interaction": "threads" }` (the kernel
  evaluates `when` against the merged settings, 0.67.1 `lib/core.mjs`; an absent setting compares
  as `""`, so `terminal` and pre-1.32 souls are untouched): `npm:@awebai/pi` `minVersion` = the
  pi extension that honours the variable; `aweb-channel@awebai-marketplace` `minVersion` = the
  Claude channel that honours it; `aw` ≥ the release whose broker honours it **and** ships
  `aw mail conversations` (one floor, the higher of the two, in `requires[0].why` and `AW_MIN`
  only if the whole package needs it — otherwise a verb-level `E_AW_FLOOR`). A `threads` spawn on
  a host below a floor fails closed at spawn (the kernel's requirement check) with the floor named;
  a `threads` launch where the runtime changed to one below its floor fails closed in the hook.
- **Truth in text**: the stage-1 sentences "not shipped yet" in the brief, skill §4b, inject and
  README are replaced in the same PR by the shipped behaviour: the wake is one line naming the
  thread and the read command; the body must be read with `aw mail show --conversation-id <id>`;
  presentation acknowledges, so `readAt` means presented.

## 6. Tests and rehearsal

- Unit (fakes modelling the pinned `aw`'s refusals and output shapes, as the package does): every
  verb's happy path and every error code; `inbox show` makes no `ack`/`inbox`/`send` call (the
  fake records argv); `threads list` without a human identity makes no `aw` call; `threads send`
  mints exactly once and reuses on the second send; `--body-file -` from stdin; the wake variable
  set/unset by `interaction` on all launch paths and in preview; floors applied only under
  `threads` (kernel `requires.when` is exercised through `oats check` in the public-kernel suite).
- Live, against the real `aw` at the floor, in the deployment's own team, before the PR is handed
  over: mint the human identity on first send, `threads list/show/send` round trip with a
  throwaway `threads` instance, `inbox show` leaves `read_at` null (checked as the agent with
  `aw mail show --message-id`), the agent's one-line wake observed in a pi session, then retire
  the instance; the human identity stays (by design). Committed text about the rehearsal says
  only that a real alias was minted, never which, on which host or for whom (lane rule).

## 7. Release

One `oats.aweb` release (1.32.0) with its own notes naming: the delivery-contract change
(condition 3), the raised floors and why, the verbs, the human identity (where it lives, that
nothing removes it), the `readAt` = presented caveat, and the known limits (#155 captured
allow-list; awebai/oats#1540). Released together with the Desktop panel per the coordinator.

## 8. Points answered by the coordinator (2026-10-26) and what remains

1. **Answered.** The listing's shapes are the Go client's for `/v1/conversations`
   (`ConversationItem`, `ConversationListParams`), as §4.1 now states; pinned to the shipped CLI
   when its version is relayed. Filtering is by the agent's identity (did/address), not alias.
2. **Answered.** `--to` is passed with `--conversation-id`; the rehearsal decides and the fake
   models the pinned `aw` exactly.
3. **Pending** from aweb: the variable's final name and the three client versions. No build
   before it and before the `aw` listing release.
4. **Answered.** Desktop invokes the CLI form (`oats aweb threads … --home … --json`, routed
   with `--server` through `capability-route`, the path it already uses for `oats aweb connect`)
   and gates on the declared operation names from `oats inspect` `capabilities[].operations`.
   Both forms stay. Shape details are agreed with the Desktop expert directly once named, and
   reported to the coordinator.
