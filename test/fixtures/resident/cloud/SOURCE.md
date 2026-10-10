# abqy.3 captures — aw 1.36.33 (877bbee94ce45aa1ff103912bc9850556e61dfb4), 2026-10-10

Produced on the local preview stack only (never production):
- Cloud preview 61311534 = main 186dbf0d + e0f437b3 + 1d006f2e + frontend 46221948, `make local-container`
  (api http://localhost:18001, local awid http://localhost:28910, namespace juan.dev.aweb.test).
- Published aw 1.36.33 from npm `@awebai/aw@1.36.33` in a disposable prefix.
- Each identity in its own fresh directory under /private/tmp/chatwalk/abqy3/<id>/{home,cwd}, run with
  `env -i` + PATH, HOME, AW_CONFIG_PATH, XDG_CONFIG_HOME pointing at that directory, and
  AWID_REGISTRY_URL=http://localhost:28910 (no inherited AW_/AWEB_/AWID_ variables).
- API key: a hosted custodial identity's key from the local team `juan` on this stack (never shown).

Scrubbing: every key, token, signing material and private key is replaced by `<redacted>` (field names kept).
did:key values and sha256 key ids are also redacted. did:aw stable ids, addresses and paths are shown.

## 1. Successful global init
- `1-init-global-resident1.json` — `aw init --global --name resident1 --human-name "Resident One"
  --awid-registry http://localhost:28910 --do-not-touch-agents-md --json` (AWEB_URL + AWEB_API_KEY), exit 0.
- `1-aw-file-list-resident1.txt` — `.aw` names only. NOTE: listed while `aw custody serve` was running, so
  `.aw/run/custody.sock` is present; immediately after init `run/` did not exist yet.
- `1-home-config-file-list-resident1.txt` — HOME/.config names only.
- Observed request order (api + awid access logs): aw POST awid /v1/did (registration) -> GET /v1/did/{did:aw}/full
  -> POST /api/v1/workspaces/init (server registers address + issues team certificate) -> POST /api/v1/connect
  -> PUT /api/v1/agents/me/encryption-key (+ awid encryption-key). No aweb API call precedes the registration.

## 2. partial-init.yaml from a run killed after registry registration, before workspace init completed
- `2-partial-init.yaml`.
- Method: paused the local api container (`docker pause`), started `aw init --global --name resident2 ...`;
  awid logged `POST /v1/did 200` + `GET /v1/did/{did:aw}/full 200` at 17:32:31Z; aw then blocked on
  POST /api/v1/workspaces/init; aw was SIGKILLed at 17:32:32Z and the api unpaused. The api log shows the
  workspace init was never processed. `.aw/` then contained only `partial-init.yaml`.
- Note: the partial holds the private signing key (`signing_key_b64`, redacted here) in a 0600 file.

## 3. *.rejected partial — NOT PRODUCED
I could not make aw 1.36.33 produce a `*.rejected` file on this stack. Tried (both realistic, no file tampering):
- (a) Re-run in the resident2 directory with a different name (`--name resident2b`): exit 2, refusal text in
  `3-refusal-different-name.txt`; the partial was kept as-is, no `.rejected`.
- (b) Partial for resident3 (killed as in 2), then a different identity completed init as `resident3`
  (name taken), then the original command was re-run: server 409 on POST /api/v1/workspaces/init, refusal text
  in `3-refusal-resume-after-name-taken.txt`; the partial was kept, no `.rejected`. aw advises
  "rerun the same command ... do not delete .aw/partial-init.yaml" although the conflict is permanent.
- The aw binary contains the strings `.rejected` and `*.rejected` (near the init/connect strings), but I did not
  find which condition triggers it; I did not guess further or fabricate one.

## 4. `aw custody status --json` for a running global resident
- `4-custody-status-resident1.json` — `aw custody serve` running for resident1 (same home), status exit 0.

## 5. Doctors for that resident
- `5a-doctor-identity-offline-resident1.txt` — `aw doctor identity --offline`, exit 0.
- `5a-doctor-identity-offline-resident1-no-AWID_REGISTRY_URL.txt` — same without AWID_REGISTRY_URL in the
  environment: still ok, registry_url_source "Explicit awid registry URL is available" (a global identity
  persists its registry in .aw/identity.yaml).
- `5b-doctor-registry-online-resident1.txt` — `aw doctor registry --online` (against local awid), exit 0.
