# aw output fixtures for `oats aweb resident create`

Every file here is aw output **captured verbatim from a real aw run**, by
`capture.sh` in this directory. None is written by hand or derived from aw's
source. Each `<name>.stdout`, `<name>.stderr` and `<name>.exit` is one run.

- **aw:** 1.36.33, commit `877bbee94ce45aa1ff103912bc9850556e61dfb4`
  (`aw-version.txt`; the npm release on this host).
- **Stack:** aweb's local stack, `docker-compose.e2e.yml` (postgres, redis,
  awid 0.5.23, OSS aweb server) at aweb `1d7ee6bb3519a3c940ebeb12afc86d921dc13e27`.
- **Captured:** 2026-10-10 (`captured-at.txt`).

These fixtures drive unit tests only. They are **never acceptance evidence**:
acceptance is the joint real-stack E2E against the local aweb Cloud. They are
refreshed with `capture.sh` whenever aw's output contract changes, and this
README is updated with the new version, commit and date.

| Fixture | What produced it |
| --- | --- |
| `init-apikey-workspace-init-404` | `aw init --global --name alice --do-not-touch-agents-md --json` with an API key, in an empty directory. aw saves `.aw/partial-init.yaml`, registers the DID at the real awid, then posts to `/api/v1/workspaces/init`. That endpoint is aweb Cloud's, so the OSS server answers 404, and aw keeps the partial and says to rerun. |
| `init-apikey-registry-mismatch` | The same command in the same directory with a different `AWID_REGISTRY_URL`: aw's partial-init context check refuses (exit 2). |
| `doctor-identity-offline-partial` | `aw doctor identity --offline --json` in that directory. There is no identity, so every check is `info`, yet the overall `status` is `ok`. |
| `init-apikey-rejected` | The API-key init in a directory holding a quarantined partial (`.aw/partial-init.yaml.<time>.<n>.rejected`). Only aweb Cloud makes aw quarantine a partial, so `capture.sh` creates an empty file with the name aw gives one; aw's refusal of it, before any network call, is real (exit 2). |
| `init-apikey-registry-local` | The API-key init with `AWID_REGISTRY_URL=local`: aw refuses before it writes anything (exit 2) and the directory stays empty. |
| `init-apikey-bad-url` | The API-key init with a malformed `AWEB_URL` (`not a url`): aw saves the partial, registers at awid, then fails to post (exit 1) and says to rerun. |
| `init-certificate-connect` | A complete global identity made the way aweb's own real-stack e2e makes one (`aw id create --skip-dns-verify`, team create, add-member, fetch-cert), then connected with aw's certificate `aw init --do-not-touch-agents-md --json`. It prints the same `connectOutput` JSON as the API-key init (`cmd/aw/init_connect.go`). |
| `whoami`, `doctor-identity-offline`, `doctor-registry-online` | `aw whoami --json`, `aw doctor identity --offline --json` and `aw doctor registry --online --json` in that complete identity's directory. |
| `custody-status-not-running`, `custody-status-running` | `aw custody status --json` there, before and while `aw custody serve` runs. |

Not captured here: aweb Cloud's answers (a successful API-key init, a
quarantined `.rejected` partial, a refusal for a customer-held team). The OSS
stack cannot produce them, and they are proven only in the joint E2E.
