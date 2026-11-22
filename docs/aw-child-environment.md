# Environment of aw children

`lib/aw-child-env.mjs` owns the selector list for oats.aweb. Every aw child
uses `awChildEnv`: it copies its base environment, removes
`AWEB_IDENTITY_HOME`, `AWEB_URL`, `AWEB_API_KEY`, `AWEB_ROLE_NAME`, `AWEB_ROLE`
and `AWID_REGISTRY_URL`, then applies only the call's named explicit inputs.
It sets `AW_NO_UPDATE_CHECK=1`. An existing stricter base stays stricter.
An explicit input unset in the caller is passed as `undefined`, which Node's
spawn drops; an absent operator input therefore means aw's own default.

An ordinary command takes its identity and service from the selected aw home
or explicit argv. The only registry admission source is the operator's
host-only `settings.oats.aweb.registry`, recorded by `oats aweb setup
--registry <origin>`. Neither an ambient registry nor a saved aw URL is
promoted to admission. Absent configuration means aw's own default/recorded
selection and public-address policy.

Retirement must still clean up captured effects when a launch-only
`claudeChannelMode` value is invalid. Registry admission is validated before
retire cleanup: an invalid setting means nothing is cleaned. Fix the origin
with `oats aweb setup --registry <origin>`, then retry `oats retire <instance>`.

`registry-setting.mjs` validates this one origin and identifies registry-capable
commands. Only the known value-taking global `--identity-home` is skipped; an
unknown leading flag retains the pin rather than hiding the command. The hook,
binding, invite, health, resident and qualified probe use it. Known version/help
invocations, recorded team lists, custody status and wake control receive no pin. `doctor identity --offline` does receive it: rc.3 assesses the current
private-registry admission from that environment without using the network. Init/mint, joins/connect and rollback, cleanup, grants,
registry member reads, messaging and health online reads receive the explicit
`AWID_REGISTRY_URL`. LOCAL and GLOBAL session contributions use that same
setting. Custody and wake service units receive it for their own invocation;
changing configuration requires their documented restart procedures.

Setup still supplies the documented AWEB_URL and API key to init only;
username signup receives its URL but no key. Bare API-key setup refuses before
init when an existing selected root belongs to another team or its membership
cannot be read. Create and tokenless join check their selected target rather
than unrelated default membership. A missing alias or service may use the
existing default-root locator fallback; explicit values bypass those reads.
All registry inputs, including
BYOT create's admin calls and subsequent online calls, come from the setting.
Resident init keeps its PATH/HOME-only base plus its named URL/key and the
configured pin. Offline identity diagnosis retains the stricter base plus that same explicit
pin; local custody status and version retain it without the pin.
Invite keeps disposable HOME/XDG directories; the probe keeps its stricter
scrub and existing service qualification. Custody attachment verification
alone names its grant home as AWEB_IDENTITY_HOME.

The self-hosting setup card in README documents accepted forms, private
registry admission, migration errors, service restarts and wake conflicts.
The rc.3 audit found init preserved arbitrary prefixes while reads accepted
only origins and /api aliases. OATS deliberately accepts origins only and
explicitly refuses /api with the remedy to supply its equivalent bare origin.
No URL containing credentials is echoed.

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
oats.aweb-tasks capability carries its own internal helper with the same
selector list. A parity test holds the lists equal and imports the tasks
capability in isolation; no import crosses materialized capabilities. Its
native wake-status read also removes OATS selectors before the shared scrub.

`test/aw-child-env.test.mjs` runs real provider entrypoints against a recording
aw double in disposable homes. It covers retire's service, all six selectors,
binding's version and readiness children, health, wake status and setup's
explicit inputs. No live deployment or tmux server is used. Real-service
journeys remain CI's responsibility; this double records process environment,
not remote service behavior.

`test/aw-child-env-native.test.mjs` runs the real retire hook and an explicitly
selected real aw against two loopback origins. With all six ambient selectors
exported, only the home's origin receives the signed DELETE; it returns a
fixture failure so no real service state is deleted. CI requires this test
on the tested-aw leg without skips. The real-stack journey must also pass
before merge to prove registry discovery for spawned/joined homes.
