# Native error decisions

The provider supports aw 1.36.33. That floor has no `--json` error envelope;
aw 1.36.52-rc.3 introduced it. Code-only replacements wait for the agreed
1.36.59 final floor. Working old-floor decisions remain
in place until that change; no version branch is added here.

The current decisions and structured signals needed from aw:

| Decision | Current native signal | Evidence and follow-up |
| --- | --- | --- |
| Joined cleanup may release its key | `team_not_hosted` exact stderr on the old floor; native code at newer aw | Code-only cleanup waits for that floor. CI's real keyless joined-team journey is its service proof on every matrix aw; from aw 1.36.59 a machine holding the team key gets no refusal, as aw retires the member itself (the real joined-team journeys). |
| Failed default mint created no invite | `; alternatively use --admission-team-id ` suffix | Real-aw failed join-from invite test. Ask aw for an explicit no-mint outcome instead of the suffix. |
| Alias conflict remedy | Broad `already/exists/conflict/422/active certificate/self_custody_reinit_unproven` legacy match, plus native alias refusal fields where available | Code-only alias classification waits for that floor. The legacy match can classify unrelated text; no new reliance on it is introduced here. |
| Failed revoke needs a readback | `may have applied`, timeout/deadline text | Real-aw heartbeat mutation timeout pins the shared HTTP client's ambiguous-outcome text. This is a native client wording check, not a grant-revoke journey. Ask aw for an explicit uncertain-outcome signal. |
| Missing namespace controller key | `no local controller key for`, `load controller key for` | Real-aw missing/corrupt controller tests. Ask aw for a distinct missing-controller code. |
| Missing team key | `no team key for`, `local team controller key for ... was not found` | Real-aw invite and register tests. Ask aw for a distinct missing-team-key code. |
| Team name held by another key | Exact team pin prose, or generic `http_error`/409 plus `create team at registry: ` | Real-aw loopback registry tests for both branches. Ask aw for a distinct team-name conflict code. |
| Unavailable username at signup | aw's usage error (exit 2) with a whole stderr line `username "<u>" is not available (<reason>)` naming exactly the requested username (aw quotes it with Go's `%q`, so it is read back as Go quotes it: an invisible character comes back escaped), read before any scrub (aw prints it with no terminal, from the 1.36.33 floor to 1.36.58); the reason is named only as one short snake_case word, and the same words inside another error are not it | Real-aw loopback tests for a refused availability check, a signup conflict, usernames that are part of the sentence, usernames with an invisible character, and the words inside a wrapped HTTP 500. Ask aw for a distinct `username_taken` code. |
| No published team-server record | Generic `error` with exact `no team server record is published for ...` | Real-aw loopback 404 test. Ask aw for a distinct missing-record code. |
| Spawn mint failure cause (#280) | `error.code` from the mint's allow-list, `error.http_status`, and `error.reason` from its allow-list (a reason off the list shows as the status alone); never `message` or `detail`. With no status: the missing-key wordings above, a signing key aw could not read (`read <path>/signing.key: open ...: no such file or directory`), or the network wording. With no envelope (aw before 1.36.52): `http <status>` and a listed detail code from the text | The lists in `lib/aw-failure-cause.mjs` (`AW_MINT_ERROR_CODES`, `AW_MINT_REFUSAL_REASONS`) come from aweb's maintainers' trace of `init --join-from` against aw 1.36.59. aw's codes are its published contract; server reasons are an open vocabulary, so an unknown one is not named. `test/mint-failure-cause-280.test.mjs`. Ask aw for a distinct missing-signing-key code. |
| Withheld HTTP failure class | `http <status>` then safe `detail`/`detail.code`; register prints the unwrapped `code` | Real-aw register test. Keep HTTP status and bounded code, discard arbitrary body messages. Ask aw for structured server status/code fields on register failures. |
| Unread count feature | `--count-only` in `mail inbox --help` | Real-aw help test. Ask aw for machine-readable command/feature capabilities. |
| A mint waiting for an agent signature | `error.code` `native_agent_signature_pending` (aw 1.36.59); on aw 1.36.58 and 1.36.59-rc.3, which answer the generic `error`, a failure after the key was written from a root with an identity chain | The code path is gated on the code, never on a version. `test/human-attribution.test.mjs` (A8) and the kernel's retention, `test/public-kernel-signature-pending.test.mjs`. Remove the fallback when the floor moves to 1.36.59 final. |
| Who stands behind a root or an identity | `aw who --json`: `outcome`, `human_id`, `reason`, `chain` (aw 1.36.58 and later); exit status and `error.code` only on a failure | `test/human-attribution-native.test.mjs` on every matrix aw. Below aw 1.36.58 there is no `who`: the read gives no answer. |
| Version gates | `aw <version>` first line | Real-aw version test runs both binding and probe version readers. Ask aw for a JSON version answer. |

The hook's calls affected by these decisions are `init --join-from`,
`workspace delete`, `id grant revoke/show`, and setup's `init --new-account` and `id team
create/invite/register/show-server`; health and binding read `version` and
`mail inbox --help`. The code that consumes the signals is in
`bin/oats-aweb.mjs`, `lib/aw-failure-cause.mjs`, `lib/health-host.mjs` and
`lib/binding-wire.mjs`.

`test/aw-error-prose-native.test.mjs` uses an explicitly selected binary,
a fresh HOME, generated throwaway keys and loopback-only HTTP services.
CI requires all seven native tests on the tested-aw resident-journey leg,
without skips. These fixtures pin native formatting and classification;
they grant no real service authority. `test/setup-byot-create-202.test.mjs`
checks the provider's real setup path against the same register-output shape,
including malformed/overlong codes and withholding the response message.
