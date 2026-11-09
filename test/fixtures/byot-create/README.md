# aw output fixtures for `oats aweb setup --create <label> --namespace <domain>`

Two kinds of file live here, and they are kept apart.

## Captured: real aw runs (this directory)

Every `<name>.stdout`, `<name>.stderr` and `<name>.exit` here is one run of a
**real aw binary**, written by `capture.sh` in this directory. None was
written by hand.

- **aw:** 1.36.56, commit `4d5eafdcc9118cfb8204740fa70a0d48acfd18e4`
  (`aw-version.txt`), the npm release `@awebai/aw-darwin-arm64@1.36.56`.
- **Captured:** `captured-at.txt`.
- **Offline.** `capture.sh` runs aw with a throwaway `HOME`, no namespace
  controller key, and `AWID_REGISTRY_URL=http://127.0.0.1:9` (nothing listens
  there). No namespace, registry or aweb service was used.
- **One scrub:** the invite token in `invite-team-key.stdout` is replaced with
  `SCRUBBED-INVITE-TOKEN`. aw printed a real local invite token there (154
  characters on this run) for a team key that existed only in the throwaway
  `HOME`.

| Fixture | What produced it |
| --- | --- |
| `help-create`, `help-invite`, `help-accept-invite`, `help-register` | `aw id team <command> --help`: the flags setup passes must exist. |
| `create-no-controller-key` | `aw id team create --name=eng --namespace=example.invalid --json` with no `~/.awid/controllers/example.invalid.key`: aw's usage refusal (exit 2) before any network call. |
| `invite-team-key` | `aw id team invite --team=eng --namespace=example.invalid --json` with a generated team key at `~/.awid/team-keys/example.invalid/eng.key` and no identity in the working directory. This is the native local invite setup mints after create. It is fully local, and its JSON is `{invite_id, status, token}`: no `team_id` and no `expires_at`. |
| `invite-team-key.records` | What that invite left in `~/.config/aw/team-invites/`: one `<invite-id>.json` per invite. aw keeps the invite's secret in that file (its fields are `created_at, domain, identity_scope, invite_id, secret, team_name`) until it is accepted. |
| `invite-no-team-key` | The same invite for a team whose key is not on this machine: `no team key for D/N` (exit 2). |
| `register-unreachable` | `aw id team register --service=http://127.0.0.1:9/api --team=eng:example.invalid --json` with the team key present: aw first looks the team up at the registry, which is unreachable (exit 1). |
| `accept-invite-unreachable` | That invite's token piped to `aw id team accept-invite --token-stdin --name=fixture --local --json` in `.aweb-roots/eng`: aw registers the new certificate at the registry, which is unreachable (exit 1). `accept-invite-unreachable.files` lists what it left in the root: a `.aw/signing.key` and no `identity.yaml`. A second accept into that root with a fresh invite is not refused; it reaches the registry again. |

Refresh with `test/fixtures/byot-create/capture.sh <path-to-aw>` whenever aw's
output for these commands changes, then update this README.

## `source-derived/`: shapes read from aw's source, not run

These need a registry that answers, so they cannot be captured offline. Each
one is written from aweb's source at tag `aw-v1.36.56` (`e3a1d9f`), which is
the source of the binary above. They are the shape aw prints, not a run of it:

| Fixture | Source |
| --- | --- |
| `create-created` | `teamCreateOutput` (`cli/go/cmd/aw/id_team.go:29-35`), printed by `runTeamCreate` (`id_team.go:735-742`): `status, team_id, team_did_key, team_key_path, registry_url`, and no invite token. The key and path values are placeholders. |
| `create-team-pinned` | `ensureLocalTeamRegistered` (`id_team.go:4147`): the registry answers 409, `GetTeam` succeeds, and the team's key is not the one on this machine: `team <domain>/<name> is already pinned to <did:key>`. A plain error, so `--json` prints code `error` (`awid/error_detail.go:26`, `cmd/aw/errors.go:122-147`), exit 1. The did:key is a placeholder. |
| `create-team-registry-409` | The same function when `GetTeam` fails after the 409: `create team at registry: <RegistryError>`, whose text is `registry http 409: <body>` (`awid/registry_client.go:26-31,689-694`). awid's body is `{"detail":"Team already exists"}` (`awid/src/awid_service/routes/teams.py:580`). A registry refusal, so `--json` prints code `http_error` with `http_status` and `detail` (`awid/error_detail.go:27-31`), exit 1. |

A re-run of `aw id team create` for a team whose key IS on this machine is not
a conflict: the same function succeeds and prints `create-created` again. That
is how a re-run of setup resumes.

These fixtures drive unit tests only. They are not live evidence: no part of
setup's create, register, accept, connect or `aw init --join-from` has run here
against a registry or an aweb service.
