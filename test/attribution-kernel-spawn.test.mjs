// Acceptance test 23 (spec v4.3.12), through a real kernel: a spawn refusal
// reaches `oats spawn --json` as the kernel's error.message, holding its code
// and its fix. The kernel must list spawn-attribution (OATS 0.69.8 or later);
// it is the checkout OATS_ATTRIBUTION_KERNEL_ROOT names, else the test skips,
// and OATS_ATTRIBUTION_KERNEL_REQUIRED=1 turns a skip into a failure. Only
// fakes and a private HOME: no aw state, identity or tmux server of the host's
// is touched, and the spawn never launches.
// E_PROTECTED_ADMISSION_REQUIRED's half runs on a deployment that never opted
// in (C-8); its hook-level tests are in attribution-protected-403.test.mjs.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ENDORSEMENT_OP, HUMAN, OPS, PROFILE_TEXT, ROOT_ID, SERVICE_URL, TEAM } from "./helpers/attribution-fixture.mjs";
import { POLICY, fakeAwProtected, writeIdentity } from "./helpers/fake-aw-protected.mjs";
import { fakeAwWake } from "./helpers/fake-aw-wake.mjs";

const KERNEL = process.env.OATS_ATTRIBUTION_KERNEL_ROOT;
if (process.env.OATS_ATTRIBUTION_KERNEL_REQUIRED === "1" && !KERNEL) throw new Error("OATS_ATTRIBUTION_KERNEL_REQUIRED=1 needs OATS_ATTRIBUTION_KERNEL_ROOT, an OATS kernel checkout that lists spawn-attribution");
const CAPABILITY = fileURLToPath(new URL("../oats-package/capabilities/oats-aweb", import.meta.url));

/** An opted-in deployment of a workspace whose soul composes this checkout's oats.aweb;
 *  with `neverOptedIn`, one with no setting whose team aweb has protected: its member
 *  invite is refused 403 protected_admission_required (C-8). */
function deployment(t, service, { neverOptedIn = false } = {}) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "oats-aweb-attr-kernel-")));
  const tmux = realpathSync(mkdtempSync("/tmp/aak."));
  t.after(() => { rmSync(base, { recursive: true, force: true }); rmSync(tmux, { recursive: true, force: true }); });
  const host = join(base, "source"), dep = join(base, "deployment"), home = join(base, "home");
  for (const d of [join(host, "souls", "probe"), join(dep, "agents"), home]) mkdirSync(d, { recursive: true });
  let fake, path;
  if (neverOptedIn) {
    // The legacy mint's fake, behind an aw that answers its registration with the protected 403.
    fake = fakeAwWake(t);
    const wrapper = join(base, "protected-bin");
    mkdirSync(wrapper);
    writeFileSync(join(wrapper, "aw"), `#!/bin/sh\nFAKE_JOIN_FROM_PROTECTED=reason exec "${fake.path.split(":")[0]}/aw" "$@"\n`, { mode: 0o755 });
    path = `${wrapper}:${fake.path}`;
  } else { fake = fakeAwProtected(t, { service }); path = fake.path; }
  const env = { PATH: `${path}:${dirname(process.execPath)}:/usr/bin:/bin`, HOME: home, TMUX_TMPDIR: tmux, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", OATS_REMOTE_CACHE: join(base, "cache"), AW_NO_UPDATE_CHECK: "1" };
  const ref = pathToFileURL(host).href;
  writeFileSync(join(host, "oats-workspace.yaml"), `schemaVersion: 2\nname: fixture\nmembers:\n  - ${ref}\nteams:\n  default: { team: '${TEAM}' }\n  ops: { team: '${OPS}' }\ndefaultTeam: default\nlocalTeams: true\ndefaults:\n  messaging:\n    oats.aweb: { from: local/${host} }\n`);
  writeFileSync(join(host, "oats-membership.yaml"), `schemaVersion: 2\nworkspace: ${ref}\n`);
  writeFileSync(join(host, "souls", "probe", "soul.yaml"), "schemaVersion: 2\nname: probe\ndescription: probe\nwork: directory\ncapabilities:\n  oats.core: off\n");
  writeFileSync(join(host, "souls", "probe", "AGENTS.md"), "Fixture only.\n");
  cpSync(CAPABILITY, join(host, "capabilities", "oats-aweb"), { recursive: true });
  const git = (...args) => execFileSync("git", ["-C", host, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args], { env });
  git("init", "-q"); git("add", "."); git("commit", "-qm", "fixture");
  // The legacy minting root, inventory only, and the endorsed root with its chain.
  const legacy = join(dep, ".aweb-roots", "default");
  writeIdentity(join(legacy, ".aw"));
  const rootHome = join(dep, ".aweb-endorsed-root", "acme-root");
  mkdirSync(rootHome, { recursive: true, mode: 0o700 });
  writeIdentity(join(rootHome, ".aw"), { did: ROOT_ID, chain: [{ id: HUMAN, kind: "human", parent: { kind: "namespace", id: "acme.example" } }, { id: ROOT_ID, kind: "agent", parent: { kind: "identity", id: HUMAN } }] });
  const profile = join(dep, "protected-profile.json");
  writeFileSync(profile, PROFILE_TEXT, { mode: 0o600 });
  const attribution = {
    root: { id: ROOT_ID, home: rootHome }, human: { id: HUMAN, label: "Juan Pérez" },
    service: { id: "svc-acme", profile, profileDigest: `sha256:${createHash("sha256").update(PROFILE_TEXT).digest("hex")}`, url: SERVICE_URL },
    teams: [TEAM, OPS], endorsement: { operationId: ENDORSEMENT_OP, policy: { version: POLICY.version, digest: POLICY.digest } },
  };
  // A harness that is never launched (the spawn refuses first). It answers
  // every call at once: the spawn asks it `plugin list --json`, and a harness
  // that never answers costs a 60-second timeout. YAML holds JSON as it is.
  const harness = join(base, "fake-claude");
  writeFileSync(harness, "#!/bin/sh\necho '[]'\n", { mode: 0o755 });
  writeFileSync(join(dep, "oats-local.yaml"), `schemaVersion: 2\nworkspace: ${ref}\nsettings:\n  oats.aweb:\n    root: ${legacy}\n    delivery: session\n${neverOptedIn ? "" : `    attribution: ${JSON.stringify(attribution)}\n`}launch-configs:\n  fake:\n    harness: claude\n    executable: "${harness}"\n`);
  const oats = (args) => spawnSync(process.execPath, [join(KERNEL, "bin", "oats.mjs"), ...args], { cwd: dep, env, encoding: "utf8", timeout: 120000 });
  return { fake, oats };
}

test("acceptance 23: through a real kernel, oats spawn --json carries E_ADMISSION_LIMIT and its fix in error.message", { skip: !KERNEL && "set OATS_ATTRIBUTION_KERNEL_ROOT to an OATS kernel checkout that lists spawn-attribution", timeout: 240000 }, (t) => {
  const version = JSON.parse(spawnSync(process.execPath, [join(KERNEL, "bin", "oats.mjs"), "--version", "--json"], { encoding: "utf8" }).stdout);
  assert.ok(version.features.includes("spawn-attribution"), `kernel ${version.version} doesn't list spawn-attribution`);
  const { fake, oats } = deployment(t, { admit: { code: "admission_limit_reached" }, wake: "running" });
  const r = oats(["spawn", "probe", "--name", "dev-1", "--launch-config", "fake", "--no-launch", "--json"]);
  let doc; try { doc = JSON.parse(r.stdout); } catch { assert.fail(`no JSON: ${r.stdout}${r.stderr}`); }
  assert.equal(doc.ok, false, r.stdout);
  assert.ok(doc.error.message.includes("E_ADMISSION_LIMIT"), doc.error.message);
  assert.ok(doc.error.message.includes("OATS's count, not the server's"), doc.error.message);
  assert.ok(doc.error.message.includes("wait for the rate window, retire idle instances, or change the policy"), doc.error.message);
  assert.ok(fake.calls().some((c) => c.args.includes("admit")), "the root's admit ran");
});

test("acceptance 23: through a real kernel, a deployment that never opted in gets E_PROTECTED_ADMISSION_REQUIRED and its whole fix in oats spawn --json's error.message, with one mint", { skip: !KERNEL && "set OATS_ATTRIBUTION_KERNEL_ROOT to an OATS kernel checkout that lists spawn-attribution", timeout: 240000 }, (t) => {
  const { fake, oats } = deployment(t, {}, { neverOptedIn: true });
  const r = oats(["spawn", "probe", "--name", "dev-1", "--launch-config", "fake", "--no-launch", "--json"]);
  let doc; try { doc = JSON.parse(r.stdout); } catch { assert.fail(`no JSON: ${r.stdout}${r.stderr}`); }
  assert.equal(doc.ok, false, r.stdout);
  assert.ok(doc.error.message.includes("E_PROTECTED_ADMISSION_REQUIRED"), doc.error.message);
  assert.ok(doc.error.message.includes("oats aweb setup --endorse-root --new-root --name <alias> --human <did:aw> --protected-profile <abs> --service <url>"), doc.error.message);
  assert.equal(fake.readCalls().filter((c) => c.args[0] === "init").length, 1, "never retried, never reminted");
});
