// The publisher against a real aweb server (1.27.24 or later): a scratch
// deployment spawns one pi agent with the pi extension (0.3.15 or later),
// minted into a throwaway team, then `oats aweb health enable`, a tick with the
// extension's real receipt fresh, a tick with it stale, and `disable`. Each step
// is read back from the server: the designation as the agent itself, and the
// stored health on the team's dashboard route. Never point it at a customer
// team. Opt in with OATS_AWEB_HEALTH_LIVE=1 and:
//   OATS_AWEB_HEALTH_AW          absolute path to aw >= 1.36.38
//   OATS_AWEB_HEALTH_LIVE_HOME   a HOME holding the team's authority (so the
//                                root can mint) and the pi extension
//   OATS_AWEB_HEALTH_LIVE_ROOT   the team's minting root, a connected member
//   OATS_AWEB_HEALTH_LIVE_TEAM   the team id, <name>:<namespace>
//   OATS_AWEB_HEALTH_LIVE_SERVER the aweb server's base URL
//   OATS_AWEB_HEALTH_LIVE_TOKEN  a file holding the team's dashboard token
// AWID_REGISTRY_URL and AWID_SKIP_DNS_VERIFY reach every aw call when set.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createScratchDeployment } from "./helpers/scratch-deployment.mjs";

const NAMES = ["AW", "LIVE_HOME", "LIVE_ROOT", "LIVE_TEAM", "LIVE_SERVER", "LIVE_TOKEN"];
const given = Object.fromEntries(NAMES.map((n) => [n, process.env[`OATS_AWEB_HEALTH_${n}`]]));
const skip = process.env.OATS_AWEB_HEALTH_LIVE !== "1" ? "set OATS_AWEB_HEALTH_LIVE=1 to publish to a real aweb server"
  : NAMES.filter((n) => !given[n]).map((n) => `OATS_AWEB_HEALTH_${n}`).join(", ").replace(/^(.+)$/, "set $1") || false;
/** The receipt's heartbeat must be older than the publisher's 90 s window. */
const STALE_AFTER_MS = 95 * 1000;

test("publish to a real server: designate, fresh receipt yes, stale receipt no, disable clears", { skip, timeout: 6 * 60 * 1000 }, async (t) => {
  // One cleanup, in order: resume a stopped adapter (so retire can stop it),
  // retire the agent (which deletes its identity on the server, with the aw
  // under test, so before its directory goes), dispose the scratch, then the
  // aw directory.
  const cleanup = { stopped: null, spawned: false, scratch: null };
  const alias = `hp-${randomBytes(3).toString("hex")}`;
  const bin = mkdtempSync(join(tmpdir(), "aweb-health-live-bin-"));
  t.after(() => {
    if (cleanup.stopped) try { process.kill(cleanup.stopped, "SIGCONT"); } catch { /* gone */ }
    const retired = cleanup.spawned ? cleanup.scratch.oats(["retire", alias, "--force", "--json"]) : null;
    cleanup.scratch?.dispose();
    rmSync(bin, { recursive: true, force: true });
    if (retired && retired.status !== 0) throw new Error(`retire ${alias} left its identity on the server: ${retired.stdout}${retired.stderr}`);
  });
  symlinkSync(given.AW, join(bin, "aw"));
  const registry = Object.fromEntries(["AWID_REGISTRY_URL", "AWID_SKIP_DNS_VERIFY"].filter((n) => process.env[n]).map((n) => [n, process.env[n]]));
  const scratch = cleanup.scratch = createScratchDeployment({
    withAweb: true, home: given.LIVE_HOME, path: bin, env: { ...registry, AW_NO_UPDATE_CHECK: "1" },
    teams: `teams:\n  live: { team: '${given.LIVE_TEAM}' }\ndefaultTeam: live\nlocalTeams: true\n`,
    local: `  pi:\n    harness: pi\n    executable: pi\nsettings:\n  oats.aweb:\n    root: ${given.LIVE_ROOT}\n`,
  });
  const home = join(scratch.deployment, "agents", "messenger", "instances", alias);
  const health = (...args) => scratch.json(["aweb", "health", ...args, "--soul", "messenger"]);
  const aw = (...args) => JSON.parse(spawnSync("aw", args, { env: scratch.env, encoding: "utf8" }).stdout);
  const designation = () => aw("--identity-home", join(home, ".aw"), "status-host", "show", "--json");
  const read = () => fetch(`${given.LIVE_SERVER}/v1/teams/${given.LIVE_TEAM}/agents/${alias}`, { headers: { "X-Dashboard-Token": readFileSync(given.LIVE_TOKEN, "utf8").trim() } });
  const stored = async () => {
    const r = await read();
    assert.equal(r.status, 200, `dashboard read of ${alias}`);
    return (await r.json()).health;
  };
  const rootDid = JSON.parse(spawnSync("aw", ["whoami", "--json"], { cwd: given.LIVE_ROOT, env: scratch.env, encoding: "utf8" }).stdout).did;

  const spawned = scratch.json(["spawn", "messenger", "--name", alias, "--launch-config", "pi"]);
  if (!spawned.ok) {
    // A failed spawn has no instance to retire; say whether its identity was
    // left behind on the server.
    const left = (await read()).status === 200;
    assert.fail(`spawn ${alias}: ${JSON.stringify(spawned.error)}${left ? `; its identity is left on the server: remove it with \`aw team admin remove-agent\`` : ""}`);
  }
  cleanup.spawned = true;

  // The extension writes its receipt on its first read of the stream.
  const receiptFile = join(home, ".aw", "receive", "stream.json");
  for (let i = 0; i < 60 && !existsSync(receiptFile); i++) await delay(500);
  const receipt = JSON.parse(readFileSync(receiptFile, "utf8"));
  assert.equal(receipt.kind, "pi-extension");
  assert.match(receipt.did, /^did:key:/);
  assert.equal((await stored()).source, "aweb", "before enable, aweb shows its own facts");

  assert.equal(health("enable", "--operator", "Live test operator").ok, true);
  let tick = health("publish");
  assert.deepEqual(tick.result, { published: [{ alias, team: given.LIVE_TEAM, reachable: "yes", code: null }], refused: [], skipped: [], failed: [] });
  const shown = designation();
  assert.deepEqual([shown.ok, shown.host_did, shown.host_active], [true, rootDid, true], JSON.stringify(shown));
  let status = await stored();
  assert.deepEqual([status.source, status.reachable, status.verified, status.stale], ["host", "yes", true, false], JSON.stringify(status));
  const payload = JSON.parse(Buffer.from(status.signed_payload, "base64url").toString());
  assert.deepEqual([payload.agent, payload.publisher_did, payload.team_id, payload.reachable], [receipt.did, rootDid, given.LIVE_TEAM, "yes"]);

  // A hung adapter: its process lives, its stream reads nothing.
  process.kill(receipt.pid, "SIGSTOP");
  cleanup.stopped = receipt.pid;
  await delay(Math.max(0, Date.parse(JSON.parse(readFileSync(receiptFile, "utf8")).heartbeat_at) + STALE_AFTER_MS - Date.now()));
  tick = health("publish");
  assert.deepEqual(tick.result.published, [{ alias, team: given.LIVE_TEAM, reachable: "no", code: "oats.channel_stream_down" }]);
  status = await stored();
  assert.deepEqual([status.source, status.reachable, status.reason_text, status.fixing_by, status.fixing_text, status.verified], ["host", "no", "Its message channel is not connected.", "operator", "Live test operator", true], JSON.stringify(status));
  process.kill(receipt.pid, "SIGCONT");
  cleanup.stopped = null;

  const disabled = health("disable");
  assert.deepEqual(disabled.result.designations, { cleared: [{ alias, team: given.LIVE_TEAM }], failed: [] });
  const cleared = designation();
  assert.deepEqual([cleared.ok, cleared.host_did], [true, null], JSON.stringify(cleared));
  assert.equal((await stored()).source, "aweb", "after disable, aweb shows its own facts again");
});
