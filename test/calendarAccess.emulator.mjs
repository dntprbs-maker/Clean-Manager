import './emulatorConfig.mjs';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const require=createRequire(new URL('../functions/package.json',import.meta.url));
const {initializeApp}=require('firebase-admin/app'),{getFirestore}=require('firebase-admin/firestore');
const db=getFirestore(initializeApp({projectId:'demo-clean-manager'},'acl-api'));
const co='acl_qa',root=`companies/${co}`,date='2026-11-21';
const put=(path,data)=>db.doc(path).set(data);
await put(root,{name:'열람권한 검증 회사'});
await put('admins/acl_owner',{id:'qaaclowner',name:'시험 관리자',pw:'qa-local-only',companyId:co,role:'최고관리자'});
await put('appAuthConfig/master',{accountIds:['acl_owner']});
await put(`${root}/meta/config`,{teams:['사장','A팀','B팀','관리팀']});
await put(`${root}/cals/calA`,{label:'열람권한 검증 달력',name:'열람권한 검증 달력',checked:true,color:'#2563eb'});
for(const [id,name,phone,team]of [['u1','개별 선택 직원','01000002221','A팀'],['u2','비선택 직원','01000002222','A팀'],['u3','선택 팀 직원','01000002223','B팀'],['u4','관리팀 직원','01000002224','관리팀']]){
 const profile={name,phone,companyId:co,team,role:'팀원',memberships:[{team,role:'팀원'}]};
 await put(`staffs/${id}`,{...profile,pw:'qa-local-only'});await put(`${root}/users/${id}`,{...profile,pw:'qa-local-only'});await put(`${root}/profiles/${id}`,profile);
}
await put(`${root}/events/acl_event`,{title:'가상 일정 권한검증',start:date,end:date,calId:'calA',mcpTest:true});
const base='http://127.0.0.1:5101/demo-clean-manager/asia-northeast3/';
async function call(name,data,token){const r=await fetch(base+name,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify({data})});const d=await r.json();if(d.error){const e=Error(d.error.message);e.code=d.error.status;throw e;}return d.result;}
async function login(identifier){const d=await call('appAuth',{action:'login',identifier,password:'qa-local-only'});const r=await fetch('http://127.0.0.1:9198/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=fake-key',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:d.token,returnSecureToken:true})});const a=await r.json();assert.ok(a.idToken);return a.idToken;}
const [owner,p1,denied,team,manager]=await Promise.all(['qaaclowner','01000002221','01000002222','01000002223','01000002224'].map(login));
const scope={ranges:[{from:date,to:date}]};
await call('appCalendarAccess',{calendarId:'calA',mode:'selected',teams:['B팀'],people:['u1'],expectedVersion:0},owner);
let granted;
for(const [label,token,allowed]of [['개별선택',p1,true],['팀선택',team,true],['미선택',denied,false],['관리팀 자동우회 차단',manager,false]]){const r=await call('appReadData',scope,token);assert.equal(r.events.some(e=>e.id==='acl_event'),allowed,label);assert.equal(r.cals.some(c=>c.id==='calA'),allowed,label);if(label==='개별선택')granted=r;console.log('PASS '+label);}
await assert.rejects(call('appCalendarAccess',{calendarId:'calA',mode:'selected'},p1),{code:'PERMISSION_DENIED'});
await assert.rejects(call('appWriteData',{kind:'events',id:'acl_event',merge:true,value:{description:'금지된 수정'}},p1),{code:'PERMISSION_DENIED'});
await assert.rejects(call('appCalendarAccess',{calendarId:'calA',mode:'selected',people:['other_company_person'],expectedVersion:1},owner),{code:'INVALID_ARGUMENT'});
const rawUrl='http://127.0.0.1:8180/v1/projects/demo-clean-manager/databases/(default)/documents/'+root+'/cals/calA?updateMask.fieldPaths=viewAccess';
const bypass=await fetch(rawUrl,{method:'PATCH',headers:{'Content-Type':'application/json',Authorization:'Bearer '+manager},body:JSON.stringify({fields:{viewAccess:{mapValue:{fields:{mode:{stringValue:'legacy'}}}}}})});assert.equal(bypass.status,403,'직접 규칙 우회 차단');
await call('appCalendarAccess',{calendarId:'calA',mode:'selected',teams:[],people:[],expectedVersion:1},owner);
const revoked=await call('appReadData',{...scope,deltaVersion:1,knownRevision:granted.revision,scopeKey:granted.scopeKey},p1);assert(!revoked.notModified);assert(!revoked.events.some(e=>e.id==='acl_event'));assert(!revoked.cals.some(c=>c.id==='calA'));
const widget=await fetch(base+'appWidgetData',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+p1},body:JSON.stringify({from:date,to:date})});assert(widget.ok);assert.equal((await widget.json()).events.length,0);
assert.equal((await db.doc(`${root}/events/acl_event`).get()).data().title,'가상 일정 권한검증');
await call('appCalendarAccess',{calendarId:'calA',mode:'legacy',expectedVersion:2},owner);
console.log('PASS 권한회수·캐시 재조회·위젯·수정차단·타사차단·원본보존. 운영 데이터 조회 없음.');
await db.terminate();
