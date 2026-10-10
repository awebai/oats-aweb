// The per-user service that keeps a GLOBAL resident's custody running: a
// launchd agent on macOS, a systemd --user unit on Linux. aw has no install
// verb (`aw custody serve` takes no flags and serves the identity home of its
// working directory), so OATS writes the unit. It runs `aw custody serve` in
// the resident's directory with PATH and HOME only: no key, no identity
// selector. Elsewhere there is no unit, and the operator starts custody by hand.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { custodyPreflight } from "./grant-custody.mjs";

const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };

/** ai.aweb.custody.<namespace of the address>.<name> */
export function custodyLabel(address, name) {
  const [namespace, alias, ...rest] = String(address || "").split("/");
  if (!namespace || alias === undefined || rest.length) fail("E_RESIDENT_VERIFY", `address ${address} has no namespace`);
  if (alias !== name) fail("E_RESIDENT_VERIFY", `address ${address} does not end in /${name}`);
  return `ai.aweb.custody.${namespace}.${name}`;
}

export function unitManager(platform) {
  return platform === "darwin" ? "launchd" : platform === "linux" ? "systemd" : null;
}
const unitDir = ({ platform, home, xdgConfigHome }) => platform === "darwin"
  ? join(home, "Library", "LaunchAgents")
  : join(xdgConfigHome || join(home, ".config"), "systemd", "user");
export function unitPath(where, label) {
  return join(unitDir(where), `${label}${where.platform === "darwin" ? ".plist" : ".service"}`);
}

const xml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
const unXml = (s) => String(s).replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
/** systemd expands % specifiers in every setting used here. */
const systemdValue = (s) => String(s).replace(/%/g, "%%");
const systemdQuoted = (s) => `"${systemdValue(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

/** The unit file's text. `path` and `home` are the only environment it sets. */
export function renderUnit({ platform, label, aw, root, path, home, address }) {
  for (const [what, value] of Object.entries({ label, aw, root, path, home, address })) {
    if (typeof value !== "string" || !value || /[\x00-\x1f\x7f]/.test(value)) fail("E_RESIDENT_UNIT", `the custody unit's ${what} is empty or contains a control character`);
  }
  const log = join(root, ".oats-resident", "custody.log");
  if (platform === "darwin") return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xml(label)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xml(aw)}</string>
    <string>custody</string>
    <string>serve</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${xml(root)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${xml(path)}</string>
    <key>HOME</key>
    <string>${xml(home)}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${xml(log)}</string>
  <key>StandardErrorPath</key>
  <string>${xml(log)}</string>
</dict>
</plist>
`;
  if (platform === "linux") return `[Unit]
Description=aweb custody for resident ${systemdValue(address)}

[Service]
Type=simple
WorkingDirectory=${systemdValue(root)}
Environment=${systemdQuoted(`PATH=${path}`)} ${systemdQuoted(`HOME=${home}`)}
ExecStart=${systemdQuoted(aw)} custody serve
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
`;
  return fail("E_RESIDENT_UNIT_UNSUPPORTED", `no custody unit for platform ${platform}`);
}

/** The directory a unit file serves, or undefined when it names none. */
function servedRoot(platform, text) {
  if (platform === "darwin") {
    const m = /<key>WorkingDirectory<\/key>\s*<string>([^<]*)<\/string>/.exec(text);
    return m ? unXml(m[1]) : undefined;
  }
  const m = /^WorkingDirectory=(.*)$/m.exec(text);
  return m ? m[1].trim().replace(/%%/g, "%") : undefined;
}

/** Every custody unit of resident `name` this user has, whatever its namespace. */
export function residentUnits(where, name) {
  const dir = unitDir(where);
  const suffix = where.platform === "darwin" ? ".plist" : ".service";
  let entries;
  try { entries = readdirSync(dir); } catch { return []; }
  return entries
    .filter((f) => f.startsWith("ai.aweb.custody.") && f.endsWith(`.${name}${suffix}`) && f.length > `ai.aweb.custody..${name}${suffix}`.length)
    .map((f) => {
      const path = join(dir, f);
      let root;
      try { root = servedRoot(where.platform, readFileSync(path, "utf8")); } catch { /* unreadable: serves no known directory */ }
      return { label: f.slice(0, -suffix.length), path, root };
    });
}

export function conflictMessage(unit, root) {
  return `custody unit ${unit.path} already serves ${unit.root ?? "an unreadable directory"}, not ${root}; remove that unit or choose another name`;
}

/** A command a unit manager runs, with PATH and HOME only. */
function manage(env, cmd, args) {
  try {
    return { ok: true, stdout: execFileSync(cmd, args, { env: { PATH: env.PATH || "", HOME: env.HOME || "" }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30000 }) };
  } catch (e) {
    return { ok: false, missing: e.code === "ENOENT", status: e.status, stderr: String(e.stderr || "").trim() };
  }
}
function managed(env, cmd, args) {
  const r = manage(env, cmd, args);
  if (r.missing) fail("E_RESIDENT_UNIT_UNSUPPORTED", `${cmd} is not available on this host`);
  if (!r.ok) fail("E_RESIDENT_UNIT", `${cmd} ${args.join(" ")} failed${r.status != null ? ` (exit ${r.status})` : ""}${r.stderr ? `: ${r.stderr}` : ""}`);
  return r;
}

/** Why custody would not survive a logout on Linux, or undefined. Without
 *  systemd's lingering, a user's units stop when their last session ends. */
export function lingerProblem({ platform, user, env }) {
  if (platform !== "linux") return undefined;
  const r = manage(env, "loginctl", ["show-user", user, "--property=Linger"]);
  if (r.missing) return undefined; // no systemd: the custody stage names the hand step
  if (r.ok && /^Linger=yes$/m.test(r.stdout)) return undefined;
  return `systemd lingering is off for ${user}, so the custody unit would stop when ${user} logs out: an administrator runs \`loginctl enable-linger ${user}\`, then rerun`;
}

/** Writes the unit when it is missing or differs, and makes sure it is loaded.
 *  A unit of this label that serves another directory is refused. */
export function ensureCustodyUnit({ platform, label, aw, root, home, address, uid, env, xdgConfigHome }) {
  const manager = unitManager(platform);
  if (!manager) fail("E_RESIDENT_UNIT_UNSUPPORTED", `this host (${platform}) has no supported per-user service manager`);
  const path = unitPath({ platform, home, xdgConfigHome }, label);
  const desired = renderUnit({ platform, label, aw, root, path: env.PATH, home, address });
  const existing = existsSync(path) ? readFileSync(path, "utf8") : undefined;
  if (existing !== undefined) {
    const served = servedRoot(platform, existing);
    if (served !== root) fail("E_RESIDENT_UNIT_CONFLICT", conflictMessage({ path, root: served }, root));
  }
  const changed = existing !== desired;
  if (changed) {
    mkdirSync(unitDir({ platform, home, xdgConfigHome }), { recursive: true });
    writeFileSync(path, desired, { mode: 0o644 });
  }
  if (manager === "launchd") {
    const target = `gui/${uid}/${label}`;
    const loaded = manage(env, "launchctl", ["print", target]);
    if (loaded.missing) fail("E_RESIDENT_UNIT_UNSUPPORTED", "launchctl is not available on this host");
    if (changed && loaded.ok) managed(env, "launchctl", ["bootout", target]);
    if (changed || !loaded.ok) managed(env, "launchctl", ["bootstrap", `gui/${uid}`, path]);
  } else {
    const service = `${label}.service`;
    if (changed) {
      managed(env, "systemctl", ["--user", "daemon-reload"]);
      managed(env, "systemctl", ["--user", "enable", "--now", service]);
      if (existing !== undefined) managed(env, "systemctl", ["--user", "restart", service]);
    } else if (!manage(env, "systemctl", ["--user", "is-active", service]).ok) {
      managed(env, "systemctl", ["--user", "enable", "--now", service]);
    }
  }
  return { manager, label, path, changed };
}

/** What an operator runs where OATS writes no unit. */
export function handStep(root, name) {
  return `start custody yourself: run \`aw custody serve\` in ${root} under a supervisor that keeps it running (working directory ${root}, environment PATH and HOME only), then rerun \`oats aweb resident create ${name}\` to verify`;
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
/** Waits until the running custody is ready for grant seats: running, the team
 *  ready, signing and E2EE keys ready, and the floor ops listed. Throws the
 *  last answer when it is not ready in time. */
export async function waitForCustody({ status, resident, team, timeoutMs = 30000, intervalMs = 500 }) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    try {
      return custodyPreflight({ custody: "", resident, team, e2eeRequired: true, ttl: "never", fatalOnError: false, runAw: () => status() }).status;
    } catch (e) {
      if (Date.now() >= until) fail("E_RESIDENT_CUSTODY", String(e.message || e));
    }
    await sleep(intervalMs);
  }
}
