import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeScheduleSnapshot } from '../src/lib/scheduleCache.js';

test('delta removes every old repeat occurrence and deleted source/report while retaining unrelated rows', () => {
  const prior = {revision:1,events:[{id:'a'},{id:'b'}],instances:[{id:'a',_origDate:'2026-11-01'},{id:'a',_origDate:'2026-11-02'}],
    reports:[{id:'r1',eventId:'a'},{id:'r2',eventId:'b'}],sharedWidget:{events:[{id:'a',start:'2026-11-01'},{id:'a',start:'2026-11-02'},{id:'b',start:'2026-11-01'}],calendars:[{id:'c',color:'red'}]}};
  const merged=mergeScheduleSnapshot(prior,{revision:2,delta:{replaceEventIds:['a'],replaceReportEventIds:['a'],replaceReportIds:[]},events:[],instances:[],reports:[],
    sharedWidget:{revision:2,replaceEventIds:['a'],events:[],calendars:[]}});
  assert.deepEqual(merged.events,[{id:'b'}]);assert.deepEqual(merged.instances,[]);
  assert.deepEqual(merged.reports,[{id:'r2',eventId:'b'}]);assert.equal(merged.sharedWidget.events.length,1);
  assert.equal(merged.delta,undefined);assert.equal(merged.sharedWidget.replaceEventIds,undefined);
  assert.equal(prior.events.length,2,'original complete snapshot is immutable');
});
test('only a changed report is replaced and unchanged confirmation retains the complete snapshot',()=>{
  const prior={events:[{id:'a'}],instances:[],reports:[{id:'r1',eventId:'a',memo:'old'},{id:'r2',eventId:'a'}]};
  const merged=mergeScheduleSnapshot(prior,{delta:{replaceEventIds:[],replaceReportEventIds:[],replaceReportIds:['r1']},events:[],instances:[],reports:[{id:'r1',eventId:'a',memo:'new'}]});
  assert.equal(merged.reports.length,2);assert.equal(merged.reports.find(r=>r.id==='r1').memo,'new');
  assert.deepEqual(mergeScheduleSnapshot(merged,{notModified:true,serverAt:'now'}),{...merged,serverAt:'now'});
  assert.throws(()=>mergeScheduleSnapshot(null,{delta:{}}));
});
