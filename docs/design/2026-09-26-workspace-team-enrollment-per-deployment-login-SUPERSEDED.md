# Workspace-team enrollment with a per-deployment login (oats.aweb 1.16) — SUPERSEDED

> **SUPERSEDED 2026-09-26, never implemented.** Two things in this note were withdrawn the same day:
> - there is no "personal team": a workspace has its default team (the human's directive);
> - no human login is ever in the provider's path, not even per deployment. Creating a workspace's team is an owner's act outside OATS that produces a root identity; OATS only consumes the root. aweb adds the logged-in account to `aw auth status` and an expected-account check, as optional human tooling.
>
> Record of decision: oats-knowledge, integrations-expert decision "A workspace has a default team; there is no personal team". The text below is kept as the record of the withdrawn design.



Status: SUPERSEDED 2026-09-26 (was approved by the co-leads earlier that day). Supersedes the enrollment half of 1.15, which is
shipped gated off. Depends on an aweb CLI change (section 4).

## 1. Problem

oats.aweb 1.15 (main f9972d50) mints each workspace's personal team with
`aw team ensure --workspace-key <key>`, authorised by the host's human login
(`aw auth login`). In released aw that login is one file per OS user,
`$HOME/.config/aw/auth.json` (the admission scope in
`auth.cli_team_admission.json` beside it), with no per-deployment override.
`aw auth status --json` reports status, issuer, resource, scope and expiry,
but not which human account is logged in.

A host commonly serves several people's teams under one OS user (the
maintainer's machine serves at least four human aweb accounts). Every
`team ensure` on that host binds to whichever account last logged in. A
deployment that belongs to person B gets its personal team, and every
instance identity minted in it, in person A's account. Nothing detects it.

That breaks the teams contract: an instance lives in its own person's
personal team for the workspace.

## 2. Decision (OATS side)

1. **The credential lives with the deployment.** A host-only setting
   `settings.oats.aweb.auth.dir` (default `<deployment>/.oats/aweb/auth`,
   created 0700) names the directory that holds this deployment's human
   login. It is host state: gitignored, never committed, never copied by
   `oats sync`, never carried into an instance home or a retirement
   recovery (a test asserts each). The provider passes it to every `aw auth …` and `aw team ensure …`
   call. It never falls back to the OS user's default location. `oats aweb
   setup` runs the device-flow login into that directory.
2. **The expected owner is recorded.** A host-only setting
   `settings.oats.aweb.auth.owner` records the person this deployment
   belongs to: the stable aweb account id that `aw auth status` reports,
   plus the person's GitHub login (in OATS a user IS a GitHub account).
   `oats aweb setup` shows both and writes them at login, after the human
   confirms them.
3. **One deployment = one person on a host.** Every instance in the
   deployment mints under the deployment's owner, whoever spawns it. A
   second person on the same host uses their own deployment.
4. **Mint only on a match.** Before any `team ensure`, the provider reads
   `aw auth status --json` from the deployment's directory. It proceeds only
   when the status is authorized AND the account id equals the recorded
   owner. Otherwise it refuses before any network mint:
   - no login: `authorization-required` (remedy: `oats aweb setup`);
   - a different account: `personal-team-owner-mismatch`, naming both
     handles (remedy: log in as the owner in this deployment, or change the
     owner deliberately with `oats aweb setup --owner`);
   - no recorded owner: `needs-configuration` (remedy: `oats aweb setup`).
5. **Readiness is read-only.** It reports the same states from `aw auth
   status` and the read-only spawn authority; it never mints.
6. **Unchanged from 1.15:** the per-workspace personal team through `team
   ensure` into `roots.personal`; the `local/` workspace-key fallback with its
   warning; joined teams; the multi-identity wake registration; the typed
   error prefixes; unknown failures kept raw and closed.

The kernel needs nothing: these are capability settings in the host's
`oats-local.yaml`.

## 3. What an operator sees

- One login per deployment, done once by the person who owns it:
  `oats aweb setup` (device flow; the handle is shown and confirmed).
- Four people's deployments on one machine: four logins in four
  deployment directories; none overrides another.
- A deployment copied to another machine without its auth directory:
  readiness says `authorization-required`; nothing is minted into anyone
  else's account.

## 4. What aweb must provide (requested 2026-09-26)

Minimum, both needed:

- **A selectable credential location** for `aw auth login|status|logout`
  and `aw team ensure` (a flag such as `--auth-dir <dir>` or an environment
  variable), used instead of `$HOME/.config/aw` when given.
- **The account in `aw auth status --json`**: a stable account id and the
  handle, so a consumer can check it against a recorded owner.

Named account profiles (`--account <name>`) would also work in place of the
first, provided status reports the account.

## 5. Tests and gate for 1.16

- Every auth and ensure call carries the deployment's auth directory (a fake
  aw fails any call without it).
- Owner mismatch, missing owner and missing login each refuse before any
  `team ensure`, with the remedy text.
- Live gate on the published aw that ships section 4: two deployments on one
  host logged in as two different accounts; each mints its personal team in
  its own account; a swapped login refuses with the owner mismatch; then the
  1.15 lifecycle (join, live receive, leave, retire).
