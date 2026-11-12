import test from 'node:test';
import assert from 'node:assert/strict';
import { registerBackLayer, closeBackLayer, previousScreen } from '../src/lib/backNavigation.js';

test('back dismisses only the top dialog and preserves its underlying editor', () => {
  const calls = [];
  const editor = registerBackLayer(() => calls.push('editor'), 5);
  const picker = registerBackLayer(() => calls.push('picker'), 30);
  const confirm = registerBackLayer(() => calls.push('confirm'), 100);
  assert.equal(closeBackLayer(), true);
  assert.deepEqual(calls, ['confirm']);
  confirm();
  closeBackLayer();
  assert.deepEqual(calls, ['confirm', 'picker']);
  picker(); editor();
  assert.equal(closeBackLayer(), false);
});

test('unmount removes stale handlers, even after repeated cleanup', () => {
  const old = registerBackLayer(() => assert.fail('unmounted callback'));
  old(); old();
  let count = 0;
  const active = registerBackLayer(() => count++);
  closeBackLayer();
  assert.equal(count, 1);
  active();
  assert.equal(closeBackLayer(), false);
});

test('regular cleaning subpages go back one level', () => {
  assert.equal(previousScreen('reg_site_detail'), 'reg_sites');
  assert.equal(previousScreen('reg_sites'), 'reg_hub');
  assert.equal(previousScreen('reg_settlement'), 'reg_hub');
  assert.equal(previousScreen('reg_hub'), 'calendar');
  assert.equal(previousScreen('finance'), 'calendar');
});
