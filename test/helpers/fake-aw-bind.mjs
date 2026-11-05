// A fake aw for the bind (`oats aweb setup --steward`, aweb-acrn): a global
// steward identity in its own directory, and aweb Cloud's agent-adoption
// routes behind `aw id request`, as aweb Cloud runs them
// (routers/agent_adoption_requests.py). `--raw` prints the body with one
// newline added when it has none and `HTTP <status>` on stderr, and a 4xx or
// 5xx exits 1, as cli/go/cmd/aw/id_request.go does.
//
// The identity is the `.aw` of the working directory. Cloud's answers are
// read from <base>/cloud.json at each call, so a test can change them:
//   context   {status, body}: GET /api/v1/agent-adoptions/<agent>
//   submit    {status, body}: POST .../requests (the body is logged)
//   statuses  [status, ...]: GET .../requests/<id>, one per call, the last repeats
//   response  the body of GET .../requests/<id>/response
//   importRefusesNewline  `aw id parent import` refuses a file ending in a newline
// Every call is logged as {args, cwd, env} to <base>/calls.jsonl, and every
// submitted body to <base>/submissions.jsonl.
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const STEWARD = { alias: "steward", stableId: "did:aw:steward1", didKey: "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK", domain: "acme.aweb.ai", team: "default:acme.aweb.ai", agentId: "0b6f3c1e-58f4-4c1b-9d0a-1e2f3a4b5c6d" };
export const HUMAN = "did:aw:human1";
export const CLOUD = "https://cloud.example.test";

export function fakeBindAw(base, cloud = {}) {
  const bin = join(base, "bin");
  mkdirSync(bin, { recursive: true });
  const state = { base, steward: STEWARD, human: HUMAN, cloud: CLOUD };
  writeFileSync(join(base, "cloud.json"), JSON.stringify(cloud));
  const script = `#!${process.execPath}
const fs = require("node:fs"), path = require("node:path");
const state = ${JSON.stringify(state)};
const argv = process.argv.slice(2);
fs.appendFileSync(path.join(state.base, "calls.jsonl"), JSON.stringify({ args: argv, cwd: process.cwd(), env: { AWEB_API_KEY: process.env.AWEB_API_KEY ?? null, AWEB_IDENTITY_HOME: process.env.AWEB_IDENTITY_HOME ?? null } }) + "\\n");
const cloud = JSON.parse(fs.readFileSync(path.join(state.base, "cloud.json"), "utf8"));
const aw = path.join(process.cwd(), ".aw");
const s = state.steward;
const args = argv.filter((a) => a !== "--json");
const flag = (n) => args.includes(n) ? args[args.indexOf(n) + 1] : undefined;
const out = (o) => { process.stdout.write(JSON.stringify(o, null, 2) + "\\n"); process.exit(0); };
const fail = (m) => { process.stderr.write("Error: " + m + "\\n"); process.exit(1); };
const has = (f) => fs.existsSync(path.join(aw, f));
if (process.env.AWEB_IDENTITY_HOME) fail("AWEB_IDENTITY_HOME must not reach the steward's commands");
if (args[0] === "version") { process.stdout.write("aw 1.36.54\\n  commit: fake\\n"); process.exit(0); }
if (args[0] === "init") {
  if (!process.env.AWEB_API_KEY) fail("no API key");
  fs.mkdirSync(aw, { recursive: true });
  for (const f of ["identity.yaml", "signing.key"]) fs.writeFileSync(path.join(aw, f), "");
  fs.writeFileSync(path.join(aw, "workspace.yaml"), "aweb_url: " + process.env.AWEB_URL + "\\n");
  out({ address: s.domain + "/" + flag("--name"), alias: flag("--name"), aweb_url: process.env.AWEB_URL, identity_scope: "global", name: flag("--name"), stable_id: s.stableId, status: "connected", team_id: s.team, workspace_id: "ws-1" });
}
if (args[0] === "id" && args.includes("--help")) { process.stdout.write("Make a DIDKey-signed HTTP request with the local identity key\\n"); process.exit(0); }
if (!has("signing.key") && !has("grant.yaml")) fail("no identity in " + process.cwd());
const custody = has("fake-custody") ? fs.readFileSync(path.join(aw, "fake-custody"), "utf8").trim() : "self";
if (args[0] === "whoami") out({ address: s.domain + "/" + s.alias, alias: s.alias, custody, did: s.didKey, domain: s.domain, identity_scope: "global", name: s.alias, stable_id: s.stableId });
if (args[0] === "doctor" && args[1] === "identity") out({ status: "ok", checks: [{ id: "identity.key", status: "ok" }], subject: { identity_scope: "global", alias: s.alias, team_id: s.team, workspace_id: "ws-1" } });
if (args[0] === "doctor" && args[1] === "registry") out({ status: "ok", checks: [] });
if (args[0] === "workspace" && args[1] === "status") out({ workspace: { agent_id: has("fake-no-agent-id") ? null : s.agentId, alias: s.alias, workspace_id: "ws-1" }, team: [] });
if (args[0] === "who") {
  if (!has("id-chain.json")) out({ identity_valid: false, outcome: "legacy_no_chain" });
  out({ identity_valid: true, outcome: "nearest_human", human_id: JSON.parse(fs.readFileSync(path.join(aw, "id-chain.json"), "utf8")).human });
}
if (args[0] === "id" && args[1] === "request") {
  if (custody !== "self") fail("current identity has no local signing key");
  const [method, url] = [args[2], new URL(args[3])];
  const raw = args.includes("--raw");
  const reply = (status, body) => {
    const text = typeof body === "string" ? body : JSON.stringify(body);
    if (raw) { process.stdout.write(text.endsWith("\\n") ? text : text + "\\n"); process.stderr.write("HTTP " + status + "\\n"); }
    else process.stdout.write(JSON.stringify({ status, body: text }) + "\\n");
    if (status >= 400) { process.stderr.write("Error: request failed with status " + status + "\\n"); process.exit(1); }
    process.exit(0);
  };
  if (url.origin !== state.cloud) reply(404, { detail: "Not Found" });
  const m = /^\\/api\\/v1\\/agent-adoptions\\/([^/]+)(?:\\/requests(?:\\/([^/]+)(\\/response)?)?)?$/.exec(url.pathname);
  if (!m) reply(404, { detail: "Not Found" });
  if (m[1] !== s.agentId) reply(404, { detail: "Agent not found" });
  if (method === "GET" && !url.pathname.includes("/requests")) {
    const c = cloud.context || { status: 200, body: { parent: { kind: "identity", id: state.human }, domain: s.domain, kind: "agent", invitation_id: "inv-" + Date.now(), subject_id: s.stableId, subject_key: s.didKey } };
    reply(c.status, c.body);
  }
  if (method === "POST" && !m[2]) {
    const body = fs.readFileSync(flag("--body-file"), "utf8");
    fs.appendFileSync(path.join(state.base, "submissions.jsonl"), JSON.stringify({ body, header: flag("--header") ?? null }) + "\\n");
    const doc = JSON.parse(body);
    const c = cloud.submit || { status: 200, body: { request_id: "req-1", status: "pending", expires_at: "2026-11-06T10:00:00Z", deployment_label: doc.deployment_label, approval_path: "/account/adoptions/" + s.agentId + "/req-1?team_id=t1" } };
    reply(c.status, c.body);
  }
  if (method === "GET" && m[2] && !m[3]) {
    const seen = path.join(state.base, "status-reads");
    const n = fs.existsSync(seen) ? Number(fs.readFileSync(seen, "utf8")) : 0;
    fs.writeFileSync(seen, String(n + 1));
    const list = cloud.statuses || ["issued"];
    reply(200, { request_id: m[2], status: list[Math.min(n, list.length - 1)], expires_at: "2026-11-06T10:00:00Z", deployment_label: "x", approval_path: "/account/adoptions/" + s.agentId + "/" + m[2] + "?team_id=t1" });
  }
  if (method === "GET" && m[3]) reply(200, cloud.response ?? JSON.stringify({ v: 1, request_id: "req-1", chain: [{ human: state.human }] }));
  reply(405, { detail: "Method Not Allowed" });
}
if (args[0] === "id" && args[1] === "parent" && args[2] === "request") {
  const file = flag("--out");
  if (fs.existsSync(file)) fail("refusing to overwrite " + file);
  fs.writeFileSync(file, JSON.stringify({ v: 1, request: { operation: "issue", kind: "agent", id: s.stableId, subject_key: s.didKey, domain: flag("--domain"), invitation_id: flag("--invitation-id"), parent: { kind: "identity", id: flag("--parent") } }, proof: "sig" }) + "\\n");
  out({ request_id: "csr-1", fingerprint: "SHA256:fake", out: file });
}
if (args[0] === "id" && args[1] === "parent" && args[2] === "import") {
  const body = fs.readFileSync(args[3], "utf8");
  if (cloud.importRefusesNewline && body.endsWith("\\n")) fail("invalid response: trailing data");
  const doc = JSON.parse(body);
  fs.writeFileSync(path.join(aw, "id-chain.json"), JSON.stringify({ human: doc.chain[0].human, domain: flag("--domain") }));
  out({ status: "imported", request_id: doc.request_id });
}
fail("fake aw: unsupported " + argv.join(" "));
`;
  writeFileSync(join(bin, "aw"), script);
  chmodSync(join(bin, "aw"), 0o755);
  const lines = (f) => existsSync(join(base, f)) ? readFileSync(join(base, f), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
  return {
    bin,
    setCloud: (c) => writeFileSync(join(base, "cloud.json"), JSON.stringify(c)),
    calls: () => lines("calls.jsonl"),
    submissions: () => lines("submissions.jsonl"),
  };
}

/** A complete steward identity in `home`, as `aw init --global` leaves it. */
export function seedSteward(home, { custody, awebUrl = CLOUD + "/api" } = {}) {
  mkdirSync(join(home, ".aw"), { recursive: true });
  for (const f of ["identity.yaml", "signing.key"]) writeFileSync(join(home, ".aw", f), "");
  writeFileSync(join(home, ".aw", "workspace.yaml"), `aweb_url: ${awebUrl}\n`);
  if (custody) writeFileSync(join(home, ".aw", "fake-custody"), custody);
}
