# Native and kernel test matrix

`node scripts/test-ci.mjs <group>` invokes `npm test` for the selected files
and requires a nonempty run with zero skips. A missing executable or fixture
therefore fails its group. New test files enter `unit` unless explicitly
assigned to another group. CI supplies an empty environment and disposable
HOME for every group. Tests never select a person's identity or tmux server.

| Group | Versions and prerequisites | What runs |
| --- | --- | --- |
| `unit` | aw 1.36.33, 1.36.58, 1.36.59-rc.5 (the next by its pinned npm integrity); Python with pty; POSIX file modes | Provider behavior, strict recording fakes, native CLI/loopback signup and invite refusals, TTL vectors, offline status signing, the offline `aw who` read of a chainless root. Every recorded hook/probe command path and flag is then checked against this exact aw's help. |
| `kernel` | OATS v0.70.0 at `7512163012876511088da79168c74540f9523c66`, tested aw, tmux; isolated local Git repositories | Public hostOnly, requirement backends, roots, disposal, registry, preview, runtime, upgrade, tasks and attention contracts. Only disposable kernel deployments are exercised. |
| `host` | Same pinned kernel and tested aw, tmux on a private socket directory | Native health commands, scheduler and process observations. Identity reads moved to disposable stack journeys. |
| `stack` | All three aw versions; OSS aweb at `679d50066d4160748f6f9cfa0537161992399573`, PostgreSQL, Redis, awid, pinned kernel, disposable Linux user manager | Resident creation refusal/resume, custody, grants and show, legacy bare-label grant fill/retire, roster/count, joined and retained seats (a chainless root's join passes no `--parent`; on an aw with it, the parented accept's argv is parsed by the real aw), the non-acknowledging `messaging:mail` read, native identity/readiness observations and sanitized capture generation. |
| `historical` (manual) | OATS `bb2ba8c9a254edb745913b9c5a9d9b833fda932d` and `e6e75ed8ba5a0a07a4b3e26fc627cac9064c730b` | The retained 0.42/0.47 inventory projection comparison. Those kernels are below the package's supported 0.70 floor, so current CI does not provision them. |
| `hosted` (acceptance) | Disposable hosted team, pi extension, dashboard token and status API | `health-live.test.mjs`; no Cloud credentials are available to the OSS CI stack. |

The stack uses the CI-only `test/fixtures/stack/awid-public-origin.yaml`
override to configure `AWID_PUBLIC_ORIGINS=http://127.0.0.1:18010` for native
covering controller signatures. The pinned service code and authentication
checks stay unchanged. Scratch host readers receive the selected
`OATS_NODE_BIN` / `OATS_CLI_BIN` pair instead of relying on an installed oats.
Printed-step journeys explicitly name that private registry through
`AWID_REGISTRY_URL`. While diagnosing joined-spawn failures, the CI-only
observer forwards native argv, environment and output unchanged and captures
only booleans for the known private-registry refusal, never command output.

The runtime version list comes from `scripts/aw-test-versions.mjs`, which
imports the supported floor and tested version from `lib/aw-floor.mjs`,
which reads `aw-compat.json` and pins
next separately. CI verifies the installed version before running tests. The resident baseline
recapture uses the exported floor value, so a floor bump cannot silently drop it.
Next remains prerelease qualification, not an increase in the tested window.

## Explicit capability exclusions

- On aw 1.36.33, the three native BYOT create-shape cases are excluded from
  `unit`: the controller-key behavior requires aw >=1.36.56. Their fake
  cases still run, and their real cases run on tested and next.
- On aw 1.36.33, `id team set-server` and `show-server` do not exist.
  Their recorded tuples are excluded from floor admission only: the existing
  BYOT route requires aw >=1.36.53 and its refusal tests still run. The two
  native prose cases requiring these commands and `mail inbox --count-only`
  run at tested and next, as before P2. The real-stack floor asserts that
  count-only is unsupported and that the provider reports that capability absent.
- On aw >=1.36.53, `stack` excludes the second API-key partial-registry
  mismatch journey. These clients refuse the OSS server's team lookup
  before writing a partial. The preceding journey checks that refusal and
  the absence of a partial/key instead.
- A kernel without `settings-committed-only` excludes that one named tasks
  admission case. The group reads the real kernel's feature list and prints
  the exclusion with its version; the supported tasks selection cases still run.
- On aw 1.36.33, `mail threads` does not exist. Its recorded tuple is
  excluded from floor admission only: `messaging:mail` requires aw >=1.36.53
  and refuses an older aw with `E_AW_TOO_OLD` before any mail call, which its
  unit test pins. `test/mail-read-native.test.mjs` asserts the command is
  absent at the floor and admits every built argv at tested and next. The
  stack journey for `messaging:mail` asserts the refusal at the floor.
- On aw 1.36.33, `who` does not exist; the guard asserts its absence and
  excludes it. The provider's reads then answer nothing: C1 keeps what was
  recorded and check-only reports `unavailable` (README, "Human attribution").
- Below aw 1.36.59, `id team accept-invite --parent` is excluded only where the
  real aw lacks it (1.36.33 and 1.36.58; the pinned next, 1.36.59-rc.5, has it):
  only a join from an adopted root passes it, and that join stops before any
  invite there with `E_ADOPTED_ROOT_AW_TOO_OLD`. The grammar's `--parent` comes
  from the next aw (`node scripts/capture-aw-argv.mjs <tested> <floor> <next>`).
- Status publishing requires aw >=1.36.38. The floor signing test asserts
  that the command is unsupported; it does not skip.
- The Linux lingering test runs in Linux CI. A local non-Linux package group
  excludes its exact name because systemd lingering is unavailable; mode-denial tests also require a non-root
  POSIX user, and terminal tests require Python's pty module. CI provides these.

The native join-refusal test has a diagnostic branch for aw 1.36.33:
`init --join-from` there does not carry the structured refusal code to OATS.
It must still refuse, bind no identity and expose no token. Tested and next
must also report the structured diagnosis. Remove the legacy assertion when
the supported floor moves to 1.36.59 final.

## Native argv coverage

The grant, setup, wake, join-from and mail-read CLI doubles record the hook's built argv;
`probe-fixture.mjs` uses the same validator/recorder for the probe's selected
aw runner. This includes `mail send --new-conversation --to --subject
--body-file`, both `mail show` selectors and its conversation limit, and
identity-home/team selection. The real help guard requires witnesses for all
31 recorded command paths and checks every used flag, parsed together.
Appending `--help` proves parse acceptance; it does not exercise required-together
or mutually exclusive flag groups, or value validation performed by the command.
Values are never written to the shared recording log. For mail send, the
unit vectors cover both qualified contracts. The guard selects the branch
advertised by this real CLI and requires a recorded send for that branch:
1.36.33 uses `--new-conversation`; 1.36.58 and next use recipient plus subject
(the flag was removed in 1.36.53). A regression that always uses one form
therefore fails the required witness check on the other version.

Other provider/library argv run directly against the real binary instead of
the recording doubles:

| Provider argv | Named native proof |
| --- | --- |
| `init --global`, `doctor identity --offline --json`, `doctor registry --online --json`, `custody serve/status/stop` | `resident-journey.test.mjs` and `test/fixtures/resident/capture.sh` in the disposable stack group. |
| Probe `mail send` and `mail show`, including leading identity/team selectors | `probe-mail-native.test.mjs` qualifies actual native help, executes the provider's one-send/full-reply proof against controlled external transport, then admits its actual argv with native `--help` at every matrix version. It sends no native mail. |
| `status publish --print-signed` and publisher flags | `health-status-native.test.mjs`, all vector documents; floor asserts unsupported. |
| `team invite --member-local` and `team invite inspect` | `invite-native.test.mjs`, generated identities and loopback HTTP. |
| `mail inbox --count-only --json`, roster members/presence, retained connect/status/heartbeat/whoami | `resident-journey.test.mjs` runs the provider roster and requires the joined seat's certificate and presence sources with complete presence at all three versions. Tested/next compare the provider's unread count with native `unread_count`; floor asserts absent count capability. |

Exclusions use Node's `--test-skip-pattern` with exact escaped names, after
checking that every name is a declared literal test in the selected files.
Excluded tests are outside the selected group and contribute no skipped count.
The runner rejects stale exclusions before starting npm test. The literal-name check is test selection validation;
it makes no claim about provider behavior from source text.

## Captures and acceptance

The resident journey also mints a real 720-hour grant with the pre-1.25
`oats:<instance>` label and constructs its legacy-shaped metadata and grant
home without seat.json. The launch must fill seat.json, keep the grant active
with renewal off, and retire must revoke it in its recorded team. This case
runs at every matrix version, including 1.36.33 and 1.36.58.

The fill checks the list row's `status`. In the pinned service,
[`list_identity_grants`](https://github.com/awebai/aweb/blob/679d50066d4160748f6f9cfa0537161992399573/server/src/aweb/routes/identity_grants.py#L173)
uses [`grant_status`](https://github.com/awebai/aweb/blob/679d50066d4160748f6f9cfa0537161992399573/server/src/aweb/identity_grant_status.py#L15),
which returns `expired` for a finite grant past its expiry. `aw id grant show`
returns this list row; `effective_status` belongs to the separate grant
status endpoint used by custody. Unit tests pin the no-write refusal for an
expired grant with both renewal off and renewal on launch.

The stack group writes only public observations to `OATS_AWEB_CAPTURE_DIR`:
grant receipts/show, resident identity, roster, count, workspace record and
broker status. It captures only identities it created. The resident baseline
is recaptured with the still-supported floor CLI. Before artifact upload,
`scripts/sanitize-captures.mjs` refuses private keys and credential fields
without reflecting their values in logs, redacts token patterns and normalizes
runner paths. Upload depends on successful sanitization. The author inspects
all artifact files before committing them and records their provenance.
The committed baseline was refreshed from passing floor/tested artifacts in
[run 44439390779](https://github.com/awebai/oats-aweb/actions/runs/44439390779).
Receipts and the exact transformations are documented beside the
[resident](../test/fixtures/resident/README.md),
[wake](../test/fixtures/codex-delivery/README.md),
[workspace](../test/fixtures/probe/README.md) and
[mint](../test/fixtures/grant-mint/README.md) captures. This is evidence for that
run's package merge head, not a claim that a later PR head passed.
Decoded JSON strings are checked recursively for YAML credential fields, including
the workspace-record string; malformed `.json` captures also refuse without echoing
their contents.

Private-registry journeys explicitly record the operator's registry with
`oats aweb setup --registry <origin> --soul probe --json` after workspace and
controller preparation. This record-only step creates no root, account or team.
The LOCAL joined-spawn and killed-join acceptance assertions then run unchanged;
ambient AWID variables and native aw records alone are not registry admission.
Direct resident-hook fixtures receive the same explicit `OATS_SETTINGS.registry`,
including their resident-map and alternate-registry overrides. Direct `healthHost`
fixtures also pass the resolved `settings.registry` argument, as `healthMain` does;
the adapter does not load operator settings from disk. This fixture
preparation requires the registry-setting provider change; the CLI floor stays
unchanged. Printed controller cleanup commands run as complete shell lines in
the fixture's isolated operator environment, preserving any explicit registry
prefix; the journey then checks the certificate is absent at the service. The
loaded custody unit must carry exactly the configured `AWID_REGISTRY_URL`, no
other `AWID_` names, and no `AWEB_` variables; key/ownership/process and
certificate checks stay in place.

The retained journey separately records the real kernel's post-start session
inspection and the broker's pre-event status. Pending aw request m, a healthy idle
seat may still carry the initial `pending` / `not-launched` observation; this is
a native readiness false negative, not successful readiness. Once aw fixes m,
the marked assertion must require active status before any event. The journey
then sends one mail from a second disposable identity and requires active status,
an admitted streaming connection and the unique message marker in its private
inert pane. That proves terminal delivery, not model consumption.

The OSS stack cannot establish `workspace delete` returning
`alias_released:true` for a hosted self-release. Before claiming hosted
acceptance, run spawn/retire/retry with a disposable hosted team and record
that native response, alias reuse and no second release on retry. The
loopback refusal tests prove real aw's parsing and wire behavior for
`unknown_or_invalid`, `alias_conflict` and `self_custody_reinit_unproven`;
they do not claim Cloud server authorization. A complete hosted account
creation and the hosted health/receive journey also remain acceptance items.

## Removed source and prose guards

P2 replaces spelling checks with executable behavior or removes guards that
could pass without exercising their claimed behavior:

| Former assertion | Disposition |
| --- | --- |
| First-level aw verb help | Full runtime-recorded subcommand/flag check against every pinned CLI. The guard has missing-child and unknown-flag negative controls. |
| `execFileSync` source spelling | Removed; real argv admission and hostile-value behavior are exercised through hook calls and recording fakes. Import/resource boundaries remain checked. |
| `process.env` absent in managed-policy source | Removed; policy files, precedence and resulting readiness/launch verdicts remain behavior tests. |
| Private draft recipe text | The documented shell recipe actually runs twice; file uniqueness, owner-only mode and disposable location are checked. |
| Session recovery sentences in source/docs (`1-15`) | Runtime Comms assertions remain; prose/source repetitions removed. |
| `1-27` changelog, skill and description wording | Removed; manifest compatibility and runtime channel/preview/readiness cases remain. |
| CI YAML regex parsing (`health-aw-floor`) | Removed; CI builds its version matrix from the module and enforces zero skips while executing each selected group. |
| `claim-human-docs`, `pi-mail-recovery-guidance` prose | Removed; prose is reviewed as documentation, not represented as service behavior. |
| `aweb-tasks-skill` prose and `no-task-coordination` document scans | Removed; argv-checker/detector unit behavior and generated runtime briefs remain. |
| `aweb-tasks` inject wording about task state, locks and roles | Removed the whole-file prose regex; task wiring/validation, command admission and task-team behavior remain executable tests. |
| Roster `1.20.0 documents the roster` | Removed README/CHANGELOG/skill/inject spelling checks; roster rows, completeness and command tuples remain executable tests. |
| `1-21` documentation sentence test | Removed prose checks; retained the manifest's connect-command contract as `the manifest exposes the connect command`; connect/setup behavior cases remain. |
| `1-18` delivery/preview/readiness documentation tests | Removed three prose guards; runtime delivery transitions, preview purity, deregistration failures and channel confirmation readiness remain executable cases. |
| `1-17` team-model documentation test | Removed wording checks; closed-workspace/default-team/join behavior cases remain. |
| `aw-compat` README JSON-copy test | Removed document duplication check; validated compatibility JSON and runtime version/refusal behavior remain. |
| Joined-team poll skill text | Removed prose-only readiness wording; poll readiness, stale-runtime and no-install remedies remain executable tests. |
| BYOT team-key copy advice scan and nested-root migration prose | Removed documentation scans; setup refusal/state preservation and existing-root placement tests remain. |
| Tasks-team inject/skill hashes and identity-home source scan | Removed text hashes/scans; task-team selection, joined identity resolution and read-only readiness still run against provider operations. |
| Tasks-skill command count, pi README heading, old changelog sentence | Removed prose-only checks; command checker negative controls, manifest install-entry warning behavior and default-team runtime failures remain. |
| Resident documentation-envelope matching | All 17 runtime outcome cases remain, compared against explicit JSON envelope fixtures; only the documentation wording guard was removed. |

`kernel-module-boundary.test.mjs` remains unchanged: it enforces an actual
package/kernel import boundary. Native BYOT tests compare consumed fields,
not every key aw may add to its answer.

The historical `1.36.23-source-fixture` receipt integrity test remains as an
explicit call to `verifySourceAwFixture`, preserving its exact source/hash
assertions. It is not native admission: `verifyPinnedAw` always requires the
current matrix, ignores source-receipt environment variables, and cannot use a
historical receipt to bypass the supported floor.
