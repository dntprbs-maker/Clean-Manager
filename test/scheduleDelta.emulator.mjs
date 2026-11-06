import './emulatorConfig.mjs';
import { functionsOrigin, authHost, firestoreHost } from './emulatorConfig.mjs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { recordAppReadChange } from '../functions/lib/appReadChanges.js';
import { mergeScheduleSnapshot } from '../src/lib/scheduleCache.js';
const require=createRequire(new URL('../functions/package.json',import.meta.url));
const {initializeApp}=require('firebase-admin/app'),{getFirestore}=require('firebase-admin/firestore');
const db=getFirestore(initializeApp({projectId:'demo-clean-manager'},'schedule-delta'));
const companyId='qa_cache_'+Date.now(),root=`companies/${companyId}`;
const put=(path,value)=>db.doc(path).set(value);
const call=async(name,data,token)=>{
  const r=await fetch(`${functionsOrigin}/demo-clean-manager/asia-northeast3/${name}`,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify({data})});
  const body=await r.json();assert.equal(r.status,200,JSON.stringify(body));return body.result;
};
async function change(collection,id,value){
  const ref=db.doc(`${root}/${collection}/${id}`),before=await ref.get();
  if(value===null)await ref.delete();else await ref.set(value);
  const after=await ref.get();
  const event={id:randomUUID(),params:{companyId,id},data:{before,after}};
  await recordAppReadChange(db,event,collection);
  const revision=(await db.doc(`${root}/meta/readRevision`).get()).data().revision;
  await recordAppReadChange(db,event,collection);
  assert.equal((await db.doc(`${root}/meta/readRevision`).get()).data().revision,revision,'delivery retries are idempotent');
}
try{
  await put(root,{name:'영구 캐시 시험'});
  await put('admins/qa_cache_owner',{id:'qacacheowner',name:'캐시 관리자',pw:'cache-local-only',companyId,role:'최고관리자',team:'사장'});
  await put(`${root}/meta/readRevision`,{revision:0});
  await put(`${root}/cals/team`,{label:'팀',color:'#123456'});
  const event={title:'변동분 일정',calId:'team',start:'2026-11-05',end:'2026-11-05'};
  await put(`${root}/events/a`,event);await put(`${root}/events/b`,{...event,title:'변경 없는 일정'});
  await put(`${root}/events/series`,{...event,start:'2020-01-01',end:'2020-01-01',repeat:'daily'});
  await put(`${root}/reports/r1`,{eventId:'a',date:'2026-11-05',memo:'old'});
  await put(`${root}/reports/r2`,{eventId:'a',date:'2026-11-05',memo:'unchanged'});
  const login=await call('appAuth',{action:'login',identifier:'qacacheowner',password:'cache-local-only'});
  const token=(await(await fetch(`http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=local-only`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:login.token,returnSecureToken:true})})).json()).idToken;
  const scope={from:'2026-11-01',to:'2026-11-10',widgetRange:{from:'2026-10-25',to:'2026-11-14'},deltaVersion:1};
  let snapshot=await call('appReadData',scope,token);
  const next=async()=>call('appReadData',{...scope,knownRevision:snapshot.revision,scopeKey:snapshot.scopeKey},token);
  const compare=async()=>{
    const fresh=await call('appReadData',scope,token);
    const canonical=rows=>rows.map(r=>JSON.stringify(r)).sort();
    for(const key of ['events','instances','reports','cals'])assert.deepEqual(canonical(snapshot[key]),canonical(fresh[key]),key+' delta equals authoritative fresh snapshot');
    assert.deepEqual(canonical(snapshot.sharedWidget.events),canonical(fresh.sharedWidget.events));
  };
  const unchanged=await next();assert.equal(unchanged.notModified,true);assert.equal(unchanged.events,undefined);
  await change('reports','r1',{eventId:'a',date:'2026-11-05',memo:'changed'});
  let response=await next();assert.ok(response.delta);assert.deepEqual(response.reports.map(r=>r.id),['r1']);
  snapshot=mergeScheduleSnapshot(snapshot,response);await compare();
  console.log('PASS report edit returns one changed report; replay receipt does not increment twice');
  await change('events','a',{...event,title:'수정',start:'2028-01-01',end:'2028-01-01'});
  response=await next();assert.ok(response.delta);assert.equal(response.events.some(e=>e.id==='b'),false);
  snapshot=mergeScheduleSnapshot(snapshot,response);await compare();
  console.log('PASS moved event and linked reports disappear from app/widget while unrelated data remains');
  await change('events','series',{...event,start:'2020-01-01',end:'2020-01-01',repeat:'daily',exceptions:{'2026-11-05':{start:'2026-11-06',end:'2026-11-06',title:'이동 회차'}}});
  snapshot=mergeScheduleSnapshot(snapshot,await next());await compare();
  await change('events','b',null);snapshot=mergeScheduleSnapshot(snapshot,await next());await compare();
  console.log('PASS repeat moved exception and hard deletion reconcile exactly with fresh app/widget reads');
  await change('cals','team',{label:'팀',color:'#654321'});
  response=await next();assert.equal(response.delta,undefined,'permission-affecting configuration resets scope safely');
  snapshot=mergeScheduleSnapshot(snapshot,response);await compare();
  // Independent widget can reuse a snapshot shared by the application.
  const widget=async body=>{
    const r=await fetch(`${functionsOrigin}/demo-clean-manager/asia-northeast3/appWidgetData`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify(body)});
    assert.equal(r.status,200);return r.json();
  };
  const shared=snapshot.sharedWidget;
  const query={from:shared.from,to:shared.to,knownRevision:snapshot.revision,scopeKey:shared.widgetScopeKey,deltaVersion:1};
  assert.equal((await widget(query)).notModified,true);
  await change('events','b',event);
  const widgetDelta=await widget(query);assert.deepEqual(widgetDelta.replaceEventIds,['b']);assert.deepEqual(widgetDelta.events.map(e=>e.id),['b']);
  console.log('PASS app-shared cursor confirms widget unchanged without event payload; next edit returns one source only');
  const fullScope={full:true,deltaVersion:1};
  const ledger=await call('appReadData',fullScope,token);
  await change('events','a',null);
  const ledgerDelta=await call('appReadData',{...fullScope,knownRevision:ledger.revision,scopeKey:ledger.scopeKey},token);
  const mergedLedger=mergeScheduleSnapshot(ledger,ledgerDelta);
  assert.ok(mergedLedger.reports.some(r=>r.id==='r1'),'owner retains historical report after source deletion');
  assert.ok(mergedLedger.reports.some(r=>r.id==='r2'));
  const user={name:'캐시 직원',phone:'01000008881',pw:'cache-local-only',companyId,role:'팀장',team:'팀',memberships:[{team:'팀',role:'팀장'}]};
  const staffId='cache_staff_'+companyId;
  await put('staffs/'+staffId,user);await put(`${root}/users/${staffId}`,user);
  await put(`${root}/cals/private`,{label:'개인',personal:true,ownerId:'someone-else'});
  await put(`${root}/reports/bReport`,{eventId:'b',date:'2026-11-05',memo:'직원 보고'});
  const staffLogin=await call('appAuth',{action:'login',identifier:user.phone,password:user.pw,companyId});
  const staffToken=(await(await fetch(`http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=local-only`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:staffLogin.token,returnSecureToken:true})})).json()).idToken;
  const staffBase=await call('appReadData',scope,staffToken);
  assert.ok(staffBase.events.some(e=>e.id==='b'));
  await change('events','b',{...event,calId:'private',finance:{secret:'not-visible'}});
  const staffDelta=await call('appReadData',{...scope,knownRevision:staffBase.revision,scopeKey:staffBase.scopeKey},staffToken);
  assert.ok(staffDelta.delta);assert.equal(JSON.stringify(staffDelta).includes('not-visible'),false);
  const staffMerged=mergeScheduleSnapshot(staffBase,staffDelta);
  assert.equal(staffMerged.events.some(e=>e.id==='b'),false);assert.equal(staffMerged.reports.some(r=>r.eventId==='b'),false);
  assert.equal(staffMerged.sharedWidget.events.some(e=>e.id==='b'),false);
  const privatePath=`http://${firestoreHost}/v1/projects/demo-clean-manager/databases/(default)/documents/appAuthReadStreams/${companyId}/changes/client-write-denied`;
  for(const identity of [null,token,staffToken])for(const method of ['GET','PATCH']) {
    const response=await fetch(privatePath,{method,headers:{'Content-Type':'application/json',...(identity?{Authorization:`Bearer ${identity}`}:{})},...(method==='PATCH'?{body:JSON.stringify({fields:{}})}:{})});
    assert.equal(response.status,403,'change journal is inaccessible to anonymous, owner and staff clients');
  }
  console.log('PASS owner historical reports preserved; staff permission loss removes cached source, reports and widget occurrences');
  console.log('Schedule delta emulator integration passed.');
}finally{await db.terminate();}
