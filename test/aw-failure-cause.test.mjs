// awebai/oats-aweb#52: the cause of a failed, output-withheld aw call, named
// from a fixed vocabulary. aw's own text is matched, never relayed.
import assert from 'node:assert/strict';
import test from 'node:test';
import { NAMESPACE_CONTROLLER_KEY_MISSING, SERVICE_REFUSED, TEAM_KEY_MISSING, serviceDetailCode, withheldFailureCause } from '../oats-package/capabilities/oats-aweb/lib/aw-failure-cause.mjs';
const NETWORK = 'the aweb service could not be reached: a network or TLS failure';
const NONE = 'no HTTP status, aw error code or network failure in its output';
const SECRET = 'aw_inv_SECRET0123456789abcdef';

// Go's net, net/http and crypto/tls wordings, as the aw binary carries them. Each row
// carries one wording only, so a row fails when its wording is dropped.
for (const stderr of [
  `Post "https://aweb.example.invalid/v1/x": dial tcp: lookup aweb.example.invalid: no such host`,
  `Post "https://aweb.example.invalid/v1/x": dial tcp4 192.0.2.1:443: connect: no route to host`,
  `Post "https://aweb.example.invalid/v1/x": dial tcp6 [2001:db8::1]:443: connect: no route to host`,
  `Post "https://aweb.example.invalid/v1/x": net/http: TLS handshake timeout`,
  `Post "https://aweb.example.invalid/v1/x": EOF`,
  `Post "https://aweb.example.invalid/v1/x": unexpected EOF`,
  `Post "https://aweb.example.invalid/v1/x": net/http: request canceled (Client.Timeout exceeded while awaiting headers)`,
  `Post "https://aweb.example.invalid/v1/x": read tcp 192.0.2.2:5000->192.0.2.1:443: read: connection reset by peer`,
  `Post "https://aweb.example.invalid/v1/x": tls: failed to verify certificate: x509: certificate signed by unknown authority`,
  `Post "https://aweb.example.invalid/v1/x": dial tcp 192.0.2.1:443: i/o timeout`,
]) test(`network wording is classified: ${stderr.slice(stderr.indexOf('": ') + 3)}`, () => {
  assert.equal(withheldFailureCause({ stderr: `${stderr} ${SECRET}`, stdout: '' }), NETWORK);
});

test('an EOF that is not Go\'s transport wording is not a network failure', () => {
  assert.equal(withheldFailureCause({ stderr: 'reached EOF of the team list', stdout: '' }), NONE);
});

test('aw\'s allowlisted --json error code is named, even with notes after the envelope', () => {
  assert.equal(withheldFailureCause({ stderr: '', stdout: JSON.stringify({ error: { code: 'unknown_or_invalid', message: SECRET } }) }), 'aw error unknown_or_invalid');
  assert.equal(withheldFailureCause({ stderr: '', stdout: `${JSON.stringify({ error: { code: 'unknown_or_invalid', message: SECRET } })}\nnote: ${SECRET}` }), 'aw error unknown_or_invalid');
});

test('a code off the allowlist is never named, and no input text is relayed', () => {
  for (const code of ['server_unreachable', `custom ${SECRET}`]) {
    const cause = withheldFailureCause({ stderr: '', stdout: JSON.stringify({ error: { code, message: SECRET } }) });
    assert.equal(cause, NONE);
  }
  assert.equal(withheldFailureCause({ stderr: `something odd ${SECRET}`, stdout: `not json ${SECRET}` }), NONE);
});

// awebai/oats-aweb#202: a key aw needs that is not on this machine, in aw 1.36.54's
// own wording (stderr, and the same message in its --json envelope on stdout).
const envelope = (message) => JSON.stringify({ error: { code: 'error', message } });
for (const [message, cause] of [
  ['no local controller key for --namespace d.invalid; pass --hosted for a hosted sibling, or install the namespace controller key for BYOT (aw id namespace prepare-controller --domain d.invalid)', NAMESPACE_CONTROLLER_KEY_MISSING],
  ['load controller key for d.invalid: open /home/u/.awid/controller.key: permission denied', NAMESPACE_CONTROLLER_KEY_MISSING],
  ['no team key for d.invalid/eng; run `aw id team create` first', TEAM_KEY_MISSING],
  ['local team controller key for eng:d.invalid was not found: open /home/u/.config/aw/team-keys/d.invalid/eng.key: no such file or directory', TEAM_KEY_MISSING],
]) test(`a missing local key is named: ${message.slice(0, 40)}`, () => {
  assert.equal(withheldFailureCause({ stderr: `${message} ${SECRET}`, stdout: envelope(message) }), cause);
  assert.equal(withheldFailureCause({ stderr: '', stdout: envelope(message) }), cause, 'the envelope alone names it');
});

test('a service detail code is named only from the table or as one short snake_case word', () => {
  for (const code of ['service_url_mismatch', 'awid_team_not_found', 'awid_team_controller_mismatch', 'awid_team_missing_controller', 'invalid_controller_signature', 'invalid_controller_timestamp', 'validation_error', 'a', `a${'b'.repeat(47)}`]) assert.equal(serviceDetailCode(code), code);
  for (const code of [`a${'b'.repeat(48)}`, 'service_url_mismatch\n', 'service_url_mismatch\nx', 'x\nservice_url_mismatch', 'Service_url', '1code', 'code-with-dash', 'code with space', '', SECRET, 42, null, undefined, {}, ['service_url_mismatch']]) assert.equal(serviceDetailCode(code), SERVICE_REFUSED, JSON.stringify(code));
});
