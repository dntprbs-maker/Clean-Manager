import test from 'node:test';
import assert from 'node:assert/strict';
import { calendarWindows, expandEventsInWindows } from '../src/lib/scopedData.js';

test('distant month, selected day and team day remain separate bounded windows',()=>{
  assert.deepEqual(calendarWindows(new Date(2024,0,1),'2026-11-05','2026-11-05'),[
    {from:'2023-12-31',to:'2024-02-03'},
    {from:'2026-11-05',to:'2026-11-05'},
  ]);
});
test('recurrence expansion never fills the years between independent displayed windows',()=>{
  const windows=calendarWindows(new Date(2026,10,1),'2020-01-01');
  const events=expandEventsInWindows([{id:'daily',start:'2020-01-01',end:'2020-01-01',repeat:'daily'}],windows);
  assert.equal(events.length,36);
  assert.ok(events.every(e=>e.start==='2020-01-01'||(e.start>='2026-11-01'&&e.start<='2026-12-05')));
});
test('one long event overlapping two windows is not duplicated and moved identity remains distinct',()=>{
  const windows=[{from:'2026-01-01',to:'2026-01-01'},{from:'2026-11-05',to:'2026-11-05'}];
  const events=expandEventsInWindows([
    {id:'long',start:'2025-01-01',end:'2027-01-01'},
    {id:'repeat',start:'2026-01-01',end:'2026-01-01',repeat:'daily',exceptions:{'2026-01-02':{start:'2026-11-05',end:'2026-11-05'}}},
  ],windows);
  assert.equal(events.filter(e=>e.id==='long').length,1);
  assert.equal(events.filter(e=>e.id==='repeat'&&e.start==='2026-11-05').length,2);
});
