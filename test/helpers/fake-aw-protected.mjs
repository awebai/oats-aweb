// A fake aw for human attribution: the protected commands as aw built from
// aweb 859e07567 answers them (cli/go/cmd/aw id_create_unaddressed.go,
// id_endorse.go, id_team_admission_policy.go, id_team_admit.go,
// id_team_install_cert.go, id_team_remove_agent.go, service.go, errors.go), and the identity chain as released aw 1.36.58 runs
// it (who.go, id_child.go, id_parent.go). Their answers, field names, codes and
// refusals are aw's, not what is convenient.
//
// The one named deviation from 859e07567 (agreed with the lead, mail
// 34626247): a committed `aw id endorse` installs the root's chain (the
// human's certificate, then the root's) in the root's identity home, as aweb is
// asked to make it do. At 859e07567 it registers the chain and installs none,
// so the root couldn't issue.
//
// An identity is the `.aw` of the working directory, or `--identity-home`.
// Its id is `<home>/did` when present (a registered did:aw), else
// `did:key:z<name of the directory holding .aw>` (`-<label>` added for a
// joined team's `.aweb-identity-<label>`). An installed chain is
// `<home>/id-chain.json`; an installed team certificate is
// `<home>/team-certs/<team>.json`; a connected workspace `<home>/workspace.yaml`.
//
// Under --json a refusal prints aw's envelope {"error": {code, message}} on
// stdout and exits 1. The protected service is <base>/service.json:
//   policy: {version, digest, bounds}; teams: {<team>: "protected"|"legacy"|"missing"}
//   endorse: [answers, one per call]: "pending" | "committed" | {code}
//   admit: {code} | {lostOnce: true} (the first execute's answer is lost)
//   install: {code}; remove: "served" | "unserved" | {code}
//   policyRead: {code}; createKill: true (create --no-address dies after its key)
//   wake: "running" (the host wake broker runs; otherwise it doesn't)
// Every call is logged to <base>/calls.jsonl; every admission charge, keyed by
// operation id, to <base>/charges.json; every issued child to issued.jsonl.
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export const PROTECTED_AW_VERSION = "1.36.59-rc.2+859e075";
/** A protected team's policy as aw reports it (handoff/admission_policy.go
 *  decodeAdmissionPolicy: exactly these members; `teams` in code-point order). */
export const POLICY = Object.freeze({ version: 3, digest: `sha256:${"c".repeat(64)}`, teams: Object.freeze(["backend:acme.example", "ops:acme.example"]), root_selector: Object.freeze({ kind: "service_endorsed_root", service_id: "svc-acme" }), subject_kinds: Object.freeze(["agent"]), member_role: "member", bounds: Object.freeze({ max_active: 50, max_per_window: 10, rate_window_seconds: 3600 }) });

function write(p, c, mode) { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, c); if (mode) chmodSync(p, mode); }

export function fakeAwProtected(t, { service = {} } = {}) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "oats-aweb-protected-")));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const bin = join(base, "bin"), serviceFile = join(base, "service.json");
  writeFileSync(join(base, "registry.json"), JSON.stringify({ revoked: [], unavailable: false }));
  writeFileSync(serviceFile, JSON.stringify({ policy: POLICY, teams: {}, endorse: ["pending", "committed"], remove: "unserved", ...service }));
  writeFileSync(join(base, "charges.json"), "{}");
  write(join(bin, "aw"), `#!${process.execPath}
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const base = ${JSON.stringify(base)};
let args = process.argv.slice(2);
let identityHome = null;
const take = (name) => { const i = args.indexOf(name); if (i < 0) return undefined; const v = args[i + 1]; args = [...args.slice(0, i), ...args.slice(i + 2)]; return v; };
identityHome = take("--identity-home") || null;
fs.appendFileSync(path.join(base, "calls.jsonl"), JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd(), identityHome }) + "\\n");
if (process.env.AWEB_IDENTITY_HOME) { console.error("fake aw: an inherited AWEB_IDENTITY_HOME reached aw"); process.exit(9); }
const json = args.includes("--json");
args = args.filter((a) => a !== "--json");
process.umask(0o077);
const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const svc = () => readJson(path.join(base, "service.json"));
const saveSvc = (s) => fs.writeFileSync(path.join(base, "service.json"), JSON.stringify(s));
const emit = (o) => { console.log(JSON.stringify(o, null, 2)); process.exit(0); };
const fail = (code, message, exit = 1) => { console.error("Error: " + message); if (json) console.log(JSON.stringify({ error: { code, message } })); process.exit(exit); };
const usage = (message) => fail("", message, 2);
const flag = (n) => args.includes(n) ? args[args.indexOf(n) + 1] : undefined;
const flags = (n) => args.flatMap((a, i) => a === n ? [args[i + 1]] : []);
const cmd = args.slice(0, 3).join(" ");
const homeDir = () => identityHome || path.join(process.cwd(), ".aw");
const keyOf = (h) => { const label = /^\.aweb-identity-(.+)$/.exec(path.basename(h)); return "did:key:z" + path.basename(path.dirname(h)) + (label ? "-" + label[1] : ""); };
const idOf = (h) => fs.existsSync(path.join(h, "did")) ? fs.readFileSync(path.join(h, "did"), "utf8").trim() : keyOf(h);
const chainOf = (h) => fs.existsSync(path.join(h, "id-chain.json")) ? readJson(path.join(h, "id-chain.json")) : null;
const state = () => readJson(path.join(base, "registry.json"));
const store = (h, name) => { const d = path.join(h, name); fs.mkdirSync(d, { recursive: true, mode: 0o700 }); return d; };
const profile = () => { const p = flag("--protected-profile"); if (!p) usage("--protected-profile is required"); if (!fs.existsSync(p)) fail("profile_invalid", "the protected-service profile is not valid"); return p; };
const opId = () => { const u = flag("--operation-id"); if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(u || "")) usage("--operation-id must be a lowercase UUID"); return u; };
const registered = (h) => { if (!fs.existsSync(path.join(h, "signing.key"))) fail("", "no identity in " + h); const id = idOf(h); if (!id.startsWith("did:aw:")) usage("only a registered root (with a did:aw) can request an admission"); return id; };
if (args[0] === "version") { console.log("aw " + (process.env.FAKE_AW_VERSION || ${JSON.stringify(PROTECTED_AW_VERSION)})); console.log("  commit: fake"); process.exit(0); }
if (args[0] === "init") { fs.appendFileSync(path.join(base, "forbidden.jsonl"), JSON.stringify({ args }) + "\\n"); fail("", "the legacy --join-from mint must not run on an opted-in deployment", 97); }
if (args[0] === "wake" && args[1] === "status") emit(svc().wake === "running" ? { daemon_running: true, daemon_version_state: "reported", daemon_version: ${JSON.stringify(PROTECTED_AW_VERSION.replace(/^aw /, "").split("+")[0])}, instances: [] } : { daemon_running: false, daemon_version_state: "not_running", instances: [] });
if (args[0] === "wake") { console.log("ok"); process.exit(0); }

// ---- id create --local | --no-address (id_create_unaddressed.go)
if (cmd === "id create --local" || cmd === "id create --no-address") {
  const local = args[2] === "--local";
  if (!identityHome) usage((local ? "--local" : "--no-address") + " requires an explicit --identity-home for the new identity");
  const h = identityHome, registry = flag("--registry");
  if (!local && !registry) usage("--no-address requires --registry: the registry origin its did:aw is registered at");
  const pending = path.join(h, ".unaddressed-create.json");
  const has = (n) => fs.existsSync(path.join(h, n));
  if (local && has("signing.key") && has("identity.yaml") && !has("workspace.yaml") && !has("team-certs") && !has("did")) emit({ status: "already_exists", did_key: keyOf(h), identity_home: h });
  if ((has("identity.yaml") || has("workspace.yaml") || has("team-certs")) || (has("signing.key") && !fs.existsSync(pending))) fail("identity_exists", h + " already holds an identity");
  if (fs.existsSync(pending) && readJson(pending).registry !== (registry || null)) fail("identity_exists", h + " holds a creation for another registry");
  const resumed = fs.existsSync(pending);
  fs.mkdirSync(h, { recursive: true, mode: 0o700 });
  if (!resumed) { fs.writeFileSync(path.join(h, "signing.key"), "k\\n", { mode: 0o600 }); fs.writeFileSync(pending, JSON.stringify({ registry: registry || null })); }
  if (!local && svc().createKill && !resumed) process.kill(process.pid, "SIGKILL");
  const didKey = keyOf(h), result = { status: resumed ? "resumed" : "created", did_key: didKey, identity_home: h };
  if (!local) { const didAw = "did:aw:" + path.basename(path.dirname(h)); fs.writeFileSync(path.join(h, "did"), didAw); Object.assign(result, { did_aw: didAw, registry_url: registry }); }
  fs.writeFileSync(path.join(h, "identity.yaml"), "did: " + didKey + "\\n" + (local ? "" : "stable_id: did:aw:" + path.basename(path.dirname(h)) + "\\n"), { mode: 0o600 });
  fs.rmSync(pending, { force: true });
  emit(result);
}

// ---- id endorse (id_endorse.go), run from the root's home
if (cmd.startsWith("id endorse")) {
  const human = flag("--human"); if (!human) usage("--human is required: the did:aw of the human who endorses this root");
  const op = opId(); profile();
  const h = homeDir(), root = registered(h), teams = flags("--team");
  if (!flag("--deployment-label")) usage("--deployment-label is required: the deployment's name the human sees");
  if (!teams.length) usage("--team must name each team once, at least one");
  const s = svc();
  const ops = path.join(base, "endorse-ops.json"); const known = fs.existsSync(ops) ? readJson(ops) : {};
  const intent = JSON.stringify({ human, teams: [...teams].sort(), root, label: flag("--deployment-label") });
  if (known[op] && known[op].intent !== intent) fail("operation_conflict", "operation " + op + " was requested with other inputs or at another service; a changed endorsement needs a new operation id");
  if (!known[op]) {
    for (const team of teams) { const mode = s.teams[team] || (s.policy.teams.includes(team) ? "protected" : "missing"); if (mode !== "protected") fail("admission_policy_missing", "team " + team + " has no protected admission policy at this service"); }
    known[op] = { intent, prepared: 0 }; known[op].prepared++;
    fs.writeFileSync(ops, JSON.stringify(known));
  }
  const answer = s.endorse.length > 1 ? s.endorse.shift() : s.endorse[0]; saveSvc(s);
  if (answer && typeof answer === "object") fail(answer.code, "operation " + op + " is " + (answer.state || "refused") + ": " + answer.code);
  if (answer === "pending") emit({ operation_id: op, state: "pending", reason: "awaiting_human", page: "https://human.example/approve/" + op, digest: "sha256:" + "d".repeat(64), fingerprint: "dddddddddddddddd", expires_at: "2026-11-13T19:00:00Z" });
  // committed: registered and read back; the deviation: the chain is installed.
  const certificate_id = crypto.createHash("sha256").update(op).digest("hex").slice(0, 32);
  const human_cert = { certificate: { v: 1, type: "aweb.id-certificate", id: human, domain: "acme.example", parent: { kind: "namespace", id: "acme.example" }, kind: "human" }, signature: "s" };
  const root_cert = { certificate: { v: 1, type: "aweb.id-certificate", id: root, domain: "acme.example", parent: { kind: "identity", id: human }, kind: "agent" }, signature: "s" };
  fs.writeFileSync(path.join(h, "id-chain.json"), JSON.stringify({ v: 1, type: "aweb.id-chain", certificates: [human_cert, root_cert] }), { mode: 0o600 });
  delete known[op]; fs.writeFileSync(ops, JSON.stringify(known));
  emit({ operation_id: op, state: "committed", certificate_id, registered: true });
}

// ---- id team admission-policy (id_team_admission_policy.go), as the root
if (cmd === "id team admission-policy") {
  const team = flag("--team"); if (!team) usage("--team is required");
  profile(); registered(homeDir());
  const s = svc();
  if (s.policyRead) fail(s.policyRead.code, "team " + team + ": " + s.policyRead.code);
  // A protected team the policy doesn't list has no policy for it: admission_policy_missing (RequireAdmissionPolicy).
  const mode = s.teams[team] || (s.policy.teams.includes(team) ? "protected" : "missing");
  if (mode === "missing") fail("admission_policy_missing", "team " + team + ": team " + team + " has no protected admission policy at this service");
  emit({ service_id: "svc-acme", team_id: team, mode, policy: mode === "protected" ? s.policy : null });
}

// ---- id team admit (id_team_admit.go), as the root
if (cmd === "id team admit") {
  for (const f of ["--team", "--member-key", "--alias", "--policy-digest", "--certificate-out"]) if (!flag(f)) usage(f + " is required");
  if (!(Number(flag("--policy-version")) >= 1)) usage("--policy-version must be the positive version aw id team admission-policy reported");
  const op = opId(); profile(); const root = registered(homeDir());
  const team = flag("--team"), s = svc();
  const charges = readJson(path.join(base, "charges.json"));
  const body = JSON.stringify({ team, key: flag("--member-key"), id: flag("--member-id") || "", alias: flag("--alias"), v: flag("--policy-version"), d: flag("--policy-digest"), root });
  if (charges[op] && charges[op].body !== body) fail("operation_conflict", "operation " + op + " was requested with other inputs or at another service; changed inputs need a new operation id");
  if (!charges[op]) {
    if (s.admit && s.admit.code) fail(s.admit.code, "operation " + op + ": " + s.admit.code);
    if (flag("--policy-digest") !== s.policy.digest || Number(flag("--policy-version")) !== s.policy.version) fail("policy_changed", "operation " + op + " is refused: policy_changed");
    charges[op] = { body, certificate_id: crypto.randomUUID(), team, alias: flag("--alias"), member_did_key: flag("--member-key"), member_did_aw: flag("--member-id") || "" };
    fs.writeFileSync(path.join(base, "charges.json"), JSON.stringify(charges));
    if (s.admit && s.admit.lostOnce) { delete s.admit; saveSvc(s); fail("receipt_unavailable", "operation " + op + "'s execute answer was lost and it is still pending; resume it with the same operation id"); }
  }
  const c = charges[op];
  const cert = { version: 1, certificate_id: c.certificate_id, team_id: team, team_did_key: "did:key:zteam", member_did_key: c.member_did_key, ...(c.member_did_aw ? { member_did_aw: c.member_did_aw } : {}), alias: c.alias, identity_scope: c.member_did_aw ? "global" : "local", issued_at: "2026-11-13T00:00:00Z", signature: "sig" };
  const out = flag("--certificate-out"), text = JSON.stringify(cert, null, 2) + "\\n";
  if (fs.existsSync(out) && fs.readFileSync(out, "utf8") !== text) fail("certificate_out_exists", out + " already holds another file; the service keeps the certificate, so move the file and run again");
  if (!fs.existsSync(path.dirname(out))) fail("", "open " + out + ": no such file or directory");
  fs.writeFileSync(out, text, { mode: 0o600 });
  emit({ operation_id: op, state: "committed", certificate_out: out });
}

// ---- id team install-cert (id_team_install_cert.go)
if (cmd === "id team install-cert") {
  const cf = flag("--certificate"); if (!cf) usage("--certificate is required: the certificate file to install");
  if (!identityHome) usage("install-cert requires an explicit --identity-home: the home whose identity it names");
  const h = identityHome, s = svc();
  let cert; try { cert = readJson(cf); if (!cert.certificate_id) throw 0; } catch { fail("certificate_invalid", cf + " is not a team certificate"); }
  if (cert.member_did_key !== keyOf(h)) fail("member_mismatch", "the certificate names member " + cert.member_did_key + ", not this home's identity " + keyOf(h));
  if (s.install && s.install.code) fail(s.install.code, "install: " + s.install.code);
  const dest = path.join(store(h, "team-certs"), cert.team_id.replace(":", "__") + ".json");
  let status = "installed";
  if (fs.existsSync(dest)) { if (readJson(dest).certificate_id !== cert.certificate_id) fail("certificate_conflict", h + " already holds certificate for " + cert.team_id); status = "already_installed"; }
  fs.writeFileSync(dest, JSON.stringify(cert), { mode: 0o600 });
  emit({ status, team_id: cert.team_id, alias: cert.alias, certificate_id: process.env.FAKE_INSTALL_CERT_ID || cert.certificate_id, did_key: keyOf(h), identity_home: h, ...(cert.member_did_aw ? { did_aw: cert.member_did_aw } : {}) });
}

// ---- id team remove-agent (id_team_remove_agent.go), as the root
if (cmd === "id team remove-agent") {
  const cf = flag("--certificate"); if (!cf) usage("--certificate is required");
  const op = opId(); profile(); registered(homeDir());
  let cert; try { cert = readJson(cf); } catch { fail("certificate_invalid", cf + " is not a team certificate"); }
  const s = svc();
  if (s.remove === "unserved") fail("receipt_unavailable", "the protected service does not answer team.agent.remove");
  if (s.remove && typeof s.remove === "object") fail(s.remove.code, "operation " + op + ": " + s.remove.code);
  fs.appendFileSync(path.join(base, "removed.jsonl"), JSON.stringify({ certificate_id: cert.certificate_id, operation_id: op }) + "\\n");
  emit({ operation_id: op, state: "committed", certificate_id: cert.certificate_id });
}

// ---- service init (service.go)
if (args[0] === "service" && args[1] === "init") {
  if (!flag("--service")) usage("--service is required");
  const h = homeDir();
  fs.writeFileSync(path.join(h, "workspace.yaml"), "alias: " + path.basename(path.dirname(h)) + "\\nteam_id: " + flag("--team") + "\\naweb_url: " + flag("--service") + "\\n", { mode: 0o600 });
  console.log("Connected"); process.exit(0);
}

// ---- workspace delete, team list, id team members
if (args[0] === "workspace" && args[1] === "delete") { const h = homeDir(); if (!fs.existsSync(path.join(h, "workspace.yaml"))) fail("", "no workspace in " + h); fs.rmSync(path.join(h, "workspace.yaml")); emit({ alias: args[2], alias_released: false, alias_released_reason: "protected_team" }); }
if (args[0] === "team" && args[1] === "list") emit({ memberships: [] });

// ---- the identity chain, as aw 1.36.58 runs it
const aw = homeDir();
if (!fs.existsSync(path.join(aw, "signing.key"))) fail("", "no identity in " + aw + "; run aw init first");
const id = idOf(aw), c = chainOf(aw);
if (args[0] === "who") {
  if (fs.existsSync(path.join(aw, "fake-who.json"))) { console.log(fs.readFileSync(path.join(aw, "fake-who.json"), "utf8")); process.exit(0); }
  const result = (outcome, reason, extra = {}) => emit({ id, domain: extra.domain ?? "", outcome, human_id: extra.human_id ?? null, identity_valid: extra.identity_valid ?? null, kind: extra.kind ?? null, reason, ...(extra.chain ? { chain: extra.chain } : {}) });
  if (!c) { if (id.startsWith("did:key:")) result("unknown", "legacy_no_chain"); result("unknown", "unregistered_identity"); }
  const certs = c.certificates.map((x) => x.certificate), domain = certs[certs.length - 1].domain;
  if (certs[certs.length - 1].id !== id) result("unknown", "subject_mismatch", { identity_valid: false, domain });
  const s = state();
  if (s.unavailable) result("unavailable", "status_expired", { domain });
  const revokedAt = certs.findIndex((x) => s.revoked.includes(x.id));
  if (revokedAt >= 0) result("unknown", revokedAt === certs.length - 1 ? "revoked" : "parent_revoked", { identity_valid: false, domain });
  const human = [...certs].reverse().find((x) => x.kind === "human");
  result(human ? "nearest_human" : "no_human", "verified", { identity_valid: true, kind: certs[certs.length - 1].kind, human_id: human ? human.id : null, domain, chain: certs.map((x) => ({ id: x.id, kind: x.kind })) });
}
if (cmd === "id child invite") {
  if (!c) fail("", id + " has no installed chain, so it issues no children; select --as-root or --human");
  const inv = { invitation_id: crypto.randomUUID(), parent: { kind: "identity", id }, domain: c.certificates[c.certificates.length - 1].certificate.domain, kind: flag("--kind"), expires_at: "2026-11-13T23:59:59Z" };
  fs.writeFileSync(path.join(store(aw, "id-invitations"), inv.invitation_id + ".json"), JSON.stringify({ ...inv, recipient: flag("--recipient") }));
  emit(inv);
}
if (cmd === "id parent request") {
  if (c) fail("", id + " already has an installed ID chain; a request issues only a first certificate");
  const request = { request: { v: 1, type: "aweb.id-certificate-request", request_id: crypto.randomUUID(), operation: "issue", id, domain: flag("--domain"), parent: { kind: "identity", id: flag("--parent") }, kind: "agent", subject_key: id, invitation_id: flag("--invitation-id") }, signature: "sig" };
  fs.writeFileSync(path.join(store(aw, "id-requests"), request.request.request_id + ".json"), JSON.stringify(request));
  const out = flag("--out"); if (fs.existsSync(out)) fail("", "refusing to overwrite " + out);
  fs.writeFileSync(out, JSON.stringify(request), { mode: 0o600 });
  process.exit(0);
}
if (cmd === "id child receive") {
  const req = readJson(args[3]).request;
  const invFile = path.join(aw, "id-invitations", req.invitation_id + ".json");
  if (!fs.existsSync(invFile)) fail("", "invitation_not_found");
  fs.writeFileSync(path.join(store(aw, "id-received"), req.request_id + ".json"), JSON.stringify(req));
  emit({ request_id: req.request_id, operation: "issue", invitation_id: req.invitation_id, state: "pending", id: req.id, domain: req.domain, parent: req.parent, kind: req.kind });
}
if (cmd === "id child approve") {
  const file = path.join(aw, "id-received", args[3] + ".json");
  if (!fs.existsSync(file)) fail("", "request_not_found");
  const req = readJson(file), issuer = c.certificates;
  if (issuer.length + 1 > 8) fail("", "depth_exceeded");
  const child = { certificate: { v: 1, type: "aweb.id-certificate", id: req.id, domain: req.domain, parent: req.parent, kind: "agent" }, signature: "sig" };
  const out = flag("--out"); if (fs.existsSync(out)) fail("", "refusing to overwrite " + out);
  fs.writeFileSync(out, JSON.stringify({ v: 1, request_id: req.request_id, chain: { v: 1, type: "aweb.id-chain", certificates: [...issuer, child] } }), { mode: 0o600 });
  fs.appendFileSync(path.join(base, "issued.jsonl"), JSON.stringify({ issuer: id, child: req.id }) + "\\n");
  process.exit(0);
}
if (cmd === "id child refuse") emit({ request_id: args[3], state: "refused" });
if (cmd === "id parent import") {
  const response = readJson(args[3]);
  if (!fs.existsSync(path.join(aw, "id-requests", response.request_id + ".json"))) fail("", "request_binding_mismatch");
  fs.writeFileSync(path.join(aw, "id-chain.json"), JSON.stringify(response.chain), { mode: 0o600 });
  emit({ request_id: response.request_id, id, registration: id.startsWith("did:aw:") ? "registered" : "" });
}
console.error("fake aw (protected): unexpected aw " + process.argv.slice(2).join(" ")); process.exit(3);
`);
  chmodSync(join(bin, "aw"), 0o755);
  const lines = (f) => { try { return readFileSync(join(base, f), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };
  const readService = () => JSON.parse(readFileSync(serviceFile, "utf8"));
  return {
    base,
    path: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`,
    calls: () => lines("calls.jsonl"),
    forbidden: () => lines("forbidden.jsonl"),
    issued: () => lines("issued.jsonl"),
    removed: () => lines("removed.jsonl"),
    charges: () => JSON.parse(readFileSync(join(base, "charges.json"), "utf8")),
    service: readService,
    setService: (change) => writeFileSync(serviceFile, JSON.stringify({ ...readService(), ...change })),
    revoke: (id) => { const s = JSON.parse(readFileSync(join(base, "registry.json"), "utf8")); s.revoked.push(id); writeFileSync(join(base, "registry.json"), JSON.stringify(s)); },
    unavailable: (on = true) => { const s = JSON.parse(readFileSync(join(base, "registry.json"), "utf8")); s.unavailable = on; writeFileSync(join(base, "registry.json"), JSON.stringify(s)); },
  };
}

/** An identity home as aw keeps one, owner-only: `signing.key`, `identity.yaml`,
 *  an optional `did` (registered) and an installed chain of {id, kind, parent}. */
export function writeIdentity(identityHome, { did, chain } = {}) {
  mkdirSync(identityHome, { recursive: true, mode: 0o700 });
  chmodSync(identityHome, 0o700);
  write(join(identityHome, "signing.key"), "k\n", 0o600);
  write(join(identityHome, "identity.yaml"), `did: did:key:z${identityHome.split("/").at(-2)}${/^\.aweb-identity-/.test(identityHome.split("/").at(-1)) ? `-${identityHome.split("/").at(-1).slice(".aweb-identity-".length)}` : ""}\n`, 0o600);
  if (did) write(join(identityHome, "did"), did, 0o600);
  if (chain) write(join(identityHome, "id-chain.json"), JSON.stringify({ v: 1, type: "aweb.id-chain", certificates: chain.map((c) => ({ certificate: { v: 1, type: "aweb.id-certificate", domain: "acme.example", ...c }, signature: "s" })) }), 0o600);
}
