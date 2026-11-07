import './emulatorConfig.mjs';import {browserOrigin,functionsOrigin} from './emulatorConfig.mjs';
import fs from 'node:fs';import {createRequire} from 'node:module';import assert from 'node:assert/strict';import puppeteer from 'puppeteer';import {createHash} from 'node:crypto';import {pathToFileURL} from 'node:url';
const require=createRequire(new URL('../functions/package.json',import.meta.url));
const {initializeApp}=require('firebase-admin/app'),{getFirestore}=require('firebase-admin/firestore');
const {Client}=await import(pathToFileURL(require.resolve('@modelcontextprotocol/sdk/client/index.js')));
const {StreamableHTTPClientTransport}=await import(pathToFileURL(require.resolve('@modelcontextprotocol/sdk/client/streamableHttp.js')));
const db=getFirestore(initializeApp({projectId:'demo-clean-manager'},'money-photo-test'));
await db.doc('companies/qa_pagination/events/event_000').set({title:'검증일정0',start:'2026-11-05',end:'2026-11-05',startTime:'09:00',endTime:'10:00',calId:'team1'});
const key='cmk_local-money-photo-only';await db.doc('mcpAgents/moneyqa').set({enabled:true,label:'검증AI',scopes:['events:read','events:write','finance:read','finance:write'],keyHash:createHash('sha256').update(key).digest('hex')});
const client=new Client({name:'finance-photo-test',version:'1'});
const browser=await puppeteer.launch({headless:true,args:['--window-position=-32000,-32000']});
const page=await browser.newPage();await page.setViewport({width:390,height:900,deviceScaleFactor:1,hasTouch:true});
const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',async d=>{errors.push('Unexpected dialog '+d.message());await d.dismiss();});
fs.mkdirSync('test/.artifacts',{recursive:true});
const context=source=>page.evaluate(source=>{for(const el of document.querySelectorAll('*')){const key=Object.keys(el).find(k=>k.startsWith('__reactFiber$'));let f=key&&el[key];while(f){const c=f.memoizedProps?.value;if(c?.openModal)return new Function('ctx',source)(c);f=f.return;}}throw Error('Context missing');},source);
const click=text=>page.evaluate(text=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===text);if(!b)throw Error('Missing button '+text);b.click();},text);
async function fill(label,text){const e=await page.$(`input[aria-label="${label}"]`);assert.ok(e,label);await e.focus();await e.evaluate(e=>e.select());await e.press('Backspace');await e.type(text);}
const wait=text=>page.waitForFunction(text=>document.body.innerText.includes(text),{timeout:30000},text);
async function until(check){const start=Date.now();while(Date.now()-start<30000){if(await check())return;await new Promise(r=>setTimeout(r,150));}throw Error('Expected app data did not arrive');}
async function call(name,args){const r=await client.callTool({name,arguments:args});assert.ok(!r.isError,r.content[0]?.text);return JSON.parse(r.content[0].text);}
try{
 await client.connect(new StreamableHTTPClientTransport(new URL(functionsOrigin+'/demo-clean-manager/asia-northeast3/mcp/mcp'),{requestInit:{headers:{Authorization:'Bearer '+key}}}));
 const tools=(await client.listTools()).tools.map(t=>t.name);assert.ok(tools.includes('set_event_finance')&&tools.includes('get_event_finance')&&tools.includes('attach_event_photos'));assert.ok(!tools.includes('create_employee'));
 await call('set_event_finance',{eventId:'event_000',revenue:'15000×37'});
 await call('set_event_finance',{eventId:'event_000',memberPays:[{headcount:4,unitAmount:100000,status:'paid'}],extraCosts:[{label:'주차비',amount:5000}]});
 assert.equal((await call('get_event_finance',{eventId:'event_000'})).profit,150000);
 const image=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=400;c.height=300;const x=c.getContext('2d'),v=x.createImageData(400,300);let s=1234;for(let i=0;i<v.data.length;i+=4){s=(s*1664525+1013904223)>>>0;v.data[i]=s&255;v.data[i+1]=(s>>>8)&255;v.data[i+2]=(s>>>16)&255;v.data[i+3]=255;}x.putImageData(v,0,0);return c.toDataURL('image/png').split(',')[1];});assert.ok(image.length>100000,'Exercise HTTP bodies larger than the old100KB limit');
 await call('attach_event_photos',{eventId:'event_000',photos:[{name:'확대시험1.png',dataBase64:image,mimeType:'image/png'},{name:'확대시험2.png',dataBase64:image,mimeType:'image/png'}]});
 const event=await call('get_event',{eventId:'event_000'});assert.equal(event.photos.length,2);assert.ok(event.photos.every(p=>!p.path));
 await page.goto(browserOrigin,{waitUntil:'domcontentloaded'});await page.waitForSelector('input[placeholder="아이디 또는 전화번호"]');await page.type('input[placeholder="아이디 또는 전화번호"]','qaowner');await page.type('input[placeholder="비밀번호"]','qa-local-only');await click('로그인');await wait('QA 페이지네이션');
 await until(()=>context("return ctx.events.some(e=>e.id==='event_000'&&e.finance?.revenue===555000);").catch(()=>false));
 await page.evaluate(()=>localStorage.setItem('lastEventInputMode','direct'));
 await context("ctx.openModal('2026-11-05','event_000');");await page.waitForSelector('section[aria-label="청소비·정산 입력"]');await click('청소비·정산 입력선택');
 assert.equal(await page.$eval('input[aria-label="청소비"]',e=>e.value),'555,000');await page.focus('input[aria-label="청소비"]');assert.equal(await page.$eval('input[aria-label="청소비"]',e=>e.value),'15000×37');
 await fill('청소비','15000×38');await page.focus('input[placeholder="일정을 입력하세요."]');assert.equal(await page.$eval('input[aria-label="청소비"]',e=>e.value),'570,000');
 await fill('팀원 1 지급액','90000×4');await page.focus('input[placeholder="일정을 입력하세요."]');await click('저장');await page.waitForFunction(()=>!document.querySelector('input[placeholder="일정을 입력하세요."]'));
 const stored=(await db.doc('companies/qa_pagination/events/event_000').get()).data();assert.equal(stored.finance.revenue,570000);assert.equal(stored.finance.revenueExpression,'15000×38');assert.equal(stored.finance.memberPays[0].unitAmount,90000);assert.equal(stored.finance.memberPays[0].headcount,4);assert.equal(stored.finance.memberPays[0].status,'paid');
 await context("ctx.openModal('2026-11-05','event_000');");await page.waitForSelector('section[aria-label="청소비·정산 입력"]');await click('청소비·정산 입력선택');await page.focus('input[aria-label="청소비"]');assert.equal(await page.$eval('input[aria-label="청소비"]',e=>e.value),'15000×38');
 await fill('청소비','15000×');await click('저장');await wait('0 이상의 정수');assert.ok(await page.$('input[placeholder="일정을 입력하세요."]'));assert.equal((await db.doc('companies/qa_pagination/events/event_000').get()).data().finance.revenue,570000);await context('ctx.closeModal();');
 console.log('PASS real MCP HTTP photo/partial finance + real app save/refocus/reopen/invalid formula and grouped metadata');
 await context("ctx.setCurrentScreen('finance');");await wait('수입·지출 관리');await context("ctx.setFinanceModal({open:true,editId:'t_0'});");await page.waitForSelector('input[aria-label="수입·지출 금액"]');await fill('수입·지출 금액','15000×37');await click('수정 저장');await page.waitForFunction(()=>!document.querySelector('input[aria-label="수입·지출 금액"]'));assert.equal((await db.doc('companies/qa_pagination/transactions/t_0').get()).data().amount,555000);
 await context("ctx.setFinanceModal({open:true,editId:'t_0'});");await page.waitForSelector('input[aria-label="수입·지출 금액"]');await page.focus('input[aria-label="수입·지출 금액"]');assert.equal(await page.$eval('input[aria-label="수입·지출 금액"]',e=>e.value),'15000×37');await context("ctx.setFinanceModal({open:false,editId:null});ctx.setCurrentScreen('calendar');ctx.setDetEv(ctx.events.find(e=>e.id==='event_000'));");
 const thumbnail='button.w-20.h-20 img';await page.waitForSelector(thumbnail);await page.waitForFunction(selector=>[...document.querySelectorAll(selector)].every(i=>i.complete&&i.naturalWidth>0),{},thumbnail);await page.click(thumbnail);await page.waitForSelector('[role="dialog"][aria-label="사진 크게 보기"]');
 const touch=await page.createCDPSession();const point=(id,x,y)=>({id,x,y,radiusX:3,radiusY:3,force:1});
 await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point(1,130,400),point(2,250,400)]});await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[point(1,60,400),point(2,320,400)]});await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 await page.waitForFunction(()=>Number(document.querySelector('[data-photo-zoom]')?.dataset.photoZoom)>1.8);assert.equal(await page.evaluate(()=>visualViewport.scale),1);
 assert.ok(await page.$('img[alt="첨부 사진 1"]'));await page.screenshot({path:'test/.artifacts/photo-pinched.png'});
 await page.click('button[aria-label="사진 크기 초기화"]');await page.waitForFunction(()=>document.querySelector('[data-photo-zoom]').dataset.photoZoom==='1.000');
 await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point(1,320,400)]});await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[point(1,70,400)]});await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForSelector('img[alt="첨부 사진 2"]');await page.click('button[aria-label="사진 닫기"]');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);
 console.log('PASS ledger formula edit persistence; MCP thumbnails; actual two-finger pinch keeps page scale1 and photo index; reset/swipe/close; browser errors0');
}finally{await client.close().catch(()=>{});await browser.close();await db.terminate();}
