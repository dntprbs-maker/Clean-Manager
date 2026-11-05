import test from 'node:test';
import assert from 'node:assert/strict';
import { seoulToday } from '../src/lib/dateTime.js';
import { calendarRange } from '../src/lib/scopedData.js';
test('Seoul midnight and year boundary do not depend on device timezone',()=>{
  assert.equal(seoulToday(new Date('2026-11-04T14:59:59Z')),'2026-11-04');
  assert.equal(seoulToday(new Date('2026-11-04T15:00:00Z')),'2026-11-05');
  assert.equal(seoulToday(new Date('2026-12-31T15:00:00Z')),'2027-01-01');
});
test('calendar range includes spillover cells and independent selected/team day',()=>{
  assert.deepEqual(calendarRange(new Date(2026,10,1),'2026-11-05',null),{start:'2026-11-01',end:'2026-12-05'});
  assert.deepEqual(calendarRange(new Date(2026,10,1),'2026-10-30','2026-12-08'),{start:'2026-10-30',end:'2026-12-08'});
});
