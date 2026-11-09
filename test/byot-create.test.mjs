// The aw floor for `setup --create --namespace` (lib/byot-create.mjs): 1.36.53, cited to aw's tags.
import assert from 'node:assert/strict';
import test from 'node:test';
import { AW_BYOT_CREATE, byotCreateAwRefusal } from '../oats-package/capabilities/oats-aweb/lib/byot-create.mjs';
import { AW_TESTED } from '../oats-package/capabilities/oats-aweb/lib/aw-floor.mjs';

test('the BYOT create floor is 1.36.53, a refusal floor at or below aw-compat\'s tested', () => {
  assert.equal(AW_BYOT_CREATE, '1.36.53');
  assert.equal(byotCreateAwRefusal(AW_TESTED), undefined);
  for (const v of ['1.36.53', '1.36.56', '1.37.0']) assert.equal(byotCreateAwRefusal(v), undefined, v);
  for (const v of ['1.36.33', '1.36.44', '1.36.51', '1.36.53-rc.5']) assert.equal(byotCreateAwRefusal(v), `--create --namespace needs aw >= 1.36.53 (this host has ${v}): upgrade with npm install -g @awebai/aw@${AW_TESTED}; nothing was created`, v);
  assert.match(byotCreateAwRefusal(undefined), /\(this host has an unreadable aw\)/);
});
