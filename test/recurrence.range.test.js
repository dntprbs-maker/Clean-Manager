import test from 'node:test';
import assert from 'node:assert/strict';
import { expandRecurring, assignmentOccursOn } from '../src/lib/repeat.js';

const fixed = { evaluationDate: '2026-11-05' };
const dates = (ev, start, end = start) => expandRecurring([ev], { ...fixed, start, end });
const daily = { id: 'old', start: '2020-01-01', end: '2020-01-01', repeat: 'daily' };

test('old daily series jumps past the historical 400th occurrence', () => {
  const result = dates(daily, '2026-11-01', '2026-11-03');
  assert.deepEqual(result.map(e => e.start), ['2026-11-01', '2026-11-02', '2026-11-03']);
  assert.ok(result.every(e => e.id === 'old' && e._origDate === e.start && e._recurring));
});

test('default evaluation horizon remains one year, without silent 400 truncation', () => {
  const result = expandRecurring([daily], fixed);
  assert.equal(result.at(-1).start, '2027-11-05');
  assert.ok(result.length > 400);
  assert.equal(dates(daily, '2027-11-06').length, 0);
});

test('daily interval and inclusive repeatUntil are respected', () => {
  const ev = { ...daily, repeatInterval: 3, repeatUntil: '2020-01-10' };
  assert.deepEqual(dates(ev, '2020-01-02', '2020-01-20').map(e => e.start), ['2020-01-04', '2020-01-07', '2020-01-10']);
});

test('weekly interval uses original Sunday week anchor', () => {
  const ev = { ...daily, start: '2026-10-28', end: '2026-10-28', repeat: 'weekly', repeatInterval: 2, repeatWeekdays: [1, 3] };
  assert.deepEqual(dates(ev, '2026-11-01', '2026-11-18').map(e => e.start), ['2026-11-09', '2026-11-11']);
});

test('monthly day clamps month end including leap day', () => {
  const ev = { ...daily, start: '2023-01-31', end: '2023-01-31', repeat: 'monthly', repeatMonthlyDay: 31 };
  assert.deepEqual(dates(ev, '2024-02-01', '2024-03-31').map(e => e.start), ['2024-02-29', '2024-03-31']);
});

test('monthly last weekday and legacy fifth weekday spill are retained', () => {
  const ev = { ...daily, start: '2020-01-01', repeat: 'monthly', repeatMonthlyType: 'weekday', repeatMonthlyWeekday: 1, repeatMonthlyOrdinal: -1 };
  assert.deepEqual(dates(ev, '2026-11-01', '2026-12-31').map(e => e.start), ['2026-11-30', '2026-12-28']);
  const fifth = { ...ev, start: '2026-02-01', end: '2026-02-01', repeatMonthlyOrdinal: 5 };
  assert.deepEqual(dates(fifth, '2026-03-01', '2026-03-02').map(e => e.start), ['2026-03-02']);
});

test('yearly leap day clamps and interval retains origin', () => {
  const ev = { ...daily, start: '2020-02-29', end: '2020-02-29', repeat: 'yearly', repeatInterval: 2, repeatYearlyMonth: 2, repeatYearlyDay: 29 };
  assert.deepEqual(dates(ev, '2023-01-01', '2026-12-31').map(e => e.start), ['2024-02-29', '2026-02-28']);
});

test('monthly and yearly windows jump beyond the former iteration limits', () => {
  const monthly = { ...daily, start: '1980-01-15', end: '1980-01-15', repeat: 'monthly' };
  assert.deepEqual(dates(monthly, '2026-11-01', '2026-11-30').map(e => e.start), ['2026-11-15']);
  const yearly = { ...daily, start: '1600-01-01', end: '1600-01-01', repeat: 'yearly', repeatYearlyType: 'weekday', repeatYearlyMonth: 11, repeatYearlyOrdinal: 1, repeatYearlyWeekday: 4 };
  assert.deepEqual(dates(yearly, '2026-11-01', '2026-11-30').map(e => e.start), ['2026-11-05']);
});

test('long occurrences overlapping left boundary survive', () => {
  const ev = { ...daily, start: '2026-10-01', end: '2026-10-04', repeatInterval: 10 };
  assert.deepEqual(dates(ev, '2026-11-02').map(e => [e.start, e.end]), [['2026-10-31', '2026-11-03']]);
  assert.equal(dates({ id: 'single', start: '2026-10-01', end: '2026-11-05' }, '2026-11-05').length, 1);
});

test('exceptions move in and out without losing original identity or duplicating', () => {
  const ev = { ...daily, exceptions: {
    '2020-01-01': { start: '2026-11-02', end: '2026-11-02', id: 'spoof' },
    '2026-11-02': { start: '2026-12-01', end: '2026-12-01' },
    '2026-11-03': { _deleted: true },
  } };
  const result = dates(ev, '2026-11-02', '2026-11-03');
  assert.equal(result.length, 1);
  assert.equal(result[0].id, 'old');
  assert.equal(result[0]._origDate, '2020-01-01');
  assert.equal(result[0]._hasException, true);
});

test('moved exceptions must correspond to valid original occurrences', () => {
  const ev = { ...daily, repeatInterval: 2, repeatUntil: '2020-01-05', exceptions: {
    '2020-01-02': { start: '2026-11-02', end: '2026-11-02' },
    '2020-01-03': { start: '2026-11-02', end: '2026-11-02' },
    '2020-01-07': { start: '2026-11-02', end: '2026-11-02' },
    'invalid': { start: '2026-11-02' },
  } };
  assert.deepEqual(dates(ev, '2026-11-02').map(e => e._origDate), ['2020-01-03']);
});

test('legacy assignments and old daily assignments are checked at requested day', () => {
  assert.equal(assignmentOccursOn({ id: 'a', days: [4] }, '2026-11-05'), true);
  assert.equal(assignmentOccursOn({ id: 'a', days: [4] }, '2026-11-06'), false);
  assert.equal(assignmentOccursOn(daily, '2026-11-05'), true);
});

test('invalid windows fail and excessively broad series throw instead of truncating', () => {
  assert.throws(() => dates(daily, '2026-02-30'), /Invalid recurrence window/);
  assert.deepEqual(dates(daily, '2026-11-05', '2026-11-04'), []);
  assert.throws(() => expandRecurring([{ ...daily, start: '1000-01-01', end: '1000-01-01' }], fixed), /overflow/);
});
