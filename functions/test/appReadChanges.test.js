import test from 'node:test';
import assert from 'node:assert/strict';
import { readAppChanges } from '../lib/appReadChanges.js';

function journal(rows) {
  let calls=0;
  const query={where(){return this;},orderBy(){return this;},limit(){return this;},async get(){calls++;return {docs:rows.map(data=>({data:()=>data}))};}};
  return {db:{doc:()=>({collection:()=>query})},calls:()=>calls};
}
const input={deltaVersion:1,knownRevision:10,scopeKey:'bound-scope'};
const head={revision:12,scopeKey:'bound-scope'};
test('continuous journal collects changed sources and individual report IDs without copying source payloads',async()=>{
  const spy=journal([{revision:11,collection:'events',id:'a',eventIds:['a']},{revision:12,collection:'reports',id:'r',eventIds:['a','b']}]);
  assert.deepEqual(await readAppChanges(spy.db,'co',input,head),{eventIds:['a'],reportIds:['r'],sourceIds:['a','b']});
  assert.equal(spy.calls(),1);
});
test('missing sequence or permission configuration change requires a complete range snapshot',async()=>{
  for(const rows of [[],[{revision:12,collection:'events',id:'a',eventIds:['a']}],[{revision:11,collection:'events',id:'a',eventIds:['a']}],
    [{revision:11,collection:'cals',id:'team',eventIds:[]},{revision:12,collection:'events',id:'a',eventIds:['a']}]]) {
    assert.equal(await readAppChanges(journal(rows).db,'co',input,head),null);
  }
});
test('legacy, changed scope and out-of-range cursors never query the change journal',async()=>{
  const spy=journal([]);
  for(const value of [{...input,deltaVersion:undefined},{...input,scopeKey:'another-role'},{...input,knownRevision:-1},{...input,knownRevision:12},{...input,knownRevision:0}]) {
    assert.equal(await readAppChanges(spy.db,'co',value,value.knownRevision===0?{...head,revision:201}:head),null);
  }
  assert.equal(spy.calls(),0);
});
test('a confirmed local write rereads only its source before the change trigger advances',async()=>{
  const spy=journal([]);
  assert.deepEqual(await readAppChanges(spy.db,'co',{...input,knownRevision:12,refreshEventIds:['saved']},head),
    {eventIds:['saved'],reportIds:[],sourceIds:['saved']});
  assert.equal(spy.calls(),0);
});
