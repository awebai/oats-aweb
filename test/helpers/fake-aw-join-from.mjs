// `aw init --join-from=<root> --join-team=<team> --name=<alias>` as aw 1.36.17
// runs it (cmd/aw/init.go runInitJoinFrom): refuse a target home that already
// holds identity material, mint one invite from the root, accept it into the
// home and connect the workspace, then print one JSON object. Fakes embed it as
// `(${joinFromFake})(args)`: it handles a --join-from init and exits, and
// returns false for anything else. Self-contained (it runs inside a CommonJS
// fake), so it may use only `require` and its argument.
//
// Refusals, selected by env:
//   FAKE_JOIN_FROM_NOT_MEMBER  the root cannot mint an invite for the team
//   FAKE_JOIN_FROM_CONFLICT    the alias still holds an active certificate
//   FAKE_JOIN_FROM_LATE        the home is written, then the command fails
//   FAKE_JOIN_FROM_GARBAGE     exit 0 with output that is not JSON
//   FAKE_JOIN_FROM_HANG        the home is written, then the command hangs
// FAKE_JOIN_FROM_REPLY (a JSON object) overrides fields of the success reply.
// A root with no .aw is refused like a non-member root.
export function joinFromFake(args) {
  const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
  const flag = (n) => args.find((a) => a.startsWith(n + "="))?.slice(n.length + 1) ?? (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
  if (args[0] !== "init" || flag("--join-from") === undefined) return false;
  const root = flag("--join-from"), team = flag("--join-team"), alias = flag("--name");
  if (!team || !alias) { console.error("fake aw: --join-team and --name are required by this fixture"); process.exit(2); }
  const aw = path.join(process.cwd(), ".aw");
  for (const name of ["signing.key", "identity.yaml", "team-certs", "workspace.yaml"]) {
    if (fs.existsSync(path.join(aw, name))) { console.error("Error: refusing to overwrite existing " + path.join(aw, name)); process.exit(2); }
  }
  if (process.env.FAKE_JOIN_FROM_NOT_MEMBER || !fs.existsSync(path.join(root, ".aw"))) {
    console.error("Error: create invite for " + team + " from " + root + ": 403 forbidden: not a member of the team; alternatively use --admission-team-id " + team + " with host authorization");
    process.exit(1);
  }
  if (process.env.FAKE_JOIN_FROM_CONFLICT) { console.error("Error: accept invite: 409 conflict: alias " + alias + " already has an active certificate (invite TOKEN-SHOULD-NOT-LEAK)"); process.exit(1); }
  const workspaceId = crypto.randomUUID(), service = "https://app.aweb.ai/api";
  const certPath = "team-certs/" + team.replace(/:/g, "__") + ".pem";
  fs.mkdirSync(path.join(aw, "team-certs"), { recursive: true });
  fs.writeFileSync(path.join(aw, "signing.key"), "fixture-key\n");
  fs.writeFileSync(path.join(aw, "identity.yaml"), "alias: " + alias + "\nteam_id: " + team + "\n");
  fs.writeFileSync(path.join(aw, certPath), JSON.stringify({ version: 1, certificate_id: "cert-" + alias, team_id: team, alias }));
  fs.writeFileSync(path.join(aw, "teams.yaml"), "active_team: " + team + "\nmemberships:\n    - team_id: " + team + "\n      alias: " + alias + "\n      cert_path: " + certPath + "\n");
  fs.writeFileSync(path.join(aw, "workspace.yaml"), "aweb_url: " + service + "\nmemberships:\n    - team_id: " + team + "\n      alias: " + alias + "\n      workspace_id: " + workspaceId + "\n      cert_path: " + certPath + "\n      joined_at: \"2026-09-30T00:00:00Z\"\nhuman_name: fixture\nworkspace_path: " + process.cwd() + "\n");
  if (process.env.FAKE_JOIN_FROM_LATE) { console.error("Error: connect: context deadline exceeded"); process.exit(1); }
  if (process.env.FAKE_JOIN_FROM_HANG) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30000); process.exit(0); }
  if (process.env.FAKE_JOIN_FROM_GARBAGE) { console.log("TOKEN-SHOULD-NOT-LEAK not json"); process.exit(0); }
  console.log(JSON.stringify({ status: "connected", alias, team_id: team, workspace_id: workspaceId, aweb_url: service, ...JSON.parse(process.env.FAKE_JOIN_FROM_REPLY || "{}") }, null, 2));
  process.exit(0);
}

/** The recorded `aw init --join-from` calls, and one flag's `--name=value`. */
export const joinFromCalls = (calls) => calls.filter((c) => c.args[0] === "init" && c.args.some((a) => a.startsWith("--join-from=")));
export const flagValue = (args, name) => args.find((a) => a.startsWith(name + "="))?.slice(name.length + 1);
