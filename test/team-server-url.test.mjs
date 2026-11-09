// The aweb service URL as AWID's team-server record holds it: aw 1.36.56 publishes only a
// canonical URL (awid/team_server.go:116 CanonicalTeamServerURL), and register strips a trailing
// slash (cmd/aw/helpers.go:851 cleanBaseURL). Setup canonicalizes once and uses that form throughout.
import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalTeamServerURL } from '../oats-package/capabilities/oats-aweb/lib/team-server-url.mjs';

test('a service URL is put in the canonical form aw publishes', () => {
  for (const [raw, url] of [
    ['https://aweb.example.invalid/api', 'https://aweb.example.invalid/api'],
    ['https://aweb.example.invalid/api/', 'https://aweb.example.invalid/api'],
    [' https://AWEB.Example.Invalid:443/api/ ', 'https://aweb.example.invalid/api'],
    ['https://aweb.example.invalid', 'https://aweb.example.invalid'],
    ['https://aweb.example.invalid/', 'https://aweb.example.invalid'],
    ['https://aweb.example.invalid:8443/api', 'https://aweb.example.invalid:8443/api'],
    ['http://127.0.0.1:9/api', 'http://127.0.0.1:9/api'],
    ['http://localhost:8000', 'http://localhost:8000'],
    ['http://[::1]:8000/api', 'http://[::1]:8000/api'],
    ['http://[::ffff:127.0.0.1]:8000/api', 'http://[::ffff:7f00:1]:8000/api'],
  ]) assert.deepEqual(canonicalTeamServerURL(raw), { url }, raw);
});

test('a URL a team-server record cannot hold is refused with aw\'s reason', () => {
  for (const [raw, reason] of [
    ['', 'is required'],
    ['not a url', 'is not a URL'],
    ['ftp://aweb.example.invalid/api', 'must use https'],
    ['http://aweb.example.invalid/api', 'must use https outside loopback hosts'],
    ['https://user:pw@aweb.example.invalid/api', 'must not include userinfo, params, query or fragment'],
    ['https://aweb.example.invalid/api?x=1', 'must not include userinfo, params, query or fragment'],
    ['https://aweb.example.invalid/api#f', 'must not include userinfo, params, query or fragment'],
    ['https://aweb.example.invalid/a;b', 'must not include userinfo, params, query or fragment'],
    ['https://aweb.example.invalid//api', 'must not end with a slash or contain empty segments'],
    ['https://192.0.2.1/api', 'must not use a literal IP address'],
    ['http://[::ffff:192.0.2.1]/api', 'must use https outside loopback hosts'],
    [`https://aweb.example.invalid/${'a'.repeat(2048)}`, 'must be at most 2048 bytes'],
  ]) assert.deepEqual(canonicalTeamServerURL(raw), { reason }, raw);
});
