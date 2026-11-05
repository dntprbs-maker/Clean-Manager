import test from 'node:test';
import assert from 'node:assert/strict';
import { expandRecurring } from '../lib/appRecurrence.js';

test('server app recurrence exports a standalone date-only engine', () => {
  const actual = expandRecurring([{ id: 's', start: '2000-01-01', end: '2000-01-01', repeat: 'daily' }], {
    start: '2026-11-05', end: '2026-11-06', evaluationDate: '2026-11-05',
  });
  assert.deepEqual(actual.map(e => [e.id, e._origDate, e.start]), [
    ['s', '2026-11-05', '2026-11-05'], ['s', '2026-11-06', '2026-11-06'],
  ]);
});

test('server retains moved recurrence identity and inclusive overlap', () => {
  const actual = expandRecurring([{
    id: 's', start: '2020-01-01', end: '2020-01-01', repeat: 'daily', repeatUntil: '2020-01-02',
    exceptions: { '2020-01-01': { start: '2026-11-03', end: '2026-11-05' } },
  }], { start: '2026-11-05', end: '2026-11-05', evaluationDate: '2026-11-05' });
  assert.equal(actual.length, 1);
  assert.equal(actual[0]._origDate, '2020-01-01');
  assert.equal(actual[0].start, '2026-11-03');
  assert.equal(actual[0]._hasException, true);
});
