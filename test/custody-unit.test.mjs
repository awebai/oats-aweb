// The per-user custody unit `oats aweb resident create` writes: a launchd
// agent on macOS, a systemd --user unit on Linux. Both platforms are tested on
// every host; a host's own validator (plutil, systemd-analyze) checks the
// rendered file when it is installed.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { custodyLabel, ensureCustodyUnit, lingerProblem, renderUnit, residentUnits, unitManager, unitPath, waitForCustody } from "../oats-package/capabilities/oats-aweb/lib/custody-unit.mjs";
import { fakeResidentAw } from "./helpers/fake-aw-resident.mjs";

const LABEL = "ai.aweb.custody.juan.aweb.ai.alice";
function base(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "oats-custody-unit-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
const onPath = (cmd) => spawnSync("sh", ["-c", `command -v ${cmd}`]).status === 0;

test("the label is ai.aweb.custody.<address namespace>.<name>", () => {
  assert.equal(custodyLabel("juan.aweb.ai/alice", "alice"), LABEL);
  assert.throws(() => custodyLabel("juan.aweb.ai/bob", "alice"), /address juan\.aweb\.ai\/bob does not end in \/alice/);
  assert.throws(() => custodyLabel("no-namespace", "alice"), /address no-namespace has no namespace/);
});

test("a dotted label is a valid systemd unit name and launchd label", () => {
  // systemd.unit(5): unit names are at most 255 characters of ASCII letters,
  // digits, ":", "-", "_", "." and "\", followed by a type suffix.
  for (const label of [LABEL, "ai.aweb.custody.a-b.example.com.x_y-1", custodyLabel(`${"a".repeat(63)}.${"b".repeat(63)}.example/${"c".repeat(64)}`, "c".repeat(64))]) {
    assert.match(`${label}.service`, /^[A-Za-z0-9:_.\\-]+\.service$/);
    assert.ok(`${label}.service`.length <= 255, label);
    assert.match(label, /^[A-Za-z0-9._-]+$/, "a reverse-DNS launchd label");
  }
});

test("macOS: a LaunchAgent plist running aw custody serve in R with PATH and HOME only", (t) => {
  const dir = base(t);
  const text = renderUnit({ platform: "darwin", label: LABEL, aw: "/opt/homebrew/bin/aw", root: "/Users/a b/R&<x>", path: "/opt/homebrew/bin:/usr/bin:/bin", home: "/Users/a b", address: "juan.aweb.ai/alice" });
  assert.equal(text, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/opt/homebrew/bin/aw</string>
    <string>custody</string>
    <string>serve</string>
  </array>
  <key>WorkingDirectory</key>
  <string>/Users/a b/R&amp;&lt;x&gt;</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/bin:/bin</string>
    <key>HOME</key>
    <string>/Users/a b</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/Users/a b/R&amp;&lt;x&gt;/.oats-resident/custody.log</string>
  <key>StandardErrorPath</key>
  <string>/Users/a b/R&amp;&lt;x&gt;/.oats-resident/custody.log</string>
</dict>
</plist>
`);
  if (onPath("plutil")) {
    writeFileSync(join(dir, "u.plist"), text);
    const lint = spawnSync("plutil", ["-lint", join(dir, "u.plist")], { encoding: "utf8" });
    assert.equal(lint.status, 0, lint.stdout + lint.stderr);
  }
  assert.equal(unitPath({ platform: "darwin", home: "/Users/a" }, LABEL), `/Users/a/Library/LaunchAgents/${LABEL}.plist`);
  assert.equal(unitManager("darwin"), "launchd");
});

test("Linux: a systemd --user service running aw custody serve in R with PATH and HOME only", (t) => {
  const dir = base(t);
  const text = renderUnit({ platform: "linux", label: LABEL, aw: "/usr/local/bin/aw", root: "/srv/res %d/R", path: "/usr/local/bin:/usr/bin", home: "/home/a", address: "juan.aweb.ai/alice" });
  assert.equal(text, `[Unit]
Description=aweb custody for resident juan.aweb.ai/alice

[Service]
Type=simple
WorkingDirectory=/srv/res %%d/R
Environment="PATH=/usr/local/bin:/usr/bin" "HOME=/home/a"
ExecStart="/usr/local/bin/aw" custody serve
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
`);
  if (onPath("systemd-analyze")) {
    const file = join(dir, `${LABEL}.service`);
    writeFileSync(file, text.replace("/usr/local/bin/aw", "/bin/true").replace("/srv/res %%d/R", "/"));
    const verify = spawnSync("systemd-analyze", ["verify", "--user", file], { encoding: "utf8" });
    assert.doesNotMatch(verify.stderr, /Invalid|Failed to|bad-setting/i, verify.stderr);
  }
  assert.equal(unitPath({ platform: "linux", home: "/home/a" }, LABEL), `/home/a/.config/systemd/user/${LABEL}.service`);
  assert.equal(unitPath({ platform: "linux", home: "/home/a", xdgConfigHome: "/cfg" }, LABEL), `/cfg/systemd/user/${LABEL}.service`);
  assert.equal(unitManager("linux"), "systemd");
  assert.equal(unitManager("win32"), null);
  assert.throws(() => renderUnit({ platform: "linux", label: LABEL, aw: "/a\nb", root: "/r", path: "/p", home: "/h", address: "x/alice" }), /contains a control character/);
});

test("residentUnits finds every unit of a name, with the directory it serves", (t) => {
  const home = base(t);
  for (const platform of ["darwin", "linux"]) {
    const make = (label, root) => {
      const file = unitPath({ platform, home }, label);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, renderUnit({ platform, label, aw: "/bin/aw", root, path: "/bin", home, address: `${label.split(".").slice(3, -1).join(".")}/${label.split(".").at(-1)}` }));
      return file;
    };
    const a = make("ai.aweb.custody.one.example.alice", "/r/one");
    make("ai.aweb.custody.two.example.bob", "/r/bob");
    const b = make("ai.aweb.custody.two.example.alice", "/r/two & more");
    assert.deepEqual(residentUnits({ platform, home }, "alice").sort((x, y) => x.path.localeCompare(y.path)), [
      { label: "ai.aweb.custody.one.example.alice", path: a, root: "/r/one" },
      { label: "ai.aweb.custody.two.example.alice", path: b, root: "/r/two & more" },
    ]);
    assert.deepEqual(residentUnits({ platform, home }, "carol"), []);
  }
});

test("linger: Linux without it stops with the exact admin command; with it, nothing", (t) => {
  const dir = base(t);
  const no = fakeResidentAw(join(dir, "no"), { linger: "no", aw: false });
  assert.equal(lingerProblem({ platform: "linux", user: "alice", env: { PATH: no.bin } }), "systemd lingering is off for alice, so the custody unit would stop when alice logs out: an administrator runs `loginctl enable-linger alice`, then rerun");
  const yes = fakeResidentAw(join(dir, "yes"), { linger: "yes", aw: false });
  assert.equal(lingerProblem({ platform: "linux", user: "alice", env: { PATH: yes.bin } }), undefined);
  assert.equal(lingerProblem({ platform: "darwin", user: "alice", env: { PATH: no.bin } }), undefined);
});

test("ensureCustodyUnit installs once, is idempotent, and refuses a unit of its label serving another directory", (t) => {
  const dir = base(t);
  const fake = fakeResidentAw(dir, { aw: false });
  const home = join(dir, "home"); mkdirSync(home);
  for (const platform of ["darwin", "linux"]) {
    const opts = { platform, label: LABEL, aw: "/bin/aw", root: "/r/alice", home, address: "juan.aweb.ai/alice", uid: 501, env: { PATH: fake.bin, HOME: home } };
    const first = ensureCustodyUnit(opts);
    assert.deepEqual(first, { manager: unitManager(platform), label: LABEL, path: unitPath({ platform, home }, LABEL), changed: true });
    const calls = fake.calls().length;
    const again = ensureCustodyUnit(opts);
    assert.equal(again.changed, false);
    // Unchanged and loaded: only the loaded check runs.
    assert.ok(fake.calls().length - calls <= 1, JSON.stringify(fake.calls().slice(calls)));
    assert.throws(() => ensureCustodyUnit({ ...opts, root: "/r/other" }), { code: "E_RESIDENT_UNIT_CONFLICT", message: `custody unit ${unitPath({ platform, home }, LABEL)} already serves /r/alice, not /r/other; remove that unit or choose another name` });
    rmSync(join(dir, "unit-loaded"), { force: true });
  }
  const darwin = fake.calls().filter((c) => c.cmd === "launchctl").map((c) => c.argv.join(" "));
  assert.deepEqual(darwin.slice(0, 2), [`print gui/501/${LABEL}`, `bootstrap gui/501 ${unitPath({ platform: "darwin", home }, LABEL)}`]);
  const linux = fake.calls().filter((c) => c.cmd === "systemctl").map((c) => c.argv.join(" "));
  assert.deepEqual(linux.slice(0, 2), ["--user daemon-reload", `--user enable --now ${LABEL}.service`]);
});

test("waitForCustody: ready, ops missing, unreadable: three different answers", async () => {
  const answers = {
    ready: () => readFileSync(new URL("./fixtures/resident/custody-status-running.stdout", import.meta.url), "utf8"),
    missing: () => JSON.stringify({ ...JSON.parse(answers.ready()), ops: ["status.v1", "sign_plain_message.v1", "create_e2ee_envelope.v1", "unwrap_e2ee_message.v1"] }),
    unreadable: () => "not json",
  };
  const team = JSON.parse(answers.ready()).teams[0].team_id;
  const status = await waitForCustody({ status: answers.ready, resident: "carol", team, timeoutMs: 1000, intervalMs: 10 });
  assert.equal(status.status, "running");
  await assert.rejects(waitForCustody({ status: answers.missing, resident: "carol", team, timeoutMs: 100, intervalMs: 10 }),
    { code: "E_RESIDENT_CUSTODY", message: "custody preflight failed for carol: status=running; required custody operations are missing: mail_reply_continuation.v1, grant_never_ttl.v1; restart the custody on aw 1.36.33 or later (upgrade aw, restart the custody service and the wake daemon, then oats sync)" });
  await assert.rejects(waitForCustody({ status: answers.unreadable, resident: "carol", team, timeoutMs: 100, intervalMs: 10 }),
    { code: "E_RESIDENT_CUSTODY", message: /^custody preflight failed for carol: custody status could not be read: aw custody status returned no JSON result/ });
});
