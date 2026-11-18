# Environment of aw children

`lib/aw-child-env.mjs` owns the selector list for oats.aweb. Every aw child
uses `awChildEnv`: it copies its base environment, removes
`AWEB_IDENTITY_HOME`, `AWEB_URL`, `AWEB_API_KEY`, `AWEB_ROLE_NAME`, `AWEB_ROLE`
and `AWID_REGISTRY_URL`, then applies only the call's named explicit inputs.
It sets `AW_NO_UPDATE_CHECK=1`. An existing stricter base stays stricter.

An ordinary spawn, launch, retire, roster or readiness read takes identity
and service from its selected aw home or explicit argv. Exporting a selector
does not redirect it. Record a service with the native `aw workspace
connect` procedure in that home; record a registry through aw's identity/team
setup. These commands never infer a new destination from the caller's key.

Deliberate inputs:

- The hook's custody verification passes the grant home as
  `AWEB_IDENTITY_HOME` explicitly.
- Setup's API-key `aw init --do-not-touch-agents-md` passes `AWEB_URL` and
  `AWEB_API_KEY` and `AWID_REGISTRY_URL` by name. Username signup
  passes `AWEB_URL` and `AWID_REGISTRY_URL` explicitly, never an API key.
  Each input reaches that init only; later membership reads use the shared scrub.
  Setup create/join still reads the documented
  `AWEB_URL` to choose its explicit `--service`/`--url` arguments. The
  messages asking for the server's public URL still apply.
- Resident create keeps its PATH/HOME-only base. Its init explicitly passes
  `AWEB_URL`, `AWEB_API_KEY` and optional `AWID_REGISTRY_URL`; its subsequent
  native reads explicitly retain that registry, without URL or key.
- Invite keeps disposable HOME/XDG directories and its existing allowlist.
  Probe keeps its stricter removal of agent, kernel and aw variables.

# AWEB_API_KEY inheritance inventory for oats.aweb 1.42.1

This version-pinned inventory supports the aw rc4 supplied-key review. In
oats.aweb 1.42.1 the hook's `run` passed the ambient key to all of these, except the default-team
`init --join-from` mint (which already removed it). Calls through
`--identity-home` used the same runner and inherited it too.

| Surface | Native commands |
| --- | --- |
| Delivery | `wake status`, `wake register`, `wake deregister` (including the asynchronous child) |
| Grants | `custody status`, `id grant mint`, `id grant list`, `id grant show`, `id grant revoke` |
| Retained seats | `workspace connect`, `check --online`, `workspace status`, `whoami`, `heartbeat` |
| Team reads and joins | `team list`, `team invite`, `team invite inspect`, `id team list`, `id team accept-invite`, `workspace connect` |
| Cleanup and roster | `workspace delete`, `id team members`, `workspace status` |
| Setup/connect | `whoami`, `id team create`, `id team show-server`, `id team register`, `id team set-server`, `id team invite`, API-key `init` |
| Binding/readiness | `version` and `runAw` children (custody/grant/wake reads, `mail inbox --help`); the version reader removed only the ambient identity home |
| Host wake status | `wake status --json` |

The hook's version reader shares binding's reader. Username signup and setup
join's membership read already removed the key. Invite, resident native reads,
health and probe already withheld it; resident init and setup API-key init
deliberately received it. The shared scrub preserves those deliberate init inputs and removes ambient
inheritance elsewhere. The independently materialized
oats.aweb-tasks capability is handled separately, with a parity test for the
same selector list.

`test/aw-child-env.test.mjs` runs real provider entrypoints against a recording
aw double in disposable homes. It covers retire's service, all six selectors,
binding's version and readiness children, health, wake status and setup's
explicit inputs. No live deployment or tmux server is used. Real-service
journeys remain CI's responsibility; this double records process environment,
not remote service behavior.
