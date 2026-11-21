import test from 'node:test';
import assert from 'node:assert/strict';
import { calendarViewDecision, saveCalendarAccess } from '../lib/calendarAccess.js';
import { canViewWidgetEvent, projectCalendar } from '../lib/appAuthCore.js';
import { projectWidgetRange } from '../lib/appScopedReads.js';
import { createFakeDb } from './helpers/fakeFirestore.js';
const user=(uid,team='A')=>({kind:'staff',user:{uid,companyId:'co',memberships:team?[{team,role:'팀원'}]:[]}});
const owner={kind:'admin',user:{uid:'owner',companyId:'co'}};
const cal={id:'cal',label:'A',feedToken:'secret',viewAccess:{mode:'selected',teams:['B'],people:['p1'],version:1}};
const event={id:'event',calId:'cal',title:'synthetic only',start:'2026-11-21',end:'2026-11-21'};
test('선택 팀 또는 선택 사람만 열람, 관리자·개인 주인 보존',()=>{
 for(const p of [user('b','B'),user('p1'),owner])assert.equal(canViewWidgetEvent(event,p,[cal],[]),true);
 for(const p of [user('a'),user('none',''),user('manager','관리팀')])assert.equal(canViewWidgetEvent(event,p,[cal],[]),false);
 assert.equal(calendarViewDecision({...cal,personal:true,ownerId:'mine'},user('mine')),true);
});
test('선택한 사람이 소속팀과 무관하게 개인달력 열람, 미선택자 메타데이터 비공개',()=>{
 const personal={...cal,personal:true,ownerId:'other'};
 assert.ok(projectCalendar(personal,user('p1')));
 assert.equal(projectCalendar(personal,user('a')),null);
 assert.equal(projectCalendar(personal,user('p1')).feedToken,undefined);
});
test('권한 없는 위젯·반복 회차 출력 차단 및 권한 부여/회수 반영',()=>{
 const range={from:'2026-11-21',to:'2026-11-23'};
 assert.equal(projectWidgetRange([{...event,repeat:'daily'}],user('a'),[cal],[],range).events.length,0);
 assert.equal(projectWidgetRange([{...event,repeat:'daily'}],user('p1'),[cal],[],range).events.length,3);
 assert.equal(projectWidgetRange([event],user('p1'),[{...cal,viewAccess:{mode:'selected',teams:[],people:[]}}],[],range).events.length,0);
});
test('설정 없는 기존 달력은 기존 소속팀 정책 그대로',()=>{
 const legacy={id:'cal',label:'A'};
 assert.equal(calendarViewDecision(legacy,user('a')),null);
 assert.equal(canViewWidgetEvent(event,user('a'),[legacy],[]),true);
 assert.equal(canViewWidgetEvent(event,user('b','B'),[legacy],[]),false);
});
async function fixture(){const db=createFakeDb();await db.doc('companies/co/cals/cal').set({id:'cal',label:'A',color:'#fff'});await db.doc('companies/co/meta/config').set({teams:['A','B']});await db.doc('companies/co/users/p1').set({name:'가상 직원'});const read=[];const base=db.doc;db.doc=path=>{assert(!/\/events(?:\/|$)/.test(path),'일정 조회 금지');read.push(path);return base(path);};return{db,read};}
test('설정 저장은 일정 조회 없이 팀·사람 검증, 버전 및 동기화 번호 갱신',async()=>{
 const{db,read}=await fixture();const r=await saveCalendarAccess(db,owner,{calendarId:'cal',mode:'selected',teams:['B','B'],people:['p1']});assert.deepEqual(r.viewAccess.teams,['B']);assert.equal(r.viewAccess.version,1);assert.equal((await db.doc('companies/co/cals/cal').get()).data().color,'#fff');assert.equal((await db.doc('companies/co/meta/readRevision').get()).data().revision,1);assert(!read.some(p=>p.includes('/events/')));
 await assert.rejects(saveCalendarAccess(db,owner,{calendarId:'cal',mode:'selected'}),{code:'aborted'});
});
test('일반 직원·관리팀도 열람 대상을 바꿀 수 없고 타사·없는 직원 차단',async()=>{
 const{db}=await fixture();for(const p of [user('p1'),user('manager','관리팀')])await assert.rejects(saveCalendarAccess(db,p,{calendarId:'cal',mode:'selected'}),{code:'permission-denied'});
 for(const input of [{teams:['없는팀']},{people:['foreign']},{calendarId:'../cal'},{people:'p1'}])await assert.rejects(saveCalendarAccess(db,owner,{calendarId:'cal',mode:'selected',...input}),{code:'invalid-argument'});
 assert.equal((await db.doc('companies/co/cals/cal').get()).data().viewAccess,undefined);
});
test('대상 모두 해제와 기존 방식 복원도 실제 저장하며 일정 변경 없음',async()=>{
 const{db}=await fixture();await saveCalendarAccess(db,owner,{calendarId:'cal',mode:'selected'});const restricted=(await db.doc('companies/co/cals/cal').get()).data();assert.equal(calendarViewDecision(restricted,user('a')),false);await saveCalendarAccess(db,owner,{calendarId:'cal',mode:'legacy',expectedVersion:1});assert.equal(calendarViewDecision((await db.doc('companies/co/cals/cal').get()).data(),user('a')),null);
});
