import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serializeHubSource, exportHubChanges } from '../lib/hubChanges.js';

const doc = data => ({ id: 'server-id', data: () => data, updateTime: { toDate: () => new Date('2026-10-25T12:00:00Z') } });
test('hub projection preserves recurrence and authoritative identity while excluding unrelated private fields', () => {
  const r = serializeHubSource(doc({ id:'untrusted-id', title:'청소', start:'2026-10-25', repeat:'monthly', repeatMonthlyDay:25,
    exceptions:{'2026-11-25':{status:'completed'}}, contact:'private', mcpCreatedBy:{agentId:'private'} }), 'events');
  assert.equal(r.id,'server-id'); assert.equal(r.repeatMonthlyDay,25); assert.equal(r.exceptions['2026-11-25'].status,'completed');
  assert.equal(r.contact,undefined); assert.equal(r.mcpCreatedBy,undefined);
});
test('import markers remain authoritative without duplicating calendar payloads or report attachments', () => {
  const r = serializeHubSource(doc({gcalSync:{secret:'unneeded'},icsRaw:'large calendar',icsUid:'uid'}),'events');
  assert.equal(r.gcalSync,true); assert.equal(r.icsRaw,true); assert.equal(r.icsUid,true);
  const report = serializeHubSource(doc({eventId:'a',date:'2026-10-25',status:'완료',photos:['private']}),'reports');
  assert.equal(report.photos,undefined); assert.equal(report.eventId,'a');
});
test('an empty confirmed journal costs one head read and does not claim source quiescence', async () => {
  let reads=0;
  const db={doc:path=>{assert.equal(path,'mcpHubStreams/company');return{get:async()=>{reads++;return{data:()=>({sequence:7})};},collection:()=>{throw Error('empty poll must not query source or journal');}};}};
  const p=await exportHubChanges(db,'company',{cursor:7});
  assert.equal(reads,1);assert.deepEqual(p.items,[]);assert.equal(p.source_quiescence,'unknown');
});
