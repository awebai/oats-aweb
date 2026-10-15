// A scratch OATS deployment driven by the real kernel on PATH, isolated from
// the operator's: its own HOME, Git configuration and tmux socket directory,
// and an environment built from nothing, so no inherited TMUX or OATS_*
// variable reaches a live server or a real instance. Its one soul composes no
// capability; its harness is a script that sleeps, so a launched home is a
// real tmux pane with a live process.
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync, appendFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const WORKSPACE = "git:github.com/scratch/ws";

const CAPABILITY = new URL("../../oats-package/capabilities/oats-aweb", import.meta.url).pathname;

/** `withAweb`: the workspace member also carries this checkout's oats.aweb
 *  capability and a soul that composes it from there, so `oats aweb …` runs
 *  from the deployment. That soul is spawned only by the live test
 *  (health-live.test.mjs), which gives a throwaway team and its root:
 *  `home` (a HOME holding that team's authority, kept on dispose), `path` (a
 *  directory put first on PATH, for its aw), `env` (more variables), `teams`
 *  (YAML appended to oats-workspace.yaml) and `local` (YAML appended to
 *  oats-local.yaml). */
export function createScratchDeployment(options = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "aweb-health-scratch-")));
  // tmux refuses socket paths over about 100 bytes: keep its directory short.
  const tmux = realpathSync(mkdtempSync("/tmp/ah."));
  // A deployment that fails half-built leaves nothing behind.
  try { return buildScratchDeployment(root, tmux, options); } catch (error) {
    rmSync(tmux, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
}

function buildScratchDeployment(root, tmux, { withAweb = false, home: givenHome, path, env: extraEnv = {}, teams = "", local = "" }) {
  const home = givenHome ?? join(root, "home"), ws = join(root, "ws"), deployment = join(root, "dep"), bin = join(root, "bin");
  for (const d of [home, ws, bin]) mkdirSync(d, { recursive: true });
  const gitConfig = join(root, "gitconfig");
  writeFileSync(gitConfig, "");
  const env = { ...extraEnv, PATH: `${path ? `${path}:` : ""}${dirname(process.execPath)}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin`, HOME: home, TMUX_TMPDIR: tmux, GIT_CONFIG_GLOBAL: gitConfig, GIT_CONFIG_NOSYSTEM: "1" };
  const write = (path, text) => { mkdirSync(dirname(join(ws, path)), { recursive: true }); writeFileSync(join(ws, path), text); };
  write("oats-workspace.yaml", `schemaVersion: 2\nname: scratch\nmembers: [${WORKSPACE}]\n${teams}`);
  write("oats-membership.yaml", `schemaVersion: 2\nworkspace: ${WORKSPACE}\n`);
  write("souls/plain/soul.yaml", "schemaVersion: 2\nname: plain\ndescription: Scratch soul with no capabilities\nwork: directory\ncapabilities:\n  oats.core: off\n");
  write("souls/plain/AGENTS.md", "Scratch soul.\n");
  if (withAweb) {
    cpSync(CAPABILITY, join(ws, "capabilities", "oats-aweb"), { recursive: true });
    write("souls/messenger/soul.yaml", "schemaVersion: 2\nname: messenger\ndescription: Scratch soul composing oats.aweb, never spawned\nwork: directory\ncapabilities:\n  oats.core: off\n  oats.aweb: { from: here }\n");
    write("souls/messenger/AGENTS.md", "Scratch messenger soul.\n");
  }
  const git = (...args) => execFileSync("git", ["-c", "user.name=scratch", "-c", "user.email=scratch@example.invalid", "-C", ws, ...args], { env, stdio: "pipe" });
  git("init", "-q", "-b", "main"); git("add", "."); git("commit", "-qm", "scratch");
  execFileSync("git", ["config", "--file", gitConfig, `url.file://${ws}.insteadOf`, "https://github.com/scratch/ws.git"], { env });
  const harness = join(bin, "fake-harness");
  writeFileSync(harness, "#!/bin/sh\nexec sleep 3600\n");
  chmodSync(harness, 0o755);

  const oats = (args, { cwd = deployment, input } = {}) => spawnSync("oats", args, { cwd, env, input, encoding: "utf8", timeout: 60000 });
  const onboard = oats(["onboard", deployment, "--workspace", WORKSPACE, "--json"], { cwd: root });
  if (onboard.status !== 0) throw new Error(`oats onboard failed: ${onboard.stdout}${onboard.stderr}`);
  appendFileSync(join(deployment, "oats-local.yaml"), `launch-configs:\n  fake:\n    harness: pi\n    executable: "${harness}"\n${local}`);
  const json = (args, options) => { const r = oats([...args, "--json"], options); try { return JSON.parse(r.stdout); } catch { throw new Error(`oats ${args.join(" ")}: ${r.stdout}${r.stderr}`); } };
  const homeOf = (name) => join(deployment, "agents", "plain", "instances", name);
  const sockets = () => readdirSync(tmux, { recursive: true }).map((p) => join(tmux, p)).filter((p) => p.endsWith("/oats"));

  return {
    root, deployment, env, homeOf, oats, json,
    spawn(name, { launch = true } = {}) {
      const r = json(["spawn", "plain", "--name", name, ...(launch ? ["--launch-config", "fake"] : ["--no-launch"])]);
      if (!r.ok) throw new Error(`spawn ${name}: ${JSON.stringify(r.error)}`);
      return homeOf(name);
    },
    stop(name) {
      const plan = json(["instance", "stop", name, "--plan"]);
      const r = json(["instance", "stop", name, "--apply", "--plan-revision", plan.result.planRevision, "--idempotency-key", `stop-${name}`]);
      if (!r.ok) throw new Error(`stop ${name}: ${JSON.stringify(r.error)}`);
    },
    /** Kills the harness process of a launched home, as a crash would. */
    crash(name) {
      const pane = json(["session", "inspect", "--home", homeOf(name)]).result.paneId;
      const [socket] = sockets();
      const panePid = execFileSync("tmux", ["-S", socket, "display", "-p", "-t", pane, "#{pane_pid}"], { env, encoding: "utf8" }).trim();
      const child = execFileSync("pgrep", ["-P", panePid], { encoding: "utf8" }).trim().split("\n")[0];
      process.kill(Number(child), "SIGTERM");
    },
    /** Ends the deployment's tmux server, as a reboot does. */
    killTmux() {
      for (const socket of sockets()) spawnSync("tmux", ["-S", socket, "kill-server"], { env });
    },
    dispose() {
      for (const socket of sockets()) spawnSync("tmux", ["-S", socket, "kill-server"], { env });
      rmSync(tmux, { recursive: true, force: true });
      rmSync(root, { recursive: true, force: true });
    },
  };
}
