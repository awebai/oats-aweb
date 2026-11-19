# aw output fixtures for `oats aweb resident create`

The root-level data files are native aw output refreshed by `capture.sh` in
the disposable CI stack, then sanitized. Each `<name>.stdout`, `<name>.stderr`
and `<name>.exit` is one command; `identity-global.yaml` is the public identity
record from that same run. No signing key or identity directory is copied.

- **aw:** 1.36.33, commit `877bbee94ce45aa1ff103912bc9850556e61dfb4`.
- **Captured:** 2026-11-19T01:47:58Z (`captured-at.txt`).
- **Artifact:** `aw-captures-1.36.33`, ID `14491051131`, `resident/` subtree.

Captured on 2026-11-19 in [CI run 44439390779](https://github.com/awebai/oats-aweb/actions/runs/44439390779), from
package branch `f978ed929d0eb0a21e55b7f8770b5b143e2eca45` and PR merge
`df85234e7ca74a01d0e16a9b6f1db2d7e3d75f78` (main `66d02dc1` plus that branch).
The disposable stack was aweb `679d50066d4160748f6f9cfa0537161992399573`;
the kernel was OATS `13f8f133808f5932bf461108703c1bada4b3f3d3`.
Both the floor and tested stack groups passed. Their artifacts were inspected
before committing; they contain public wire data, no credentials or private keys.
The sanitizer redacts credential patterns and normalizes runner paths. Disposable
public IDs, timestamps, field omissions and newly emitted fields are preserved.

These fixtures drive unit tests; OSS observations do not prove hosted acceptance.
Refresh them with `capture.sh` when aw's output contract changes and update this
receipt. The historical `cloud/` preview captures below were not refreshed.

| Fixture | What produced it |
| --- | --- |
| `init-apikey-workspace-init-404` | `aw init --global --name alice --do-not-touch-agents-md --json` with an API key, in an empty directory. aw saves `.aw/partial-init.yaml`, registers the DID at the real awid, then posts to `/api/v1/workspaces/init`. That endpoint is aweb Cloud's, so the OSS server answers 404, and aw keeps the partial and says to rerun. |
| `init-apikey-registry-mismatch` | The same command in the same directory with a different `AWID_REGISTRY_URL`: aw's partial-init context check refuses (exit 2). |
| `doctor-identity-offline-partial` | `aw doctor identity --offline --json` in that directory. There is no identity, so every check is `info`, yet the overall `status` is `ok`. |
| `init-apikey-rejected` | The API-key init in a directory holding a quarantined partial (`.aw/partial-init.yaml.<time>.<n>.rejected`). aw's refusal (exit 2, `refuseRejectedAPIKeyPartialInit`, before any network call) is real. The quarantine file is not: aw makes one only when aweb answers with a different identity than it registered (`init_apikey.go:182-197`), which no honest server does, so `capture.sh` creates an empty file with the name aw gives one. |
| `init-apikey-registry-local` | The API-key init with `AWID_REGISTRY_URL=local`: aw refuses before it writes anything (exit 2) and the directory stays empty. |
| `init-apikey-bad-url` | The API-key init with a malformed `AWEB_URL` (`not a url`): aw saves the partial, registers at awid, then fails to post (exit 1) and says to rerun. |
| `init-certificate-connect` | A complete global identity made the way aweb's own real-stack e2e makes one (`aw id create --skip-dns-verify`, team create, add-member, fetch-cert), then connected with aw's certificate `aw init --do-not-touch-agents-md --json`. It prints the same `connectOutput` JSON as the API-key init (`cmd/aw/init_connect.go`). |
| `whoami`, `doctor-identity-offline`, `doctor-registry-online` | `aw whoami --json`, `aw doctor identity --offline --json` and `aw doctor registry --online --json` in that complete identity's directory. |
| `custody-status-not-running`, `custody-status-running` | `aw custody status --json` there, before and while `aw custody serve` runs. |
| `identity-global.yaml` | The public `.aw/identity.yaml` written by this run's complete global identity. Its `registry_url` is the disposable stack's private awid, `http://127.0.0.1:18010`. `resident-seat-registry.test.mjs` changes only that line for its default-registry/no-registry vectors. |

## `cloud/`: aweb Cloud's local preview stack

`cloud/` holds aw 1.36.33 (`877bbee94ce45aa1ff103912bc9850556e61dfb4`) runs
against aweb Cloud's **local preview stack** (never production), captured
2026-10-10 by aweb in its chat walkthrough. Source: "local Cloud preview, aweb
chat walkthrough"; `cloud/SOURCE.md` is aweb's own account of how each file was
made and scrubbed. The files are copied unchanged. Their argv was
`aw init --global --name <name> --human-name "<name>" --awid-registry <url>
--do-not-touch-agents-md --json`. The command's argv is
`aw init --global --name <name> --do-not-touch-agents-md --json`, with the
registry from `AWID_REGISTRY_URL`; the output contract is the same.

| Fixture | Used for |
| --- | --- |
| `1-init-global-resident1.json` | the hosted API-key init's success: the command's answer check accepts it |
| `1-aw-file-list-resident1.txt`, `2-partial-init.yaml` | the trees a success and a run killed after registration leave: the preflight reads them as adopt and continue |
| `3-refusal-different-name.txt`, `3-refusal-resume-after-name-taken.txt` | aw's refusals that keep the partial (a different `--name`, exit 2; a name taken since, aweb's 409): passed through verbatim |
| `4-custody-status-resident1.json`, `5a-*`, `5b-*` | evidence only: scrubbing made the custody status invalid JSON, and the doctors are text, so the unit tests read the local-stack captures above; both doctors and the custody are ok, and offline identity is the same with and without `AWID_REGISTRY_URL` |

Not captured anywhere: the different-identity answer that makes aw quarantine
a partial, which no honest stack gives (the joint E2E's included), and a
refusal for a customer-held team, whose aw preflight is not released yet; the
joint E2E covers it once it is.
