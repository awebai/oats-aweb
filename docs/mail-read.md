# messaging:mail: an instance's own mail, read without acknowledging it

oats.aweb answers the messaging layer's operation `messaging:mail` with the
messaging layer's `mail` answer, `mailApi: 1`. The answer's shape and its
guarantees are described once, for every messaging provider, in the OATS
kernel's `docs/desktop-cli-api.md` ("Mail, `mailApi: 1`"). This page says how
oats.aweb produces it. The code is `lib/mail-read.mjs`, dispatched as the
`mail` command of `bin/oats-aweb.mjs`.

```text
oats operation run messaging:mail --home <abs> [--arg limit=50] [--arg cursor=<nextCursor>] [--arg conversation=<id>] [--server <id>] --json
oats aweb mail [--limit N] [--cursor C] [--conversation ID] [--json]      # the same read, from the home
```

The OATS Desktop's mail sheet reads it on open and on a manual refresh, never
on its status poll: each read costs 1 + N aw calls, each an HTTPS round trip.

## It never acknowledges

aw acknowledges mail when `aw mail inbox` shows it, and `aw mail reply`
acknowledges the message it answers. The read runs only:

| aw command | why | what it does at the server |
| --- | --- | --- |
| `aw version` | the floor below, local | nothing |
| `aw --identity-home <h> whoami --json` | which identity `<h>` is, so `direction` can be decided | reads |
| `aw --identity-home <h> mail threads --limit 50 [--cursor C] --json` | the identity's threads, newest activity first ("Listing marks nothing read") | `GET /v1/conversations` |
| `aw --identity-home <h> mail show --conversation-id <id> --limit 500 --json` | one conversation's messages | `GET /v1/messages/conversations/<id>` |
| `aw --identity-home <h> mail show --message-id <id> --json` | a legacy thread, which has one message and no conversation | `GET /v1/messages/<id>` |

`assertReadOnlyAwArgv` refuses every other argv (`mail inbox` in any form,
`ack`, `reply`, `send`, `log`, `chat`, a `--team` override) before anything
runs, and every call goes through it. This is the contract's (v2) list made
narrower, with one addition: `aw version`, which reads nothing from the
server and answers `E_AW_TOO_OLD`; and without `mail inbox --count-only`,
which the read never needs (no field holds a count): the tests call it
directly against aw to compare unread counts. Pinned by:

- `test/mail-read.test.mjs`: the guard, and every scripted read passes it;
- `test/mail-operation.test.mjs`: the command as the kernel runs it, with a
  fake aw that validates and records each argv for
  `scripts/check-aw-argv.mjs`, which then checks every recorded command and
  flag against each CI matrix aw's help;
- `test/mail-read-native.test.mjs`: every argv form the read builds, values
  included, accepted by the real aw (`OATS_TEST_AW`);
- the stack journey "messaging:mail reads a real home's mail on both
  identities and acknowledges nothing" (`test/resident-journey.test.mjs`): a
  real joined-team home, real aw and the real OSS server, read through the
  pinned kernel's `oats operation run`; each identity's unread count and every
  message's `read_at` are the same before and after.

## The aw it needs

`mail threads` came in aw 1.36.53, above the provider's aw floor
(`aw-compat.json` `min`). Below 1.36.53 (the provider's own floor included, when aw's version
reads) the read answers `ok: false`,
`E_AW_TOO_OLD`, with `details: {version, needs: "1.36.53"}`, before any mail
call. Every other oats.aweb path keeps the floor it has.

## Which identities

The primary identity (the home's `.aw`, or a grant seat's grant home) labelled
with the default team's label, then each joined team's identity home,
labelled with its label, from the home's recorded `capabilityMeta`.

## How a page is found

aw gives each identity's threads newest activity first, and a conversation's
messages from its OLDEST end. The read walks the threads of every identity in
activity order, a few at a time (6 aw calls at once), and merges their
messages, newest first by `createdAt` (to the microsecond aweb gives, not
only the millisecond), then message id, then team. A message
is certain once it is newer than the latest activity of every thread not yet
read: no unread thread can hold a newer one. A page of threads not yet listed
counts at the activity of the last thread listed before it. The page is the newest `limit`
certain messages, and the read stops as soon as it has them, so a page of 50
reads about 50 conversations at most on a first page.

- **Budget.** At most 300 conversation reads and 150 s per answer (the
  kernel's bound is 240 s). Past either, the page holds only what is certain.
  If nothing is, the identities with unread threads get the error
  `too-many-threads`, and `hasMore` is false.
- **Cursor.** `nextCursor` encodes the last message's `createdAt`, id and
  team. The next page re-lists the threads and keeps only messages older than
  it, so there is no overlap and no gap; it may re-read threads with newer
  activity. A cursor from a `--conversation` read is valid only with the same
  conversation.
- **`--conversation <id>`.** That conversation on each identity that has it,
  newest first; an identity where aw answers "not found" is no error.
- **`limit`.** 1 to 200, default 50; anything else, or a cursor no answer gave,
  is `E_BAD_ARGS`.

## Bounds and partial threads

- Each `body` is cut at 16 KiB of UTF-8, on a character boundary, with
  `truncated: true`.
- The whole `result` is at most 256 KiB of JSON. Past it the page ends early,
  with `hasMore: true` and a `nextCursor` at its last message. When the newest
  message alone doesn't fit, its `subject` and `threadTitle` are cut to the
  most that fits, at a character boundary, with `truncated: true`: a page is
  never empty with more to read. When even the answer with no messages
  doesn't fit (its identities and partial conversations alone), the read
  fails whole with `E_MAIL_TOO_LARGE`, `details: {identities, bound}`. Every
  answer is checked against the bound before it is returned.
- A conversation whose read returned 500 messages (aw's `mail show` ceiling)
  may be longer, and its newest messages are the missing ones. It is listed in
  `conversations` with `partial: "oldest-first-only"`. When aw sends
  `order=desc` on `mail show` (asked of the aw maintainers), the read takes
  the newest end and `partial` goes `null`. A partial conversation the read
  met is listed even when none of its old messages made the page, so the
  warning is never lost.
- `documents` holds a plain rendering for a generic view reader: each
  message's header and the first 500 characters of its body. Sender text is
  escaped so it adds no markdown structure, and quoted.

## The fields, from aw's

| field | from aw |
| --- | --- |
| `identity` (identities, from, to) | `stable_id` (did:aw) when aw gives one, else the `did` (did:key); the same rule everywhere, so a client can compare them |
| `direction` | `sent` when `from_did` is the identity's did or `from_stable_id` its stable id |
| `readByAgent` | received: `read_at` is set; sent: `true` (the agent wrote it; `read_at` is the recipient's) |
| `encrypted` | `content_mode: "encrypted_v2"`, `message_version: 2` or an `encrypted_envelope`. aw decrypts the body with the agent's keys |
| `verification` | `verified`, `verified_legacy`, `verified_custodial`: `verified`; `unverified`; `failed`, `identity_mismatch`: `failed`; anything else (`verification_stale` too): `unknown` |
| `priority` | `low`, `normal`: `normal`; `high`, `urgent`: `high`; anything else: `unknown` |
| `threadTitle` | the thread's `title` (aw decrypts an encrypted first subject), else its `subject` |

## Errors

Per identity, in `identities[].error`; the read fails whole
(`E_MAIL_UNREADABLE`, with `details.identities`) only when no identity could
be read, or (`E_MAIL_TOO_LARGE`, above) when no answer can fit the bound.

| error | meaning |
| --- | --- |
| `identity-missing` | its identity home is not there |
| `identity-unreadable` | `aw whoami` failed |
| `no-mail-read` | a grant without the `mail.read` scope, or the server refused the identity's thread list |
| `threads-unreadable` | `aw mail threads` failed: nothing of this identity was read |
| `conversation-unreadable` | one conversation could not be read (an E2EE body that won't decrypt, a server error or refusal): its messages are missing, the rest are shown |
| `too-many-threads` | the budget ran out before anything could be ordered (above) |

A home whose oats.aweb copy predates the operation answers the kernel's
`E_OPERATION_UNKNOWN`; it gets the operation from `oats instance upgrade` once
an oats.aweb with it is pinned, or by spawning anew.
