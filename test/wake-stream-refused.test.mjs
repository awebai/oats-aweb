// awebai/oats-aweb#214: from aw 1.36.58 the host wake broker reports a stream
// the server refused (401, 403, 404, 422 and other 4xx but 408, 409, 425,
// 429) as `refused`, never admitted, with its cause and next attempt, and
// retries it. Readiness names that phase, its cause, its next attempt and the
// remedy instead of only its general not-admitted message.
//
// The refused row is the real 1.36.40 capture changed into aw 1.36.58's shape
// as aw's source at tag aw-v1.36.58 writes it (awebai/aweb, cli/go/wake):
// status.go:90-95 (receive identity: stream_admitted, stream_phase,
// stream_cause, stream_next_attempt_at, stream_error), broker.go:851-853 (the
// instance's stream_admitted is false when any stream is not admitted),
// stream.go:125 (a refused stream is never admitted). No live capture of a
// refused stream exists in the fixtures.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {targetReceiveAssessment} from '../oats-package/capabilities/oats-aweb/lib/wake-receive.mjs';

const capture = () => JSON.parse(readFileSync(new URL('./fixtures/wake-status/client-1.36.40-daemon-1.36.37.json', import.meta.url), 'utf8'));

function refusedStatus({cause = '401', nextAttempt = '2026-10-17T06:20:00Z', error = 'aweb: http 401: {"detail":"invalid signature"}'} = {}) {
  const status = capture();
  status.daemon_version = '1.36.58';
  const row = status.instances[0];
  row.stream_admitted = false;
  const stream = row.receive_identities[0];
  stream.stream_admitted = false;
  stream.stream_phase = 'refused';
  delete stream.connected_at;
  if (cause !== null) stream.stream_cause = cause;
  if (nextAttempt !== null) stream.stream_next_attempt_at = nextAttempt;
  if (error !== null) stream.stream_error = error;
  return status;
}

function assess(status) {
  const row = status.instances[0];
  const expected = {home: row.home, primary: row.identity_home, runtimeDelivery: 'external-session', bindings: [{identity_home: row.identity_home, team: 'fixture:example.test', controls: true, event_classes: []}]};
  return targetReceiveAssessment(status, expected, {minimumVersion: '1.36.33', now: Date.parse('2026-10-17T06:08:42Z')});
}

test('a refused stream is a wake-stream-unavailable problem naming the phase, its cause, its next attempt and the remedy', () => {
  const {problems} = assess(refusedStatus());
  assert.equal(problems.length, 1);
  assert.equal(problems[0].code, 'wake-stream-unavailable');
  assert.equal(problems[0].message, 'broker receive stream for team fixture:example.test is refused by the server (cause 401); the broker retries it on its own, next at 2026-10-17T06:20:00Z; fix what the server refused, then restart the home to register it again, which retries at once');
});

test('a refused stream with no cause or next attempt still names the phase and the remedy', () => {
  const {problems} = assess(refusedStatus({cause: null, nextAttempt: null}));
  assert.equal(problems[0].code, 'wake-stream-unavailable');
  assert.equal(problems[0].message, 'broker receive stream for team fixture:example.test is refused by the server; the broker retries it on its own; fix what the server refused, then restart the home to register it again, which retries at once');
});

test('a refused stream\'s cause, next attempt and error are never echoed unless they have aw\'s shape', () => {
  const {problems} = assess(refusedStatus({cause: 'aw_inv_SECRETTOKENVALUE https://x.invalid/?t=1', nextAttempt: 'tomorrow; rm -rf', error: 'Authorization: Bearer SECRETTOKENVALUE'}));
  assert.equal(problems[0].code, 'wake-stream-unavailable');
  assert.doesNotMatch(problems[0].message, /SECRETTOKENVALUE|x\.invalid|tomorrow|Bearer/);
  assert.match(problems[0].message, /is refused by the server; the broker retries it on its own; fix what the server refused/);
});

test('a terminal event name is a cause aw reports and is named', () => {
  const {problems} = assess(refusedStatus({cause: 'grant_revoked'}));
  assert.match(problems[0].message, /is refused by the server \(cause grant_revoked\);/);
});

test('a target not admitted with no refused stream keeps the general message', () => {
  const status = refusedStatus();
  status.instances[0].receive_identities[0].stream_phase = 'streaming';
  status.instances[0].receive_identities[0].stream_admitted = true;
  const {problems} = assess(status);
  assert.equal(problems[0].code, 'wake-stream-unavailable');
  assert.equal(problems[0].message, 'broker target reports streams not admitted or malformed admission evidence');
});
