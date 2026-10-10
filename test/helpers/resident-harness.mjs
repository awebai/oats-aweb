// The CLI harness for `oats aweb resident create` tests: a temporary
// deployment and HOME, the fakes of fake-aw-resident.mjs first on PATH, and a
// runner that parses the last stdout line as the --json envelope.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CAPTURED, fakeResidentAw } from "./fake-aw-resident.mjs";

export const HOOK = fileURLToPath(new URL("../../oats-package/capabilities/oats-aweb/bin/oats-aweb.mjs", import.meta.url));
export const KEY = "aw_sk_unit_KEYVALUE_5f3c9e";
export const NAME = CAPTURED.name;
export const DOMAIN = CAPTURED.address.split("/")[0];
export const LABEL = `ai.aweb.custody.${DOMAIN}.${NAME}`;
export const AWEB_URL = "http://127.0.0.1:18000";

export function setup(t, fakeOptions = {}, { localYaml = "schemaVersion: 2\nworkspace: local\n" } = {}) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "oats-resident-")));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const deployment = join(base, "deploy"), home = join(base, "home");
  mkdirSync(deployment); mkdirSync(home);
  writeFileSync(join(deployment, "oats-local.yaml"), localYaml);
  const fake = fakeResidentAw(base, fakeOptions);
  const env = { PATH: `${fake.bin}:${dirname(process.execPath)}:/usr/bin:/bin`, HOME: home, OATS_TEAM_SCOPE: deployment, OATS_SETTINGS: "{}", AWEB_URL, AWEB_API_KEY: KEY };
  const root = join(deployment, ".aweb-residents", NAME);
  const run = (args = [], extraEnv = {}, { unset = [] } = {}) => {
    const runEnv = { ...env, ...extraEnv };
    for (const k of unset) delete runEnv[k];
    const started = Date.now();
    const r = spawnSync(process.execPath, [HOOK, "resident", ...args], { env: runEnv, cwd: deployment, encoding: "utf8", input: "", timeout: 60000 });
    let doc; try { doc = JSON.parse(r.stdout.trim().split("\n").at(-1)); } catch { doc = undefined; }
    return { ...r, doc, ms: Date.now() - started };
  };
  const unitPath = process.platform === "darwin" ? join(home, "Library", "LaunchAgents", `${LABEL}.plist`) : join(home, ".config", "systemd", "user", `${LABEL}.service`);
  return { base, deployment, home, root, env, fake, run, unitPath, localYaml: () => readFileSync(join(deployment, "oats-local.yaml"), "utf8") };
}
export const initCalls = (fake) => fake.calls().filter((c) => c.cmd === "aw" && c.argv[0] === "init");
