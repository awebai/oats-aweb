// `aw init --join-from=<root> --join-team=<team> --name=<alias>` as aw runs it
// (cmd/aw/init.go runInitJoinFrom), in aw 1.36.58's order (awebai/oats-aweb#240):
//   1. refuse a target home that already holds identity material;
//   2. mint one invite from the root (a refusal here ends with aw's
//      "; alternatively use --admission-team-id <team> with host authorization");
//   3. write the new member's signing.key (and, on a hosted invite, the
//      pending-hosted-accept marker): aw saves the key BEFORE the service call
//      (cmd/aw/id_team.go hostedAcceptSigningKeyAt, resolveOrGenerateMemberDIDKeyAt);
//   4. register the member with the service: an alias another agent holds is
//      refused here, after the key is written;
//   5. write team-certs/, identity.yaml and teams.yaml;
//   6. connect the workspace (workspace.yaml) and print one JSON object.
// Fakes embed it as `(${joinFromFake})(args)`: it handles a --join-from init and
// exits, and returns false for anything else. Self-contained (it runs inside a
// CommonJS fake), so it may use only `require` and its argument.
//
// FAKE_JOIN_FROM_REGISTRY names a JSON file, {"<team>": [member, ...]}: step 4
// appends the member there (alias, certificate_id, member_did_key, ...), and an
// alias with an unrevoked entry is refused as held. `membersFake` answers
// `aw id team members` from the same file.
//
// Refusals and cuts, selected by env:
//   FAKE_JOIN_FROM_NOT_MEMBER  the root cannot mint an invite for the team (step 2)
//   FAKE_JOIN_FROM_CONFLICT    the alias still holds an active certificate (step 4)
//   FAKE_JOIN_FROM_SELF_CUSTODY  the alias belongs to another self-custodial agent (aw 1.36.51, as captured on a VM; step 4)
//   FAKE_JOIN_FROM_PREVIEW     aw 1.36.53-rc.3 against a server without invite preview: the --json error envelope on stdout (as captured on a VM; step 4)
//   FAKE_JOIN_FROM_STOP_AFTER  "key", "register" or "cert": the command hangs after that step, as a mint killed there
//   FAKE_JOIN_FROM_FAIL_AFTER_REGISTER  the certificate cannot be saved after the registration: aw fails with this text
//   FAKE_JOIN_FROM_LATE        the home is written, then the command fails
//   FAKE_JOIN_FROM_GARBAGE     exit 0 with output that is not JSON
//   FAKE_JOIN_FROM_HANG        the home is written, then the command hangs
//   FAKE_JOIN_FROM_REGISTER_FIRST  NOT aw 1.36.58's order: the member is registered
//                              before any local file is written, then the command
//                              hangs. It models an aw that registers first, which is
//                              what retire's branch for a home with no key covers.
//   FAKE_JOIN_FROM_PROTECTED   a 403 at step 4: "reason" or "detail" carries protected_admission_required
//                              (a team aweb has protected), "other" another code, "none" no code
// FAKE_JOIN_FROM_REPLY (a JSON object) overrides fields of the success reply.
// A root with no .aw is refused like a non-member root.
export function joinFromFake(args) {
  const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
  const flag = (n) => args.find((a) => a.startsWith(n + "="))?.slice(n.length + 1) ?? (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
  if (args[0] !== "init" || flag("--join-from") === undefined) return false;
  const root = flag("--join-from"), team = flag("--join-team"), alias = flag("--name");
  if (!team || !alias) { console.error("fake aw: --join-team and --name are required by this fixture"); process.exit(2); }
  const aw = path.join(process.cwd(), ".aw");
  const hang = () => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30000); process.exit(0); };
  for (const name of ["signing.key", "identity.yaml", "team-certs", "workspace.yaml"]) {
    if (fs.existsSync(path.join(aw, name))) { console.error("Error: refusing to overwrite existing " + path.join(aw, name)); process.exit(2); }
  }
  // 2. The invite, from the root.
  if (process.env.FAKE_JOIN_FROM_NOT_MEMBER || !fs.existsSync(path.join(root, ".aw"))) {
    console.error("Error: create invite for " + team + " from " + root + ": 403 forbidden: not a member of the team; alternatively use --admission-team-id " + team + " with host authorization");
    process.exit(1);
  }
  // A real Ed25519 key, saved as aw saves it (the 32-byte seed in a PEM block), and its did:key.
  const { privateKey } = crypto.generateKeyPairSync("ed25519");
  const der = privateKey.export({ format: "der", type: "pkcs8" });
  const pem = "-----BEGIN ED25519 PRIVATE KEY-----\n" + Buffer.from(der.subarray(der.length - 32)).toString("base64") + "\n-----END ED25519 PRIVATE KEY-----\n";
  const pub = Buffer.from(crypto.createPublicKey(privateKey).export({ format: "jwk" }).x, "base64url");
  const base58 = (bytes) => {
    const A = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    let n = BigInt("0x" + Buffer.from(bytes).toString("hex")), s = "";
    while (n > 0n) { s = A[Number(n % 58n)] + s; n /= 58n; }
    for (const b of bytes) { if (b !== 0) break; s = "1" + s; }
    return s;
  };
  const did = "did:key:z" + base58([0xed, 0x01, ...pub]);
  const certificateId = "cert-" + alias;
  const registryFile = process.env.FAKE_JOIN_FROM_REGISTRY;
  const readRegistry = () => { try { return JSON.parse(fs.readFileSync(registryFile, "utf8")); } catch { return {}; } };
  const register = () => {
    if (!registryFile) return;
    const r = readRegistry();
    r[team] = [...(r[team] || []), { certificate_id: certificateId, team_id: team, alias, member_did_key: did, identity_scope: "local", issued_at: new Date().toISOString() }];
    fs.writeFileSync(registryFile, JSON.stringify(r));
  };
  if (process.env.FAKE_JOIN_FROM_REGISTER_FIRST) { register(); hang(); }
  // 3. The key, before the service call.
  fs.mkdirSync(aw, { recursive: true });
  fs.writeFileSync(path.join(aw, "signing.key"), pem, { mode: 0o600 });
  if (process.env.FAKE_JOIN_FROM_STOP_AFTER === "key") hang();
  // 4. The registration, and its refusals.
  if (process.env.FAKE_JOIN_FROM_PREVIEW) { console.log(JSON.stringify({ error: { code: "unknown_or_invalid", message: "unknown_or_invalid: Invite is unknown or invalid, or this service does not support invite preview. TOKEN-SHOULD-NOT-LEAK" } })); process.exit(1); }
  // aw prints a failure on stderr and, under --json, its error envelope on stdout (cmd/aw/root.go reportCLIError).
  const refuse = (text, error) => { console.error(text); console.log(JSON.stringify({ error: { ...error, message: text } })); process.exit(1); };
  if (process.env.FAKE_JOIN_FROM_SELF_CUSTODY) refuse('accept hosted team invite: registry http 403: {"detail":{"code":"self_custody_reinit_unproven","message":"This alias belongs to an agent that holds its own key, and this request does not prove it holds that key. Use a new alias, or ask the team owner to remove the existing agent if a first init left it half-made. TOKEN-SHOULD-NOT-LEAK"}}', { code: "http_error", http_status: 403, reason: "self_custody_reinit_unproven" });
  // A team aweb has protected refuses the member invite (spec acxy.7 C-8), as aw at
  // 44158f1bb reports a server refusal (awid error_detail.go DescribeError): code
  // http_error, the status, and the server's code as `reason` (a coded detail) or `detail` (a plain one).
  const protectedAs = process.env.FAKE_JOIN_FROM_PROTECTED;
  if (protectedAs === "reason") refuse('Error: accept invite: registry http 403: {"detail":{"code":"protected_admission_required","message":"This team admits agents only through an endorsed root."}}', { code: "http_error", http_status: 403, detail: "This team admits agents only through an endorsed root.", reason: "protected_admission_required" });
  if (protectedAs === "detail") refuse('Error: accept invite: registry http 403: {"detail":"protected_admission_required"}', { code: "http_error", http_status: 403, detail: "protected_admission_required" });
  if (protectedAs === "other") refuse('Error: accept invite: registry http 403: {"detail":{"code":"team_closed","message":"This team is closed."}}', { code: "http_error", http_status: 403, detail: "This team is closed.", reason: "team_closed" });
  if (protectedAs === "none") refuse("Error: accept invite: registry http 403: forbidden", { code: "http_error", http_status: 403 });
  const held = (readRegistry()[team] || []).some((m) => m.alias === alias && !m.revoked_at);
  if (process.env.FAKE_JOIN_FROM_CONFLICT || held) refuse("Error: accept invite: 409 conflict: alias " + alias + " already has an active certificate (invite TOKEN-SHOULD-NOT-LEAK)", { code: "alias_conflict", http_status: 409, reason: "alias_active" });
  register();
  if (process.env.FAKE_JOIN_FROM_STOP_AFTER === "register") hang();
  // aw saves the certificate after the registration and reports a failure to save it.
  if (process.env.FAKE_JOIN_FROM_FAIL_AFTER_REGISTER) refuse("Error: save team certificate " + path.join(aw, "team-certs") + ": " + process.env.FAKE_JOIN_FROM_FAIL_AFTER_REGISTER, { code: "error" });
  // 5. The certificate and the identity.
  const workspaceId = crypto.randomUUID(), service = "https://app.aweb.ai/api";
  const certPath = "team-certs/" + team.replace(/:/g, "__") + ".pem";
  fs.mkdirSync(path.join(aw, "team-certs"), { recursive: true });
  fs.writeFileSync(path.join(aw, certPath), JSON.stringify({ version: 1, certificate_id: certificateId, team_id: team, alias, member_did_key: did }));
  fs.writeFileSync(path.join(aw, "identity.yaml"), "alias: " + alias + "\nteam_id: " + team + "\ndid: " + did + "\n");
  fs.writeFileSync(path.join(aw, "teams.yaml"), "active_team: " + team + "\nmemberships:\n    - team_id: " + team + "\n      alias: " + alias + "\n      cert_path: " + certPath + "\n");
  if (process.env.FAKE_JOIN_FROM_STOP_AFTER === "cert") hang();
  // 6. The workspace.
  fs.writeFileSync(path.join(aw, "workspace.yaml"), "aweb_url: " + service + "\nmemberships:\n    - team_id: " + team + "\n      alias: " + alias + "\n      workspace_id: " + workspaceId + "\n      cert_path: " + certPath + "\n      joined_at: \"2026-09-30T00:00:00Z\"\nhuman_name: fixture\nworkspace_path: " + process.cwd() + "\n");
  if (process.env.FAKE_JOIN_FROM_LATE) { console.error("Error: connect: context deadline exceeded"); process.exit(1); }
  if (process.env.FAKE_JOIN_FROM_HANG) hang();
  if (process.env.FAKE_JOIN_FROM_GARBAGE) { console.log("TOKEN-SHOULD-NOT-LEAK not json"); process.exit(0); }
  console.log(JSON.stringify({ status: "connected", alias, team_id: team, workspace_id: workspaceId, aweb_url: service, ...JSON.parse(process.env.FAKE_JOIN_FROM_REPLY || "{}") }, null, 2));
  process.exit(0);
}

/** `aw id team members --team-id=<team> --json`, answered from FAKE_JOIN_FROM_REGISTRY
 *  (see joinFromFake), as aw prints it (cmd/aw/id_team.go teamMembersOutput). It exits
 *  for that command and returns false for anything else. FAKE_MEMBERS_FAIL makes the
 *  read fail as an unreachable registry does. Self-contained, as joinFromFake. */
export function membersFake(args) {
  const fs = require("node:fs");
  if (args.slice(0, 3).join(" ") !== "id team members") return false;
  const team = args.find((a) => a.startsWith("--team-id="))?.slice("--team-id=".length) ?? args[args.indexOf("--team-id") + 1];
  if (process.env.FAKE_MEMBERS_FAIL) { console.error("Error: list team members for " + team + ": registry unavailable"); process.exit(1); }
  let r = {}; try { r = JSON.parse(fs.readFileSync(process.env.FAKE_JOIN_FROM_REGISTRY, "utf8")); } catch {}
  console.log(JSON.stringify({ team_id: team, members: r[team] || [] }));
  process.exit(0);
}

/** The recorded `aw init --join-from` calls, and one flag's `--name=value`. */
export const joinFromCalls = (calls) => calls.filter((c) => c.args[0] === "init" && c.args.some((a) => a.startsWith("--join-from=")));
export const flagValue = (args, name) => args.find((a) => a.startsWith(name + "="))?.slice(name.length + 1);
