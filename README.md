# oats-aweb

Official [OATS](https://github.com/awebai/oats) messaging and tasks integrations for
[aweb](https://aweb.ai). It provides per-instance native identities, mail/chat
skills, team roster discovery and session/channel delivery integration. Messaging
is separate from durable task tracking; the selected tasks provider owns tasks.

## aw-compat.json: the aw this provider supports

`oats-package/capabilities/oats-aweb/aw-compat.json` states which aw releases
this oats.aweb supports, in two fields:

```json
{
  "min": "1.36.33",
  "tested": "1.36.58"
}
```

- **`min`** is the client floor every path is held to: spawn, the commands, the
  hooks, the probe and a grant seat's custody refuse an older aw ("aw floor"
  below).
- **`tested`** is the highest aw the CI journeys pass on. CI's resident-journey
  matrix runs exactly `min` and `tested`, each checked to be the aw it
  installed. Above `tested`, on a server other than the aweb Cloud, readiness
  and spawn warn `aw-newer-than-tested`.

Each value is an exact semver version, never a range, and `min` is never above
`tested`. `lib/aw-floor.mjs` reads the file beside it, so the copy of the
capability in a home reads its own, and exports the two values as `AW_MIN` and
`AW_TESTED`. The module fails to load, naming the file, when the file is
missing or breaks these rules. No other oats.aweb code holds either value;
oats.aweb-tasks, copied into a home on its own, keeps its own `AW_MIN`, and a
test holds it equal to `min`.

The file is public. OATS's getting-started skill reads it at the oats.aweb ref
the OATS catalog pins, never at `main`, to install the tested aw for a
customer-run aweb server. Its path and its two keys stay as they are, and any
change to a field is release-noted.

## Human attribution

A deployment can opt in to human attribution: every instance a person
spawns into the deployment's protected teams then carries a chain to that
human, and the protected service admits it. It takes one endorsed root per
deployment, one approval by the human, and the protected service's operator
binding the root.

1. The service's operator provides the protected profile (a public file that
   pins the service's origins, registry and keys) and binds the root.
2. The setup expert runs, in the deployment:

   ```sh
   oats aweb setup --endorse-root --new-root --name <alias> --human <did:aw> \
     --protected-profile <abs> --service <url> [--label "<the human's name>"] [--teams <label,…>]
   ```

   - `<alias>`: the new root's name, 1-64 letters, digits, `-` or `_`;
   - `<did:aw>`: the human's own `did:aw`, the one who approves;
   - `<abs>`: the absolute, normalized path of the protected profile the
     service's operator provided;
   - `<url>`: the aweb service the protected teams use.

   Setup creates the root (a registered agent identity, under
   `D/.aweb-endorsed-root/<alias>`, owner-only), then stops at
   `requester-unbound` until the operator binds it. The rerun after the
   binding prints the approval link, its digest and fingerprint, the teams
   and their bounds. Under `--json` it answers `E_ENDORSE_NOT_APPROVED`,
   `state: pending`, with the link at once, and a rerun resumes the same
   operation. Only the human's or the service's final no (`human_refused`,
   `subject_ineligible`, `operation_expired`, `approval_expired`) is
   `state: refused`, and the rerun starts a new operation; any other answer
   aw doesn't map, or none, is `state: unknown`, and the rerun resumes the
   same one. Once the human approves, setup records
   `settings.oats.aweb.attribution` in `oats-local.yaml`, last.
3. From then on, each spawn into those teams creates a key-only identity,
   has the root (or a chained spawner) issue its chain, and has the root
   admit it with the protected service. Each start checks the chain with
   `aw who`; status rows show the human's label as `attributedHuman`.

`--protected-profile` takes the profile's absolute path as written, with no
`.` or `..` segment and no repeated or trailing `/`; any other form refuses
`E_ATTRIBUTION_SETTING` (`problem: profile-path`) before any effect, and setup
never rewrites it. `--label` is the human's display name in status rows; without it, rows show
the human's did:aw. A rerun of the same command after success refreshes the
recorded policy and adds newly mapped teams the policy lists, all or nothing.
A deployment that never opts in is unchanged.

## Human attribution: opting in

What opting in means, as the endorse output says it:

- Custody: the root's agent key is readable by every instance of this
  deployment (the same OS user), within its bounds: it can admit agents only
  within this root's own admission bounds.
- Outages: spawns into the protected teams stop while the protected service's
  or the identity registry's evidence is unavailable.
- Existing instances keep their identities, unattributed: respawn to attribute
  them.
- One approval: the human approves this root once, at its link; later spawns
  need no approval.
- Revocation: if the human revokes this root, new spawns refuse
  E_ATTRIBUTION_REVOKED; the path out is in the README, "Human attribution:
  revocation".
- BYOT: a deployment whose user can reach team or controller keys
  (~/.awid/team-keys, ~/.awid/controllers), which today is every existing BYOT
  deployment, can't opt in until aweb's package 8 migrates those keys; that's
  a known precondition, not a bug.
- Residents: opting in means no new residents until aweb's custody update
  lands (aweb-acxy.18): resident create and resident certify refuse here;
  existing residents are unchanged.
- Membership doesn't imply attribution: a genuinely chainless spawner's child
  is still admitted by the root, but carries no chain.

The deployment label aw requires is derived, never a flag:
`<short host name>:<basename of D>` (the basename alone with no host name).
It is sent to the protected service and shown on the approval page, so the
host and directory names reach the service's operator. It is recorded with
the endorsement's operation, so a rerun of that operation sends the same
label.

## Human attribution: revocation

When the human revokes the endorsed root, or its chain is revoked or replaced,
every new spawn refuses `E_ATTRIBUTION_REVOKED`, before any key: each spawn
reads the root's own verdict, whoever spawns it, a chainless spawner included. Each refusal gives this
section's first step, then the second as setup's whole command, each
placeholder as "Human attribution" says. The whole path is:

1. Remove `settings.oats.aweb.attribution` from this deployment's
   `oats-local.yaml`.
2. Create a new root with
   `oats aweb setup --endorse-root --new-root --name <alias> --human <did:aw> --protected-profile <abs> --service <url>`.
   It stops at `requester-unbound`.
3. The protected service's operator binds the new root (bind-root).
4. Then rerun the same setup, which endorses the new root.

Step 3 is aweb's request-binding act (`bind-root`, with `--replace-root <old
root>` for a replacement), which the aw this release pins serves. With an aw
that doesn't serve it, a new root needs the protected service's operator to
bind it, and that step isn't available yet, so this deployment can't spawn
into its protected teams until it is: no working path exists, and the
refusal names no other fix.

- Removing the setting alone is no fix: a spawn into a protected team would
  then take the legacy invite and refuse `E_PROTECTED_ADMISSION_REQUIRED`.
- Re-endorsing the same root is outside v1.
- A home already running keeps its identity and its memberships. Its next
  start runs `aw who`, records it unattributed and warns
  `attribution-revoked`. Until then its status row still names the human:
  restart, or respawn, to clear the name.

## Human attribution: admission refusals

At spawn, the endorsed root admits each new identity into its protected
team, under the operation id persisted in the new home
(`.oats-aweb/admission-<team-label>.json`). A spawn refusal carries its code,
its first sentence and this section; the full texts are here.

- `E_ADMISSION_LIMIT` (aw `admission_limit_reached`): the team is at its
  policy's bounds (`max_active`, `max_per_window` per `rate_window_seconds`).
  The refusal gives those bounds and OATS's count of live homes holding a
  committed admission for the team, labelled "OATS's count, not the
  server's": the server reports no count. Wait for the rate window, retire
  idle instances (a retire removes its memberships through the root), or
  change the policy. With an aw that doesn't serve `team.agent.remove`,
  retiring an instance frees no slot, and the refusal says so.
- `E_ADMISSION_REFUSED`, with aw's code as `details.code`:
  - `admission_policy_missing`: this team is not in the deployment's
    admission policy, and this aweb release can't add a team to it: the
    policy stays as provisioned. Once aweb serves
    `team.admission-policy.change`, the team's owner approves adding it, and
    then the operator runs bind-root for this root and the team.
  - `scope_refused`, `profile_scope_refused`, `profile_scope_ambiguous`: the
    team is in the policy, but this root most likely isn't bound for that
    team's controller, for example a team added after the operator bound the
    root. Ask the protected service's operator to run bind-root for this
    root (its did:aw is in the refusal) and the team. Rerunning bind-root
    with an added team leaves the root's other grants unchanged.
  - `policy_changed`: the team's admission policy changed since the
    endorsement. Rerun `oats aweb setup --endorse-root` to refresh it, then
    rerun the spawn, which starts a new attempt.
  - `subject_ineligible`, `operation_expired` and `approval_expired`: the
    protected service's final refusal, with its code.
  - `operation_conflict`: aw sent this operation id with other inputs, and
    never sends it again. Rerun the spawn, which starts a new operation.
- `E_ADMISSION_UNKNOWN`: the admission's outcome is unknown. Only the codes
  above refuse: every other code aw answers (for example
  `receipt_unavailable`, `prepare_unconfirmed`, which aw gives even for a
  committed receipt, `execute_answer_lost`, an HTTP 429 or 5xx, or a code aw
  adds later), or no code at all, leaves it unknown. The spawn retries once
  with the same operation id; the refusal then names the operation id and the
  team, and the home is kept. Retire it once the service answers: the retire
  resumes the admission with the same operation id, which never charges
  twice. A committed one is then removed with the rest of the home's
  memberships, and one still unknown keeps the home again. Only the
  operation's own final codes (`admission_policy_missing`, `policy_changed`,
  `admission_limit_reached`, `subject_ineligible`, `operation_expired`,
  `approval_expired`) record it refused, which needs nothing more. A refusal
  of the root's request itself (a scope code, `signed_request_invalid`,
  `authority_changed`, `operation_conflict` or `operation_mismatch`) says
  nothing of the operation, so the home is kept: fix the root, then retire
  again. An unknown admission whose `--certificate-out` file holds the
  admitted certificate (its team and member key) committed, and is kept as
  committed even while the root can't act.
- Once an admission committed, nothing undoes it: a rerun of a spawn's or a
  join's admission whose `--certificate-out` file holds its certificate
  resumes from it with no second admit, and a refusal of a retry leaves it
  committed, for its leave or retire to remove.
- `E_ATTRIBUTION_EXCHANGE` with `step: install`: the admitted certificate
  couldn't be installed in the new home, or its id isn't aw's form. Respawn.
  A code aw doesn't list is never retried.
- `E_ATTRIBUTION_EVIDENCE`: registry evidence was unavailable (for example
  install-cert's `registry_unavailable`). Retry the spawn: spawns stop while
  evidence is unavailable.
- `E_ATTRIBUTION_EXCHANGE` with `step: connect`: check that the aweb service
  at the recorded URL is reachable; if the URL itself is wrong, rerun
  `oats aweb setup --endorse-root --service <the correct url>`.
- `E_ATTRIBUTION_EXCHANGE` with `step: lock`: another command of this home
  is acting on the same team label (a spawn, join, leave or retire holds its
  admission lock, `.oats-aweb/admission-<label>.lock`). Rerun once it ends.
  If no oats aweb command runs as the pid it names, remove that file (the
  refusal names it within the home): a lock
  whose process has ended is taken over by the next command anyway.

## Human attribution: retire and reconciliation

A retire removes each membership an opted-in home holds, right after it
deletes the home's workspace: the server authenticates that delete with the
membership's certificate, which the removal revokes. Before either, it resumes
an admission whose outcome is unknown, so an outcome OATS can still learn
keeps the home with nothing deleted. A joined identity's workspace can't be
deleted through aw on a team outside aweb's hosted zone: retire says so, and
that record stays at the service until it goes stale. A joined identity
that never connected (a join killed after its key, refused, or whose install
or connect failed) has no workspace: a leave or retire deletes it locally,
with no workspace delete, and the root still removes any membership it holds.
"Never connected" means no `workspace.yaml` in the joined identity's home: one
that connected and then lost that file is deleted the same way, and its
workspace at the service goes stale.
The root removes a
membership through the protected service
(`aw id team remove-agent`, from the root's home, with the root's copy of the
certificate under `D/.aweb-endorsed-root/<alias>/admissions/`). The removal's
operation id is kept in the home (`.oats-aweb/removal-<team-label>.json`), so
a retry never sends a second one, and a confirmed removal deletes the root's
copy. A retire kept by an unconfirmed removal never sends the workspace
delete again: the rerun only removes. A retained seat deletes no workspace of
its own: its retire removes the memberships it joined before it releases the
seat, and an unconfirmed removal keeps the seat and its lock.

On an admitted team in aweb's hosted zone (`aweb.ai` and its subdomains), aw's
workspace delete is hosted self-retirement: the service would revoke the
membership itself, a second removal beside the root's. So there retire, the
rollback of a failed spawn and `oats aweb leave` send no workspace delete, for
the primary identity or a joined one: the root's removal is the only act, and
the workspace record stays until it goes stale. Retire answers
`aliasReusable: false`, `aliasReason: hosted-workspace-kept`, whether or not
the removal was confirmed, and says the workspace was left to go stale; a
rerun only removes.

What a retire says when it can't remove a membership:

- An unconfirmed removal (an unknown or lost receipt, HTTP 429 or 5xx, or no
  code) keeps the home: retire it again once the service answers.
- `admission-removal-unavailable`: the service's server answered 404, 405 or
  501 to `team.agent.remove`, so it may not serve removal yet. Its operator
  upgrades the server; then run `oats aweb setup --reconcile-admissions`. With
  an aw that doesn't serve the act, retiring an instance frees no admission
  slot.
- `admission-removal-blocked`, with a `reason`: the root can't act. The
  membership and the root's copy are kept, and the home goes.
  - `root-home-missing`, `root-home-unsafe`, `profile-changed` or
    `service-refused`: fix the root, then run
    `oats aweb setup --reconcile-admissions`.
  - `root-revoked`: no OATS path removes this membership in v1. It counts
    only in the revoked root's bucket, never in the new root's.
  - `root-copy-missing`: no certificate for this membership is left, so OATS
    can't remove it. A missing copy is first written again from the home's own
    certificate when that is the one admitted: admit's `--certificate-out`
    file, else the certificate aw installed in the home's identity.
- While an unknown admission's resume can't run for a reason that can be
  fixed (`root-home-unsafe`, `profile-changed`, `service-refused`), the home is
  kept: fix the root, then retire again, which resumes the admission.

A home's own `oats aweb join` and `leave` follow the same rules. A join
issues the joined identity's chain from this home and has the root admit it,
never through a member invite; a team outside `attribution.teams` refuses
`E_ENDORSE_POLICY` (`unlisted`), and a join that fails after its key exists
keeps the joined identity for the rerun, which reuses its key and chain.
A home's commands run with the settings it captured at spawn, so a join reads
the deployment's live setting (`oats inspect --soul`, as the legacy join reads
its current root) for what `setup --endorse-root`'s refresh rewrites: the
teams and the endorsement's policy. A team mapped and added after the home's
spawn is joined without a respawn, under the current policy; a pending
admission's rerun still sends its recorded policy and operation. Everything
else (the root, the human, the service, the profile and its digest, the
endorsement's operation) must equal the home's captured setting: a live
setting that differs, or has no attribution, refuses `E_ATTRIBUTION_SETTING`
(`setting-diverged`, naming the key) before any protected call → respawn this
home to use the current setting. Live settings that can't be read refuse
`setting-unreadable`, naming the `oats inspect` read to repair. A leave, like
retire, start and readiness, keeps the captured setting. A
leave removes the membership through the root, then deletes the joined
identity, its workspace record left to go stale as at retire: an unknown admission or
an unconfirmed removal keeps it for the rerun, and a root that can't act
keeps the membership with `admission-removal-blocked`, its record kept for
the home's retire and `--reconcile-admissions`. While another command
holds a label's admission lock, a leave of it refuses `step: lock`, and a
retire acts on nothing, exits nonzero and keeps the home
(`admission-locked`), naming the rerun. A retire holds the lock of every
label the home could act on, from before its first effect to its exit, so a
join or leave started during it refuses `step: lock`; a join or leave holds
its labels' locks for its whole command the same way. A joined team the root
admitted that is no longer eligible stays joined at the next start, with a
warning: a start makes no protected call, so retire (or a leave once the team
is eligible again) removes it through the root. A joined team admitted
before the opt-in leaves as before.

`oats aweb setup --check-only --json` reports, with the setting, an
`attribution` block: the root, human, service and teams; whether the root
verifies (`verified`); spawners with no chain; each team's bounds and OATS's
own count of admitted live homes; `leakedMemberships` (active local
certificates whose alias has no live or kept home here); the key scan's
findings, with the legacy minting roots (the configured `root` and
`roots`, the deployment's own `.aw` and each `.aweb-roots/<label>/.aw`)
listed as package 8 inventory by their public id (`legacy-minting-root`:
left untouched, never refused on: an opted-in deployment needs none, and
readiness asks for no messaging root there); and `limits`, what the pinned aw doesn't
serve yet. Leaks come from
the team's member list, read through a home that holds a membership (aw signs
that read with a member's key), and from the root's own copies under
`admissions/`, which need no reader: a membership the root admitted counts
as leaked once no home here holds its certificate (one a leave set aside
counts as leaked while its home lives). The list is the registry's, unsigned:
a row is only acted on through the root's copy of its certificate, and a
certificate a home holds is never leaked, whatever alias the list gives it.
The root's copies are read once, before the homes are listed and their records
read: the kernel lists a spawning home from its first record, and a home
records its admission before the admit and the copy only after it, so a spawn
or join that commits while reconciliation runs is never taken for a leak.
A record is what says which memberships are its home's, so a live home's
admission record, or its `.oats-aweb` directory, that can't be read, or a
record that isn't one of the state table's (no state it has, no team, no
label or another than its file's, a committed record naming no certificate
id, a certificate id that isn't aw's
form or an empty `--certificate-out`, a pending or unknown record with no
alias), is never read as none: check-only lists every team under `unreadableTeams` with that
record's path, and reconciliation refuses `E_ATTRIBUTION_EVIDENCE`, plan
included, until it is readable again (owner-only) or restored. Every other
command reads a home's records the same way, `E_ATTRIBUTION_EVIDENCE` with
problem `records-unreadable`, naming the record, before any effect: a retire
keeps the home (`records-unreadable`) and a leave or a join's rerun refuses
before it acts on any label it names, each until the record is readable again
or restored; a start, never blocked,
keeps that joined team and warns.
With a protected profile that fails its checks (its mode, or bytes that no
longer match setup's digest), check-only makes no call that relies on it and
says so under `attribution.problem`. A team no home here can read is
listed under `unreadableTeams`, and only its copies are known there, never
as having no other leaks.

`oats aweb setup --reconcile-admissions [--plan]` removes the leaked
memberships the root holds a copy for, each removal's operation id kept
under the root's `removals/`. `--plan` lists them first and removes nothing. A
leaked membership with no copy (admitted before the root kept copies) is
reported and never removed.

Home readiness, with the setting, warns `attribution-revoked`,
`attribution-unverified`, `attribution-spawner-unchained`, `admission-leaked`
(the home holds an admission whose outcome is unknown),
`admission-removal-unavailable` and `protected-key-reachable`.

## Human attribution: a deployment that never opted in

Once aweb's operator has protected a team, a deployment that never opted in
can no longer mint into it with the member invite: the service answers HTTP
403 `protected_admission_required`, and the spawn refuses
`E_PROTECTED_ADMISSION_REQUIRED`, for the primary team or a team the spawn
joins. The invite is never retried and nothing is reminted; readiness reports
nothing for it.

The fix is to opt in, as "Human attribution" above describes:
`oats aweb setup --endorse-root --new-root --name <alias> --human <did:aw> --protected-profile <abs> --service <url>`,
each placeholder as that section says. An operator who has no human ID yet gets one first, by enrolling a passkey at
the protected service. Any other 403 is reported as before.

## 1.42.1 — the release OATS pins for 1.42

Requires OATS >=0.68.0; the aw floor stays >=1.36.33 and the tested aw is
1.36.58. 1.42.0's changes, with a comment fixed so OATS's mirror check
accepts the package.

## 1.42.0 — retained seats are safer, and captured execution is removed

Requires OATS >=0.68.0; the aw floor stays >=1.36.33 and the tested aw is
1.36.58. A retained seat's lock is taken atomically, and a lock held on
another host refuses with its release. A killed or failed spawn never deletes
the standing identity's workspace. A seat reads its aweb service only from
its own `workspace.yaml` `aweb_url`: `OATS_AWEB_URL` is no longer read for
it. The captured-execution variables are ignored, with one warning each.
Boolean settings accept `"true"`/`"false"` and refuse anything else.

## 1.41.0 — an interrupted join is settled, and roster marks retired certificates

Requires OATS >=0.68.0; the aw floor stays >=1.36.33 and the tested aw is
1.36.58. A join killed after aw accepted its invite is written ahead as
`pendingJoins` in the home's `.oats-aweb/teams.json`: the next `oats aweb
join`, `leave` or retire finishes or releases it, and a start warns. `oats
aweb roster` marks a certificate a retire on this host left in a team whose
controller key people hold, with the command its controller removes it with.
Readiness names a `refused` wake stream with aw's cause and next attempt.

## 1.40.0 — a broker-delivered home needs a running broker

Requires OATS >=0.68.0; the aw floor stays >=1.36.33 and the tested aw is
1.36.58. `oats spawn` and every start refuse a home the host wake broker
delivers to (Codex, or `delivery: session`) while no broker runs, with
`wake-daemon-not-running` and how to start it on that host. Claude and pi
homes under channel delivery never ask.

## 1.39.1 — tested aw 1.36.58

Requires OATS >=0.68.0; the aw floor stays >=1.36.33, and the tested aw is
1.36.58, published in `aw-compat.json` (above). With aw 1.36.58 a refused
wake stream reads `refused` and is retried; readiness reports it as
`wake-stream-unavailable`. Its broker lock is an OS file lock: stop an older
broker before the new one starts, which `oats aweb wake install` does.

## 1.39.0 — bring-your-own-team setup completes

Requires OATS >=0.68.0; the aw floor stays >=1.36.33, and the tested aw is
1.36.56, published in `aw-compat.json` (above). `oats aweb setup --create
<label> --namespace <domain>` now creates, registers, publishes and verifies
the team-server record, and records a per-team root. Re-running the same
command resumes a partial create. `--name` names that root's identity. The
route needs aw 1.36.53 or later and refuses an older aw up front, with nothing
created. A taken team name stops it; a completed create names where the team
key is ("Supported acts" below).

## 1.38.0 — pi 0.5.0 without the skills filter

Requires OATS >=0.68.0; the aw floor stays >=1.36.33 and the tested aw 1.36.53.
@awebai/pi 0.5.0 bundles no skills, so a pi home no longer needs the
`"skills": []` filter on its extension entry once 0.5.0 or later is installed
in its pi folder: `pi-extension-skills-loaded` now warns only below 0.5.0 or
when the version can't be read. The aweb skills now ship on their own as
@awebai/claude-skills; a home gets its skills from its capabilities, so the new
warning `pi-skills-package-loaded` fires when its pi folder lists that package
unfiltered ("The pi extension without its skills" below).

## 1.37.0 — claim floors for aweb tasks

Requires OATS >=0.68.0; the aw floor stays >=1.36.33 and the tested aw 1.36.53.
A home that composes oats.aweb-tasks warns when whatever keeps its task claims
present is too old: the host wake daemon below aw 1.36.54
(`wake-daemon-outdated`), the aweb-channel plugin below 1.8.2
(`aweb-channel-outdated`) or the aweb pi extension below 0.4.1
(`pi-extension-outdated`). They are warnings, not refusals, and messaging-only
homes get none ("Claim floors" below). While npm's `latest` aw is 1.36.53,
install aw by version: `npm install -g @awebai/aw@1.36.54`, then
`oats aweb wake install`. On macOS that rerun now reloads the broker
(bootout, then bootstrap) so launchd runs the new aw; a running custody job
is reloaded by hand (CHANGELOG, 1.37.0, "Known issue").

## 1.36.0 — setup from one pasted invite

Requires OATS >=0.68.0; the aw floor stays >=1.36.33 and the tested aw 1.36.53.
`oats aweb setup --soul <soul> --invite-stdin --name <alias>`, without `--join`,
joins a team from the invite alone: aw 1.36.53 reads its team and service
without redeeming it, the label comes from the team's name, and every refusal
comes before anything is redeemed. `oats aweb invite --json` answers that
command beside the token, at `result.joinCommand`. Every invite acceptance
now reads the token on stdin, never an argv. A refused `oats aweb join` and a
failed `aw team invite` name their cause and fix, and new team roots go beside
the default team's root.

## 1.35.0 — one tasks team for every deployment; pi without bundled skills

Requires OATS >=0.68.0; the aw floor stays >=1.36.33 and the tested aw 1.36.53.
oats.aweb-tasks gains `team: <label>`, the aweb team whose task list every
deployment shares, set only in the workspace's or a soul's `tasks:` payload
(`committedOnly`, enforced by kernels with `settings-committed-only`), and a
readiness check that refuses a home that has not joined it. The pi extension is
installed with its bundled skills filtered out, and readiness warns
`pi-extension-skills-loaded` where it still loads them. A joined team that has
become the default is kept until the home is respawned.

## 1.34.0 — messaging only; aweb tasks by opt-in

Requires OATS >=0.68.0; the aw floor stays >=1.36.33 and the tested aw 1.36.53.
oats.aweb teaches messaging only: nothing it puts into a home names the task
layer, `aw task`, `aw work`, `aw lock` or `aw roles`. oats.aweb-tasks teaches
them, and composing it is how a home opts into aweb tasks; its inject and skill
open with the workspace's opt-in. The inject gives the whole messaging loop.

## 1.33.3 — tested with aw 1.36.53

Requires OATS >=0.68.0; the aw floor stays >=1.36.33, and the tested aw moves to
1.36.53, npm's `latest`. A resident create whose API key is refused can be rerun:
aw 1.36.53 mints nothing on that refusal, and the rerun runs aw again. The
unread-count warning follows whether health publishes now, inside readiness's
time budget, and the alias-conflict refusal names its remedy plainly.

## 1.33.2 — a warning when aw is newer than its server

Requires OATS >=0.68.0; the aw floor stays >=1.36.33. Off the aweb Cloud,
readiness and spawn warn (`aw-newer-than-tested`) when the host's aw is newer
than the provider is tested with, naming the server's upgrade first. A mint
that aw refuses with `unknown_or_invalid` names that likely cause instead of
only "output withheld".

## 1.33.1 — invites on a workspace set up without a sign-in

Requires OATS >=0.68.0; the aw floor stays >=1.36.33. `oats aweb invite`
works on a workspace that `oats aweb setup --username` created, and its JSON
answer names the service to hand on (`awebUrl`). An aw pre-release above the
floor now passes the provider's version checks.

## 1.33.0 — a workspace without a browser sign-in

Requires OATS >=0.68.0; the aw floor stays >=1.36.33. `oats aweb setup
--username` creates the account and team without a sign-in, and setup's
`aw init` no longer writes aw's rules into `AGENTS.md` or `CLAUDE.md`.
`/oats-aweb` says how the person then attaches themselves to the account
with `aw claim-human`: the setup expert runs it with the address they give,
and the account is theirs once they click the link aw mails them. The
CHANGELOG has the rest, and how to remove rules an earlier setup wrote.

## 1.32.0 — upgrade a stopped seat

Requires OATS >=0.68.0; the aw floor stays >=1.36.33. Upgrade the kernel
first, then select and sync the package version in the workspace.

A stopped seat moves to the locked package with `oats instance upgrade`:
stop it, inspect `oats instance upgrade <instance> --plan`, then apply with
the returned plan revision and an idempotency key. Start it again with
`oats session start`. Upgrade preserves the identity, grant, seat and joined
teams. It makes no `aw` calls: the next start re-registers the wake broker
and renews grants according to the seat's settings. With `identity.renew: off`,
that start keeps the existing grant and its expiry.

The hook adopts metadata from local, global grant and retained seats,
including 1.17.1. Plan is read-only; apply refreshes only delivery from settings
and runtime from the home's recorded `instance.json` harness. An unreadable or
unsupported harness keeps the recorded runtime and warns. Recorded
`claudeChannelMode` stays unchanged until a launch can prove it. A plan that
cannot recognize the metadata names the respawn remedy.

The tasks capability also declares stateless adoption: every plan adopts and
apply passes its supplied metadata through, defaulting absent or empty metadata
to `{}`, without home reads or `aw` calls. A seat composing messaging and tasks
moves both modules together.

## Tasks

One `oats.aweb` package release supplies two independently selected capabilities:

| Capability | Slot | Responsibility |
| --- | --- | --- |
| `oats.aweb` | messaging | identities, mail/chat, roster and receive delivery |
| `oats.aweb-tasks` | tasks | assignment, claims, status, blockers and handoff |

To opt an existing workspace into aweb tasks, pin the package and select both
slots in `oats-workspace.yaml`, then run `oats sync`:

```yaml
packages:
  oats.aweb: v1.31.0
defaults:
  messaging: { oats.aweb: { from: package } }
  tasks: { oats.aweb-tasks: { from: package } }
```

Selection without a catalog alias is verified on OATS 0.67.1 and main
`593255d9`. Once `oats.aweb` is pinned and synced, its exported
`oats.aweb-tasks` resolves through the lock. Scratch spawn previews select both
capabilities without `E_SLOT_CONFLICT`.

A soul can instead select `oats.aweb-tasks: { from: package }` in its
`capabilities:` map. Its `tasks:` key is a provider payload (or `none`), not a
capability selection. Replace the workspace's existing tasks selection; each
soul has at most one tasks provider. Messaging and tasks occupy different slots.

Tasks use the instance's own messaging identity in its default team. For an
already joined team, use its explicit identity home as taught by
[/aweb-tasks](oats-package/capabilities/oats-aweb-tasks/skills/aweb-tasks/SKILL.md).
The tasks capability creates no identities or memberships. Its spawn hook emits
an advisory brief and makes no reads or aw calls. Before using tasks, the
agent checks `aw whoami`; if that fails, it reports the failure to its human and
does not use tasks. Conversation stays with the messaging provider.

#### One team's task list: `team`

`team: <label>` names the aweb team whose task list oats.aweb-tasks reads and
writes, so that every deployment of a workspace can share one list:

```yaml
# oats-workspace.yaml, or a soul's soul.yaml
tasks: { team: shared }
```

- **Where it is set.** `team` belongs in the workspace's or a soul's `tasks:`
  payload, never in a deployment's `oats-local.yaml` or with
  `oats spawn --provider`. The manifest marks it `committedOnly`, and the
  kernel owns that rule: a kernel that lists `settings-committed-only` in
  `oats version --json` refuses `team` from `oats-local.yaml` and from
  `--provider` (`E_WORKSPACE_SCHEMA`, reason `committed-only-key`). An earlier
  kernel ignores the flag. Either way the provider has no origin check of its
  own, and `team` belongs in the workspace's or a soul's `tasks:`.
- **Absent** (the default): the home's default team, exactly as before. The
  brief is unchanged byte for byte, and readiness adds one passing item with no
  team warning (a home can still get a claim-floor warning, below). The inject and skill say "the tasks team", which is the default team
  when `team` is absent.
- **A label** follows oats.aweb's rule: a letter or digit, then up to 63
  letters, digits, `-` or `_`. Anything else is refused: the brief tells the
  agent not to use tasks and the spawn warns, and readiness answers
  `team-invalid`, naming what is wrong with the value.
- **The identity that acts in it** is the joined team's identity home, read
  from oats.aweb's own record and never built from the label: from the
  instance home, `oats aweb teams --json`, `joined[].identityHome` where
  `label` is the setting. Every task and work command runs as
  `aw --identity-home <identityHome> task|work …`. The brief names the label,
  and the inject's and skill's "Tasks team" block teaches the lookup. A label
  that is not joined is reported and the agent stops: it never falls back to
  the default team.
- **The default team's own label** needs no join: plain `aw task …` is right,
  and the brief and readiness say so.

**Readiness** (`oats readiness`) refuses a home whose identity cannot act in
the team:

| Code | Subject | Meaning |
| --- | --- | --- |
| `team-not-joined` | home | the home has not joined the label |
| `team-not-eligible` | home or soul | the label is not one of its teams, so it cannot join it |
| `team-global-seat` | home or soul | a GLOBAL seat cannot join teams until #60 |
| `team-invalid` | home or soul | the value is not a team label |
| `team-unverified` | home or soul | `oats aweb teams --json` (home) or the kernel's teams (soul) could not be read; never ready |

Each refusal names both remedies: join the team with
`oats aweb join --labels <label>`, run from the home (a GLOBAL seat cannot,
until #60), or set `tasks: none` for that soul. A soul whose label is eligible
reads ready with the warning `team-join-at-spawn`: its homes must join it
(oats.aweb `join=<label>` at spawn). The default team's label reads ready with
`team-is-default`. For a home, the check runs `oats aweb teams --json` from the
home through the kernel that runs the check (`OATS_CLI_BIN`); whether the seat
is GLOBAL is the kernel's resolved oats.aweb `identity.mode`, read with
`oats inspect --home|--soul … --json`, a soul named by its qualified name from
`OATS_SOUL_ID` so that another soul of the same bare name cannot make it
ambiguous. An unreadable mode is never taken as GLOBAL, nor as ready: a home
gets the not-joined refusal, with its #60 note, and a soul `team-unverified`.
Each call is bounded at 10 s.

The manifest declares `binding` with `normalize`, `bind` and `check` because
the kernel requires all three to name commands. The kernel runs only `check`,
with a workspace context and the readiness action (`oats readiness`). The
captured bindings are gone: `normalize` and `bind`, and a `check` whose input
carries `binding` or `invocation`, answer `provider-not-qualified` with the
reason `captured bindings are not supported since oats.aweb 1.42.0; readiness
takes a workspace context (oats readiness)` (`CAPTURED_UNSUPPORTED` in
`lib/binding-wire.mjs`). Any event run with `OATS_BINDING_FILE`,
`OATS_INVOCATION_CONTEXT_FILE` or `OATS_SOURCE_RECEIPT_FILE` set runs its
normal path and warns `<NAME> is ignored: ` followed by that reason, once per
variable, naming the variable only: a hook in its JSON warning, every other
command on stderr.

#### Claim floors

aweb takes over a task claim whose presence heartbeat has gone stale. Which
component heartbeats a home's claims depends on how it receives, and the
readiness check warns when that component is older than the release that
heartbeats. These are warnings, added beside the team answer whether it is
ready or a refusal; they never refuse. They come from oats.aweb-tasks only:
oats.aweb's readiness and floors are unchanged, and a messaging-only home gets
no new read or warning.

| Code | Home | Floor | Version read from |
| --- | --- | --- | --- |
| `wake-daemon-outdated` | listed in `aw wake status --json` | aw 1.36.54 | the daemon's reported version |
| `aweb-channel-outdated` | Claude (kernel harness), not listed | aweb-channel 1.8.2 | the user-scope `aweb-channel@awebai-marketplace` entry in `<config dir>/plugins/installed_plugins.json`; the config dir is the launch's literal `CLAUDE_CONFIG_DIR`, else `~/.claude` |
| `pi-extension-outdated` | pi (kernel harness), not listed or listed for its joined teams | @awebai/pi 0.4.1 | `<agentDir>/npm/node_modules/@awebai/pi/package.json`; `<agentDir>` is the launch's literal `PI_CODING_AGENT_DIR`, else `~/.pi/agent` |

- **The daemon** warns from oats.aweb's AW_MIN (1.36.33) up to 1.36.54;
  1.36.54-rc.1 warns. oats.aweb registers a home with the broker exactly when
  it needs it, and its readiness then reads the daemon, so below AW_MIN its
  own `wake-daemon-outdated` is the only item. A stale registration oats.aweb
  no longer expects gets neither below AW_MIN. A home the daemon doesn't list
  gets no daemon item. A pi home the daemon lists for its joined teams can get
  both the daemon and the pi warning.
- **Not listed,** the kernel's launched harness alone picks: claude the plugin,
  pi the extension, anything else nothing. A Claude or pi home on
  `delivery: session` that is missing from the broker gets the plugin or
  extension warning too; that is harmless, because oats.aweb's readiness
  reports the missing registration.
- **Nothing is added** for a version or status that can't be read: a daemon
  that is not running or reports no version, which oats.aweb reports where it
  needs the broker; a project-scope install; pi's older global npm location;
  a file reached through a link out of its folder, or one that isn't a
  regular file. Joined teams that only poll have no heartbeat and get nothing.
  A soul gets nothing: the check can't tell whether its delivery is the
  broker.
- **The reads** are the kernel's launch record in the home's `instance.json`
  (`launch.harness`, else `harness`, and `launch.env`; never oats.aweb's
  metadata or files), `aw wake status --json` run from the home without the
  check's own `OATS_*` or an inherited `AWEB_IDENTITY_HOME`, and the one file
  per component above. The aw call is bounded at 10 s, and by what is left of
  25 s after the team reads, so the check stays inside the kernel's 30 s.
- **The upgrade:**
  1. Install aw 1.36.54.
  2. Rerun `oats aweb wake install` to restart the host wake daemon.
  3. Update aweb-channel to 1.8.2 on a Claude host, or @awebai/pi to 0.4.1 on
     a pi host.
  4. Restart the homes.

Provider 1.31.0 requires OATS >=0.52.0 and aw >=1.36.33; the upgrade
release above raises the kernel floor to >=0.68.0.
The task protocol and file flags are verified against aw 1.36.47.

### Developing the tasks capability

The distributed payload lives in `oats-package/`; both capabilities are copied
whole into separate instance modules. Keep hooks self-contained within their
own capability. The manifest validator checks the two exported IDs and their
shared package version and kernel floor. No npm dependencies are needed for
provider tests or validation.

```bash
env -i HOME="$HOME" PATH="$PATH" node --test test/aweb-tasks.test.mjs test/aweb-tasks-skill.test.mjs test/aweb-tasks-team.test.mjs test/aweb-tasks-claim-floors.test.mjs
env -i HOME="$HOME" PATH="$PATH" npm run validate
env -i HOME="$HOME" PATH="$PATH" node scripts/check-aweb-tasks-argv.mjs
```

The argv checker parses the skill and runs only help against aw 1.36.47.

Task coordination is taught only here, in oats.aweb-tasks. Nothing oats.aweb
puts into a home mentions it: its inject, its skills (the vendored aweb skills
included), its readiness phrases, and the briefs and warnings its hooks write.
`test/no-task-coordination.test.mjs` reads the files; the spawn and
grant-seat fixtures check what the hooks write, with the patterns in
`test/helpers/task-coordination-text.mjs`. Teaching that oats.aweb drops moves
here rather than being lost.
`test/aweb-tasks-kernel.test.mjs` is an opt-in real-kernel selection check:
set `OATS_TASKS_KERNEL_ROOT` to the kernel source and
`OATS_TASKS_SCRATCH_ROOT` to a scratch parent, then run that test file. It creates
local bare package/workspace repositories, an isolated HOME and cache, and
previews a soul with both providers. It calls no live service or aw command.
`test/aweb-tasks-team-kernel.test.mjs` takes the same two variables. It gives
`team` through soul payloads, reads `oats readiness --soul` for each case, and
compares an absent `team` with the same package stripped of its check: only the
one passing item differs. On a kernel that lists `settings-committed-only` it
also checks the refusal of `team` from `oats-local.yaml` and `--provider`; it
skips that case on an earlier kernel. `test/aweb-tasks-team.test.mjs` drives the check
against a fake kernel that answers `oats aweb teams --json` and
`oats inspect … --json`, and pins that the inject and skill, minus their "Tasks
team" block and heartbeat paragraph and with their one changed sentence
restored, are byte-identical to the text before the setting.
`test/aweb-tasks-claim-floors.test.mjs` drives the claim floors with a fake
`aw wake status`, fake Claude and pi installs and a fake kernel. Its version
rules live in `lib/version.mjs`, a copy of oats.aweb's `lib/aw-floor.mjs` rules,
since a capability's module is copied into a home on its own. Its AW_MIN is a
copy of oats.aweb's too. The test holds both copies equal to oats.aweb's.

## 1.30.0 — Codex readiness from the kernel's launch record

Readiness now takes a home's runtime from the kernel's recorded launch
(`instance.json` `launch.harness`), not from provider metadata. A home that
launched under Codex therefore needs the host wake broker: a missing Codex
target or primary stream reports `wake-stream-missing`. A malformed
`status.updated_at` from `aw wake status` reports
`wake-status-timestamp-unknown`, no longer `wake-status-stale`. Both floors are
unchanged. See [the changelog](CHANGELOG.md#1300--2026-10-19).

## 1.29.0 — the agent status publisher

`oats aweb health enable | status | disable | publish` publishes a signed
status for every agent of a deployment to aweb once a minute (can it be
reached, why not, who fixes it), which aweb's dashboard shows instead of its
own guess. It is opt-in and host-only: a deployment that never enables it
behaves as before. Publishing needs aw 1.36.38. Both floors are unchanged.
The same opt-in tick flags unread mail with an observed broker error, using an
`oats.aweb` attention claim visible in status and Desktop. It requires runtime
`waiting-on-you` and aw's read-only `mail inbox --count-only`; count errors
preserve claims. Without the tick no such claim appears. Channel-delivery
homes and grant-backed resident seats are outside this observer. Historical
worker errors need consecutive ticks without progress. `health status` reports
its live coverage.

See [docs/health-publisher.md](docs/health-publisher.md) and
[the changelog](CHANGELOG.md#1290--2026-10-16).

## 1.28.0 — the host wake broker as a service

`oats aweb wake install | status | uninstall` installs, reports and removes
the per-user unit (`ai.aweb.wake`) that keeps `aw wake run` going: see
[docs/wake-service.md](docs/wake-service.md). Readiness warns
`claude-channel-mode-default` for a Claude channel home that runs in
development mode because nobody chose it, and checks the broker at soul scope
when the spawn will need it. Both floors are unchanged. See
[the changelog](CHANGELOG.md#1280--2026-10-15).

## 1.27.3 — broker readiness uses a post-status clock

Fixes false `wake-status-stale` / `unavailable` on broker-required homes
(Codex, `delivery: session`, and native-channel homes with joined teams).
Broker timestamps are judged after the status read, with no skew allowance;
invalid and genuinely future timestamps still fail. Both floors are unchanged:
OATS >=0.52.0 and aw >=1.36.33. See [the changelog](CHANGELOG.md#1273--2026-10-14).

## 1.27.2 — etiquette points to `/oats-token-saving`

Instruction text only. The `/oats-aweb` skill's etiquette defers whether to
send, to whom and how long to `/oats-token-saving` (`oats.core` 2.6.0, OATS
0.54.0) and keeps how to send. Both floors are unchanged.

## 1.27.1 — custody unit conflicts and Node paths

`resident create` refuses recognised same-root custody units under another
label, naming the unit and platform retirement steps. Its unit PATH now uses
the kernel's absolute `OATS_NODE_BIN`, with the previous node path as fallback
on older kernels. Both floors are unchanged. Rerun `oats aweb resident create <name>` from the deployment to rewrite an existing unit; see
[the custody unit and upgrade steps](docs/resident-create.md#the-custody-unit).

## 1.27.0 — OATS confirms Claude's development-channel prompt

Requires OATS 0.52.0 or later: upgrade the kernel first, then `oats sync`.
Older kernels stay on oats.aweb 1.26.2.

- **Development mode no longer stops at the prompt.** A Claude home in
  `claudeChannelMode: development` (the default) under `delivery: channel` shows
  Claude's development-channel prompt, and OATS confirms it once at launch.
  `settings.oats.aweb.claudeChannelMode: approved` stops the prompt.
- **`channel-dev-confirmation` states that decision** at spawn apply, start and
  restart, the start preview (`oats launch-config preview`) and readiness.
  Readiness is quiet once the kernel recorded the home's last start as
  `launchPrompts.status: completed`. The spawn preview shows no decision
  statement yet ([oats#912](https://github.com/awebai/oats/issues/912)).
- **`claude-channels-unavailable`** replaces it at readiness when Claude ignored
  the flag (the kernel recorded `flag-ignored`): its launch environment opts out
  of telemetry (`DISABLE_TELEMETRY`, `DO_NOT_TRACK` or
  `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`), or the account or organization
  has no channels. Remove the variable from the launch environment, or use an
  account with channels.
- **The exact-home launch consent recipe is gone** from the skill: the kernel
  no longer reads that key.

## 1.26.2 — a resident's seat is ready without a minting root

- In a deployment that holds only residents (one made by `resident create`,
  for example), a GLOBAL seat no longer reports "no messaging root" at
  readiness. Local mode still needs its minting root, as does a GLOBAL seat
  with no resident configured.

## 1.26.1 — the printed next steps work in a fresh deployment

- **`resident create` maps the team without `--team-label`.** The resident's
  team is mapped under the team's name (`default` for `default:acme.aweb.ai`)
  and becomes the deployment's default team where there is none, so the
  printed spawn line works as printed. An existing default is never changed:
  the command prints `oats teams default <label>` as the first step instead.
  It needs OATS 0.48.0 or later and refuses an older kernel before any effect.
- **A seat verifies at its resident's registry.** A grant seat gets
  `AWID_REGISTRY_URL` from the resident's `.aw/identity.yaml` when that
  registry is not aw's default.
- Details: [docs/resident-create.md](docs/resident-create.md).

## 1.26.0 — one command for a GLOBAL resident

- **`oats aweb resident create <name>`** makes a GLOBAL resident identity in an
  existing hosted team from the aweb dashboard's line:

  ```
  AWEB_API_KEY=<key> AWEB_URL=<url> oats aweb resident create <name> [--dir <deployment>] [--root <dir>] [--team-label <label>] [--plan] [--json]
  ```

  It runs exactly one `aw init --global` in the resident's directory
  (`<deployment>/.aweb-residents/<name>` by default) and verifies the identity.
  It then installs a per-user custody unit, a launchd agent on macOS or a
  systemd --user unit on Linux, that runs `aw custody serve` there, waits for
  that custody to be ready, and records `settings.oats.aweb.residents.<name>`.
  The next step it prints spawns a grant seat on the resident.
- **The key.** It is read from `AWEB_API_KEY`, or, with no key in the
  environment, from a terminal prompt that does not echo. With neither, the
  command refuses at once. It is in the environment of the init run only (built
  from nothing: `PATH`, `HOME`, `AWEB_URL`, the key, `AW_NO_UPDATE_CHECK`, and
  `AWID_REGISTRY_URL` when set), and in no argv, unit, setting, capture or
  output. No flag takes a key.
- **Re-runs.** After a failure, a rerun continues aw's own partial init, so the
  DID is the same. After success, a rerun only verifies. A quarantined partial
  is refused with aw's own message, and R is never deleted.
- **Customer-held (BYOT) teams** are aw's to refuse: its message passes through.
- **One client floor, 1.36.33** (`AW_MIN`). `setup --install-aw` installs
  `^1.36.33` by default.
- The whole contract, every `--json` envelope, the custody unit's controls and
  what CI proves against what only the joint E2E proves:
  [docs/resident-create.md](docs/resident-create.md).

## 1.25.0 — grants that never expire; replies to senders outside the roster

- **New grant seats never expire.** A GLOBAL seat spawned on 1.25.0 gets a
  grant that ends only when it is revoked (oats-aweb#80).
- **One setting keeps a duration:** `identity.ttl`, for example
  `identity: { ttl: 720h }` in the seat's settings (`never`, or a Go duration
  from 60s to 720h). A renewal keeps the seat's duration: the captured
  `identity.ttl`, else the ttl the renewed grant recorded, else 720h for a grant
  minted before 1.25.0, so an existing seat never silently stops expiring.
- **What bounds a grant now:** its scopes, revocation at retire, and revocation
  by the resident's owner. A revoked grant's next request is refused at once;
  an open notification stream ends within about 30 seconds.
- **Host order, before syncing to 1.25.0:** upgrade aw to 1.36.32 or later,
  restart every resident custody service and the host wake daemon, then
  `oats sync`. A running custody or daemon keeps its old code until it restarts.

The rest:

- **One client floor, 1.36.32** (`AW_MIN` in `lib/aw-floor.mjs`). Spawn,
  commands, `setup --check-only`, readiness and the probe refuse an older aw
  with one message naming the installed version, the floor and
  `npm i -g @awebai/aw@latest` (or the exact version). `setup --install-aw`
  installs `^1.36.32` by default. aw 1.36.31 lets an agent reply to a sender
  who is not on its team roster, such as a dashboard human in aweb Cloud's agent
  chat; aw 1.36.32 mints grants that never expire.
- **Every mint states its ttl** (`--ttl=never` or the duration), though aw's own
  default is now never. A minted grant's `expires_at` must answer its request:
  `"never"` or a finite timestamp for a never request (the team or issuing
  certificate may cap it), a finite timestamp for a duration. Anything else
  fails the mint closed: the grant is revoked and nothing is kept. When the
  aweb service refuses a never mint (a server without never-grants answers 422,
  or 404 before the grants endpoint), aw mints nothing: the error shows aw's
  message, nothing is kept and nothing is retried with a duration.
- **Custody ops, probed from `aw custody status --json`.** A never seat needs its
  custody to list `grant_never_ttl.v1`; an E2EE grant seat (the default) needs
  `mail_reply_continuation.v1`, listed beside the E2EE ops. When one is
  missing, readiness and the mint preflight say "required custody operations
  are missing: …; restart the custody on aw 1.36.32 or later (upgrade aw,
  restart the custody service and the wake daemon, then oats sync)". It is an
  op probe, not a version check. A seat with an explicit duration does not need
  the never op; one with `identity.e2ee: false` does not need the reply op and
  cannot send the encrypted reply to a sender outside the roster. When the
  custody status cannot be read, the message says "custody status could not
  be read: …", never that an op is missing.
- **No grant is left unrevoked silently.** Revocation is the only end of a
  never-grant. Every mint is labelled `oats:<instance>:<seat>`, with a random
  seat id kept in `identity.seat` and written to the home
  (`.oats-aweb/seat.json`) before the first mint, so a hook killed after the
  mint still leaves a retire the seat; the custody's grant list is the source of
  truth: every real start and every retire revokes this seat's other active
  grants (at retire, all of them), including one minted before a crash. Other
  labels, including pre-1.25.0 `oats:<instance>`, are never touched. A failed
  revoke names the grant, how long it stays valid ("until revoked", or "until
  <expiry> unless revoked") and `aw id grant revoke <id>` run in the resident's
  custody directory; readiness warns `grant-revoke-pending` from the list, or
  `grant-revoke-unchecked` when it cannot read it. A renewal that fails keeps
  the previous grant and starts on it; only a failed first mint at spawn fails.
  A retire exits nonzero while a grant stays unrevoked or the list cannot be
  read, and lists each grant with its revoke command, as `--force` prints it.
- **`wake-daemon-outdated` is a warning.** A running wake daemon below the floor
  still receives, so readiness reports it with the remedy "upgrade aw, then
  restart the host wake daemon" and goes on to assess the target. A daemon that
  is not running or reports no version is still a problem.
- **`aw-newer-than-tested` is a warning.** When the aw on PATH is above the
  highest aw this provider's CI journeys pass on (`tested` in
  `aw-compat.json`), and
  the home's own team root (or, at spawn, the root of a team it also joins)
  names a service other than the aweb Cloud (an exact
  origin match on `https://app.aweb.ai`), readiness and spawn say so: a server
  on an older aweb may refuse a newer aw, for example at the spawn's identity
  mint. The fix it names first is the server's aweb; pinning the host's aw to
  the tested release only suits a host where no deployment needs a newer one.
  The Cloud never warns, because aw reaches npm `latest` only after the Cloud
  supports it. A mint that aw refuses with its `unknown_or_invalid` error code
  says the same instead of only "output withheld".
- **Grant scopes.** Custody re-reads the source message to reply, so a reply
  needs `mail.read` as well as `mail.send`. The NORMAL grant profile carries
  both; a send-only custom grant fails closed with `grant_scope_denied`.
- **Late replies.** A reply to a human whose key in the original message has
  expired fails by design ("source sender key is missing, expired or invalid;
  ask them to send a new message"): ask them to send a new message.
- **Grant lifetime in readiness.** Readiness reads a grant seat's recorded grant
  and asks neither aw nor custody. A never-grant, the healthy default, gets no
  lifetime diagnostic (readiness has no informational channel; the brief says it
  never expires), and its `"never"` is never read as a date. A grant with a
  duration gets `grant-expiring` (warning) within 7 days of expiry,
  `grant-expired` (problem; messaging unavailable) at or after it, and
  `grant-expiry-unknown` (warning) when no expiry can be read, never a guessed
  one. Each names the instant as recorded and that seat's remedy, from the
  renew mode the grant recorded (`identity.grant.renew`) and the
  `identity.ttl` the seat captured: under `renew: launch`, "restart the seat
  to renew it (`oats session restart --home <home>`)"; for a seat that
  captured an `identity.ttl` duration, "a restart requests another <ttl>
  (…); removing identity.ttl and respawning requests never; team or certificate
  limits still apply"; for a capped never request, "restart the seat to renew
  it up to the team's limit (…)"; under
  `renew: off`, where a restart keeps the grant, "respawn the seat (or set
  `renew: launch` and respawn)". A grant minted before 1.25.0 records no renew
  mode, so its remedy adds "if its identity.renew is off, respawn it instead".
  LOCAL seats get none of these.

## 1.21.0 — connect a deployment on another machine

After `oats server connect` has created the workspace's deployment on another
machine, one command from the local deployment gives that deployment messaging:

```bash
oats aweb connect <server-id> --soul <any soul with messaging> [--install-aw] [--name <alias>] [--json]
```

It runs the host's steps through the kernel's capability route
(`oats aweb … --server <id>`, OATS feature `capability-route`). The steps are:

| Step | What it does |
|---|---|
| `aw` | `oats aweb setup --check-only --json [--install-aw]` on the host: aw, its default team, membership |
| `invite` | `ok` if the host is already a member (nothing minted); else `aw team invite --team-id <team>` from THIS deployment's root for the team |
| `join` | `oats aweb setup --join <label> --invite-stdin --name <alias> [--service <url>]` on the host, the token on stdin |
| `readiness` | a second `--check-only` on the host: `ok` when aw meets the floor and its root is a member |

Statuses are `ok`, `done`, `needs-human` (with `remedy`), `skipped` (`detail`
names the step it waits for) and `failed` (`code`, `detail`). Every runnable
command in a `remedy` is in backticks. With `--json`
the answer is `{schemaVersion: 1, ok: true, result: {server, team: {label,
team}, ready, steps}}`. A `failed` step ends the run with `ok: false`,
`error.code` = that step's code and `error.details.steps` = the steps so far.
Failures: `E_TEAM_NOT_MEMBER` (this deployment cannot invite to the host's
team: join it here first), a kernel route code such as `E_SSH`,
`E_INVITE_FAILED`, `E_JOIN_FAILED`, and the host's `E_AW_INSTALL` /
`E_AW_FLOOR`. `E_INVITE_FAILED` keeps aw's output withheld and names the cause
(the HTTP status and redacted server `detail`, else aw's `--json` error code, an
unreachable service, or that its output held none of these), that nothing was
sent to the host, and the root it ran in with the setting that chose it. A team that is not hosted (a local-controller BYOT team) is
`needs-human` (`E_INVITE_NOT_HOSTED`), because its invites only work on the
machine that minted them. The host root's alias is the server id, or `--name`
when the id is not a valid aweb alias. connect spawns nothing: it mints for the
deployment's root, never for an instance.

The join half works on its own when someone else mints the invite:

- `oats aweb setup --join <label> --invite-stdin` reads the token from stdin
  (the first line, trimmed) and behaves exactly as `--invite <token>`. The two
  flags cannot be combined.
- `oats aweb setup --install-aw [--aw-version <v>]` runs
  `npm install -g @awebai/aw@<v>` (default `^<aw floor>`, today `^1.36.33`)
  where aw is missing or below the floor, re-checks the floor, then continues.
- `oats aweb setup --check-only --json` answers, as one line:

```json
{"aw": {"status": "ok", "version": "1.36.23"},
 "defaultTeam": {"label": "aweb", "team": "aweb:example.aweb.ai"},
 "member": true, "root": "/Users/pat/Agents/aweb/.aweb-roots/aweb"}
```

  `aw.status` is `ok`, `done` (installed now: `detail` says from what),
  `needs-human` (`detail`, `remedy`) or `failed` (`code`, `detail`; exit 1).
  `member` is `null` when aw cannot be asked, and `root` is the root that mints
  for the default team (`roots[team]`, else `root`) when one exists.

**The invite token** exists only in connect's memory and on the routed join's
stdin. It never appears in oats argv, a file, a log, the result or an error
message, and a failed join leaves it nowhere. On the host, `aw id team
accept-invite` takes it as an argument, so it is visible in the host's
process list for the accept call's duration. Its lifetime and use count are aw's: aw
has no expiry or single-use flag for invites yet.

## 1.20.0 — a roster that says what each entry is

`oats aweb roster` lists the union of the team's membership certificates
(`aw id team members`) and its workspaces (`aw workspace status`, the presence
view), one entry per alias, each with its sources, status and kind:

```text
aweb team aweb:example.aweb.ai — 9 entries (membership certificates and workspaces):
  aweb — global identity, active, harbor, example.aweb.ai/aweb [presence]
  pat-operator — human (from its session context), seen 2d ago [presence]
  oats-expert-pat — instance (from its workspace path), active, harbor [certificate, presence]
  builder-aweb — deployment root (from its workspace path), seen 3h ago, builder [certificate, presence]
  idle-reviewer — unknown, certificate only: no workspace record [certificate]
```

- Kinds: `global identity` (from the identity scope, listed first),
  `human` / `hosted agent` (from the session context), `instance` /
  `deployment root` (from the workspace path), else `unknown`. Inferred kinds
  say so. A certificate with no workspace record is reported as that, not as
  retired.
- A certificate that a retire on this host left in a team whose controller key
  is held by people (retire answered `team_not_hosted`) is marked: its line ends
  `; retired by OATS on this host <YYYY-MM-DD>; the team controller removes it
  with: <command>`, and the footer counts those certificates. Only the team's
  controller can remove them, with the printed command. Its `--registry` is
  the one aw uses for that membership: the plain `registry_url` that aw reports
  for it or that the identity's `teams.yaml` records for it. When the
  membership records only its `aweb_url`, aw discovers the registry from that
  service, so the command has no `--registry` and says so. With neither, aw
  uses its default: the registry `AWID_REGISTRY_URL` sets, else none. Retire records them in
  `<deployment>/.oats-aweb/retired-certificates.json` (team, certificate id,
  registry origin and command, never a secret), matched on team and certificate
  id, never on alias. The roster never prints the stored command: it builds the
  command from the entry's team, certificate id and registry, each validated,
  as retire does. An entry it can't be built from shows `; its record entry is
  malformed (<why>), so no command to remove it is shown` (and `--json` gives
  `command: null`, with a `retired-record` problem); one recorded with no
  registry adds `(the registry was not recorded; the command omits --registry)` to
  its command. The record lives on the host where the retire ran: a roster read
  on another host doesn't show those leftovers.
- The record is a claim, not proof, since any agent on the host can write it.
  A marked member whose workspace reads `active` in presence shows `; recorded
  as retired, but its workspace is active: check before removing` instead of
  the mark and the command, and the footer does not count it; `--json` gives
  `command: null` and `conflict: "workspace-active"`, with a `retired-record`
  problem. The record is left as it is. A marked member whose workspace is
  offline, that has none, or whose presence could not be read keeps the mark
  and the command.
- aw does not mark the team's coordinator; the roster says so and points at
  the global identities.
- If a source cannot be read, or presence is past its 200-workspace cap, the
  roster lists what it has and prints `Incomplete: <source>: <why>.`
- `--json`: `{team, members: [{alias, kind, kindFrom, identityScope, address,
  role, status, sources, presence, retired?}], certificatesComplete,
  presenceComplete, problems}`. Status is `active`, `offline`,
  `no-workspace-record` or `presence-unknown`. `retired: {at, instance,
  command, conflict?}` is on marked members only. A record that cannot be read is a
  `problems` entry with source `retired-record`, and nothing from it is shown.

## 1.19.0 — team model 3

Works with OATS 0.36 (team model v2) and OATS 0.38 (team model 3, where the
workspace commits the teams a soul may join and its default, and
`oats-local.yaml` may declare teams only when `oats-workspace.yaml` says
`localTeams: true`).

- `OATS_DEFAULT_TEAM_FROM` may be `workspace` (the workspace's fallback
  default); it is reported as itself in `defaultTeam.from` and named in the
  spawn brief.
- `oats aweb setup --create` asks the kernel (`oats teams --json`,
  `localTeams`) before creating anything. Where local teams are closed it
  creates the aweb team and its per-team root, records no local team, and
  prints what to commit in `oats-workspace.yaml`. `--username` and the setup
  verdicts give the same advice there instead of `oats teams add|default`.
- The unmapped-default remedy names both ways to choose another default.

## 1.17.7 — team model v2 provider

Requires OATS >=0.30.0 and aw >= 1.36.13. This is the provider side of OATS
team model v2 (kernel 0.30): the kernel supplies the default team and eligible
teams, and oats.aweb never reads a provider `team` setting or the root's active
team as a fallback.

### Fixed

- Native retire writes a local completion marker after the default workspace is
  self-deleted, so a later retire retry after another hook kept the home does
  not call `aw workspace delete` again with an already-revoked certificate.

### Changed (breaking)

- Removed `settings.oats.aweb.team` and legacy `OATS_TEAM_ID` /
  `OATS_TEAM_LABEL(S)` semantics.
- The default comes from `OATS_DEFAULT_TEAM` (label), `OATS_DEFAULT_TEAM_ID`
  (provider id) and `OATS_DEFAULT_TEAM_FROM` (`deployment`, `soul`, or, from
  OATS 0.38, `workspace`).
- `OATS_TEAMS` rows are exactly `{ label, team, default, from }`; eligible join
  targets are rows with `default: false`.
- The teams JSON field `defaultTeam` is `{ label, team, from } | null`; `oats aweb teams --json` emits it with
  `eligible`, `joined`, `left`, and `at`. `left[]` records visible live-read
  leaves (`reason: "no-longer-eligible"`, last 20).
- No default configured refuses readiness/spawn with
  `no teams configured: run \`oats aweb setup\``. An unmapped default has label
  + from but no id and refuses with
  ``the default team <label> has no provider id yet: its owner runs oats aweb setup, then commits the id, or choose another default: `oats teams default <label>`, or `defaultTeam:` in oats-workspace.yaml when the workspace doesn't allow local teams``.

Wider teams are still joined explicitly with `settings.oats.aweb.join` at spawn
or `oats aweb join` while live.

### Provider settings

Host-owned settings live under `settings.oats.aweb` (normally in
`oats-local.yaml`). The boolean settings, `identity.e2ee`,
`identity.takeOver` and `health.publish`, accept `true` and `false` and also
the strings `"true"` and `"false"`, which is what `oats spawn --provider
oats.aweb key=value` passes. `null`, which an empty YAML value (`e2ee:`)
is, reads as unset, so the default applies. Any other value (another string,
the empty one included, or a number) is refused before anything is done: by spawn, start and readiness
alike for the `identity` ones (retire reads neither), and wherever
`health.publish` is read. The refusal names the setting, the accepted values
and where to set it. The provider settings are:

- `delivery`: `channel` (default) or `session`. It picks the delivery path per
  runtime:

  | runtime | `channel` | `session` |
  |---|---|---|
  | Claude Code | the `aweb-channel` plugin (launch flag) | host wake broker |
  | pi | the `@awebai/pi` extension, without its skills ([below](#the-pi-extension-without-its-skills)) | host wake broker |
  | Codex, or any runtime without an aweb channel | host wake broker | host wake broker |

  The channel packages push events into the session. The host wake broker
  presents them by typing into the session's terminal pane, and in Claude Code
  that keystroke can answer a dialog on the human's behalf (aweb-abmy), so a
  runtime with a channel uses it by default and the broker covers only the
  runtimes that have none. The broker path sets `AWEB_DELIVERY=session` (which
  also keeps any ambient channel package silent) and registers the home with
  `aw wake register`.

  New Claude/channel compositions default to
  `--dangerously-load-development-channels plugin:aweb-channel@awebai-marketplace`.
  aweb-channel is not on Anthropic's default channel allowlist. The recommended
  unattended route is explicit host-local `claudeChannelMode: approved`, which
  selects `--channels plugin:aweb-channel@awebai-marketplace` (no development
  prompt). Claude admits the plugin when its managed policy sets
  `channelsEnabled: true` and lists `{plugin: "aweb-channel", marketplace:
  "awebai-marketplace"}` in `allowedChannelPlugins`; on hosts without
  server-managed settings or MDM that is a root-owned file a human admin writes
  once (`/etc/claude-code/managed-settings.json` on Linux,
  `/Library/Application Support/ClaudeCode/managed-settings.json` on macOS).
  The skill's section 4 summarises the host steps; the procedure, its checks and
  failure remedies are oats.setup's `/oats-host-delivery` (oats.framework 1.11.0).
  Without that policy the channel does not register. Readiness reads the
  machine file read-only and warns one verdict: `claude-channel-policy-admitted`,
  `claude-channel-policy-not-admitted` (naming the missing key),
  `claude-channel-policy-malformed` (Claude Code documents that it refuses to
  start while a managed-settings file is unparseable, in
  code.claude.com/docs/en/managed-settings.md) or
  `claude-channel-enrollment-unverified` (absent, unreadable or an unsupported
  platform). An approved launch warns the same
  verdict, and nothing when the file admits the plugin. The file is evidence,
  not proof: server-managed settings or MDM override it, and only the nonce
  exchange proves receive. For an unattended Claude home, the approved route
  is recommended.

  Both modes contribute exactly one fixed plugin argument;
  `settings.oats.aweb.claudeChannelMode` selects argv, never consent. No automatic
  migration, consent inference, approved-to-development fallback or flip-back
  occurs. A future default change requires an explicit reviewed release.

  Development selection shows Claude Code's development-channel prompt, and
  OATS 0.52.0 and later confirm it once at launch;
  `settings.oats.aweb.claudeChannelMode: approved` stops the prompt. The kernel
  records the outcome in `instance.json` `launchPrompts.status` and explains a
  blocked start in its own `launch-prompt` readiness item;
  `channel-dev-confirmation` states the
  decision at spawn apply, start and restart, the start preview (`oats
  launch-config preview`) and readiness, where it is quiet only after a
  `completed` start. `oats spawn --preview` runs no provider hooks, so it shows
  no decision statement yet ([oats#912](https://github.com/awebai/oats/issues/912)). See the skill's
  [Channel selection and the development-channel prompt](oats-package/capabilities/oats-aweb/skills/oats-aweb/SKILL.md#4-how-messages-reach-you-delivery-and-wakes).
  A blocked result can retain an active session after Enter; inspect first, never
  automatically resend input or relaunch. A confirmed prompt does not prove
  admission or receive readiness.

  The provider never observes or answers a prompt: its readiness reads only the
  status the kernel recorded, and actual prompt outcomes belong to the kernel
  launch result and durable receipt. Passing confirmation does not prove native
  receive; `native-receive-unproven` remains.

  Readiness uses the captured mode or an exact retained provider launch
  contribution, including historical development arguments. Missing evidence
  produces `claude-channel-mode-unproven`; current settings do not rewrite a
  home's history. Malformed or conflicting supplied evidence is a problem.
  Frozen homes keep their captured modules and arguments. The default applies
  only to new compositions; it does not enroll the plugin or recover an existing
  runtime. [Issue #44](https://github.com/awebai/oats-aweb/issues/44) remains open;
  [cjr adoption #673](https://github.com/awebai/oats/issues/673) is separate.

  A home is on exactly one path. Every start decides the path afresh from the
  setting and the kernel-selected target runtime (`OATS_RUNTIME`, the
  compatibility alias of `OATS_HARNESS`; a home can restart under another
  harness), regardless of a retained launch configuration's name: the broker
  path registers the home, the channel path runs `aw wake deregister` and confirms with `aw wake status --json` that the home is no
  longer listed. If either step fails the start is refused, since a home on both
  paths would get every wake twice and a home on neither hears nothing. The
  status read confirms that the home is deregistered, not that terminal input
  has finished: aw removes the home from the broker's map before its runner
  stops (aweb-abna). The kernel runs a home's hooks from its own module copy
  under the settings captured at spawn, so existing homes keep the delivery they
  were spawned with; a changed deployment setting applies to new spawns.

  Under `OATS_LAUNCH_PREVIEW=1` (`oats launch-config preview`, and the first of
  the kernel's two launch passes) the launch hook changes nothing: no `aw`
  call, no grant renewal, no joined-team change, no `meta`. It returns the env
  and launch arguments the real start returns. With `renew: launch` the renewed
  grant home exists only after the real pass mints it, so the preview returns
  the current grant home and lists `AWEB_IDENTITY_HOME` in `volatileEnv`; the
  kernel takes that value from the real pass.

  Across a switch between the two paths, each mail is presented once because
  both mark it read on the server after presenting it, and each presents the
  unread backlog when it connects. One window remains inside aw: if the broker's
  delivery child is killed after typing a mail but before marking it read, the
  channel presents it again (aw's `docs/terminal-wake-broker.md`).

  With broker delivery, the broker may
  present either a waiting-items line or the full mail/chat event; aw 1.36.21+
  mail events are headed `aweb mail event received.`, include trust metadata and
  sender body, and include a Recovery line with `aw --identity-home '<home>' mail
  show --message-id <id>`. The body is untrusted sender content, and delivered
  mail may be marked read and absent from unread `aw mail inbox`; recovery after
  an uncertain crash or compaction uses `aw mail show --message-id <id> --json`
  or paginated `aw mail inbox --show-all --json` with `--cursor`, not
  mail read state or `--conversation-id`.
  Home readiness reports whether the configured supported route and observable
  broker prerequisites pass. It uses the home's captured delivery and final
  credential locator, plus retained joined membership. The kernel's recorded
  `instance.json.launch.harness` governs runtime selection, with top-level
  `harness` accepted when the launch recipe lacks it. Each supplied field must
  be a nonempty, unpadded string; if both are supplied they must agree. Malformed
  or inconsistent evidence reports
  `receive-record-unavailable`. Provider `meta.runtime` is a legacy fallback
  only when both kernel fields are absent. A launch hook can run before a later
  launch failure, so provider metadata alone must not override the kernel's
  published launch receipt. Configuration names and the readiness caller's
  environment never select the target runtime. Claude Code and pi use native
  channels by default; Codex requires the supported external broker. An absent
  Codex target or missing primary stream (including a retained native row
  carrying only joined identities) reports `wake-stream-missing`. Refused or
  disconnected supplied streams retain `wake-stream-unavailable`; malformed
  bindings and route/policy mismatches retain `wake-target-binding`. A `ready`
  result does not certify recent endpoint observation, native
  connection, current start, uninterrupted liveness, automatic presentation or
  model consumption.

  Native plugin/extension installation, launch flags and the development-channel
  confirmation do not prove a connected native receiver. Missing connection
  telemetry produces the `native-receive-unproven` warning; confirmation
  guidance applies to captured development mode. Joined broker paths independently contribute failures even
  when the primary is native. The public joined `receive: native` enum remains
  unchanged for compatibility; it denotes broker-managed joined delivery, not
  a harness-native connection or readiness attestation.

  Broker readiness reads one `aw wake status --json` snapshot. It checks the
  canonical target, a running daemon that reports its version, active/unpaused target, complete
  captured identity set and its delivery/ownership/event/control policy,
  admitted streams in the released `streaming` phase, running worker, and
  target/worker/binding errors. Missing required daemon, worker or stream
  evidence is a problem. A running daemon below the aw floor is the
  `wake-daemon-outdated` warning, and the target is still assessed; a daemon
  whose status lacks worker evidence cannot establish the broker prerequisites.

  Observation age, absent optional inspection evidence and an inspection in
  progress warn without making otherwise satisfied prerequisites unavailable.
  The 30-second threshold only labels old evidence with its age; it is not a
  readiness gate, broker guarantee or command timeout. Quiet workers inspect at
  startup and on events, so their observations can age without a transport
  failure. Missing observation evidence is unproven, never an invented
  successful inspection. Supplied timestamps must still be valid, nonfuture
  and consistently ordered; malformed or contradictory status is a problem.
  A supplied malformed `status.updated_at` reports
  `wake-status-timestamp-unknown`, naming the observed client and daemon versions
  (or `unknown` when unavailable). Provider `unavailable` maps to kernel
  `unknown`; malformed time is not evidence of staleness. A parsed future
  snapshot remains `wake-status-stale`. The parser accepts RFC 3339 timestamps
  with attached fractional seconds of one through nine digits, as emitted by
  supported aw releases; it does not infer compatibility from a version alone.
  Known stopped/shell/unusable endpoint state, failed inspection and explicit
  errors remain problems even when old or followed by `inspect_start`, which
  can retain prior state and errors. `last_inspect_at` also updates on errors;
  neither it nor historical input/success timestamps establish success.

  One worker field needs a narrower interpretation: released aw can retain
  `channel_core.last_error` across subsequent status updates. Node can re-emit
  that text on ordinary status updates; a new status line does not date the
  failure. A new worker run can reset the field. With `inspect_done`,
  a supplied nonfailure worker state, no `readiness_error` and no other failure
  or malformed evidence, `wake-worker-error-retained` warns with bounded error
  text. Its currency is unproven. There is no error timestamp or common ordering
  token to establish that inspection followed the error or resolved it;
  `last_success_at` records input and is not the deciding signal. Without that
  completed observation, the worker error remains a problem. Row, readiness,
  binding, stream, conflict, pause and nonrunning failures remain problems.

  OATS reports nonshell inspection as `unknown`, not `idle`. Public status does
  not independently attest endpoint presence or identify the current start.
  Readiness does not refresh the broker, send input, register, resume or modify
  the home. A soul check with no home remains prerequisite-only. Existing
  configuration/authentication and applicable custody failures retain their
  diagnostics and skip receive evaluation until prerequisites pass.

  A genuinely absent legacy delivery/runtime record uses the settings-based
  prerequisite fallback for missing facts and warns that receive ownership and
  complete-set assurance are unproven. It does not replace valid captured facts
  with current settings or infer ownership from a broker row or caller runtime.
  Only absent captured delivery falls back to `settings.delivery`; `session`
  requires broker checks. Captured `session` requires them even without runtime;
  captured `channel` without runtime leaves primary ownership unproven, including
  when current settings say `session`. An explicit Codex runtime requires broker
  prerequisites even when captured delivery is absent, while complete-set
  ownership remains unproven. A retained empty runtime string keeps its
  existing external-broker meaning. Any known joined path requires broker checks,
  except a Claude channel home's joined teams, which it reads at task boundaries:
  readiness reports `joined-team-polled` for those.
  Retained joined identities still receive target/worker/stream and known-policy
  checks. Malformed JSON, unreadable records, wrong types, invalid values and
  contradictory retained facts are problems, not legacy absence.

  Valid `.oats-aweb/teams.json` is authoritative over launch metadata because
  later join/leave commands update it. Complete captured local plans require
  valid membership state. Legacy metadata-only joined state is retained with
  the fallback qualification; a missing file is not evidence that known joins
  disappeared. If both legacy membership sources are absent, there are no known
  joined entries, not a certified empty set. Otherwise valid unmatched bindings
  can remain in a partial legacy projection; every supplied binding must be
  well-formed and healthy, but the result cannot certify full-set matching.
  Global grant/retained-root spawn paths may omit this file only
  when recorded provenance consistently establishes an empty joined set.
  Grant readiness uses the final recorded `identity.grant.home`, never the newest
  directory or the caller's `AWEB_IDENTITY_HOME`.
  For a GLOBAL grant seat captured with `delivery: session`, a foreign broker
  binding reports `wake-target-binding` with both grant-home basenames. A
  quarantined primary reports
  `wake-stream-unavailable`, including the HTTP status and recognized grant
  denial detail when supplied. Arbitrary error text, headers and response bodies
  are not echoed. Both diagnostics explain that restarting the seat re-registers
  the broker with its current grant home; readiness itself never re-registers.
  An admitted primary in aw's `starting` or `retrying` phase gives a
  `wake-stream-unavailable` warning, including safe HTTP/service detail or a
  recognized network failure phrase from its error text. The broker reconnects
  automatically. Phase determines the outcome even when `stream_error` is set.
  Worker, binding and all other readiness checks still apply; stopped, unknown
  or missing phases remain problems; an unknown phase is named in the problem.
  From aw 1.36.58 a stream the server refused reads `refused` (it was
  `quarantined`), for any home: readiness reports `wake-stream-unavailable`
  naming the phase, aw's cause (an HTTP status or a terminal event's name) and
  the next attempt, never the error text. The broker retries it on its own;
  fix what the server refused, and restarting the home registers it again,
  which retries at once.

- `claudeChannelMode`: `development` (default) or explicit `approved`, **host-only** in
  `oats-local.yaml` under `settings.oats.aweb`. Committed soul/workspace settings
  and spawn-provider overrides are rejected by the kernel. Explicit null, empty,
  wrong-type or unknown values fail before provider effects. This setting changes
  only Claude/channel arguments; Pi, Codex and `delivery: session` are unchanged.
- `root`: absolute directory whose `.aw` is the default team's minting root.
  This root is for one aweb team only. A seat with `identity.mode: global` and
  an `identity.resident` acts through that resident's grant and needs no
  minting root, so readiness does not ask for one.
- `roots`: map `{ <team id>: <absolute directory> }`. `roots[team]` wins over
  `root` and is required when a deployment mints into more than one aweb team.
  Each mapped directory owns its own `.aw` identity for exactly that team.
- `residents`: map of resident name to absolute custody directory for
  `identity.mode: global`; host-only because it points at custody material.
  `oats aweb resident create <name>` records its resident here.
- `join`: comma-separated eligible labels to join at spawn.
- `identity`: local by default; `global` uses a named resident grant. For fresh
  GLOBAL creation in an existing hosted team versus resident reuse, follow the
  [existing-team GLOBAL resident journey](oats-package/capabilities/oats-aweb/skills/oats-aweb/references/existing-team-global-resident.md).
  Global spawn consumes a provisioned resident; it does not create one:
  `oats aweb resident create` does.
  A new GLOBAL seat requests `identity.ttl: never` by default, with
  `identity.renew: launch`: each actual launch re-mints, while preview makes
  no changes. A renewal keeps the seat's duration (its captured ttl, else the
  ttl the grant recorded, else 720h for a grant minted before 1.25.0).
  `identity.ttl` may instead set a Go duration from 60s to 720h;
  `E_GRANT_TTL` refuses anything else before grant or launch effects,
  including retained-grant paths. Explicit `renew: off` retains the existing
  grant. The team grant cap or issuing-certificate expiry can impose a finite
  deadline even on a never request. The mint receipt's `expires_at`, recorded
  as `identity.grant.expiresAt`, determines expiry diagnostics and the brief;
  renewal preserves the requested TTL. Scopes and revocation still apply.
  Existing homes retain their captured provider/settings until explicitly
  recomposed; publishing this version does not update them automatically.

There is deliberately **no** `settings.oats.aweb.team` in 1.17. Team selection
belongs to the OATS team model (`oats teams`, `oats soul teams`) and reaches the
provider as `OATS_DEFAULT_TEAM*` and `OATS_TEAMS`. If a `team` setting is present
at any layer, oats.aweb refuses it instead of treating provider payloads as team
configuration.

### The pi extension without its skills

An aweb install made through OATS installs only what messaging needs: a home
gets its skills through its OATS capabilities (oats.aweb, and oats.aweb-tasks
where chosen), never machine-wide. `@awebai/pi` below 0.5.0 bundles five
skills with its extension (aweb-bootstrap, aweb-coordination, aweb-identity,
aweb-messaging and aweb-team-membership), and pi loads them in every session
that uses that pi folder. The extension does not need them. From 0.5.0 the
extension declares `"skills": []` itself and ships none, so it needs no
filter. Install the extension:

```bash
pi install npm:@awebai/pi
```

Below 0.5.0, also make its entry in the pi folder's `settings.json` filter the
skills out:

```json
{"packages": [{"source": "npm:@awebai/pi", "skills": []}]}
```

The pi folder is `PI_CODING_AGENT_DIR`, else `~/.pi/agent`. `pi install`
writes a plain string, `"npm:@awebai/pi"`; replace that string with the object,
keeping any version in `source` and every other entry. pi's object form loads
everything except the resource types it empties (pi's `docs/packages.md`,
"Select package resources"). Checked with pi 1.3.0 and `@awebai/pi` 0.4.0: the
filtered entry still loads the extension and none of its skills, and a later
`pi install` or `pi update` of the package keeps the filter (`pi install
npm:@awebai/pi@latest` rewrites `source` to `npm:@awebai/pi@latest` and keeps
`"skills": []`), so an update needs no second step. `pi remove` drops the
entry with its filter. A filter left in place after an update to 0.5.0 is
harmless.

The skills now ship on their own in `@awebai/claude-skills` (0.2.17 and later),
which aweb documents as a user-wide install. Never install it in a pi folder
that OATS homes use: pi would load its skills in every session there, beside
the ones the home's capabilities give it.

Home readiness reads the home's launch's pi folder (the recorded launch's
`PI_CODING_AGENT_DIR`, else `$HOME/.pi/agent`), its `settings.json` only, and
warns for a pi home:

- `pi-extension-skills-loaded` when it lists `npm:@awebai/pi`, with or without
  a version, as a plain string or as an object without `"skills": []`, and the
  `@awebai/pi` installed there (`<pi folder>/npm/node_modules/@awebai/pi`) is
  below 0.5.0 or its version can't be read. The message names the file and
  the exact edit, or the update to 0.5.0. From 0.5.0 it is quiet.
- `pi-skills-package-loaded` when it lists `npm:@awebai/claude-skills`, with
  or without a version, the same way, whatever the extension's version. The
  message names the file and the fix: remove the entry, or filter it with
  `"skills": []`.

Both can appear together. A missing or unreadable file, a folder that lists
neither package, another runtime and soul scope say nothing.

Known gaps:

- Claude Code's aweb-channel plugin (through 1.8.2) ships one skill of its own,
  `aw:configure`, a channel setup helper. Claude Code installs a plugin whole,
  so OATS cannot drop it; aweb is asked to ship the plugin without it.

### One root per team

A local aweb root holds one local identity and therefore one team membership.
Accepting a second local team into the same `.aw` would overwrite
`identity.yaml` and is refused by aw. For every created or joined non-default
team, setup creates a real per-team root such as
`<deployment>/.aweb-roots/<label>`, accepts the invite into
`<root>/.aw`, connects the workspace, and records
`settings.oats.aweb.roots[<team id>] = <root>` in `oats-local.yaml`. Minting for
team `T` uses `roots[T]` when present, otherwise `root`. For a team other than
the default, a spawn-time join (`join`) and `oats aweb roster --label` accept
that root only when `aw team list --json` run in it lists `T`; the cwd,
`OATS_WORKSPACE` and the instance home's own `.aw` are never tried. Otherwise
they refuse, naming the team, the root tried and the remedy (`oats aweb setup
--join <label> --invite-stdin` in the deployment, then a respawn).

Wherever the provider matches a team id it was given (a setting, a record, the
kernel's environment) against one aw reports, it compares them as aw spells
them: the name and the domain lowercased and trimmed, without a trailing dot
(`lib/aweb-team-id.mjs`). A mixed-case `roots` key or default team therefore
finds its root, its certificate and its workspace. What the provider writes or
prints keeps the spelling it was given.

The general OATS >=0.42.0 compatibility floor applies to the remaining provider
behavior; explicit wider-team LOCAL join additionally requires the selected same
kernel to support `inspect --home` for recorded soul provenance, then
`inspect --soul --dir --json` with live teams and current `oats.aweb` root settings,
and to dispatch `OATS_TEAM_SCOPE` as the selected deployment. Missing or invalid
results refuse before invite minting; ambient soul names or settings are no
workaround. The pinned public fixture at `bb2ba8c9` (OATS 0.42 source) verifies
these features, not the earliest compatible release. Older homes need the fixed
provider composition; ordinary lifecycle keeps its captured settings.

Explicit `oats aweb join` resolves current host-owned minting roots through the
same kernel's public inspect API. It first validates the selected home's recorded
soul, then reads that soul in the selected deployment, consuming only `root` and
`roots`. The exact team's explicit entry wins, including when invalid; otherwise
a shared current root must prove membership in that team. Query, configuration,
compatibility or membership failures refuse before an invite is minted. A team
root recorded in `oats-local.yaml` after the home's spawn is therefore joined
without a respawn. Each refusal says `nothing was minted` and names its cause
and fix: when the live settings cannot be read, the cause in parentheses and
the `oats inspect … --json` read to repair; when they name no member root for
the team, the `oats aweb setup --join <label> --invite-stdin` that makes one.
Captured module, identity and delivery settings remain unchanged; spawn, launch
and retire do not use this current-root lookup.

`oats aweb join --labels <labels> --plan [--json]` resolves each label's root
exactly as the join would and prints its team, root, the setting that chose it
(`roots[team]` or `root`) and whether membership was confirmed, or the refusal.
It mints no invite, accepts nothing and writes no identity or provider state;
it exits 1 when any label would be refused. When `aw team invite` fails, its
output stays withheld, and the failure names the cause from a fixed vocabulary
(the HTTP status and the server's `detail` with token-shaped values redacted;
otherwise aw's `--json` error code, an unreachable service, or that its output
held none of these), the root it ran in and the setting that chose it, and
that nothing was joined.

Setup selects the deployment from `OATS_TEAM_SCOPE`, with `OATS_WORKSPACE` as an
older-dispatch fallback. Supplied deployment facts must agree and the selected
directory must contain a readable `oats-local.yaml`. New team roots are siblings
under that deployment's `.aweb-roots`, even when the minting root is nested or
outside the deployment: with the default team's root at
`<deployment>/.aweb-roots/<default>`, `--join <label>` creates
`<deployment>/.aweb-roots/<label>` beside it and records it as
`roots[<team id>]` (#45). Previously recorded roots retain their exact
locations. Existing nested roots keep working and are not migrated; to move one,
ask your aweb lead.

### Setup acts

`oats aweb setup` handles the provider's deployment-root onboarding acts below;
it is not the fresh GLOBAL resident creation path. Global spawn consumes a
pre-existing resident and mints a worker grant. Use the
[existing-team GLOBAL resident journey](oats-package/capabilities/oats-aweb/skills/oats-aweb/references/existing-team-global-resident.md)
for authority, destination, native creation/reuse, custody and acceptance boundaries.
From a deployment directory (outside an instance home), dispatch setup through any
soul that uses the messaging provider, for example `oats aweb setup --soul <any soul with messaging>`; the provider consumes the kernel-forwarded `--soul` flag and does not use it as team policy.
Supported acts:

- `oats aweb setup --username <u> --name <alias> [--label L] [--plan] [--json]`:
  provider 1.23.0 (#70) automatically records the LOCAL team mapping and deployment
  default through the selected kernel after verifying the root membership.
  Missing/invalid names refuse before effects; the explicit native name fix is
  present in the 1.22.2 composition. Earlier behavior only printed mapping advice.
  Use the [username setup procedure](oats-package/capabilities/oats-aweb/skills/oats-aweb/references/username-setup.md)
  for plan, policy, matching-root resume and partial-write recovery. This is not
  an installation or timed onboarding claim.
- `oats aweb setup` with the selected team API key supplied only through the
  operator's protected child environment (`AWEB_API_KEY`): runs `aw init
  --do-not-touch-agents-md` for that hosted team. `--service` stays join-only; `--name` is supported for
  join and `--create`, and required for `--username`. Neither flag extends the
  API-key flow or provides GLOBAL setup; no `setup --global` exists. Do not
  place the key in a literal command or history.
- `oats aweb setup --create <label> --namespace <domain>`: owner/admin act for
  a customer-controlled namespace. It needs aw 1.36.53 or later: `aw id team
  set-server`/`show-server` first ship in aw 1.36.44, and the `--json` error
  answers setup reads first ship in aw 1.36.53. Below that it refuses before
  any other aw call and before the kernel: "--create --namespace needs aw >=
  1.36.53 (this host has <version>): upgrade with npm install -g
  @awebai/aw@<tested>; nothing was created", `<tested>` being aw-compat.json's
  `tested`. With `--install-aw` it installs that tested aw. It normalizes `<label>` to aweb's team-name
  rule and, before any aw call, resolves the aweb service: `AWEB_URL` (the
  server's public URL; hosted aweb is `https://app.aweb.ai/api`), else the
  `aweb_url` in an existing messaging root's `.aw/workspace.yaml`. With
  neither, it refuses and nothing is created. The per-team root's identity
  takes `--name <alias>`, else the alias of the deployment's root identity
  (`aw whoami`); a fresh deployment has none, so it needs `--name`, and
  without either setup refuses before any team key is written. It then runs `aw id team create
  --name <normalized> --namespace <domain>`, registers the team with that
  service (`aw id team register --service <url> --team <team id>`),
  publishes and verifies its AWID team-server record for that service (see
  below), mints a
  local invite with the team key aw just wrote (`aw id team invite`), accepts
  it into a new per-team root, connects the root to the service, records
  `roots[<team id>]`, then records the local mapping with
  `OATS_CLI_BIN teams add <label> --team <id>`. A re-run of the same command
  resumes a partial create: no second team, no `-2` suffix, and no second
  invite once the root's identity is accepted. The result names where aw keeps
  the team key (`team key: <path>`, under `~/.awid/team-keys/<domain>/`),
  never the key. A name already held in the namespace under a team key that is
  not on this machine stops after that one create: setup says "team
  <name>:<domain> already exists in the registry, and its team key is not on
  this machine", and names the remedy: choose another label, or run setup as
  the user whose `~/.awid/team-keys/<domain>/` holds its key. Setup never
  tries another name, and nothing is created. A refused registration names
  the HTTP status and the server's short code (such as
  `http 422 ... service_url_mismatch`) and says the team exists with its key
  kept; a re-run resumes. Without the namespace controller key, setup says
  "the namespace controller key for this namespace is not on this machine"
  and names the remedy: run `aw id namespace prepare-controller --domain
  <domain>` as this user, or create the team where that key is, then re-run.
  aw's raw output is never relayed, and `--service` is refused with
  `--create`. Before creating anything it reads `OATS_CLI_BIN teams --json`:
  where `localTeams` is `false` (team model 3: the workspace does not allow
  local teams), it records no local mapping and prints the `teams:` entry, and
  `defaultTeam:` when the workspace has none, to commit in
  `oats-workspace.yaml`, how to let souls join it (a `souls:` entry's teams),
  and the `localTeams: true` alternative. A kernel without `localTeams` (OATS
  0.36) takes the local mapping. If the kernel cannot answer, setup refuses
  before creating anything. Without `--namespace`, setup refuses hosted
  additional-team creation: the provider has no wrapper. Native aw 1.36.24
  supports `id team create --hosted`; aw 1.36.23 does not. Native JSON
  contains an invite token and must be captured privately. Operator notes:
  - **One trust boundary.** The namespace controller key
    (`~/.awid/controllers/<domain>.key`) and each team key
    (`~/.awid/team-keys/<domain>/<team>.key`) are user-wide on the deployment
    host, not inside the deployment. Every process that user runs can read
    them: the operator's shell, the deployment, and every agent instance
    spawned there. Whoever runs as that user can add members to the team, and
    with the controller key, create teams in the namespace. aw also keeps each
    local invite, its secret included, in `~/.config/aw/team-invites/<id>.json`
    until it is accepted. Setup passes the invite token only through memory and
    accept's stdin, never argv, a file or its output.
  - Each spawned instance joins the team with `aw init --join-from <root>
    --join-team <team id>`, which mints a local invite with that same team key.
    So spawns work only as the user that holds the key.
  - Setup publishes the team's coordination server at AWID, the
    `aweb.team-server/1` record that installed apps read: after register it
    runs `aw id team set-server --team <name> --namespace <domain> --url
    <aweb url>`, signed with the team key, then verifies it with `aw id team
    show-server`: the team, its current key and the URL it registered the team
    with. It reads the record before register and again just before
    publishing. One that already names that URL is left as it is, so a re-run
    stays idempotent. One that names another URL stops setup, naming both
    URLs: setup does not replace a record it finds. The team's owner then
    republishes it for the new URL, or the operator sets `AWEB_URL` to the
    published one. aw has no publish-if-absent, so a record another writer
    publishes between that last read and `set-server` is replaced, and nothing
    reports it: the verify that follows reads setup's own record.
  - The service URL is put in the canonical form the record holds (aw's
    `CanonicalTeamServerURL`) before any aw call, and that form is what setup
    registers, publishes and connects: a trailing slash is dropped, and the
    host is lowercased. A URL the record cannot hold (http outside loopback,
    a literal IP, a query, fragment or userinfo) is refused before anything
    is created.
  - A local-controller invite can be accepted only where the team key is: the
    same user on the same machine. Run setup, and the deployment's instances,
    as that user; another user's deployment on that machine cannot accept it.
    aw then falls back to a hosted invite, which a self-hosted server answers
    with 404.
  - A self-hosted aweb accepts signed requests only for its public origin:
    `AWEB_URL` must be the server's public URL, not a port forward.
  - Without `AWEB_URL`, the team is registered with the service an existing
    root already uses, which may be hosted aweb. To create on a self-hosted
    server, set `AWEB_URL` first. Setup names the service
    before it creates anything.
- `oats aweb setup --join <label> --invite <token>`: accepts an existing/shared
  team's invite into a new per-team root and records `roots[<team id>]`. It
  never accepts into the existing default root. With aw 1.36.53 or later, a
  label already mapped to a team must be the invite's team: otherwise
  `E_SETUP_JOIN_MISMATCH` names both, before anything is redeemed. An invite
  that aw cannot read keeps the released behaviour.
- `oats aweb setup --invite-stdin --name <alias>` (or `--invite <token>`),
  without `--join` (#56): needs aw 1.36.53 or later. Setup reads the invite's
  team and service with `aw team invite inspect --json`, which takes the token
  on stdin and redeems nothing (it makes one preview request to the invite's
  service). The label is the label the deployment already maps to that team
  (said as `Using label …`, `result.labelFrom: "mapping"`), else the team's
  name normalized as `--create` normalizes it; `--join <label>` chooses
  another. It then joins as `--join` does: a new root at
  `<deployment>/.aweb-roots/<label>`, `roots[<team id>]`, the team's local
  mapping, and the token reaching `aw id team accept-invite` on stdin
  (`--token-stdin`), never an argv. A hosted invite whose identity scope is
  `unknown` joins with `--local`, like a `local` one. The service is the
  invite's; an explicit `--service` must name the same service, up to a
  trailing `/api`. With `--install-aw`, an aw older than 1.36.53 is upgraded
  first. It ends with one next step (`result.next` with `--json`, the same
  line), chosen from `oats soul teams <soul>`: `oats spawn <soul> --preview`
  when the label is the soul's default, `oats spawn <soul> --provider oats.aweb
  join=<label> --preview` when the label is eligible for it, and otherwise
  making the label eligible in the workspace's `souls:` (a shared-file change,
  `/oats-teams`). When the soul's teams cannot be read, it keeps the spawn and
  says it assumes eligibility (`result.nextNote`). A kept deployment default,
  and moving it, are in the note. The dashboard's
  `--invite <token>` one-liner works; `printf '%s\n' "$TOKEN" | oats aweb setup
  --soul <soul> --invite-stdin --name <alias>` keeps the token out of shell
  history. A deployment with no root identity needs `--name <alias>`. To resume
  an admitted but unconnected join, run the printed `--join <label> --service
  <service>` command without the token; an expired, exhausted or revoked invite
  that aw reports with its team names that exact command too, with the label
  the deployment already maps to that team. Refusals, all
  before anything is redeemed:
  `E_SETUP_AW_VERSION` (aw older than 1.36.53: upgrade aw),
  `E_SETUP_INVITE_INSPECT` (inspect failed; names aw's fixed refusal code, such
  as `exhausted`, or a withheld cause), `E_SETUP_INVITE_CONTROLLER` (a
  local-controller invite: scope and status unknown), `E_SETUP_ALREADY_MEMBER`
  (`roots[team]`, `root` or the default team's root already lists the team;
  `roots[team]` is never re-pointed; when no team label maps it, the message
  names the tokenless resume for a per-team root an earlier run left, else the
  mapping: `oats teams add <label> --team <id> --no-default`, which keeps a
  workspace default, or, where the workspace allows no local teams, the
  `teams:` commit to oats-workspace.yaml), `E_SETUP_MEMBERSHIP` (one of those roots' `aw team
  list` could not be read: never taken as "not a member"),
  `E_SETUP_SERVICE_MISMATCH` (an explicit `--service` for another
  service), `E_SETUP_DEFAULT_PRESERVE` (the workspace sets the default and the
  label is unmapped; its exact `oats teams add` command names the invite's team)
  and `E_SETUP_LABEL_COLLISION` (the derived label is another team's: pass
  `--join <label>`; never a suffix). Inspect and controller refusals name the
  labelled fallback `--join <label> --invite-stdin --name <alias> --service
  <url>`. `E_SETUP_INVITE_SCOPE` (an invite for a GLOBAL identity) is different:
  ask for a LOCAL member invite (`oats aweb invite`), or use the
  [existing-team GLOBAL resident journey](oats-package/capabilities/oats-aweb/skills/oats-aweb/references/existing-team-global-resident.md).
- Owner-creates-shared flow: when a committed/shared team has no provider id,
  its owner explicitly runs `oats aweb setup --create <label> --namespace
  <domain>`. Setup creates the provider team, registers it with the service at
  `AWEB_URL` (the server's public URL) or an existing root's service, mints a
  local invite and accepts it into a per-team root, records the root locally,
  and prints the id to commit. A re-run resumes. Plain `oats aweb setup` does
  not create shared teams; it asks for the owner-provided id or invite.

For a committed/shared team whose provider id exists but whose root is not a
member, setup/readiness tells the operator it is shared: ask the owner for an
invite, then run `oats aweb setup --join <label> --invite <token>` (or use
`--create` if this host is the owner creating it). When a joined team is removed
from the live team set, hosted teams are left automatically; on a namespace team
you control (BYOT), a failed leave is reported as an instance event and the team
owner removes the member.

### Readiness messages

- No default configured: `no teams configured: run \`oats aweb setup\``.
- Unmapped default (label/from set, provider id absent):
  ``the default team <label> has no provider id yet: its owner runs oats aweb setup, then commits the id, or choose another default: `oats teams default <label>`, or `defaultTeam:` in oats-workspace.yaml when the workspace doesn't allow local teams``.
- Shared team root missing or not a member: the remedy names the team/root and
  tells the operator to run setup, create it, or ask the owner for an invite.

### aw floor

Every path requires `aw >= 1.36.33` (`AW_MIN` in `lib/aw-floor.mjs`, read from
`aw-compat.json`'s `min`: the one client floor; the probe and grant seats' custody use it too). A missing, older or unreadable `aw` is a
readiness problem, a refused command and a required spawn-hook failure, all with
one message naming the installed version, the floor and the install command,
for example `aw 1.36.31 is older than required 1.36.33; upgrade with
\`npm i -g @awebai/aw@latest\` (or \`npm i -g @awebai/aw@1.36.33\`)`. The host
wake daemon and a resident's custody service run their own code until they
restart (see 1.25.0 above). The floor is read from the first line
of `aw version`; the reader stops there instead of waiting for aw's update
check. Every aw command a hook runs has `AW_NO_UPDATE_CHECK=1`.

### What spawn and retire run

A local spawn mints the default-team identity with one command in the instance
home: `aw init --join-from=<root> --join-team=<team> --name=<instance> --json
--do-not-touch-agents-md`. aw creates the invite from the root, accepts it and
connects the workspace, so the invite token never reaches the hook. The mint
runs without `AWEB_URL`, `AWEB_API_KEY`, `AWEB_ROLE_NAME`, `AWEB_ROLE` or
`AWEB_IDENTITY_HOME`, so the service comes from the invite. On the broker
delivery path the hook then runs `aw wake register`. The recorded alias is always
the requested one: if aw reports another, the hook keeps the instance name and
adds a warning that quotes nothing from aw's reply. Joined teams still use
invite + `aw id team accept-invite` under `--identity-home`. Before the accept, the
join writes its intent to `.oats-aweb/teams.json` (`pendingJoins`: label, team,
identity home, alias, the root it mints from, time). Recovery connects through
that root, so a root that only the live settings name still works. One atomic write records the joined team and drops
the intent. A hook killed in between leaves the intent. The next `oats aweb join`
of that label adopts the membership: it connects the workspace and records it,
with no second invite. `oats aweb leave` of the label, and every retire, adopt it
and release it with the same `aw workspace delete` as a recorded joined team. A
start changes nothing at the service for it, and warns naming both commands
(awebai/oats-aweb#217).

Before the default-team mint, spawn writes its intent to
`.oats-aweb/pending-mint.json` in the home (team, alias, the root it mints
from, time), in one atomic write. aw registers the identity before it writes
the workspace binding: aw 1.36.58 writes `signing.key` first, registers the
member, then writes `team-certs/` and `identity.yaml`, and writes
`workspace.yaml` last. So a mint killed or failed in between leaves a
registration that no local file proves (awebai/oats-aweb#240). The intent is
removed once the minted identity is in the spawn's answer, or once aw confirms
a refusal. Two refusals count, by their code in aw's `--json` error answer: an
alias another member holds, and an invite the server refuses. So does a root
that can't create the invite, which aw reports before it writes the key. A
failure that only reads like an alias refusal keeps the intent. A home that already holds
identity material gets no intent, since aw refuses it before doing anything.
Any other failed mint answers `pendingMint` in its meta.

Retire acts on an intent, from the home or from that meta, only when the home
holds no bound identity. A home that aw bound (it wrote `workspace.yaml`) is
self-deleted as usual. Otherwise retire reads `aw id team members
--team-id=<team> --json` from the recorded root (team ids compared as aw
spells them: name and domain lowercased). Retire never decides a registry aw
would decide differently: it passes a registry the root records, or none.

- When the team's membership in the root's `.aw/teams.yaml` records a plain
  `registry_url`, the read gets `--registry`, and the command and the record
  name it.
- Otherwise the read gets no `--registry`, and aw resolves the registry itself,
  as for any read from that root (from the membership's `aweb_url` when it has
  one). The record stores no registry, and the command omits `--registry` and
  says so: `the team's registry is not recorded here; aw discovers it from
  <aweb_url>: the controller adds --registry <that registry> if it is not aw's
  default`.

It never runs `aw workspace
connect` to finish a half-done mint, and never retries the mint. A certificate
is this mint's only when its `member_did_key` is the did:key of the home's
`signing.key`:

- **This mint's certificate:** retire records it in the retired-certificates
  record, with the controller's `aw id team remove-member` command (its
  `--registry` is the registry the read used), and says
  the identity was registered but could not be released. It exits 0, because
  the home's key can't release it.
- **No key in the home:** aw writes the key before it registers, so the
  certificate is most likely another instance's. Retire shows no command to
  remove it and records nothing. It points to `oats aweb roster` and the
  members read at the root instead, to check the member first. It exits 0.
- **No certificate for the alias, or one held by another key:** nothing was
  registered, and the intent is dropped.
- **The members read fails:** the outcome is unknown. Retire names the read to
  run, keeps the home and the intent, and exits nonzero for a retry.

Where a certificate is found, the intent stays until the kernel removes the
home. So a retire killed before it records or answers the handoff leaves the
intent, and the next retire hands the certificate over again.

A later spawn of the same name still meets the alias refusal; when this host's
record holds a certificate for that alias and team, the refusal says so and
points to `oats aweb roster`. It names no command: the roster decides whether
the controller's command is shown, after it checks the member's presence.

Retire self-deletes with `aw workspace delete <workspace_id>`, taking the id
from the membership in `<home>/.aw/workspace.yaml` whose team and alias match
the recorded ones. It falls back to the alias when no entry matches. For a home
whose last start was on the broker path, `aw wake deregister` runs at the same
time as the delete. Before that, retire leaves each joined team and releases each
unfinished join. While a release that needs the member key fails (anything but
`team_not_hosted`), retire keeps the key and the record and exits nonzero.

### A retained seat on a server other than aweb Cloud

On an aweb server other than aweb Cloud, an agent's identity is a retained
seat: an existing member's `.aw` directory that the spawn copies into the
new home and connects (`identity.source`, its absolute path). The commands
that make one are in awebai/oats
[`docs/container.md`, "Making a seat"](https://github.com/awebai/oats/blob/main/docs/container.md#making-a-seat).
The seat directory must contain:

- `signing.key`, the member's key;
- `team-certs/`, the member's team certificate, and `teams.yaml` with a
  membership of the team (`aw id team accept-invite` or `aw id team
  fetch-cert` writes both);
- `workspace.yaml` with `aweb_url`, the team's server, which `aw workspace
  connect --service <the team's aweb server>` writes when run in the seat's
  parent directory;
- the team: the deployment's default team, or else the active team in
  `teams.yaml`.

The spawn checks these before it takes the seat's lock or copies anything, in
this order: `identity.source` is an absolute path, it holds `signing.key`, its
`workspace.yaml` records a usable `aweb_url`, a team can be determined, and its
`teams.yaml` records a membership of that team. Each refusal names its fix. A soul's readiness (`oats readiness`) reports the
first one with the spawn's own text. A retained seat mints nothing and takes
its team as above, so readiness asks it for neither a messaging root nor a
default team. A lock another seat holds is not a readiness problem: the spawn
checks it when it runs, after these. A seated home's readiness does not read
the source again.

The membership is read as `aw workspace connect --team` looks for it: the
team id of each item of `teams.yaml`'s `memberships` list, compared trimmed
and without regard to ASCII case. A `teams.yaml` that does not exist is
refused, as aw refuses it. The limit: the check decides only that. A
`teams.yaml` outside the form aw writes, with no `memberships` list, or with a
team id that is not ASCII is not decided here, and neither is the
membership's certificate file (`cert_path`): aw decides those at its connect,
after the copy. When that connect fails, the spawn binds the seat back from
its source and removes the copy; if aw refuses that too, as it does for the
same `teams.yaml`, the spawn keeps the copy and the lock and says how to
restore them.

The spawn reads the server only from that `workspace.yaml`. Any http or https
URL with a host is accepted, a path prefix (a server behind a reverse proxy) or
an IPv6 literal included, as long as it holds no userinfo, query, fragment,
whitespace or control characters; it reaches aw as one argument and is never
printed, so a failed spawn withholds aw's own output, which may name it. The
file is read in the form aw writes it: a top-level key and its value on one
line, and its `memberships:` list of flat mappings at aw's indentation, with LF
or CRLF line ends. A `workspace.yaml` in any other form (a flow collection, a
block or multi-line scalar, an escape, an anchor or tag, a quoted key, a
document marker, other indentation, another line break, or a character
outside YAML 1.1's printable set) is refused whole, rather than read for an
`aweb_url` YAML might give differently. The limit: the reader decides only the
top-level `aweb_url` of a file aw writes, and isn't a YAML validator. A file
that isn't valid YAML may still be accepted, and the URL checks (http or
https, no userinfo, query or fragment, one argument to aw, never printed)
still bound what reaches aw.
`OATS_AWEB_URL` is not read (#241): a seat without a usable `aweb_url`
is refused before anything is copied, with that `aw workspace connect` as the
fix, and the soul's readiness reports the same refusal. When a retire
compensates a spawn that did not answer, it says how to bind the identity back
to its source on that same server: as a command naming the server when it is a
plain service URL (http or https, a host, an optional port, and no path but
`/` or `/api`), and otherwise as `aw workspace connect` run there with the
service in its `workspace.yaml`.

Per aw 1.36.58's source (not a live run): on one server, the identity has one
server workspace, so connecting the seat directory and then spawning the
retained seat reuses it, and the spawn moves its path to the instance home;
that second connect does not update the seat directory's own
`workspace.yaml`. Retiring the instance releases the seat's lock and neither
deletes nor restores that server workspace: to use the seat directory itself
again, run `aw workspace connect` from there again; otherwise the next
retained spawn moves the workspace to its new home.

These work on aweb Cloud only, because aw treats only a Cloud team as hosted:
releasing an identity at retire, `oats aweb connect`, `setup --username` and
the hosted `setup --create`. A retire of a retained seat, on any server,
releases only the seat's lock and leaves the identity as it is. On another
server, where a retire releases a workspace (a team the home joined, or an
identity it minted), it deletes the workspace and leaves the certificate and
the alias, so a successor cannot reuse the name yet: `oats aweb roster` marks
that certificate as retired, with the `aw id team remove-member` command the
team's controller runs to remove it.

### The retained seat's lock

A retained seat (`identity.source`) is held through `.aw-retained-seat.json`
beside the source's `.aw`: a spawn creates it, and a take-over
(`identity.takeOver: true`) replaces it. A spawn's success rewrites it with
the alias, and a retire or a failed spawn's rollback removes it. Every one of
these changes is one guarded step (`lib/seat-lock.mjs`), using two private
files beside the lock:

- `.aw-retained-seat.json.guard`, created exclusively for the change and
  removed after it, so one change runs at a time. Another change waits up to
  3 s for it, then refuses.
- `.aw-retained-seat.json.held`, the lock moved aside by `rename(2)` while it
  is checked. The change acts only on the lock it decided on: for a retire, one
  that still names its home; for a take-over, the very lock it read; for a
  plain spawn, none. It then removes the lock, or replaces it with an
  exclusive create. Any other lock is linked back untouched.

The protocol in one statement: every read, replace and remove of the lock
happens under the guard; no guard spans an aw call; every exit after an aw call
states the lock's holder as read under the guard, or says it is unknown; every
guarded step reports what it could not clean, and nothing runs after a step
that left anything. A read
that can't be made (a guard or moved lock left by a killed change) is never
taken for "no other holder": a spawn then reconnects nothing and keeps its copy.

So a retire never removes a lock another seat took over after it looked, and
of two take-overs of one lock only one wins. The other refuses and names the
holder. A spawn that fails after another seat took the lock over leaves that
seat's server binding alone: it doesn't connect the legacy home again, and it
removes only its own copy.

Three limits remain:

- **On a filesystem where `rename`, `link` or an exclusive create isn't
  atomic,** which includes some network and FUSE filesystems, two changes can
  still interleave, and nothing detects it.
- **The guard covers file operations, never an aw call.** A take-over can land
  while a spawn's `aw workspace connect` runs, or while its rollback reconnects
  the legacy home. Then the server binding may end up with the spawn's home or
  the legacy home rather than with the seat that now holds the lock. The lock
  is read again after the spawn's last aw call (its wake registration, where
  the home has one) and after every reconnect a rollback tries, whether or not
  it succeeded. If another seat holds it, the spawn fails, removes any wake
  registration it made, says where the binding may point, and names the
  `aw workspace connect --service=… --team=…` to run from that seat's home.
  The command names the server only when it is a plain service URL, as the
  rebind a retire prints does; otherwise it says to run `aw workspace connect`
  with the service, team and role in the source's `workspace.yaml`. This
  needs a take-over of a seat whose runtime is still alive, and the take-over
  already warns about that: there are then two seats with one key, and the old
  one must be stopped.
- **Each exit names the holder as last read under the guard.** A take-over
  after that read is not reported. Taking over a live seat is operator error,
  and the take-over warns about it.

A directory at the lock's name is never taken for a lock: a change refuses it
before moving anything, and says to remove or move it.

A change that was killed can leave either private file behind. The next spawn
or take-over refuses with the file and its fix, and the next retire reports it
in its warning, whether or not the lock is still there. None of them adopts or
removes one, or judges age, pid or liveness:

- **A guard:** remove it once no change of that identity is running on any
  host that shares the directory.
- **A moved lock:** move it back (`mv .aw-retained-seat.json.held
  .aw-retained-seat.json`) if the seat it names still holds the identity and
  no lock exists. If the lock's name holds bytes that are not a lock (a write
  that did not finish), move it back over them (`mv -f`). Otherwise remove it.

A change whose step fails (a full disk, an I/O error) undoes its own effect
before it releases the guard:
- a guard it could not record itself in is removed;
- the bytes a failed lock write left are removed, all of them or a prefix (a
  write can fail after its last byte). If they can't be removed, the failure
  says so: they name no seat, so the fix is to remove them, or, for a
  take-over, to move the holder's lock back over them (`mv -f`);
- a moved lock it could not remove goes back to the lock's name, over the
  lock it wrote.

Whatever a step can't clean, its own guard or a moved lock included, the step
reports with its fix, and the change stops there. A spawn makes no further aw
call, briefs no seat and doesn't touch the lock again. Its failure names each
leftover. A retire adds the leftovers to its warning; its exit status is what
it would be with the lock untouched.

## Isolated hostOnly contract verification

`test/claude-channel-host-only.test.mjs` imports the real generic `resolveSoul`
validator from the public OATS source pinned in `.github/workflows/ci.yml`,
using this checkout's actual provider manifest. It checks both
mode values at soul, workspace and spawn-provider layers, the existing
`host-only-key` diagnostic and `oats-local.yaml` remedy, plus host-local origin
and omission controls. Unexpected fixture remote reads fail.

CI provisions that exact source outside test discovery and installs its
locked dependencies with lifecycle scripts disabled. It runs `OATS_HOST_ONLY_REQUIRED=1` with `OATS_HOST_ONLY_KERNEL_ROOT`
pointing to the pinned checkout. Missing roots/dependencies and import failures
fail this required gate. Local `npm test` explicitly skips this opt-in file when
the root is absent; to exercise it, provision the same source/dependency and run
`OATS_HOST_ONLY_REQUIRED=1 OATS_HOST_ONLY_KERNEL_ROOT=/absolute/pinned/checkout node --test test/claude-channel-host-only.test.mjs`.
This verifies the pinned source contract, not every kernel version, a host
installation, Claude admission or live delivery.

## aw-verb guard in CI

`test/oats-aweb.test.mjs` "capability guidance names only real first-level aw
verbs" runs `aw <verb> --help` for every aw verb the hook, the inject and this
README name. It needs a real aw 1.36.6 or later on PATH and skips without one.
CI's validate-and-test installs the aw the provider is tested with (`AW_TESTED`
from `lib/aw-floor.mjs`, which reads `aw-compat.json`'s `tested`; read in the
step, never written twice) into an isolated
prefix on the `npm test` step's PATH, and sets `OATS_AW_VERBS_REQUIRED=1`, so
the guard fails there instead of skipping.

With that aw on PATH, five more tests run in `npm test` instead of skipping:
the real-aw tests in `test/oats-aweb-1-14.test.mjs` and
`test/oats-aweb-1-15.test.mjs` that the resident-journey job already runs
against this aw. They read aw's help, or act on throwaway identity homes and
wake state directories: with no credentials, every call that would reach a
service is refused locally (no identity, or an invalid invite token), and the
wake calls write only their throwaway state directory. No other test changes
outcome.

### Labelled join configuration (provider 1.23.1, #78/#82)

setup is an operator act: run one setup at a time per deployment.
The selected provider composition must include provider 1.23.1; existing captured
homes do not adopt them automatically. Labelled join verifies exactly one LOCAL
membership before recording its canonical team. The selected public kernel's
teamsApi 2 query/add/default/readback features are required, as for username setup.
It records a missing label mapping and establishes a default only when no
deployment or workspace default exists. A local default is preserved while
adding a mapping; an exact existing shared/local mapping is reused.

When the effective default comes from the workspace and the mapping is missing,
setup retains the admitted root but returns `E_SETUP_DEFAULT_PRESERVE` without
team writes. Its exact `oats teams add` remedy is an operator decision: that
command also creates a local default, shadowing the workspace default. With a
preserved different default, the result instead gives the exact optional
`oats teams default` command to select the joined label.

Closed policy when the plan needs a team write, conflicting/unmapped
declarations and invalid queries refuse before acceptance when knowable. Later
policy/mapping changes or failed writes remain typed failures with observed
partial state (or unavailable readback).
Retain the root and retry the same labelled command without an invite; matching
membership resumes without redemption. Setup rechecks before writes and reads
back afterward, but public verbs are not an atomic transaction: do not change
configuration concurrently. Soul-specific defaults do not establish a local
default and may still control that soul's selection after deployment setup.

LOCAL launch and no-effect preview now return the same explicit instance
`<home>/.aw` identity selector as spawn. GLOBAL grant locators and delivery/joined
metadata remain unchanged. This corrects a pre-existing omission, not a new
1.23.0 regression.

### Member invitation (provider 1.23.0, #71)

From the selected deployment, `oats aweb invite --soul S [--label L]
[--plan] [--json]` selects a declared label (or the selected soul's default),
checks its canonical team and root membership, then asks native/server authority
to issue a LOCAL hosted member invitation. There is no recipient argument:
the accepting side chooses its own alias. This is not a dashboard human invite,
GLOBAL invitation or local-controller/BYOT issuance.

`--plan` only reads team/root/membership and states what would be requested; it
neither mints nor proves permission. Apply uses `roots[T]`, or `root` only when
that override is absent; invalid explicit roots refuse. With neither set, it
uses the deployment's own root, the one `oats aweb setup` creates and spawn
reads, and refuses if the deployment has no `.aw`. Native invocation uses
the selected root as cwd, explicit team ID, isolated disposable HOME and no
inherited credentials, controller state, external identity home or routing.
Membership is not an owner/admin claim; the server decides issuance authority.

Success prints the token once (plain stdout), or once at `result.token` inside
`{schemaVersion:1,ok:true,result}` with `--json`. Beside it, the joiner's
one-line command, which never holds the token (#56): `result.joinCommand` with
`--json`, and on stderr in text mode, so stdout stays the token alone:
`oats aweb setup --soul <soul> --invite-stdin --name <alias>` (the `--soul` the
invite was dispatched with, else `<soul>`; `<alias>` stays a placeholder for
the joining root's name, which a fresh joining machine needs), which reads the
token on stdin and needs aw 1.36.53 or later on the joining host. With `--json`, plan and apply
also answer `result.awebUrl`: the service the issuing root names (its
`.aw/workspace.yaml` `aweb_url`, as written), or `null`, never a guessed
default. Only a plain service URL is handed on: http(s), a host, an optional
port and a path of `/` or `/api` at most. A root that names none, or a URL
that could carry a credential (userinfo, a query, any other path), answers
`null`. It
is safe to hand on as the recipient's `--service`; the token is the secret part. Capture it privately and pass
only to the intended accepting operator's labelled `setup --invite-stdin`
procedure in `/oats-aweb` §8, **Invitations and certificate ownership**. Never
log, echo, put in argv/history, or send it as ordinary mail. Setup hands it to
`aw id team accept-invite --token-stdin` on stdin (aw 1.36.33, the provider's
floor), so it is in no process's argv on the accepting host.
A token is not bound to the future alias. Issuance is never automatically retried.

`E_INVITE_ARGUMENT`, `E_INVITE_DEPLOYMENT`, `E_INVITE_TEAM_QUERY`,
`E_INVITE_TEAM`, `E_INVITE_ROOT` and `E_INVITE_MEMBERSHIP` refuse before issuance.
Repair the selected input/context/root rather than substitute an ambient identity.
Unrelated kernel warnings do not block invitation; all failure-severity problems
and selected-label warnings do. Refusals name only known safe problem codes,
never arbitrary diagnostic text. Membership reads and issuance both isolate
native HOME; plans discard temporary state without changing the selected root.
For pinned aw 1.36.23, only its anchored CLI-generated HTTP 401/403 prefix maps
to `E_INVITE_DENIED`; details are statically withheld, never matched as role or
body prose. Other statuses, transport and unknown native errors are
`E_INVITE_NATIVE`; without an HTTP status its message names the cause from the
same fixed vocabulary as the join (aw's `--json` error code, an unreachable
service, or none of these) and the issuing root with the setting that chose it,
never aw's text or a token. Invalid successful native output is `E_INVITE_OUTPUT`.
Inspect an uncertain issuance before any deliberate retry. No mandatory authority
query or extra Cloud version floor is introduced. This act additionally requires
the selected kernel to dispatch `OATS_TEAM_SCOPE` and expose public
`teams --dir D --json` with `schemaVersion: 1`, `teamsApi: 2`, the selected
deployment, declarations and problems. The public fixture pins OATS 0.42 source
`bb2ba8c9a254edb745913b9c5a9d9b833fda932d`; it does not establish the earliest
compatible release. Unsupported/malformed query schemas refuse before minting.
The package-wide OATS >=0.42.0 floor applies to other behavior.
This source feature needs a
future provider release/composition and is not installed by this documentation.

### Isolated team-root verification

`test/setup-team-roots.test.mjs` exercises placement, parser remedies and current
join authority using controlled native and kernel JSON substitutes. The opt-in
`test/public-kernel-team-roots.test.mjs` executes public dispatch and inspect from
the same pinned kernel checkout used by the hostOnly gate. Run it with
`OATS_HOST_ONLY_REQUIRED=1 OATS_HOST_ONLY_KERNEL_ROOT=/absolute/pinned/checkout`.
It uses isolated local Git repositories and a fake aw; it does not verify live
service behavior or perform host onboarding.

The opt-in `test/username-native.test.mjs` checks #66 with an explicitly selected
real aw 1.36.23 executable (commit `61c38162596d1af9085741d70d15900ff9894257`).
Run `OATS_TEST_AW_1_36_23=/absolute/path/to/aw OATS_USERNAME_NATIVE_REQUIRED=1
node --test test/username-native.test.mjs`. It records the executable path,
version/build and SHA-256; isolated HOME and loopback service fixtures prevent
use of ambient accounts. Signup is deliberately refused: the test proves native
argument/wire acceptance, secret-output withholding and no root after refusal,
not successful hosted bootstrap or live membership.

`test/invite.test.mjs` covers selection and output failures. The opt-in
`test/invite-native.test.mjs` uses the same pinned executable above; run with
`OATS_TEST_AW_1_36_23=/absolute/path/to/aw OATS_INVITE_NATIVE_REQUIRED=1
node --test test/invite-native.test.mjs`. It exercises provider-to-native argv,
selected-root certificate routing, synthetic loopback success and plain-detail
HTTP denials, withheld hostile bodies, no-write plan and foreign controller-state
isolation. Generated keys/certificates and invite strings are fixtures, not live
authority or usable tokens. Native JSON decoding/missing-token failures exit
nonzero and remain `E_INVITE_NATIVE`; malformed exit-zero output is tested with
a substitute. The public-kernel fixture also dispatches invite planning through
the selected messaging soul. These checks do not prove a timed operator journey.

### Username mapping/default verification

Username setup and labelled join share the configuration/readback adapter in
`lib/setup-team-default.mjs`; `lib/setup-join-default.mjs` owns join membership and
preserve-default policy. The provider 1.23.0 (#70) username flow uses the selected
`OATS_CLI_BIN` with explicit deployment and sanitized kernel selectors for public
`teams --json`, `teams add` and `teams default`. It accepts `teamsApi: 2`, including
standalone `localTeams: null`; only explicit false/`local-teams-closed` is a policy
refusal, and only when the plan needs a team write. This act needs those public
query/mutation/readback features and selected deployment dispatch. The pinned OATS 0.42 source
`bb2ba8c9a254edb745913b9c5a9d9b833fda932d` is exercised evidence, not proof of an
earliest compatible release. The general package floor remains unchanged.

`test/setup-default.test.mjs` covers preflight, retained membership and injected
partial failures. The stateful public-CLI substitute is in
`test/helpers/fake-kernel-team-config.mjs`; the public-kernel fixture separately
executes real team mutations only in disposable deployments. The pinned username
native test also reads a generated retained certificate through actual aw and
resumes mapping without signup. Its deliberately refused loopback signup still
does not prove successful hosted account creation. Neither fixture is a timed
M3 operator journey. Run the existing full suite with the explicit public/native
test variables above; no service install or customer operation is part of testing.

### Grant duration and renewal verification

GLOBAL spawn and launch use the shared `lib/grant-duration.mjs` resolver.
It preserves absent/null/empty default aliases and Go duration syntax, including
component-wise nanosecond truncation. Launch validates before preview, broker
registration or retained-grant returns. LOCAL launch must keep its ordinary
joined-team lifecycle instead of entering the GLOBAL renewal early return.

Mint receipt validation lives in `lib/grant-expiry.mjs`: a never request
accepts `"never"` or a finite RFC3339 timestamp; a duration requires a finite
timestamp. Downstream code uses the recorded expiry, independently of the
requested TTL. Run `node --test --test-concurrency=1 test/minted-expiry.test.mjs
test/never-grant.test.mjs test/grant-expiry.test.mjs test/health-vocabulary.test.mjs`
for receipt validation, capped-seat startup and renewal, custody preflight,
expiry diagnostics and health classification. The fake-aw harness checks the
provider's contract; it does not establish live capped-mint acceptance.

Run `node --test test/grant-duration.test.mjs test/oats-aweb-hook-1-13.test.mjs`
for duration boundaries, mint arguments, default/explicit renewal and retained
failure/preview controls. With `OATS_TEST_AW_1_36_23` pointing at the pinned
1.36.23 executable, `test/grant-duration-native.test.mjs` checks version, help
and duration flag parsing in an isolated home. It always passes `--help`:
no mint executes, and syntactically valid out-of-range values can pass this
help check. The 60s..720h range and `never` are separately enforced by provider tests and
qualified against native source `61c38162596d1af9085741d70d15900ff9894257`
(`cmd/aw/id_grant.go`). These checks are not live custody, grant or expiry
acceptance. With `AW_REAL_CLI_BIN` pointing at a real aw 1.36.32 or later,
native or the npm JS shim, `test/never-grant.test.mjs` checks that it parses
`--ttl=never` and the durations OATS passes, in an empty directory where aw
stops before any network call.


For an isolated build of the exact native source pin, the same opt-in fixtures
also require `OATS_TEST_AW_SOURCE_RECEIPT=/absolute/path/to/receipt.json`.
The receipt must identify `kind: "exact-source-build"`, the exact source commit,
`sourceClean: true`, binary path, SHA256 and matching version output. Only
`1.36.23-source-fixture` at the pinned commit is accepted in this mode.
Record the build command/toolchain/platform separately; this is exact-source
contract evidence, not the historical published binary. Without that receipt,
the original published-version checks remain mandatory. The receipt validator
has wrong-version/source/hash/path controls. No fixture authorizes live requests.

The root recorder preserves block-style YAML around a replaced scalar, including
kernel-wrapped quoted paths; ambiguous continuations refuse rather than consuming
neighboring settings. Public dispatch tests cover first join followed by tokenless
resume through actual kernel serialization. Focused setup tests cover neighboring
roots/comments, partial failures, policy changes and explicit-default preservation.

### Resident create verification

`oats aweb resident create` lives in `lib/resident.mjs` (stages, key handling,
verify, record) and `lib/custody-unit.mjs` (the launchd and systemd units);
the shared `oats-local.yaml` writer is `lib/local-settings.mjs`. Its contract,
envelopes and coverage are in [docs/resident-create.md](docs/resident-create.md).

- Run `node --test <file>` separately for `test/resident-create.test.mjs`,
  `test/custody-unit.test.mjs`, `test/resident-custody-regressions.test.mjs`,
  `test/resident-docs.test.mjs` and `test/resident-cloud-captures.test.mjs`
  for the unit tests. The custody regressions exercise both platforms, including
  foreign-unit refusal without writes and rewriting an existing unit after
  the kernel-selected node path changes. Their fake aw (`test/helpers/fake-aw-resident.mjs`) replays only
  real captures from `test/fixtures/resident`, and fake launchctl, systemctl and
  loginctl record their calls under a temporary HOME. The prompt tests drive a
  real pseudo-terminal through `python3`. `test/resident-docs.test.mjs` fails
  when an envelope in the doc differs from the command's real output.
- `test/resident-journey.test.mjs` runs real aw against aweb's local stack. Bring
  the stack up from an aweb checkout at ci.yml's `AWEB_STACK_COMMIT` with
  `docker compose -f docker-compose.e2e.yml up -d --build --wait postgres redis
  awid aweb`, then set `OATS_RESIDENT_JOURNEY_AW` (an aw executable of
  `aw-compat.json`'s `min` or `tested`, at the commit the test qualifies it on),
  `OATS_RESIDENT_JOURNEY_AWEB_URL=http://127.0.0.1:18000` and
  `OATS_RESIDENT_JOURNEY_AWID_URL=http://127.0.0.1:18010`, and
  `OATS_RESIDENT_JOURNEY_KERNEL` (a checkout of an OATS kernel with
  `teams-conditional-default`, its dependencies installed with `npm ci`). Its
  adopt journeys load a real custody unit for a random test namespace (launchd
  on macOS, systemd --user on Linux, which needs lingering and
  `XDG_RUNTIME_DIR`) and remove it afterwards. The last three run the printed
  next steps through that kernel in a fixture workspace: the spawn mints a real
  grant at the resident's custody, and the retire revokes it. CI's
  `resident-journey` job runs them with `OATS_RESIDENT_JOURNEY_REQUIRED=1`, once
  for each of `min` and `tested`. Moving `tested` moves three things together:
  the matrix (`test/health-aw-floor.test.mjs` fails until it matches), the
  journey test's qualified aw and commit (its first test fails until they
  match), and the stack commit, to aweb's release of that aw (no test checks
  it).
- When aw's output contract changes, refresh the fixtures with
  `test/fixtures/resident/capture.sh <aw> <scratch dir>` against the same stack,
  and update its README's version, commit and date.

### Wake service verification

`oats aweb wake install|status|uninstall` lives in `lib/wake-service.mjs`. It
builds its unit from `lib/custody-unit.mjs`'s parts: the unit directory and
quoting, `searchPath`, the manager runner, linger and the running pid. Change
those parts only with both commands' tests green. Its contract, unit text and
errors are in [docs/wake-service.md](docs/wake-service.md).

- `node --test test/wake-service.test.mjs` covers both platforms against a fake
  host (`test/helpers/fake-wake-host.mjs`): fake aw, oats, systemctl,
  launchctl, loginctl and ps on a PATH holding nothing else, under a temporary
  HOME and XDG_CONFIG_HOME, with a fake kernel for `status`'s home walk.
- Never run `install` or `uninstall`, or a manager command, against a real
  user's units to test it. `systemctl --user` reaches the real user manager
  whatever HOME is, so a live systemd proof needs a disposable machine or
  user.

### GLOBAL grant app inventory (provider 1.23.2, #76)

The selected provider composition records the successful native mint's actual
`apps` and `skipped_apps` under `identity.grant`, bound to that grant ID. Native
aw 1.36.26 supplies this receipt; earlier receipts without both fields have
unavailable inventory, not an empty delegation. Valid empty arrays mean a known
empty snapshot. Malformed optional inventory produces `E_GRANT_APP_INVENTORY`
and unavailable metadata while preserving an otherwise-valid grant and its
existing lifecycle. This informational check is not an authority gate.

Comms describes the snapshot at spawn, not a dynamically refreshed grant.
All inventory briefs/advisories show only app IDs, tool counts and skip codes;
tool names, origins and digests stay out of instruction-bearing text. Read
`oats inspect --home <home> --json` for the current recorded identity/grant.
Launch preview's warning describes the retained snapshot; a pending renewal's
inventory is unknown until its receipt. Preview never mints. Successful
`renew: launch` records the new snapshot and emits an advisory; `renew: off`
retains the old one, including on restart. Failed renewal retains the previous
grant and snapshot under the existing recovery rules. No inventory implies
receive readiness, live app acceptance or automatically updated captured homes.

Preview requires selected-kernel warning projection: tested at OATS 0.47.0
source `e6e75ed8ba5a0a07a4b3e26fc627cac9064c730b`. OATS 0.42 source
`bb2ba8c9a254edb745913b9c5a9d9b833fda932d` persists the spawn snapshot through
inspect but omits preview warnings. Missing inventory in that older preview is
unreported/unsupported, not empty or no authority. These samples do not establish
the earliest supported release or change the package-wide floor.

The tested newer public kernel exposes the preview advisory in warnings, not a new
structured inventory field, and does not refresh spawn's Comms on renewal.
Kernel [#773](https://github.com/awebai/oats/issues/773) tracks those projection
limits. Provider code does not rewrite TASK or use environment/argv as a
metadata channel. No appTools setting, extra mint, discovery or new native flag
is introduced.

Implementation: `lib/grant-app-inventory.mjs` validates the optional pair as a
whole before persistence/display, copies only recognized fields, and bounds it
to 256 app entries, 1024 tools per app, 2048 characters per string and 64 KiB
of serialized inventory. Tool names in the recorded inventory must match
`^[A-Za-z0-9_][A-Za-z0-9_-]*$` without normalization. This is a deliberately
narrower informational contract than the native tool validator, not an authority
restriction. Unsupported/ambiguous display data becomes unavailable
without changing native authority; it is never trimmed or expanded. Current
receipt fixtures are byte copies of aw source873ed2bf; local substitute tests
do not prove live grant or Folio authority.

## Explicit round-trip probe

`oats aweb probe --home /absolute/canonical/home [--timeout 60] [--json]`
reports a verified nonce round trip when qualified CLI **and** server support
are available. It is an explicit send action, never a readiness/lifecycle check.
Admission requires the provider aw floor (1.36.33; the probe was
source-qualified at aw 1.36.28) and the exact selected hosted service `/meta`
`build.aweb_version` >=1.27.12; unavailable support refuses before sending.
There is no legacy fallback. The
selected-service guarantee holds modulo redirects issued by the selected origin
for unauthenticated heartbeat discovery only; signed mail and metadata refuse redirects. See [probe proof, JSON, compatibility and acceptance](docs/probe.md).

### Runtime delivery regression verification

`node --test test/oats-aweb-1-18.test.mjs test/codex-delivery-wire.test.mjs`
checks stale provider runtime, missing Codex target/primary stream, inconsistent
kernel receipts and retained native/joined routing. Readiness remains read-only.
With `OATS_PREVIEW_KERNEL_ROOT` selecting a real kernel installation or checkout,
`node --test test/public-kernel-codex-delivery.test.mjs` executes its
`prepareLaunchHooks` producer for preview, preflight and real provider hooks in
disposable homes. Ambient Claude selectors and a retained Claude recipe cannot
override the selected Codex runtime. This fixture uses fake aw for registration;
it does not start a harness or prove live receive. CI requires it against the
same pinned kernel as the launch-preview tests.

The sanitized live status sample and limits are recorded in
[test/fixtures/codex-delivery/README.md](test/fixtures/codex-delivery/README.md).

### Upgrade regression verification

`node --test test/oats-aweb-upgrade.test.mjs` checks literal historical and
current metadata, read-only planning, idempotent apply, safe runtime reads and
dispatch without `aw`. It shares the delivery fake-home fixture with the
1.18 tests. `test/oats-aweb-hook-1-13.test.mjs` checks the historical grant
upgrade followed by launch: registration precedes old-grant revocation, and a
failed registration keeps the old grant. All lifecycle effects use fake `aw`
and temporary homes. Run `npm run validate` for the manifests and schema.

CI also requires `test/public-kernel-upgrade.test.mjs` against the kernel at
`OATS_KERNEL_COMMIT`, with `OATS_PREVIEW_KERNEL_ROOT` selecting its checkout
and `OATS_PREVIEW_KERNEL_REQUIRED=1`. It uses the scratch-deployment helper,
fake aw and a sleeping harness: acquire local v1.17.1 package bytes for a
messaging seat and v1.31.0 bytes for a seat composing messaging and tasks,
spawn each global-grant session seat, re-lock to this branch, stop, plan/apply
upgrade, start and restart. It checks the module, migrated metadata, previous
version and upgrade event, and on each start that the new grant home is
registered before the previous grant is revoked and is the last registration.
For the same two versions it upgrades a local-identity Codex seat recorded
under `delivery: channel`, which 1.17.1 never registers with the broker: the
start and the restart each register `<home>/.aw` as a session home, and the
harness, a fake that records its argv and environment, launches with
`AWEB_DELIVERY=session` and no channel flag. CI fetches the provider tags at
checkout; the test never fetches or uses a live identity.
