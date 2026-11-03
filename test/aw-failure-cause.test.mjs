// awebai/oats-aweb#52: the cause of a failed, output-withheld aw call, named
// from a fixed vocabulary. aw's own text is matched, never relayed.
import assert from 'node:assert/strict';
import test from 'node:test';
import { withheldFailureCause } from '../oats-package/capabilities/oats-aweb/lib/aw-failure-cause.mjs';
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
