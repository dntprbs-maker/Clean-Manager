import assert from 'node:assert/strict';
import test from 'node:test';
import { hasReminderSettings, planReminders, reminderOccurrence, claimReminder } from '../lib/eventReminders.js';
import { isDailyDigestSlot, reminderTime } from '../lib/eventReminderTimes.js';

const time = value => Date.parse(value + '+09:00');
const modes = ['10m', '30m', '60m', 'previousNoon'];
const event = { id: 'event', start: '2026-11-08', startTime: '00:15', reminderModes: modes };

test('reused scheduler preserves the original Seoul 08:00 digest slot', () => {
  assert.equal(isDailyDigestSlot('2026-11-07T23:00:00Z'), true);
  assert.equal(isDailyDigestSlot('2026-11-07T23:01:00Z'), false);
  assert.equal(isDailyDigestSlot('2026-11-07T08:00:00Z'), false);
});

test('four Seoul reminder times across midnight and all-day policy', () => {
  assert.deepEqual(modes.map(mode => reminderTime(event, mode)), [
    time('2026-11-08T00:05'), time('2026-11-07T23:45'), time('2026-11-07T23:15'), time('2026-11-07T12:00'),
  ]);
  assert.equal(reminderTime({ ...event, start: '2026-02-31' }, 'previousNoon'), null);
  assert.equal(reminderTime({ ...event, allDay: true }, '10m'), null);
  const planned = planReminders({ ...event, allDay: true }, time('2026-11-07T09:00'));
  assert.deepEqual(planned.plans.map(item => item.mode), ['previousNoon']);
});

test('no settings, late opt-in, completion, cancellation and changed time', () => {
  const now = time('2026-11-07T23:16');
  assert.equal(hasReminderSettings({ start: event.start }), false);
  const before = planReminders(event, now - 120_000);
  assert.deepEqual(planReminders(event, now).plans.map(item => item.mode), ['30m', '10m']);
  assert.equal(planReminders(event, now, before.plans).plans[0].mode, '60m');
  const old = before.plans[0];
  assert.equal(reminderOccurrence({ ...event, startTime: '02:00' }, old), null);
  for (const patch of [{ completed: true }, { status: 'deleted' }, { title: '🔵 완료' }, { title: '🚫 취소' }, { reminderModes: [] }]) {
    assert.equal(reminderOccurrence({ ...event, ...patch }, old), null);
    assert.equal(planReminders({ ...event, ...patch }, now).plans.length, 0);
  }
});

test('series keeps original dates, handles moved and cancelled occurrences and extends the horizon', () => {
  const now = time('2026-11-07T09:00');
  const recurring = { ...event, repeat: 'daily', reminderModes: ['10m'], exceptions: {
    '2026-11-08': { start: '2026-11-09', end: '2026-11-09', startTime: '01:00' },
    '2026-11-10': { _deleted: true },
    '2026-11-11': { reminderModes: [] },
  } };
  const result = planReminders(recurring, now);
  const [unmoved, moved] = result.plans;
  assert.equal(unmoved.original, '2026-11-09');
  assert.equal(moved.original, '2026-11-08');
  assert.equal(moved.date, '2026-11-09');
  assert.notEqual(moved.key, unmoved.key);
  assert.equal(reminderOccurrence(recurring, moved)._origDate, moved.original);
  assert.equal(result.plans.some(item => ['2026-11-10', '2026-11-11'].includes(item.original)), false);
  const afterCheckpoint = planReminders(recurring, result.checkpoint + 60_000, result.plans);
  assert.ok(afterCheckpoint.plans.at(-1).at > result.plans.at(-1).at);
});

test('atomic claim rejects stale versions and only claims an occurrence once', async () => {
  const version = { isEqual: other => other === version };
  const stale = { isEqual: () => false };
  const plan = { key: 'single_10m', at: Date.now() };
  const queued = { version, plans: [plan], checkpoint: null };
  let pending = queued;
  let current = stale;
  let claimed = false;
  const queue = { collection: () => ({ doc: () => 'receipt' }) };
  const db = { runTransaction: callback => callback({
    getAll: async () => [{ updateTime: current }, { data: () => pending }, { exists: claimed }],
    create: () => { claimed = true; },
    delete: () => { pending = undefined; },
  }) };
  assert.equal(await claimReminder(db, 'source', queue, plan, version), false);
  assert.equal(claimed, false);
  current = version;
  assert.equal(await claimReminder(db, 'source', queue, plan, version), true);
  pending = queued; // A source edit rebuilt the queue with the same occurrence.
  assert.equal(await claimReminder(db, 'source', queue, plan, version), false);
});
