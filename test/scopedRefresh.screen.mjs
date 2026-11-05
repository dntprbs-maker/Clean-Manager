import './emulatorConfig.mjs';
import { browserOrigin } from './emulatorConfig.mjs';
import { createRequire } from 'node:module';
import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
const require=createRequire(new URL('../functions/package.json',import.meta.url));
const {initializeApp}=require('firebase-admin/app'),{getFirestore}=require('firebase-admin/firestore');
const db=getFirestore(initializeApp({projectId:'demo-clean-manager'},'scoped-browser'));
const root='companies/qa_pagination';
await db.doc(root+'/meta/readRevision').set({revision:100});
await db.doc(root+'/events/interveningTest').set({title:'읽으면 안 되는 중간연도',start:'2023-01-01',end:'2023-01-01',calId:'team1'});
const browser=await puppeteer.launch({headless:true});const page=await browser.newPage();
await page.setViewport({width:430,height:932});const errors=[],responses=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('response',async r=>{if(r.url().endsWith('/appReadData')){try{responses.push({request:JSON.parse(r.request().postData()||'{}').data,response:(await r.json()).result});}catch{}}});
await page.evaluateOnNewDocument(()=>{
  const create=window.setInterval.bind(window),clear=window.clearInterval.bind(window),ticks=new Map();window.__qaMinuteTicks=ticks;
  window.setInterval=(fn,ms,...args)=>{const id=create(fn,ms,...args);if(ms===60000)ticks.set(id,()=>fn(...args));return id;};
  window.clearInterval=id=>{ticks.delete(id);clear(id);};
});
const wait=text=>page.waitForFunction(t=>document.body.innerText.includes(t),{timeout:30000},text);
async function context(fn,...args){return page.evaluate((source,args)=>{for(const el of document.querySelectorAll('*')){const k=Object.keys(el).find(k=>k.startsWith('__reactFiber$'));let f=k&&el[k];while(f){const v=f.memoizedProps?.value;if(v?.setCurrentScreen)return new Function('ctx','args',source)(v,args);f=f.return;}}throw Error('Provider absent');},fn,args);}
async function settle(){await page.waitForNetworkIdle({idleTime:500,timeout:10000}).catch(()=>{});}
try{
  await page.goto(browserOrigin,{waitUntil:'domcontentloaded'});
  await page.waitForSelector('input[placeholder="아이디 또는 전화번호"]');await page.type('input[placeholder="아이디 또는 전화번호"]','01000001234');
  await page.waitForSelector('input[placeholder="비밀번호"]');await page.type('input[placeholder="비밀번호"]','qa-local-only');
  await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='로그인').click());await wait('검증일정44');await settle();
  const initialCount=responses.length;
  assert.ok(initialCount>0&&responses.some(r=>r.response?.events),'capture the initial scoped response before testing traffic');
  await page.evaluate(()=>{for(const tick of window.__qaMinuteTicks.values())tick();});await settle();
  assert.equal(responses.length,initialCount,'unchanged minute check must not call heavy data endpoint');
  console.log('PASS idle minute reads revision only; no appReadData request');
  await page.evaluate(()=>window.dispatchEvent(new Event('online')));await settle();
  assert.ok(responses.some(r=>r.response?.notModified));await wait('검증일정44');
  console.log('PASS same-scope revision confirmation preserves displayed rows');
  await db.doc(root+'/events/revisionAdded').set({title:'변경 표식으로 반영된 일정',start:'2026-11-05',end:'2026-11-05',calId:'team1'});
  await db.doc(root+'/meta/readRevision').set({revision:101});await wait('변경 표식으로 반영된 일정');await settle();
  console.log('PASS changed revision updates actual staff calendar');
  await context('ctx.setCurrent(new Date(2020,0,1));');await wait('2020. 1.');await settle();
  await page.waitForFunction(()=>!document.body.innerText.includes('서버 자료 확인 중'),{timeout:30000}); await settle();
  const distant=responses.filter(r=>r.request?.ranges?.length===2 && r.response?.events).at(-1);
  if(!distant) console.log(JSON.stringify(responses.map(r=>({ranges:r.request?.ranges,full:r.request?.full,resultKeys:Object.keys(r.response||{})}))));
  assert.ok(distant?.response?.events,'distant month request succeeds');assert.equal(distant.request.full,false);
  assert.equal(distant.response.events.some(e=>e.id==='interveningTest'),false);
  console.log('PASS distant month keeps selected day without reading intervening years');
  await context('ctx.openModal("2026-11-05","event_000");');await settle();
  assert.equal(responses.at(-1).request.full,false);assert.ok(responses.at(-1).request.eventIds.includes('event_000'));
  console.log('PASS edit modal pins a source ID without full-company query');
  await context('ctx.closeModal();');await settle();
  assert.deepEqual(errors,[]);console.log('Scoped staff browser flow passed.');
}finally{await browser.close();await db.terminate();}
