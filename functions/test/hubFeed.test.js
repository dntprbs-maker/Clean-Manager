import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildHubFeed } from '../lib/hubFeed.js';
const range={start:'2026-10-01',end:'2026-10-31'};
test('native only, stable recurrence identity, overrides, statuses and team preserved',()=>{
 const e={id:'a',title:'청소',start:'2026-01-24',repeat:'monthly',repeatMonthlyDay:24,calId:'t',exceptions:{'2026-10-24':{start:'2026-10-25',description:'변경',status:'completed'}}};
 const f=buildHubFeed([e,{...e,id:'g',gcalSync:{eventId:'g'}},{...e,id:'i',source:'ics_import'},{...e,id:'d',status:'deleted'}],{t:'청소팀'},range);
 assert.equal(f.items.length,1);assert.equal(f.items[0].source_id,'a@2026-10-24');assert.equal(f.items[0].start_at,'2026-10-25T00:00:00+09:00');assert.equal(f.items[0].source_status,'completed');assert.equal(f.items[0].worker,'청소팀');assert.equal(f.excluded_imported,2);
});
test('old daily recurrence is not truncated before current window; inclusive all-day end converted',()=>{
 const f=buildHubFeed([{id:'old',title:'매일',start:'2020-01-01',repeat:'daily',allDay:true}],{},range);
 assert.equal(f.items.length,31);assert.equal(f.items[0].end_at,'2026-10-02');
});
test('pagination detects concurrent changes before a partial snapshot can reconcile',()=>{
 const events=Array.from({length:201},(_,i)=>({id:String(i).padStart(3,'0'),title:'t',start:'2026-10-01'}));
 const f=buildHubFeed(events,{},range);assert.equal(f.next_offset,200);
 assert.equal(buildHubFeed(events,{}, {...range,offset:200,snapshot:f.snapshot}).items.length,1);
 events[0].title='changed';assert.throws(()=>buildHubFeed(events,{}, {...range,offset:200,snapshot:f.snapshot}),/snapshot_changed/);
});
test('actual completion reports apply to the matching recurrence only and ongoing report takes priority',()=>{
 const e={id:'a',start:'2026-10-01',repeat:'daily',status:'confirmed'};
 const reports=[{eventId:'a',date:'2026-10-03',status:'완료'}];
 let f=buildHubFeed([e],{},range,reports);
 assert.equal(f.items.find(r=>r.source_id==='a@2026-10-03').source_status,'completed');
 assert.equal(f.items.find(r=>r.source_id==='a@2026-10-04').source_status,'confirmed');
 reports.push({eventId:'a',date:'2026-10-03',status:'진행중'});
 f=buildHubFeed([e],{},range,reports);assert.equal(f.items.find(r=>r.source_id==='a@2026-10-03').source_status,'in_progress');
});
