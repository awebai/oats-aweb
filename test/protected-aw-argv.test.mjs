// Acceptance test 20's --help check (spec v4.3.16): every aw command line in C-2,
// C-3 (the exchange included), C-5 and C-6 is checked against the one built aw's --help, and each JSON
// answer and error envelope is pinned against that binary as far as it can
// answer with no server. The aw is built from aweb 44158f1bb (cli/go) and named
// by OATS_AWEB_PROTECTED_AW; without it the tests skip, and
// OATS_AWEB_PROTECTED_AW_REQUIRED=1 turns a skip into a failure.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { admissionPolicyArgv, admitArgv, createLocalArgv, createNoAddressArgv, endorseArgv, installCertArgv, removeAgentArgv, serviceInitArgv } from "../oats-package/capabilities/oats-aweb/lib/protected-client.mjs";

const AW = process.env.OATS_AWEB_PROTECTED_AW;
if (process.env.OATS_AWEB_PROTECTED_AW_REQUIRED === "1" && !AW) throw new Error("OATS_AWEB_PROTECTED_AW_REQUIRED=1 needs OATS_AWEB_PROTECTED_AW, the aw built from aweb 44158f1bb");
const skip = !AW && "set OATS_AWEB_PROTECTED_AW to the aw built from aweb 44158f1bb";

function scratch(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "oats-aweb-protected-aw-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
/** aw with a private HOME and no ambient identity or registry. */
function aw(t, args, { cwd } = {}) {
  const home = scratch(t);
  const env = { PATH: process.env.PATH, HOME: home, AW_NO_UPDATE_CHECK: "1", XDG_CONFIG_HOME: join(home, ".config") };
  return spawnSync(AW, args, { cwd: cwd || home, env, encoding: "utf8", timeout: 30000 });
}
/** The flags a subcommand's --help lists, its global flags included. */
function helpFlags(t, path) {
  const r = aw(t, [...path, "--help"]);
  assert.equal(r.status, 0, r.stderr);
  return new Set([...r.stdout.matchAll(/^\s+(?:-\w, )?(--[a-z][a-z-]*)\b/gm)].map((m) => m[1]));
}
/** argv's subcommand path (its command words, after a leading --identity-home <h>, up to
 *  the first flag or positional argument) and its flags, that global one included. */
function split(argv) {
  let words = argv.filter((a) => a !== "--json");
  const global = words[0] === "--identity-home" ? ["--identity-home"] : [];
  if (global.length) words = words.slice(2);
  const end = words.findIndex((a) => !/^[a-z][a-z-]*$/.test(a));
  return { path: words.slice(0, end), flags: [...global, ...words.slice(end).filter((a) => a.startsWith("--"))] };
}

const P = "/srv/deploy/profile.json", ROOT = "/srv/deploy/.aweb-endorsed-root/acme-root";
const LINES = {
  "C-2 step 2, id create --no-address": createNoAddressArgv({ identityHome: `${ROOT}/.aw`, registry: "https://registry.example" }),
  "C-2 step 4, id endorse --no-wait": endorseArgv({ human: "did:aw:human", teams: ["backend:acme.example", "ops:acme.example"], label: "acme", operationId: "3f2b8c1e-9d4a-4b6e-8f0a-1c2d3e4f5a6b", profile: P }),
  "C-2 step 6, the waiting rerun": endorseArgv({ human: "did:aw:human", teams: ["backend:acme.example"], label: "acme", operationId: "3f2b8c1e-9d4a-4b6e-8f0a-1c2d3e4f5a6b", profile: P, wait: true }),
  "C-2 step 6, id team admission-policy": admissionPolicyArgv({ team: "backend:acme.example", profile: P }),
  "C-3 step 1, id create --local": createLocalArgv({ identityHome: "/srv/deploy/agents/dev/instances/dev-1/.aw" }),
  "C-3 step 3, id team admit (local child)": admitArgv({ team: "backend:acme.example", memberKey: "did:key:z6Mk", alias: "dev-1", policy: { version: 3, digest: `sha256:${"a".repeat(64)}` }, operationId: "3f2b8c1e-9d4a-4b6e-8f0a-1c2d3e4f5a6b", certificateOut: "/h/.oats-aweb/admission-default.cert", profile: P }),
  "C-3 step 3, id team admit (registered child)": admitArgv({ team: "backend:acme.example", memberKey: "did:key:z6Mk", memberId: "did:aw:res", alias: "res", policy: { version: 3, digest: `sha256:${"a".repeat(64)}` }, operationId: "3f2b8c1e-9d4a-4b6e-8f0a-1c2d3e4f5a6b", certificateOut: "/h/c.cert", profile: P }),
  "C-3 step 3, id team install-cert": installCertArgv({ identityHome: "/h/.aw", certificate: "/h/.oats-aweb/admission-default.cert", registry: "https://registry.example" }),
  "C-3 step 3, service init": serviceInitArgv({ identityHome: "/h/.aw", service: "https://aweb.example/api", team: "backend:acme.example" }),
  // C-3 step 2, the exchange as issueChain runs it (lib/attribution.mjs): the issuer's side, then the child's.
  "C-3 step 2, id child invite": ["--identity-home", `${ROOT}/.aw`, "id", "child", "invite", "--kind", "agent", "--recipient", "dev-1", "--expires", "10m", "--json"],
  "C-3 step 2, id parent request": ["--identity-home", "/h/.aw", "id", "parent", "request", "--invitation-id", "inv-1", "--parent", "did:aw:root", "--domain", "acme.example", "--out", "/h/.oats-aweb/attribution/request.json"],
  "C-3 step 2, id child receive": ["--identity-home", `${ROOT}/.aw`, "id", "child", "receive", "/h/.oats-aweb/attribution/request.json", "--json"],
  "C-3 step 2, id child approve": ["--identity-home", `${ROOT}/.aw`, "id", "child", "approve", "req-1", "--out", "/h/.oats-aweb/attribution/response.json"],
  "C-3 step 2, id parent import": ["--identity-home", "/h/.aw", "id", "parent", "import", "/h/.oats-aweb/attribution/response.json", "--domain", "acme.example", "--json"],
  "C-3 step 2, id child refuse": ["--identity-home", `${ROOT}/.aw`, "id", "child", "refuse", "req-1", "--json"],
  "C-3 step 4, who": ["--identity-home", "/h/.aw", "who", "--json"],
  "C-5 and C-6, id team remove-agent": removeAgentArgv({ certificate: `${ROOT}/admissions/3f2b8c1e-9d4a-4b6e-8f0a-1c2d3e4f5a6b.cert`, operationId: "3f2b8c1e-9d4a-4b6e-8f0a-1c2d3e4f5a6b", profile: P }),
};

for (const [name, argv] of Object.entries(LINES)) {
  test(`${name}: every flag is in aw's --help`, { skip }, (t) => {
    const { path, flags } = split(argv);
    const listed = helpFlags(t, path);
    for (const flag of [...flags, ...(argv.includes("--json") ? ["--json"] : [])]) assert.ok(listed.has(flag), `aw ${path.join(" ")} has no ${flag}: ${[...listed].join(" ")}`);
  });
}

test("the argv is exactly as the spec writes it", () => {
  assert.deepEqual(LINES["C-2 step 4, id endorse --no-wait"], ["--json", "id", "endorse", "--human", "did:aw:human", "--team", "backend:acme.example", "--team", "ops:acme.example", "--deployment-label", "acme", "--operation-id", "3f2b8c1e-9d4a-4b6e-8f0a-1c2d3e4f5a6b", "--protected-profile", P, "--no-wait", "--no-browser"]);
  assert.deepEqual(LINES["C-3 step 3, id team admit (local child)"], ["--json", "id", "team", "admit", "--team", "backend:acme.example", "--member-key", "did:key:z6Mk", "--alias", "dev-1", "--policy-version", "3", "--policy-digest", `sha256:${"a".repeat(64)}`, "--operation-id", "3f2b8c1e-9d4a-4b6e-8f0a-1c2d3e4f5a6b", "--certificate-out", "/h/.oats-aweb/admission-default.cert", "--protected-profile", P]);
  assert.deepEqual(LINES["C-2 step 2, id create --no-address"], ["--json", "id", "create", "--no-address", "--identity-home", `${ROOT}/.aw`, "--registry", "https://registry.example"]);
  assert.deepEqual(LINES["C-5 and C-6, id team remove-agent"], ["--json", "id", "team", "remove-agent", "--certificate", `${ROOT}/admissions/3f2b8c1e-9d4a-4b6e-8f0a-1c2d3e4f5a6b.cert`, "--operation-id", "3f2b8c1e-9d4a-4b6e-8f0a-1c2d3e4f5a6b", "--protected-profile", P]);
});

test("id create --local answers {status, did_key, identity_home}, and a rerun answers already_exists with the same key", { skip }, (t) => {
  const home = join(scratch(t), ".aw");
  const first = aw(t, createLocalArgv({ identityHome: home }));
  assert.equal(first.status, 0, first.stderr);
  const created = JSON.parse(first.stdout);
  assert.deepEqual(Object.keys(created).sort(), ["did_key", "identity_home", "status"]);
  assert.equal(created.status, "created");
  assert.match(created.did_key, /^did:key:z/);
  assert.equal(created.identity_home, home);
  const again = JSON.parse(aw(t, createLocalArgv({ identityHome: home })).stdout);
  assert.deepEqual(again, { ...created, status: "already_exists" });
});

test("a coded refusal is aw's envelope on stdout, {error: {code, message}}, with a nonzero exit", { skip }, (t) => {
  const dir = scratch(t), home = join(dir, ".aw");
  assert.equal(aw(t, createLocalArgv({ identityHome: home })).status, 0);
  writeFileSync(join(dir, "junk.cert"), "not a certificate\n");
  const r = aw(t, installCertArgv({ identityHome: home, certificate: join(dir, "junk.cert") }));
  assert.notEqual(r.status, 0);
  const doc = JSON.parse(r.stdout.trim());
  assert.equal(doc.error.code, "certificate_invalid");
  assert.equal(typeof doc.error.message, "string");
});

test("id create --no-address into a home that holds a local identity refuses identity_exists", { skip }, (t) => {
  const home = join(scratch(t), ".aw");
  assert.equal(aw(t, createLocalArgv({ identityHome: home })).status, 0);
  const r = aw(t, createNoAddressArgv({ identityHome: home, registry: "https://registry.invalid" }));
  assert.notEqual(r.status, 0);
  assert.equal(JSON.parse(r.stdout.trim()).error.code, "identity_exists");
});

test("id create --local into a home of another identity refuses identity_exists", { skip }, (t) => {
  const dir = scratch(t), home = join(dir, ".aw");
  assert.equal(aw(t, createLocalArgv({ identityHome: home })).status, 0);
  writeFileSync(join(home, "workspace.yaml"), "alias: other\n");
  const r = aw(t, createLocalArgv({ identityHome: home }));
  assert.notEqual(r.status, 0, r.stdout);
  assert.equal(JSON.parse(r.stdout.trim()).error.code, "identity_exists");
});
