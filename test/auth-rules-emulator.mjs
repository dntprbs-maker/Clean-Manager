import assert from 'node:assert/strict';
const base='http://127.0.0.1:5001/demo-clean-manager/asia-northeast3/';
async function call(name,data,token){const r=await fetch(base+name,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify({data})});const d=await r.json();if(d.error){const e=Error(d.error.message);e.code=d.error.status;throw e;}return d.result;}
async function login(identifier){const d=await call('appAuth',{identifier,password:'qa-local-only'});const r=await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=fake-key',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:d.token,returnSecureToken:true})});const a=await r.json();assert.ok(a.idToken);return a.idToken;}
const root='http://127.0.0.1:8080/v1/projects/demo-clean-manager/databases/(default)/documents/';
const owner=await login('qaowner'),staff=await login('01000001234');
async function code(path,token){return(await fetch(root+path,{headers:token?{Authorization:'Bearer '+token}:{}})).status;}
assert.equal(await code('companies/qa_pagination/events/event_000'),403);
assert.equal(await code('companies/qa_pagination/events/event_000',staff),403);
assert.equal(await code('companies/qa_pagination/events/event_000',owner),200);
assert.equal(await code('admins/qa_owner',staff),403);
assert.equal(await code('companies/qa_pagination/users/qa_other',staff),403);
assert.equal(await code('companies/qa_pagination/profiles/qa_other',staff),200);
assert.equal(await code('companies/otherCompany',staff),403);console.log('PASS actual emulator Rules: anonymous/staff raw/other credentials/other company denied; owner and sanitized profile allowed');
const data=await call('appReadData',{from:'2026-11-01',to:'2026-11-30'},staff);assert.ok(data.events.some(e=>e.id==='oldDaily'));assert.ok(!data.events.some(e=>e.id==='privateEvent'));
const widget=await fetch(base+'appWidgetData',{method:'POST',headers:{Authorization:'Bearer '+staff,'Content-Type':'application/json'},body:JSON.stringify({from:'2026-11-05',to:'2026-11-05'})}).then(r=>r.json());assert.ok(widget.events.length>=46);assert.ok(!widget.events.some(e=>e.id==='privateEvent'));console.log('PASS staff read and widget filtered source include old daily and >20 events');
await assert.rejects(()=>call('appWriteData',{kind:'events',id:'privateEvent',value:{title:'forbidden'},merge:true},staff));
await assert.rejects(()=>call('confirmMonthlySettlement',{employeeId:'qa_staff',yearMonth:'2026-11',finalAmount:1,breakdown:{refTotal:1}},staff));
await assert.rejects(()=>call('confirmMonthlySettlement',{employeeId:'qa_staff',yearMonth:'2026-11',finalAmount:1,breakdown:{refTotal:1}},owner));console.log('PASS unauthorized private edit/settlement and stale/wrong calculation rejected');
const event=data.events.find(e=>e.id==='event_000');await call('appWriteData',{kind:'events',id:event.id,merge:true,expectedVersion:event.__readVersion,value:{leaderComment:'QA comment '+Date.now()}},staff);
await assert.rejects(()=>call('appWriteData',{kind:'events',id:event.id,merge:true,expectedVersion:event.__readVersion,value:{leaderComment:'stale'}},staff));console.log('PASS versioned staff comment and concurrent-write rejection');
console.log('ALL API/RULES CHECKS PASS');
