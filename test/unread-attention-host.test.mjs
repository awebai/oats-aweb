import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {healthHost} from '../oats-package/capabilities/oats-aweb/lib/health-host.mjs';

test('count-only uses explicit identity and rejects nonzero exits even with a plausible count', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'unread-count-'));
  t.after(() => rmSync(dir, {recursive: true, force: true}));
  const bin = join(dir, 'aw');
  const host = healthHost({deployment: dir, env: {PATH: `${dir}:/usr/bin:/bin`, AWEB_IDENTITY_HOME: '/foreign', AWEB_URL: 'https://foreign.invalid'}});
  const stub = (body, exit = 0) => writeFileSync(bin, `#!/bin/sh\n[ -z "$AWEB_IDENTITY_HOME$AWEB_URL" ] || exit 50\n[ "$*" = '--identity-home /selected mail inbox --count-only --json' ] || exit 51\nprintf '%s\\n' '${body}'\nexit ${exit}\n`, {mode: 0o755});
  stub('{"unread_count":4}');
  assert.equal(await host.unreadCount('/selected'), 4);
  stub('{"unread_count":0}', 2);
  assert.equal(await host.unreadCount('/selected'), null);
  for (const body of ['{}', '{"unread_count":"0"}', '{"unread_count":-1}', '{"unread_count":1.5}', 'not JSON']) {
    stub(body); assert.equal(await host.unreadCount('/selected'), null);
  }
});
