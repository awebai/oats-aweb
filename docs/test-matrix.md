# Native and kernel test matrix

`node scripts/test-ci.mjs <group>` invokes `npm test` for the selected files
and requires a nonempty run with zero skips. A missing executable or fixture
therefore fails its group. New test files enter `unit` unless explicitly
assigned to another group. CI supplies an empty environment and disposable
HOME for every group. Tests never select a person's identity or tmux server.

| Group | Versions and prerequisites | What runs |
| --- | --- | --- |
| `unit` | aw 1.36.33, 1.36.58, 1.36.59-rc.3; Python with pty; POSIX file modes | Provider behavior, strict recording fakes, native CLI/loopback signup and invite refusals, TTL vectors, offline status signing. Every recorded hook command path and flag is then checked against this exact aw's help. |
| `kernel` | OATS v0.68.1 at `13f8f133808f5932bf461108703c1bada4b3f3d3`, tested aw, tmux; isolated local Git repositories | Public hostOnly, roots, disposal, registry, preview, runtime, upgrade, tasks and attention contracts. Only disposable kernel deployments are exercised. |
| `host` | Same pinned kernel and tested aw, tmux on a private socket directory | Native health commands, scheduler and process observations. Identity reads moved to disposable stack journeys. |
| `stack` | All three aw versions; OSS aweb at `679d50066d4160748f6f9cfa0537161992399573`, PostgreSQL, Redis, awid, pinned kernel, disposable Linux user manager | Resident creation refusal/resume, custody, grants and show, roster/count, joined and retained seats, native identity/readiness observations and sanitized capture generation. |
| `historical` (manual) | OATS `bb2ba8c9a254edb745913b9c5a9d9b833fda932d` and `e6e75ed8ba5a0a07a4b3e26fc627cac9064c730b` | The retained 0.42/0.47 inventory projection comparison. Those kernels are below the package's supported 0.68 floor, so current CI does not provision them. |
| `hosted` (acceptance) | Disposable hosted team, pi extension, dashboard token and status API | `health-live.test.mjs`; no Cloud credentials are available to the OSS CI stack. |

The runtime version list comes from `scripts/aw-test-versions.mjs`, which
reads the supported floor and tested version from `aw-compat.json` and pins
next separately. CI verifies the installed version before running tests.
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
- The Linux lingering test runs in Linux CI. A local macOS package run
  reports that platform exclusion; mode-denial tests also require a non-root
  POSIX user, and terminal tests require Python's pty module. CI provides these.

The native join-refusal test has a diagnostic branch for aw 1.36.33:
`init --join-from` there does not carry the structured refusal code to OATS.
It must still refuse, bind no identity and expose no token. Tested and next
must also report the structured diagnosis. Remove the legacy assertion when
the supported floor moves to 1.36.59 final.

## Captures and acceptance

The stack group writes only public observations to `OATS_AWEB_CAPTURE_DIR`:
grant receipts/show, resident identity, roster, count, workspace record and
broker status. It captures only identities it created. The resident baseline
is recaptured with the still-supported floor CLI. Before artifact upload,
`scripts/sanitize-captures.mjs` refuses private keys and credential fields
without reflecting their values in logs, redacts token patterns and normalizes
runner paths. Upload depends on successful sanitization. The author inspects
all artifact files before committing them and records their provenance.

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
| Resident documentation-envelope matching | All 17 runtime outcome cases remain, compared against explicit JSON envelope fixtures; only the documentation wording guard was removed. |

`kernel-module-boundary.test.mjs` remains unchanged: it enforces an actual
package/kernel import boundary. Native BYOT tests compare consumed fields,
not every key aw may add to its answer.
