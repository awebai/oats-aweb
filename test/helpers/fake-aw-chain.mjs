// A fake aw for spawn attribution (acmj.21): the --join-from mint of
// fake-aw-join-from.mjs plus aw's agent-child exchange as aweb main runs it
// (cmd/aw/id_child.go, id_parent.go, who.go). Identities are the `.aw` of the
// working directory; an installed chain is `.aw/id-chain.json`, as
// awconfig.installedIDChainPath writes it. An identity's id is `.aw/did` when
// present, else `did:key:z<directory name>`.
//
// Controls, per identity, as files in its `.aw`:
//   fake-who.json      `aw who --json` answers exactly this
// and by env:
//   FAKE_APPROVE_REFUSE=<reason>  `id child approve` refuses with that reason
//   FAKE_CHAIN_PAD=<n>            approve pads the child certificate by n bytes
//   FAKE_CHAIN_EXTRA=<n>          approve adds n extra certificates to the chain
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { joinFromFake } from "./fake-aw-join-from.mjs";

function write(p, c) { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, c); }

export function fakeAwChain(t) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "oats-aweb-chain-")));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const bin = join(base, "bin"), calls = join(base, "calls.jsonl");
  write(join(bin, "aw"), `#!${process.execPath}
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
let args = process.argv.slice(2).filter((a) => a !== "--json");
fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd(), identityHome: process.env.AWEB_IDENTITY_HOME || null }) + "\\n");
if (process.env.AWEB_IDENTITY_HOME) { console.error("fake aw: AWEB_IDENTITY_HOME must not reach a chain command"); process.exit(9); }
(${joinFromFake})(args);
const aw = path.join(process.cwd(), ".aw");
const flag = (n) => args.includes(n) ? args[args.indexOf(n) + 1] : undefined;
const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const idOf = () => fs.existsSync(path.join(aw, "did")) ? fs.readFileSync(path.join(aw, "did"), "utf8").trim() : "did:key:z" + path.basename(process.cwd());
const chain = () => fs.existsSync(path.join(aw, "id-chain.json")) ? readJson(path.join(aw, "id-chain.json")) : null;
const refuse = (reason) => { console.error("Error: " + reason); process.exit(1); };
const emit = (o) => console.log(JSON.stringify(o));
const writeOut = (file, data) => { if (fs.existsSync(file)) refuse("refusing to overwrite " + file); fs.writeFileSync(file, data); };
if (args[0] === "version") { console.log("aw 1.36.52-rc.2 fixture"); process.exit(0); }
if (args[0] === "who") {
  if (fs.existsSync(path.join(aw, "fake-who.json"))) { console.log(fs.readFileSync(path.join(aw, "fake-who.json"), "utf8")); process.exit(0); }
  const c = chain();
  if (!c) { emit({ id: idOf(), domain: "", outcome: "unknown", human_id: null, identity_valid: null, kind: null, reason: "legacy_no_chain" }); process.exit(0); }
  const certs = c.certificates.map((x) => x.certificate);
  const human = [...certs].reverse().find((x) => x.kind === "human");
  emit({ id: idOf(), domain: certs[0].domain, outcome: human ? "nearest_human" : "no_human", human_id: human ? human.id : null, identity_valid: true, kind: "agent", reason: "verified", chain: certs.map((x) => ({ id: x.id, kind: x.kind })) });
  process.exit(0);
}
if (args[0] === "id" && args[1] === "child" && args[2] === "invite") {
  const c = chain();
  if (!c) refuse(idOf() + " has no installed chain, so it issues no children; select --as-root or --human");
  const inv = { invitation_id: crypto.randomUUID(), parent: { kind: "identity", id: idOf() }, domain: c.certificates[0].certificate.domain, kind: flag("--kind"), expires_at: "2026-10-30T23:59:59Z" };
  fs.writeFileSync(path.join(aw, "invitation-" + inv.invitation_id + ".json"), JSON.stringify({ ...inv, recipient: flag("--recipient") }));
  emit(inv); process.exit(0);
}
if (args[0] === "id" && args[1] === "parent" && args[2] === "request") {
  const parent = flag("--parent");
  if (!/^did:(aw|key):/.test(parent || "")) refuse("name the parent: --parent <did:aw> or --root-parent");
  const request = { request: { v: 1, type: "aweb.id-certificate-request", request_id: crypto.randomUUID(), operation: "issue", id: idOf(), domain: flag("--domain"), parent: { kind: "identity", id: parent }, kind: "agent", subject_key: idOf(), invitation_id: flag("--invitation-id"), old_certificate: null }, signature: "sig" };
  fs.writeFileSync(path.join(aw, "outgoing-" + request.request.request_id + ".json"), JSON.stringify(request));
  writeOut(flag("--out"), JSON.stringify(request));
  console.error("Request " + request.request.request_id + " for " + idOf() + " (agent).");
  process.exit(0);
}
if (args[0] === "id" && args[1] === "child" && args[2] === "receive") {
  const req = readJson(args[3]).request;
  const invFile = path.join(aw, "invitation-" + req.invitation_id + ".json");
  if (!fs.existsSync(invFile)) refuse("invitation_not_found");
  const inv = readJson(invFile);
  if (req.parent.id !== inv.parent.id) refuse("request_binding_mismatch");
  fs.writeFileSync(path.join(aw, "received-" + req.request_id + ".json"), JSON.stringify(req));
  emit({ request_id: req.request_id, operation: "issue", invitation_id: req.invitation_id, state: "pending", id: req.id, domain: req.domain, parent: req.parent, kind: req.kind, fingerprint: "0000", recipient: inv.recipient });
  process.exit(0);
}
if (args[0] === "id" && args[1] === "child" && args[2] === "approve") {
  if (process.env.FAKE_APPROVE_REFUSE) refuse(process.env.FAKE_APPROVE_REFUSE);
  const req = readJson(path.join(aw, "received-" + args[3] + ".json"));
  const pad = "x".repeat(Number(process.env.FAKE_CHAIN_PAD || 0));
  const extra = Array.from({ length: Number(process.env.FAKE_CHAIN_EXTRA || 0) }, (_, i) => ({ certificate: { id: "did:key:zextra" + i, kind: "agent", domain: req.domain }, signature: "s" }));
  const child = { certificate: { v: 1, type: "aweb.id-certificate", id: req.id, domain: req.domain, parent: req.parent, kind: "agent", issuer_key: idOf(), issued_at: "2026-10-30T00:00:00Z", ...(pad ? { pad } : {}) }, signature: "sig" };
  const response = { v: 1, request_id: req.request_id, chain: { v: 1, type: "aweb.id-chain", certificates: [...chain().certificates, ...extra, child] } };
  writeOut(flag("--out"), JSON.stringify(response));
  process.exit(0);
}
if (args[0] === "id" && args[1] === "parent" && args[2] === "import") {
  const response = readJson(args[3]);
  if (!fs.existsSync(path.join(aw, "outgoing-" + response.request_id + ".json"))) refuse("request_binding_mismatch");
  fs.writeFileSync(path.join(aw, "id-chain.json"), JSON.stringify(response.chain));
  emit({ request_id: response.request_id, id: idOf(), registration: "" });
  process.exit(0);
}
if (args[0] === "wake") { process.exit(0); }
console.error("fake aw (chain): unexpected aw " + args.join(" ")); process.exit(3);
`);
  chmodSync(join(bin, "aw"), 0o755);
  return {
    path: `${bin}:${process.env.PATH}`,
    calls: () => { try { return readFileSync(calls, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } },
  };
}


/** An identity directory as aw keeps one: `.aw/did`, and an installed chain. */
export function writeIdentity(dir, { did, chain, who } = {}) {
  mkdirSync(join(dir, ".aw"), { recursive: true });
  writeFileSync(join(dir, ".aw", "signing.key"), "k\n");
  if (did) writeFileSync(join(dir, ".aw", "did"), did);
  if (chain) writeFileSync(join(dir, ".aw", "id-chain.json"), JSON.stringify({ v: 1, type: "aweb.id-chain", certificates: chain.map((c) => ({ certificate: { domain: "awtest-demo.example", ...c }, signature: "s" })) }));
  if (who) writeFileSync(join(dir, ".aw", "fake-who.json"), JSON.stringify(who));
}
