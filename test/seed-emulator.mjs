import {createRequire} from 'node:module';
import fs from 'node:fs';
const require=createRequire(new URL('../functions/package.json',import.meta.url));
process.env.FIRESTORE_EMULATOR_HOST='127.0.0.1:8080';process.env.FIREBASE_AUTH_EMULATOR_HOST='127.0.0.1:9099';
const {initializeApp}=require('firebase-admin/app');const {getFirestore}=require('firebase-admin/firestore');
initializeApp({projectId:'demo-clean-manager'});const db=getFirestore();
const co='qa_pagination';const date='2026-11-05';
const put=(path,value)=>db.doc(path).set(value);
await put('companies/'+co,{name:'QA 페이지네이션',companyId:co});
await put('admins/qa_owner',{id:'qaowner',pw:'qa-local-only',companyId:co,name:'검증 관리자',role:'최고관리자',team:'사장'});
await put('appAuthConfig/master',{accountIds:['qa_owner']});await put('appAuthConfig/policy',{allowPhoneFirstSetup:true});
await put('companies/'+co+'/meta/config',{teams:['사장','입주청소팀','정기청소'],linkCategories:['업무']});
for(const [id,label]of [['team1','입주청소팀'],['regular_cleaning','정기청소']])await put(`companies/${co}/cals/${id}`,{label,name:label,color:'#1a56db',checked:true});
await put(`companies/${co}/cals/private`,{label:'다른사람개인',personal:true,ownerId:'other',checked:true,color:'#f00'});
for(const [id,name,phone]of [['qa_staff','검증 직원','01000001234'],['qa_other','다른 직원','01000001235']]){
const user={name,phone,pw:'qa-local-only',companyId:co,team:'입주청소팀',role:'팀장',dailyAllowance:5000,memberships:[{team:'입주청소팀',role:'팀장'}]};
await put('staffs/'+id,user);await put(`companies/${co}/users/${id}`,user);const {pw,...publicUser}=user;await put(`companies/${co}/profiles/${id}`,publicUser);
}
const writes=[];
for(let i=0;i<45;i++){
const id='event_'+String(i).padStart(3,'0');writes.push(put(`companies/${co}/events/${id}`,{title:`검증일정${i}`,start:date,end:date,startTime:'09:00',endTime:'10:00',calId:'team1'}));
writes.push(put(`companies/${co}/reports/report_${String(i).padStart(3,'0')}`,{eventId:id,title:`보고${i}`,memo:i===0?'마지막 검색 대상':'검증 메모',date,teamName:'입주청소팀',status:i===44?'진행중':'완료'}));
writes.push(put(`companies/${co}/activityLogs/log_${String(i).padStart(3,'0')}`,{time:`2026-11-05T${String(8+Math.floor(i/60)).padStart(2,'0')}:${String(i%60).padStart(2,'0')}:00.000Z`,date,user:'검증 관리자',action:'등록',detail:`검증로그${i}`}));
}
await Promise.all(writes);
await put(`companies/${co}/events/oldDaily`,{title:'오래된 매일 반복',start:'2020-01-01',end:'2020-01-01',repeat:'daily',calId:'team1'});
await put(`companies/${co}/events/privateEvent`,{title:'보호돼야할개인일정',start:date,end:date,calId:'private'});
for(const [id,type,amount]of [['d','daily',100000],['w','weekly',200000],['m','monthly',300000]]){await put(`companies/${co}/sites/${id}`,{name:`검증현장${id}`});await put(`companies/${co}/assignments/${id}`,{employeeId:'qa_staff',siteId:id,wageType:type,wageAmount:amount,repeat:'daily',start:'2020-01-01'});}
for(const [site,day]of [['d','05'],['d','06'],['w','05'],['w','12'],['m','05']])await put(`companies/${co}/attendance/2026-11-${day}_qa_staff_${site}`,{employeeId:'qa_staff',siteId:site,date:`2026-11-${day}`,confirmed:true});
await put(`companies/${co}/extraPayments/extra`,{employeeId:'qa_staff',date,amount:70000,reason:'검증 추가금'});
for(let i=0;i<45;i++)await put(`companies/${co}/transactions/t_${i}`,{date,amount:i===0?1000000:1000,type:'income',category:'가상 수입'});
console.log('Emulator fixture seeded: 47 events,45 reports,45 logs. Settlement expected985000.');
await db.terminate();
