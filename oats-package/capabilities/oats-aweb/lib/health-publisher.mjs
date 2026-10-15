// One tick of the agent status publisher (aweb-acah.3). It runs from the
// deployment once a minute, outside every instance session, so hooks stay
// untouched and a deployment that does not publish runs none of it
// (docs/design/2026-10-14-agent-health-publisher.md, D7). Per home: the agent
// id is aw's own answer for the identity home (never guessed); the agent
// designates its status host once per (agent id, host); its team's minting
// root publishes a checked document. A resident is designated and published
// from its custody root, its seats combined. Every refusal is logged with the
// exact status and message aw reported.
import {join} from 'node:path';
import {assessHealth, combineSeats, retiredHealth} from './health-vocabulary.mjs';
import {CONTROL_CHARACTER, checkDocument} from './status-document.mjs';

export const VALIDITY_MS = 300 * 1000;
const DEFAULT_BUDGET_MS = 45 * 1000;
const DEFAULT_CONCURRENCY = 4;
const OPERATOR_MAX_BYTES = 120;
const HEALTH_KEYS = ['publish', 'language', 'operator'];

/** settings.oats.aweb.health, checked: publishing is off unless publish is true. */
export function healthSettings(settings) {
  const health = settings?.health ?? {};
  if (typeof health !== 'object' || Array.isArray(health)) throw new Error('settings.oats.aweb.health must be a map');
  const unknown = Object.keys(health).find((k) => !HEALTH_KEYS.includes(k));
  if (unknown !== undefined) throw new Error(`unknown health setting: ${unknown}`);
  if (health.publish !== undefined && typeof health.publish !== 'boolean') throw new Error('health.publish must be true or false');
  if (health.language !== undefined && (typeof health.language !== 'string' || !/^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8})*$/.test(health.language))) throw new Error('health.language must be a BCP 47 tag');
  if (health.operator !== undefined && (typeof health.operator !== 'string' || !health.operator || CONTROL_CHARACTER.test(health.operator) || Buffer.byteLength(health.operator) > OPERATOR_MAX_BYTES)) throw new Error(`health.operator must be one line of at most ${OPERATOR_MAX_BYTES} bytes`);
  return {publish: health.publish === true, language: health.language ?? 'en', operator: health.operator ?? null};
}

/** Where a resident's designation cache lives: beside its custody state. */
/** One agent is one identity in one team; `target` says where aw acts as it:
 *  {identityHome} for an instance identity, {cwd} for a root or custody. */
const agentKey = (target, team) => JSON.stringify([target, team]);

const residentCacheFile = (custody) => join(custody, '.oats-resident', 'health.json');

const isoSeconds = (ms) => new Date(Math.floor(ms / 1000) * 1000).toISOString().replace('.000Z', 'Z');

/** The agents one home holds: its primary identity and each joined team's. */
function identitiesOf(row, settings) {
  const meta = row.capabilityMeta?.['oats.aweb'];
  if (!meta) return {identities: []};
  if (meta.retained) return {skip: 'a retained seat is not published in v1'};
  const id = meta.identity ?? {};
  if (id.mode === 'global') {
    const custody = settings.residents?.[id.resident];
    if (!custody) return {skip: `resident ${id.resident} is not in settings.oats.aweb.residents`};
    return {identities: [{kind: 'resident', resident: id.resident, team: id.team, alias: id.alias, id: {cwd: custody}, host: {cwd: custody}, cacheFile: residentCacheFile(custody), identity: {kind: 'primary'}}]};
  }
  const team = id.team ?? meta.team, alias = id.alias ?? meta.alias;
  const rootFor = (t) => settings.roots?.[t] ?? settings.root;
  if (!rootFor(team)) return {skip: `no minting root for team ${team}`};
  const cacheFile = join(row.home, '.oats-aweb', 'health.json');
  const identities = [{kind: 'local', team, alias, id: {identityHome: join(row.home, '.aw')}, host: {cwd: rootFor(team)}, cacheFile, identity: {kind: 'primary'}}];
  for (const j of meta.joinedTeams ?? []) {
    if (rootFor(j.team)) identities.push({kind: 'local', team: j.team, alias: j.alias ?? alias, id: {identityHome: j.identityHome}, host: {cwd: rootFor(j.team)}, cacheFile, identity: {kind: 'joined', receive: j.receive}});
  }
  return {identities};
}

/** Settles `promise`, or answers null once `ms` have passed. */
const within = (promise, ms) => Promise.race([promise, new Promise((resolve) => setTimeout(resolve, Math.max(0, ms), null).unref?.())]).catch(() => null);

async function pool(items, size, work) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({length: Math.min(size, items.length)}, async () => {
    while (next < items.length) { const i = next++; out[i] = await work(items[i]); }
  }));
  return out;
}

/** One home's kernel state and provider readiness. Readiness is read only for
 *  a running home, within what is left of the tick's budget. */
async function observeHome(row, host, deadline) {
  const liveness = row.launched === false ? {state: 'not-launched', lastEvent: null} : await host.liveness(row);
  const readiness = liveness.state === 'alive' ? await within(host.readiness(row.home), deadline - Date.now()) : null;
  return {liveness, launchPrompts: row.launchPrompts ?? null, readiness};
}

/** Publishes one agent's status: designates when the cache says it must,
 *  honours Retry-After, sends, and records the outcome. */
async function publishAgent(agent, health, {host, now, result}) {
  const {team, alias, cacheFile} = agent;
  const cache = (await host.readCache(cacheFile)) ?? {};
  let entry = cache[team];
  if (entry && (entry.agent !== agent.agentId || entry.host !== agent.hostDid)) entry = undefined;
  entry = entry ?? {agent: agent.agentId, host: agent.hostDid, alias, designated: false};
  const save = async () => { cache[team] = entry; await host.writeCache(cacheFile, cache); };
  const refused = async (answer) => {
    const row = {alias, team, status: answer.status ?? null, code: answer.code ?? null, message: answer.message ?? ''};
    result.refused.push(row);
    await host.log({at: isoSeconds(now), ...row, retry_after: answer.retry_after ?? null});
  };
  if (entry.retryUntil && now < entry.retryUntil) {
    result.skipped.push({alias, team, reason: `rate limited until ${isoSeconds(entry.retryUntil)}`});
    return;
  }
  if (!entry.designated) {
    const set = await host.statusHostSet(agent.id, agent.hostDid);
    if (!set.ok) { await refused(set); await save(); return; }
    entry.designated = true;
  }
  const seq = now;
  const document = {v: 1, type: 'agent_status', team_id: team, agent: agent.agentId, publisher_did: agent.hostDid, seq, ...health, observed_at: isoSeconds(now), valid_until: isoSeconds(now + VALIDITY_MS)};
  const checked = checkDocument(document, {now});
  if (!checked.ok) { await refused({status: null, code: checked.error, message: checked.message}); return; }
  const answer = await host.statusPublish(agent.host, alias, document);
  delete entry.retryUntil;
  if (answer.ok) {
    result.published.push({alias, team, reachable: health.reachable, code: health.reason?.code ?? null});
  } else {
    await refused(answer);
    if (answer.code === 'not_status_host') entry.designated = false;
    if (answer.status === 429 && Number.isFinite(answer.retry_after)) entry.retryUntil = now + answer.retry_after * 1000;
  }
  await save();
}

/** One tick: assess every home, then designate and publish every agent. */
export async function publishTick({settings, now, host, budgetMs = DEFAULT_BUDGET_MS, concurrency = DEFAULT_CONCURRENCY}) {
  const options = healthSettings(settings);
  if (!options.publish) return {disabled: true};
  const supported = await host.awSupportsStatus();
  if (!supported.ok) throw new Error(supported.message);
  const deadline = Date.now() + budgetMs;
  const result = {published: [], refused: [], skipped: []};
  const rows = (await host.status()).agents.flatMap((a) => a.instances ?? []).filter((r) => !r.retirePending);

  const homes = [];
  for (const row of rows) {
    const {identities, skip} = identitiesOf(row, settings);
    if (skip) result.skipped.push({home: row.home, reason: skip});
    else if (identities.length) homes.push({row, identities});
  }
  const observed = await pool(homes, concurrency, ({row}) => observeHome(row, host, deadline));
  const time = now();
  const words = {language: options.language, operator: options.operator, now: time};

  // One agent per (identity dir, team): a resident's seats share one.
  const agents = new Map();
  homes.forEach(({identities}, i) => {
    for (const identity of identities) {
      const key = agentKey(identity.id, identity.team);
      const seat = assessHealth({...observed[i], ...words, grant: homes[i].row.capabilityMeta['oats.aweb'].identity?.grant ?? null, identity: identity.identity});
      const agent = agents.get(key) ?? {...identity, seats: []};
      agent.seats.push(seat);
      agents.set(key, agent);
    }
  });
  // A resident published before whose seats are all gone was retired.
  for (const [resident, custody] of Object.entries(settings.residents ?? {})) {
    const cache = (await host.readCache(residentCacheFile(custody))) ?? {};
    for (const team of Object.keys(cache)) {
      const key = agentKey({cwd: custody}, team);
      if (agents.has(key) || !cache[team].designated) continue;
      agents.set(key, {kind: 'resident', resident, team, alias: cache[team].alias, id: {cwd: custody}, host: {cwd: custody}, cacheFile: residentCacheFile(custody), seats: [retiredHealth(words)]});
    }
  }

  const ids = new Map();
  const ask = (target) => { const k = JSON.stringify(target); if (!ids.has(k)) ids.set(k, host.identityOf(target).catch(() => null)); return ids.get(k); };
  // Agents sharing a cache file (a home's primary and joined identities)
  // publish one after another; different files in parallel.
  const byCache = new Map();
  for (const agent of agents.values()) byCache.set(agent.cacheFile, [...(byCache.get(agent.cacheFile) ?? []), agent]);
  await pool([...byCache.values()], concurrency, async (group) => {
    for (const agent of group) {
      const own = await ask(agent.id), hostId = await ask(agent.host);
      agent.agentId = agent.kind === 'resident' ? own?.stable_id : own?.did;
      agent.hostDid = hostId?.did;
      if (!agent.agentId || !agent.hostDid) { result.skipped.push({alias: agent.alias, team: agent.team, reason: agent.agentId ? 'aw gave no publisher did' : 'aw gave no agent id'}); continue; }
      const {reachable, reason, fixing} = combineSeats(agent.seats);
      await publishAgent(agent, {reachable, ...(reason ? {reason} : {}), ...(fixing ? {fixing} : {})}, {host, now: time, result});
    }
  });
  return result;
}
