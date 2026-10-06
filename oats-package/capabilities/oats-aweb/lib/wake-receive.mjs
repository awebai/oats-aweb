// Live receive for joined teams through the host wake broker (oats.aweb 1.15).
//
// aw >= 1.36.7 accepts one registration per instance home carrying several
// broker-owned receive identities (`aw wake register --registration-json -`):
// - external-session homes (delivery: session): the broker owns every identity;
//   the primary keeps the runtime controls, joined homes add mail/chat streams;
// - native homes (delivery: channel on Claude or pi): the Claude channel
//   (native-channel) or the Pi extension (native-pi) keeps the primary
//   identity, and the broker attaches only the joined homes, disjoint from the
//   primary (aw's mixed mode).
// Under delivery: channel a runtime with no native surface (Codex, unknown) is
// an external-session home like any session home (brokerDelivers).
import {readFileSync, realpathSync, statSync} from 'node:fs';
import {isAbsolute, join, resolve} from 'node:path';

const JOINED_EVENT_CLASSES = ['mail', 'chat'];
// Conservative observation-age heuristic; not a polling or process budget.
const RECEIVE_EVIDENCE_MAX_AGE_MS = 30000;

const NATIVE_CHANNEL_RUNTIMES = ['claude', 'pi'];

/** Whether the host wake broker delivers the home's primary identity:
 *  delivery: session sends every runtime through it; delivery: channel only a
 *  runtime with no native channel (Claude has its channel plugin, pi its
 *  extension). The broker typing into a session that also has a live channel
 *  doubles every wake, so this is the one path, never both. */
export function brokerDelivers({delivery, runtime}) {
  return delivery === 'session' || !NATIVE_CHANNEL_RUNTIMES.includes(runtime);
}

/** What the kernel recorded for a home's last start: this provider's meta
 *  (capabilityMeta) and the harness it launched. Empty when unreadable. */
export function recordedStart(home) {
  let doc;
  try { doc = JSON.parse(readFileSync(join(home, 'instance.json'), 'utf8')); } catch { return {}; }
  const meta = doc?.capabilityMeta?.['oats.aweb'];
  const harness = typeof doc?.launch?.harness === 'string' ? doc.launch.harness : typeof doc?.harness === 'string' ? doc.harness : undefined;
  return {identityHome: doc?.launch?.hooks?.env?.AWEB_IDENTITY_HOME, meta: meta && typeof meta === 'object' && !Array.isArray(meta) ? meta : undefined, harness};
}

/** The runtime a home's last start ran under: what this provider recorded
 *  (an empty string is a start with no runtime, so no channel), else the
 *  harness the kernel launched, for a meta that recorded none. */
export function recordedRuntime(meta, harness) {
  return typeof meta?.runtime === 'string' ? meta.runtime : harness;
}

/** Claude Code loads aweb-channel only with
 *  --dangerously-load-development-channels, because the plugin is not on
 *  Claude Code's approved channel list (the Anthropic default list, or a
 *  Team/Enterprise organization's managed allowedChannelPlugins). Before every
 *  session that flag starts, Claude Code shows a confirmation that waits for a
 *  human answer in the terminal; nothing may answer it for them. */
export const CHANNEL_DEV_CONFIRMATION = {
  code: 'channel-dev-confirmation',
  message: 'Claude Code stops at its development-channels confirmation ("Loading development channels") before the session starts, and waits until someone answers it in the instance\'s terminal: aweb-channel is not on Claude Code\'s approved channel list, so it is loaded with --dangerously-load-development-channels',
};

/** external-session | native-channel | native-pi. */
export function runtimeDeliveryFor({delivery, runtime}) {
  if (brokerDelivers({delivery, runtime})) return 'external-session';
  return runtime === 'claude' ? 'native-channel' : 'native-pi';
}

/** The multi-identity registration document for this home, or null when it
 *  has no joined team: a native home then needs none, and an external-session
 *  home keeps the one-identity register. */
export function wakeRegistration({home, primaryIdentityHome, delivery, runtime, joined = [], backend}) {
  const rt = runtimeDeliveryFor({delivery, runtime});
  if (!joined.length) return null;
  const receive = joined.map((j) => ({identity_home: j.identityHome, label: j.label, event_classes: JOINED_EVENT_CLASSES}));
  const doc = rt === 'external-session'
    ? {home, delivery: 'session', runtime_delivery: rt, identity_home: primaryIdentityHome, receive_identities: [{identity_home: primaryIdentityHome, label: 'default', controls: true}, ...receive]}
    : {home, delivery: rt, runtime_delivery: rt, primary_identity_home: primaryIdentityHome, receive_identities: receive};
  if (backend) doc.backend = backend;
  return doc;
}

const canon = (p) => { try { return realpathSync(p); } catch { return resolve(String(p || '')); } };

/** Whether `aw wake status --json` lists this home; a status without an
 *  instances list proves nothing, so it counts as listed. */
export function statusListsHome(status, home) {
  if (!Array.isArray(status?.instances)) return true;
  const want = canon(home);
  return status.instances.some((i) => i && canon(i.home) === want);
}

/** Each joined team's actual receive mode from `aw wake status --json`:
 *  native only when the home is registered with that identity home AND the
 *  host daemon runs; otherwise poll with the reason. */
export function joinedReceiveModes(status, {home, joined = []}) {
  const running = status?.daemon_running === true || status?.daemon_version_state === 'reported';
  const want = canon(home);
  const row = (Array.isArray(status?.instances) ? status.instances : []).find((i) => i && canon(i.home) === want);
  const identities = Array.isArray(row?.receive_identities) ? row.receive_identities : [];
  return joined.map((j) => {
    const hit = identities.find((r) => r && canon(r.identity_home) === canon(j.identityHome));
    if (!hit) return {label: j.label, receive: 'poll', reason: row ? 'not-registered-with-broker' : 'home-not-registered'};
    if (!running) return {label: j.label, receive: 'poll', reason: 'wake-daemon-not-running'};
    if (hit.stream_error || hit.stream_admitted === false) return {label: j.label, receive: 'poll', reason: 'stream-not-admitted', detail: String(hit.stream_error || hit.stream_phase || 'not admitted').slice(0, 160)};
    return {label: j.label, receive: 'native', phase: hit.stream_phase || row.phase || 'unknown'};
  });
}


const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const pathValue = value => typeof value === 'string' && value.trim() === value && isAbsolute(value) && !value.includes('\0');
const samePath = (a, b) => pathValue(a) && pathValue(b) && canon(a) === canon(b);
const directory = value => { try { return pathValue(value) && statSync(value).isDirectory(); } catch { return false; } };
const problem = (code, message) => ({code, message});

/** Read retained membership without filtering broken rows into an empty set.
 * The launch metadata chooses the credential, never ambient env or newest mtime. */
export function expectedReceive(home) {
  const {meta, harness, identityHome: launchIdentity} = recordedStart(home);
  const fail = message => ({problems: [problem('receive-record-unavailable', message)]});
  if (!meta || !['session', 'channel'].includes(meta.delivery) || typeof recordedRuntime(meta, harness) !== 'string') return fail('captured delivery/runtime is missing or malformed; receive ownership is unproven');
  const runtimeDelivery = runtimeDeliveryFor({delivery: meta.delivery, runtime: recordedRuntime(meta, harness)});
  if (meta.identity !== undefined && (!object(meta.identity) || !['local', 'global'].includes(meta.identity.mode))) return fail('captured identity metadata is malformed');
  const grant = meta.identity?.grant;
  if (grant !== undefined && (!object(grant) || meta.identity?.mode !== 'global' || typeof grant.id !== 'string' || !grant.id.trim())) return fail('captured grant provenance is malformed');
  const primary = grant ? grant.home : join(home, '.aw');
  if (!directory(primary) || (launchIdentity !== undefined && !samePath(primary, launchIdentity))) return fail('captured primary identity locator is missing, unreadable or inconsistent');
  let state;
  try { state = JSON.parse(readFileSync(join(home, '.oats-aweb', 'teams.json'), 'utf8')); }
  catch (error) {
    // Global early-return spawn paths forbid joining and do not write this file.
    if (error.code === 'ENOENT' && meta.identity?.mode === 'global' &&
        (grant || meta.retained === true) && (meta.joinedTeams === undefined || (Array.isArray(meta.joinedTeams) && meta.joinedTeams.length === 0))) state = {joinedTeams: []};
    else return fail('retained joined-team state is missing or unreadable; the complete receive set is unproven');
  }
  if (!object(state) || !Array.isArray(state.joinedTeams)) return fail('retained joined-team state is malformed');
  const joined = state.joinedTeams;
  if (joined.some(j => !object(j) || typeof j.label !== 'string' || !j.label.trim() || j.label === 'default' || typeof j.team !== 'string' || !j.team.trim() || !directory(j.identityHome))) return fail('retained joined-team entry or identity locator is malformed or unreadable');
  if (new Set(joined.map(j => j.label)).size !== joined.length || new Set([canon(primary), ...joined.map(j => canon(j.identityHome))]).size !== joined.length + 1) return fail('retained receive identity locators or labels overlap');
  // Join/leave commands update the provider file, not instance.json. Valid
  // local disk state wins over old launch metadata. Global modes forbid joins.
  if (meta.identity?.mode === 'global' && (joined.length || (meta.joinedTeams !== undefined && (!Array.isArray(meta.joinedTeams) || meta.joinedTeams.length)))) return fail('global identity records contain contradictory joined-team state');
  const external = runtimeDelivery === 'external-session';
  const bindings = joined.map(j => ({identity_home: j.identityHome, label: j.label, team: j.team, controls: false, event_classes: ['mail', 'chat']}));
  if (external) bindings.unshift({identity_home: primary, team: meta.identity?.team || meta.team || meta.defaultTeam?.team, label: joined.length ? 'default' : undefined, controls: true, event_classes: []});
  return {problems: [], runtimeDelivery, primary, joined, bindings, native: !external};
}

/** Released aw status is a transport observation. Worker telemetry is absent at
 * the CLI floor; that is unknown, not permission to invent a healthy worker.
 * No generation/start witness is required or inferred from historical inputs. */
export function targetReceiveProblems(status, {home, runtimeDelivery, primary, bindings}, {minimumVersion, now = Date.now()} = {}) {
  const fail = (code, message) => [problem(code, message)];
  if (!object(status) || !Array.isArray(status.instances)) return fail('wake-status-unavailable', 'aw wake status is unavailable or malformed');
  if (status.daemon_running !== true) return fail('wake-daemon-not-running', 'host wake daemon is not confirmed running');
  if (status.daemon_version_state !== 'reported' || typeof status.daemon_version !== 'string' || !/^\d+\.\d+\.\d+$/.test(status.daemon_version || '')) return fail('wake-daemon-version-unknown', 'host wake daemon compatibility is unproven');
  const version = status.daemon_version.split('.').map(Number), floor = minimumVersion.split('.').map(Number);
  const difference = version.map((n, i) => n - floor[i]).find(n => n !== 0);
  if (difference < 0) return fail('wake-daemon-outdated', `host wake daemon is running ${status.daemon_version}; required ${minimumVersion}`);
  const rows = status.instances.filter(row => samePath(row?.home, home));
  if (rows.length !== 1) return fail('wake-target-missing', 'canonical home must have exactly one broker target row');
  const row = rows[0];
  if (row.paused !== false) return fail('wake-target-paused', 'broker target is paused or its pause state is unknown');
  if (row.phase !== 'active') return fail('wake-target-inactive', 'broker target is not confirmed active');
  if (row.runtime_delivery !== runtimeDelivery || row.delivery !== (runtimeDelivery === 'external-session' ? 'session' : runtimeDelivery) ||
      !samePath(row.identity_home, bindings[0]?.identity_home) || (runtimeDelivery !== 'external-session' && !samePath(row.primary_identity_home, primary)) ||
      (runtimeDelivery === 'external-session' && row.primary_identity_home && !samePath(row.primary_identity_home, primary))) return fail('wake-target-binding', 'broker target delivery or primary identity does not match the captured home');
  const actual = row.receive_identities;
  if (!Array.isArray(actual) || actual.length !== bindings.length) return fail('wake-target-binding', 'broker receive identity set is missing, extra or incomplete');
  for (const expected of bindings) {
    const hits = actual.filter(r => samePath(r?.identity_home, expected.identity_home));
    if (hits.length !== 1) return fail('wake-target-binding', 'broker receive identity set differs from the captured home');
    const hit = hits[0];
    // controls/event_classes/label are omitempty in the released Go wire.
    const classes = hit.event_classes === undefined ? [] : hit.event_classes;
    if ((hit.label !== undefined && typeof hit.label !== 'string') || (hit.label || undefined) !== expected.label || (hit.team_id !== undefined && hit.team_id !== expected.team) || hit.delivery_owner !== 'session-hints' ||
        (hit.controls !== undefined && typeof hit.controls !== 'boolean') || (hit.controls === true) !== expected.controls ||
        !Array.isArray(classes) || classes.length !== expected.event_classes.length || classes.some(c => typeof c !== 'string') || JSON.stringify([...classes].sort()) !== JSON.stringify([...expected.event_classes].sort())) return fail('wake-target-binding', 'broker receive ownership, label or event policy differs from the captured home');
    if (hit.stream_admitted !== true || hit.stream_error || hit.stream_phase !== 'streaming') return fail('wake-stream-unavailable', 'required receive stream is missing, refused or not connected');
  }
  const core = row.channel_core;
  if (!object(core) || core.running !== true) return fail('wake-worker-unavailable', 'broker worker is stopped or current worker evidence is unavailable');
  if ([row.last_error, row.conflict_home, core.last_error, core.readiness_error].some(v => v !== undefined && typeof v !== 'string') ||
      [core.paused, core.readiness_paused].some(v => v !== undefined && typeof v !== 'boolean') ||
      (core.binding_errors !== undefined && !object(core.binding_errors))) return fail('wake-status-unavailable', 'broker target or worker status is malformed');
  if (row.last_error || row.conflict_home || core.last_error || core.readiness_error || core.paused || core.readiness_paused || (core.binding_errors && (!object(core.binding_errors) || Object.keys(core.binding_errors).length))) return fail('wake-worker-unavailable', 'broker target or worker reports an unresolved error, pause or binding conflict');
  // Both clocks come from the broker. This is an evidence-age policy, not a
  // current-start witness. Quiet workers can age out without being broken.
  const timestamp = value => {
    const match = typeof value === 'string' && /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)(?:\.\d{1,9})?(?:Z|[+-]\d\d:\d\d)$/.exec(value);
    if (!match) return NaN;
    const [, year, month, day, hour, minute, second] = match.map(Number);
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    // Date.parse normalizes impossible calendar dates such as February 30.
    if (month < 1 || month > 12 || day < 1 || day > days[month - 1] || hour > 23 || minute > 59 || second > 59) return NaN;
    return Date.parse(value);
  };
  const updated = timestamp(status.updated_at);
  const inspected = timestamp(row.last_inspect_at);
  if (!Number.isFinite(updated) || updated > now || now - updated > RECEIVE_EVIDENCE_MAX_AGE_MS) return fail('wake-status-stale', 'broker status freshness cannot be proven (missing, future or older than 30 seconds)');
  if (!Number.isFinite(inspected) || inspected > updated || now - inspected > RECEIVE_EVIDENCE_MAX_AGE_MS) return fail('receive-inspection-unproven', 'broker inspection freshness cannot be proven within 30 seconds; a quiet healthy worker may have stale evidence');
  // inspect_start retains the previous state, while inspect_error also writes
  // last_inspect_at. Only inspect_done plus matching state and no errors is a
  // successful observation. Real OATS nonshell inspection reports unknown.
  if (core.readiness_waiting !== 'inspect_done' || core.readiness_state !== 'unknown' || row.last_state !== 'unknown') return fail('receive-inspection-unproven', 'broker has no completed successful unknown-nonshell observation; receive endpoint is unproven');
  return [];
}
