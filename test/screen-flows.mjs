import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../functions/package.json',import.meta.url));
process.env.FIRESTORE_EMULATOR_HOST='127.0.0.1:8080';const {initializeApp}=require('firebase-admin/app');const {getFirestore}=require('firebase-admin/firestore');initializeApp({projectId:'demo-clean-manager'});const db=getFirestore();
const browser=await puppeteer.launch({headless:true,args:['--no-sandbox']});
const page=await browser.newPage();await page.setViewport({width:430,height:932,isMobile:true});const errors=[];page.on('pageerror',e=>errors.push(e.message));let dialogs=[];page.on('dialog',async d=>{dialogs.push(d.message());await d.accept();});
async function click(text){await page.waitForFunction(t=>[...document.querySelectorAll('button')].some(b=>b.textContent.trim()===t&&!b.disabled),{timeout:30000},text);await page.evaluate(t=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===t);if(!b)throw Error('button missing '+t);b.click();},text);}
async function wait(text){await page.waitForFunction(t=>document.body.innerText.includes(t),{timeout:30000},text);}
async function screen(name){await page.evaluate(name=>{for(const el of document.querySelectorAll('*')){const k=Object.keys(el).find(k=>k.startsWith('__reactFiber$'));let f=k&&el[k];while(f){const v=f.memoizedProps?.value;if(v?.setCurrentScreen){v.setCurrentScreen(name);return;}f=f.return;}}throw Error('context absent');},name);}
async function login(id){await page.goto('http://127.0.0.1:5177/',{waitUntil:'domcontentloaded'});await page.waitForSelector('input[placeholder="아이디 또는 전화번호"]');await page.type('input[placeholder="아이디 또는 전화번호"]',id);await page.waitForSelector('input[placeholder="비밀번호"]');await page.type('input[placeholder="비밀번호"]','qa-local-only');await click('로그인');await wait('QA 페이지네이션');}
try{
await login('qaowner');await wait('검증일정44');await wait('오래된 매일 반복');console.log('PASS calendar includes >20 and old daily occurrence');
await screen('activity_log');await wait('현재 20건 표시');await click('20건 더 보기');await wait('현재 40건 표시');await click('20건 더 보기');await wait('현재 45건 표시');console.log('PASS log 20/40/45 prefix');
await screen('report_history');await wait('현재 20건 표시');await click('20건 더 보기');await wait('현재 40건 표시');await click('20건 더 보기');await wait('현재 45건 표시');console.log('PASS hidden report history 20/40/45 (context navigation; menu remains hidden)');
await screen('reg_settlement');await wait('985,000원');await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>['확정','재확정'].includes(b.textContent.trim())&&!b.disabled),{timeout:15000});await click(await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>['확정','재확정'].includes(b.textContent.trim())).textContent.trim()));await wait('확정됨');
const saved=(await db.doc('companies/qa_pagination/monthlySettlements/qa_staff_2026-11').get()).data();assert.equal(saved.finalAmount,985000);assert.equal(saved.breakdown.refTotal,985000);console.log('PASS actual settlement screen/server transaction 985000');
await page.screenshot({path:'test/.artifacts/settlement.png',fullPage:true});
await screen('finance');await wait('1,044,000원');await wait('현재 20건 표시');await click('20건 더 보기');await wait('현재 40건 표시');await click('20건 더 보기');await wait('현재 45건 표시');console.log('PASS month finance total includes all45 rows beyond first20');
await screen('calendar');await page.reload({waitUntil:'domcontentloaded',timeout:10000}).catch(()=>{});await wait('QA 페이지네이션');console.log('PASS authenticated reload restore');
await page.evaluate(async()=>{const {endSession}=await import('/src/lib/appAuth.js');await endSession();});await page.reload({waitUntil:'domcontentloaded',timeout:10000}).catch(()=>{});
await login('01000001234');await wait('검증일정44');await page.waitForFunction(()=>!document.body.innerText.includes('서버 자료 확인 중'),{timeout:15000});assert.equal(await page.evaluate(()=>document.body.innerText.includes('보호돼야할개인일정')),false);console.log('PASS staff server projection hides other personal calendar');
await page.screenshot({path:'test/.artifacts/staff-calendar.png',fullPage:true});
assert.deepEqual(errors,[]);console.log(JSON.stringify({result:'PASS',pageErrors:errors,dialogs}));
}catch(e){console.log(JSON.stringify({failed:e.message,errors,text:await page.evaluate(()=>document.body.innerText.slice(0,1200))}));throw e;}finally{await browser.close();await db.terminate();}
