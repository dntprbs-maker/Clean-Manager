import { test } from 'node:test';
import assert from 'node:assert/strict';
import { syncEventCalendar } from '../lib/eventCalendar.js';
const cals=[{id:'a',label:'일반 업무'},{id:'b',label:'청소팀'}];
test('달력 변경 및 옛 팀 이름을 포함한 전체 폼 저장',()=>assert.deepEqual(syncEventCalendar({calId:'b',team:'일반 업무'},cals,{calId:'a',team:'일반 업무'}),{calId:'b',team:'청소팀'}));
test('팀만 변경한 전체 폼 저장',()=>assert.deepEqual(syncEventCalendar({calId:'a',team:'청소팀'},cals,{calId:'a',team:'일반 업무'}),{calId:'b',team:'청소팀'}));
test('부분 팀 변경·부분 달력 변경·미배정',()=>{assert.equal(syncEventCalendar({team:'청소팀'},cals).calId,'b');assert.equal(syncEventCalendar({calId:'b'},cals).team,'청소팀');assert.equal(syncEventCalendar({calId:''},cals).team,'');});
test('잘못된 팀·달력은 저장 거부',()=>{assert.throws(()=>syncEventCalendar({team:'없는팀'},cals));assert.throws(()=>syncEventCalendar({calId:'missing'},cals));});
