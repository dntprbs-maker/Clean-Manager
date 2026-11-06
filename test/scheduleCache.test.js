import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeScheduleSnapshot } from '../src/lib/scheduleCache.js';
import { applySavedEntity } from '../src/lib/scheduleCache.js';

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
test('confirmed local writes preserve unrelated rows, version and recurring exceptions without mutating the previous snapshot',()=>{
  const rows=[{id:'a',finance:{revenue:1},exceptions:{old:{title:'keep'}}},{id:'b',title:'keep'}];
  const saved=applySavedEntity(rows,'a',{'exceptions.2026-11-07':{finance:{revenue:600000}}},false,'new');
  assert.equal(saved[0].exceptions['2026-11-07'].finance.revenue,600000);
  assert.equal(saved[0].exceptions.old.title,'keep');assert.equal(saved[0].__readVersion,'new');
  assert.equal(rows[0].exceptions['2026-11-07'],undefined);assert.deepEqual(saved[1],rows[1]);
  assert.deepEqual(applySavedEntity(rows,'a',null,true),[rows[1]]);
});
test('only a changed report is replaced and unchanged confirmation retains the complete snapshot',()=>{
  const prior={events:[{id:'a'}],instances:[],reports:[{id:'r1',eventId:'a',memo:'old'},{id:'r2',eventId:'a'}]};
  const merged=mergeScheduleSnapshot(prior,{delta:{replaceEventIds:[],replaceReportEventIds:[],replaceReportIds:['r1']},events:[],instances:[],reports:[{id:'r1',eventId:'a',memo:'new'}]});
  assert.equal(merged.reports.length,2);assert.equal(merged.reports.find(r=>r.id==='r1').memo,'new');
  assert.deepEqual(mergeScheduleSnapshot(merged,{notModified:true,serverAt:'now'}),{...merged,serverAt:'now'});
  assert.throws(()=>mergeScheduleSnapshot(null,{delta:{}}));
});
