# Native and kernel test matrix

`node scripts/test-ci.mjs <group>` invokes `npm test` for the selected files
and requires a nonempty run with zero skips. A missing executable or fixture
therefore fails its group. New test files enter `unit` unless explicitly
assigned to another group. CI supplies an empty environment and disposable
HOME for every group. Tests never select a person's identity or tmux server.

| Group | Versions and prerequisites | What runs |
| --- | --- | --- |
| `unit` | aw 1.36.33, 1.36.58, 1.36.59-rc.3; Python with pty; POSIX file modes | Provider behavior, strict recording fakes, native CLI/loopback signup and invite refusals, TTL vectors, offline status signing. Every recorded hook/probe command path and flag is then checked against this exact aw's help. |
| `kernel` | OATS v0.68.1 at `13f8f133808f5932bf461108703c1bada4b3f3d3`, tested aw, tmux; isolated local Git repositories | Public hostOnly, roots, disposal, registry, preview, runtime, upgrade, tasks and attention contracts. Only disposable kernel deployments are exercised. |
| `host` | Same pinned kernel and tested aw, tmux on a private socket directory | Native health commands, scheduler and process observations. Identity reads moved to disposable stack journeys. |
| `stack` | All three aw versions; OSS aweb at `679d50066d4160748f6f9cfa0537161992399573`, PostgreSQL, Redis, awid, pinned kernel, disposable Linux user manager | Resident creation refusal/resume, custody, grants and show, roster/count, joined and retained seats, native identity/readiness observations and sanitized capture generation. |
| `historical` (manual) | OATS `bb2ba8c9a254edb745913b9c5a9d9b833fda932d` and `e6e75ed8ba5a0a07a4b3e26fc627cac9064c730b` | The retained 0.42/0.47 inventory projection comparison. Those kernels are below the package's supported 0.68 floor, so current CI does not provision them. |
| `hosted` (acceptance) | Disposable hosted team, pi extension, dashboard token and status API | `health-live.test.mjs`; no Cloud credentials are available to the OSS CI stack. |

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

The grant, setup, wake and join-from CLI doubles record the hook's built argv;
`probe-fixture.mjs` uses the same validator/recorder for the probe's selected
aw runner. This includes `mail send --new-conversation --to --subject
--body-file`, both `mail show` selectors and its conversation limit, and
identity-home/team selection. The real help guard requires witnesses for all
29 recorded command paths and checks every used flag, parsed together.
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

The stack group writes only public observations to `OATS_AWEB_CAPTURE_DIR`:
grant receipts/show, resident identity, roster, count, workspace record and
broker status. It captures only identities it created. The resident baseline
is recaptured with the still-supported floor CLI. Before artifact upload,
`scripts/sanitize-captures.mjs` refuses private keys and credential fields
without reflecting their values in logs, redacts token patterns and normalizes
runner paths. Upload depends on successful sanitization. The author inspects
all artifact files before committing them and records their provenance.
Decoded JSON strings are checked recursively for YAML credential fields, including
the workspace-record string; malformed `.json` captures also refuse without echoing
their contents.

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
