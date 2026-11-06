import './emulatorConfig.mjs';
import {browserOrigin} from './emulatorConfig.mjs';
import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {recordAppReadChange} from '../functions/lib/appReadChanges.js';
const require=createRequire(new URL('../functions/package.json',import.meta.url));
const {initializeApp}=require('firebase-admin/app'),{getFirestore}=require('firebase-admin/firestore');
const db=getFirestore(initializeApp({projectId:'demo-clean-manager'},'finance-form'));
const root='companies/qa_pagination';
await db.doc(root+'/meta/readRevision').set({revision:2000});
const browser=await puppeteer.launch({headless:true,args:['--window-position=-32000,-32000']});
const page=await browser.newPage();await page.setViewport({width:430,height:1000,deviceScaleFactor:2});
const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',message=>{if(message.type()==='error'&&message.text().includes('controlled input'))errors.push(message.text());});page.on('dialog',async d=>{throw Error('Unexpected dialog: '+d.message());});
async function context(source){return page.evaluate(source=>{for(const el of document.querySelectorAll('*')){const k=Object.keys(el).find(k=>k.startsWith('__reactFiber$'));let f=k&&el[k];while(f){const ctx=f.memoizedProps?.value;if(ctx?.openModal)return new Function('ctx',source)(ctx);f=f.return;}}throw Error('Provider missing');},source);}
const wait=text=>page.waitForFunction(text=>document.body.innerText.includes(text),{timeout:30000},text);
async function click(text){await page.evaluate(text=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===text);if(!b)throw Error('Button missing '+text);b.click();},text);}
async function fill(label,value){const input=await page.$(`input[aria-label="${label}"]`);assert.ok(input,label);await input.focus();await input.evaluate(element=>element.select());await input.press('Backspace');await input.type(value);await page.waitForFunction((label,value)=>document.querySelector(`input[aria-label="${label}"]`)?.value.replaceAll(',','')===value,{},label,value);}
async function opened(source){await context(source);await page.waitForSelector('input[placeholder="일정을 입력하세요."]');}
async function saved(){await page.waitForFunction(()=>!document.querySelector('input[placeholder="일정을 입력하세요."]'),{timeout:30000});}
async function announce(id,before){const ref=db.doc(root+'/events/'+id);await recordAppReadChange(db,{id:randomUUID(),params:{companyId:'qa_pagination',id},data:{before,after:await ref.get()}},'events');await page.waitForNetworkIdle({idleTime:500,timeout:10000}).catch(()=>{});}
async function login(identifier){await page.goto(browserOrigin,{waitUntil:'domcontentloaded'});await page.waitForSelector('input[placeholder="아이디 또는 전화번호"]');await page.type('input[placeholder="아이디 또는 전화번호"]',identifier);await page.waitForSelector('input[placeholder="비밀번호"]');await page.type('input[placeholder="비밀번호"]','qa-local-only');await click('로그인');await wait('QA 페이지네이션');}
try{
 await login('qaowner');await page.evaluate(()=>localStorage.setItem('lastEventInputMode','direct'));
 await opened("ctx.openModal('2026-11-07');");
 const title='청소비 입력 검증 '+Date.now();await page.type('input[placeholder="일정을 입력하세요."]',title);
 await click('팀배정');await click('입주청소팀');
 assert.equal(await page.$('input[aria-label="청소비"]'),null,'default collapsed');
 await page.screenshot({path:'test/.artifacts/finance-accordion-collapsed.png'});
 await click('청소비·정산 입력선택');await fill('청소비','350000');await fill('팀장 지급액','200000');
 await click('+ 비용 추가');await fill('추가 비용 1 항목','주차비');await fill('추가 비용 1 금액','10000');await wait('140,000원');
 await page.screenshot({path:'test/.artifacts/finance-accordion-expanded.png'});
 await click('저장');await saved();
 const docs=await db.collection(root+'/events').where('title','==',title).get();assert.equal(docs.size,1);const ref=docs.docs[0].ref,id=ref.id;
 const first=docs.docs[0].data();assert.equal(first.finance.revenue,350000);assert.equal(first.finance.leaderPay.amount,200000);assert.equal(first.finance.extraCosts[0].amount,10000);
 await announce(id,null);console.log('PASS collapsed/expanded real form; leader amount, extra cost and 140000 profit persist');
 await opened(`ctx.openModal('2026-11-07',${JSON.stringify(id)});`);assert.equal(await page.$('input[aria-label="청소비"]'),null);
 await click('청소비·정산 입력선택');assert.equal(await page.$eval('input[aria-label="청소비"]',e=>e.value),'350,000');
 await click('팀원 직접 지급');await fill('팀원 1 이름','시험 팀원 A');await fill('팀원 1 지급액','100000');await click('+ 팀원 추가');await fill('팀원 2 이름','시험 팀원 B');await fill('팀원 2 지급액','80000');await wait('160,000원');
 await click('저장');await saved();assert.equal((await ref.get()).data().finance.memberPays.length,2);await announce(id,docs.docs[0]);
 console.log('PASS persisted amount reloads; direct member payments save and calculate 160000 profit');
 await ref.update({'finance.leaderPay.status':'paid','finance.workers':[{name:'원본 작업자'}]});await announce(id,await ref.get());
 const before=await ref.get();await opened(`ctx.openModal('2026-11-07',${JSON.stringify(id)});`);
 await page.type('input[placeholder="장소"]','기존 금액을 유지한 주소 수정');await click('저장');await saved();
 assert.deepEqual((await ref.get()).data().finance,before.data().finance,'unrelated edit preserves every finance field');await announce(id,before);
 await opened(`ctx.openModal('2026-11-07',${JSON.stringify(id)});`);await click('청소비·정산 입력선택');await fill('청소비','-1');await click('저장');await wait('0 이상의 정수');assert.ok(await page.$('input[aria-label="청소비"]'));await context('ctx.closeModal();');
 console.log('PASS unrelated edit preserves paid/worker metadata and negative amount cannot save');
 await opened("ctx.openModal('2026-11-07');");await page.type('input[placeholder="일정을 입력하세요."]','금액 없이 등록 검증');await click('청소비·정산 입력선택');await click('저장');await saved();
 const optional=await db.collection(root+'/events').where('title','==','금액 없이 등록 검증').get();assert.equal(optional.docs[0].data().finance,undefined,'opening alone does not create zero finance');
 const seriesId='finance_series_'+Date.now();await db.doc(root+'/events/'+seriesId).set({title:'반복 금액 검증',start:'2020-01-01',end:'2020-01-01',startTime:'09:00',endTime:'10:00',calId:'team1',repeat:'daily',finance:{revenue:500000,payMethod:'leader_lump',leaderPay:{amount:200000,status:'paid'}}});await announce(seriesId,null);
 await opened(`const source=ctx.events.find(e=>e.id===${JSON.stringify(seriesId)});if(!source)throw Error('series absent');ctx.openModal('2026-11-07',source.id,'instance',{...source,start:'2026-11-07',end:'2026-11-07',_recurring:true,_origDate:'2026-11-07'});`);
 await click('청소비·정산 입력선택');await fill('청소비','600000');await click('저장');await saved();
 const series=(await db.doc(root+'/events/'+seriesId).get()).data();assert.equal(series.finance.revenue,500000);assert.equal(series.exceptions['2026-11-07'].finance.revenue,600000);assert.equal(series.exceptions['2026-11-07'].finance.leaderPay.status,'paid');
 console.log('PASS optional finance remains absent; single recurrence edits preserve the series and payment state');
 await page.evaluate(async()=>{const {endSession}=await import('/src/lib/appAuth.js');await endSession();});await login('01000001234');await opened("ctx.openModal('2026-11-07','event_000');");
 assert.equal(await page.$('section[aria-label="청소비·정산 입력"]'),null);assert.deepEqual(errors,[]);
 console.log('PASS ordinary staff cannot see financial editor; browser errors empty');
}finally{await browser.close();await db.terminate();}
