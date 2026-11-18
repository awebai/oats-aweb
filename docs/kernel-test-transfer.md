# Provider assertions transferred from the kernel

Source audit: kernel `3a5503c2993a307a0bb48d0b41dcab7d175adc27`, package base
`f3f5e0227a6ee173d7ee69d608ebbde616884dd2`. The kernel's four version-named
files call provider binaries directly; these assertions belong here. Each
row below resolves the corresponding source test. Test titles identify the
replacement independently of line shifts.

The kernel suites must remain until the tests are merged, released and
present in the kernel's pinned mirror, and K1's kernel retire-hook contract
has merged. K2 owns that gate. Key modes are owned by P1 PR5, including nested
encryption keys, seat.json and pending-mint; this PR does not duplicate that
fix or imply it has landed.

## hook-1-10: 17 source tests

| Source line | Disposition and package test |
| --- | --- |
| 145 | Already covered: hook-1-13 `normal global grants use the 1.13 concrete default scopes and preflight custody before mint`. |
| 165 | Already covered: hook-1-13 `grant attachment verification failures revoke the grant, remove the home, and fail spawn`. |
| 177 | Already covered: hook-1-13 `launch renewal mints into a fresh grant home, emits the new locator, and revokes the old grant`. |
| 192 | Superseded by hook-1-13 `readiness checks the recorded final grant locator, never newest directory`; current broker evidence is also required, so the older unconditional ready expectation is obsolete. |
| 209 | Transferred to the real minted disposable grant's missing-socket check in resident-journey `printed steps, no default team: the command sets it, and the spawn line alone previews and scaffolds a seat` and its two variants. No externally supplied grant home. |
| 222 | Already covered by 1-18 `session keeps its meaning: every runtime is registered with the broker, no channel flag` and retire tests; transferred the remaining fallback assertion to `an unrecognized delivery setting uses the channel route for Claude`. |
| 255 | Already covered by 1-18 runtime transition and preview cases, including `a start that cannot leave exactly one path is refused`. |
| 292 | Already covered by 1-17-4 `a mint killed at the timeout after the accept reports the identity for compensation` and deadline/intent tests. The old test never ran kernel compensation itself. |
| 304 | Transferred to 1-17-4 `retire recovers an alias missing from meta from the workspace binding`. |
| 317 | Already covered by 1-17-4 `a retire whose alias stays held names the remedy plainly, and so does its retry` and `retire retry after successful self-delete does not call the revoked certificate again`. The old arbitrary fake reason wording is superseded by current native reason handling. |
| 341 | Already covered by 1-17-4 `an alias that still holds a certificate names the remedy, with no meta and no output leak` and killed-mint-240 refusal intent cleanup. |
| 356 | Already covered by oats-aweb `spawn accepts a 64-character alias and rejects 65 before aw` and 1-17-4 single-init argv test. |
| 389 | Transferred non-mode assertions to retained-seat-killed-spawn-228 `retained authority closure, copy exclusions, command sequence and lock do not depend on a spawner PID`. Ownership/takeover/source-preserving retire already covered by retained-seat-lock-227/-236 and restart-226. Copied-key modes remain P1 PR5's required transfer. Workspace.yaml is freshly written by real connect, so the current assertion proves the old binding's source-only content was not copied. |
| 439 | Transferred to retained-seat-killed-spawn-228 `retained rollback restores source binding and removes copied authority after a status pointing elsewhere`. |
| 457 | Transferred to the same suite's `...after a whoami with another DID`. |
| 469 | Already covered by retained-seat-restart-226 `a retained seat's spawn records its identity as local, and every start answers its identity home`, plus 1-14 retained retirement. |
| 484 | Transferred to retained-seat-killed-spawn-228 `...after wake registration refused after connect`. |

## hook-1-12: 11 source tests

| Source line | Disposition and package test |
| --- | --- |
| 126 | Already covered by 1-17-4 `spawn output is pinned byte for byte for the same inputs` and 1-18 channel runtime tests. |
| 141 | Transferred to hook-1-13 `global spawn refuses missing resident name before mint` and `global spawn refuses unresolved resident before mint`. |
| 156 | Transferred to hook-1-13 `global spawn refuses retained source in global mode before mint`. |
| 167 | Transferred to hook-1-13 `legacy grant receipt preserves explicit scopes, finite TTL, metadata and native wake/mint tuples`. |
| 193 | Transferred the additional metadata/cwd/env assertions to hook-1-13 `a wrong minted team preserves compensation metadata and revokes from custody without the caller identity`. |
| 209 | Transferred to hook-1-13 `global post-mint wake-register failure revokes, removes the grant home and returns compensation metadata`. It also checks the fake server's actual revoked state. |
| 223 | Transferred to hook-1-13 `mint with grant.yaml and no JSON recovers the grant id; revoke failure=false`. |
| 237 | Transferred to the same suite's `...revoke failure=true`, preserving compensation metadata, the current removal policy and the truthful live-grant remedy. This test does not introduce a new removal policy. |
| 250 | Transferred to hook-1-13 `global retire uses custody, clears the caller identity, deregisters the wake and handles a missing grant id`. |
| 267 | Transferred and extended by hook-1-13 `retire rechecks an uncertain revoke and reports show status revoked` and `...active`. The active answer must fail and never report identityRevoked. |
| 281 | Missing-id assertion transferred with the documented `nothing-to-delete` vocabulary already merged in oats-aweb#273 (098fdb77), not the old incorrect `nothing-to-revoke` expectation. Finite/never failure and expiry/remedy already covered by never-grant `retire: a never-grant that was not revoked stays valid, says how to revoke it, and a retry can`. K1 separately owns the kernel's documented retire-answer contract. |

## hook-1-12-1: 9 source tests

| Source line | Disposition and package test |
| --- | --- |
| 115 | Transferred to oats-aweb `primary spawn uses roots[team] before root/workspace and mints from the new home`. |
| 144 | Transferred to oats-aweb `an explicitly selected empty root never falls back to a working workspace root`. |
| 167 | Already covered: oats-aweb `authority discovery does not walk above the workspace`. |
| 191 | Already covered: 1-14 `1.14 refuses classic OATS environments consistently`. |
| 205 | Already covered by current oats-aweb setup and setup-team-roots behavior cases. Old menu sentences are prose; current username/API-key/invite acts supersede that exact old help tuple. |
| 224 | Ready read-only broker behavior already covered by workspace-readiness-wire `binding-less workspace readiness check follows settings roots, team labels and read-only custody` and captured-removed-242 readiness. The current oats-aweb `no-team readiness and spawn refuse without kernel default` pins one actionable no-team result; the old two-error ordering is superseded. |
| 254 | Transferred to 1-15 `an unmapped default is refused by spawn and binding without consulting root membership`. |
| 277 | Transferred the paired runtime assertion to 1-15 `removed settings.team is refused by both spawn and binding before any native effect`. |
| 298 | Already covered by setup-team-roots, setup-invite-56 and 1-21 invite argument/refusal cases; current setup paths supersede the old argument prose. |

## hook-1-13: 19 source tests

All entries use package `test/oats-aweb-hook-1-13.test.mjs` unless noted.

| Source line | Disposition and package test title |
| --- | --- |
| 164 | Already covered: `normal global grants use the 1.13 concrete default scopes and preflight custody before mint`. |
| 185 | Already covered: `reviewer profile narrows defaults, explicit scopes win, and unknown profiles are fatal`. |
| 207 | Already covered: `custody preflight fails closed with typed status/error and serve remedy before mint`. |
| 219 | Already covered: `custody preflight requires team grant-status endpoint when reported, allows absent readiness, and requires certificate`. |
| 242 | Already covered and enabled in CI: `real aw at the floor: custody preflight reports needs-configuration instead of faking a pass`; explicit Claude runtime reaches custody without a broker. |
| 260 | Transferred: real minted missing-socket check in resident-journey, as hook-1-10:209 above. |
| 271 | Already covered: `custody preflight requires e2ee operations by default; identity.e2ee false needs signing only and briefs a warning`. |
| 287 | Already covered: `single aw floor refuses older aw before grant mint and always passes --team`. |
| 305 | Already covered: `grant attachment verification failures revoke the grant, remove the home, and fail spawn`. |
| 326 | Already covered: `global grant spawn refuses a preflight without socket_path before mint`. |
| 337 | Already covered: `grant subject alias from grant.yaml wins over mint output, with resident fallback only when both are absent`. |
| 352 | Superseded: `readiness checks the recorded final grant locator, never newest directory` also requires current broker evidence. |
| 372 | Already covered: `launch with renewal off preserves the existing grant locator and session delivery env`. |
| 386 | Already covered: `local-mode launch with renew=launch still preserves delivery launch contributions`. |
| 398 | Already covered: `launch renewal mints into a fresh grant home, emits the new locator, and revokes the old grant`. |
| 416 | Already covered: `launch renewal keeps the old grant and locator when mint fails`. |
| 432 | Already covered: `launch renewal keeps the old grant when attachment verification or preflight socket fails`. |
| 461 | Already covered: `launch renewal reports old revoke failure truthfully but keeps the new grant`. |
| 474 | Already covered: `retire revokes the current grant id and removes every .aweb-identity directory`; additional cwd/env/wake assertions transferred separately. |
