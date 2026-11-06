import './emulatorConfig.mjs';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {recordAppReadChange} from '../functions/lib/appReadChanges.js';
const require=createRequire(new URL('../functions/package.json',import.meta.url));
const {initializeApp}=require('firebase-admin/app'),{getFirestore}=require('firebase-admin/firestore');
const db=getFirestore(initializeApp({projectId:'demo-clean-manager'},'cache-native-browser'));
if(!(await db.doc('companies/qa_pagination/meta/readRevision').get()).exists)await db.doc('companies/qa_pagination/meta/readRevision').set({revision:1000});
import { browserOrigin } from './emulatorConfig.mjs';
import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
const browser=await puppeteer.launch({headless:true,args:['--window-position=-32000,-32000']});
async function context(page,source){return page.evaluate(source=>{for(const el of document.querySelectorAll('*')){const k=Object.keys(el).find(k=>k.startsWith('__reactFiber$'));let f=k&&el[k];while(f){const ctx=f.memoizedProps?.value;if(ctx?.setCurrentScreen)return new Function('ctx',source)(ctx);f=f.return;}}throw Error('Provider missing');},source);}
async function run({supported,widget,hungCapabilities=false,deltaVersion=1}) {
  const isolated=await browser.createBrowserContext();const page=await isolated.newPage();const errors=[],reads=[];let widgetRequests=0;
  page.on('pageerror',e=>errors.push(e.message));
  page.on('request',r=>{if(r.url().endsWith('/appReadData')&&r.method()==='POST')reads.push(JSON.parse(r.postData()).data);if(r.url().includes('/appWidgetData'))widgetRequests++;});
  await page.evaluateOnNewDocument(({supported,widget,hungCapabilities,deltaVersion})=>{
    window.androidBridge={};
    const state={calls:[],commits:[],fresh:false,session:null,next:0};window.__nativeQA=state;
    const methods=['capabilities','setSession','clearSession','invalidateData','beginSharedRead','commitSharedRead','cancelSharedRead'];
    window.Capacitor={PluginHeaders:[{name:'WidgetSession',methods:methods.map(name=>({name,rtype:'promise'}))}],nativePromise:async(plugin,method,args)=>{
      state.calls.push(method);
      if(method==='capabilities'){if(hungCapabilities)return new Promise(()=>{});if(!supported)throw Error('old APK');return {supported:true,deltaVersion};}
      if(method==='setSession'){state.session={companyId:args.companyId,userId:args.userId};return {};}
      if(method==='clearSession'){state.session=null;state.fresh=false;return {};}
      if(method==='invalidateData'){state.fresh=false;return {};}
      if(method==='beginSharedRead')return widget&&!state.fresh?{supported:true,ticket:'qa-'+(++state.next),from:'2026-10-25',to:'2026-12-14'}:{supported:true};
      if(method==='commitSharedRead'){state.commits.push(args);state.fresh=true;return {accepted:true};}
      return {};
    }};
  },{supported,widget,hungCapabilities,deltaVersion});
  try{
    await page.goto(browserOrigin,{waitUntil:'domcontentloaded'});
    await page.waitForSelector('input[placeholder="아이디 또는 전화번호"]');await page.type('input[placeholder="아이디 또는 전화번호"]','qaowner');
    await page.waitForSelector('input[placeholder="비밀번호"]');await page.type('input[placeholder="비밀번호"]','qa-local-only');
    await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='로그인').click());
    await page.waitForFunction(()=>document.body.innerText.includes('QA 페이지네이션'),{timeout:30000});
    await context(page,"ctx.setSelDate('2026-11-05');ctx.setCurrent(new Date(2026,10,1));");
    await page.waitForFunction(()=>document.body.innerText.includes('검증일정44'),{timeout:30000});
    if(supported&&!hungCapabilities){
      assert.ok(reads.length,'native owner uses shared authorized endpoint');
      if(widget){
        await page.waitForFunction(()=>window.__nativeQA.commits.length>0,{timeout:10000});
        const shared=await page.evaluate(()=>({session:window.__nativeQA.session,...window.__nativeQA.commits.at(-1)}));
        assert.equal(shared.snapshot.companyId,shared.session.companyId);assert.equal(shared.snapshot.userId,shared.session.userId);
        assert.equal(shared.snapshot.from,'2026-10-25');assert.equal(shared.snapshot.to,'2026-12-14');assert.ok(shared.snapshot.events.length>20);
        const allowed=new Set(['id','title','start','end','startTime','endTime','allDay','place','calId']);
        for(const event of shared.snapshot.events)assert.ok(Object.keys(event).every(k=>allowed.has(k)));
        assert.ok(reads.some(r=>r.widgetRange?.from==='2026-10-25'));
        const editedTitle='공유 편집 검증 '+Date.now();
        const changedRef=db.doc('companies/qa_pagination/events/event_000'),before=await changedRef.get();
        await context(page,`return ctx.updateEvent({...ctx.events.find(e=>e.id==="event_000"),title:${JSON.stringify(editedTitle)}});`);
        await recordAppReadChange(db,{id:randomUUID(),params:{companyId:'qa_pagination',id:'event_000'},data:{before,after:await changedRef.get()}},'events');
        await page.waitForFunction(title=>window.__nativeQA.commits.some(c=>c.snapshot.events.some(e=>e.id==='event_000'&&e.title===title)),{timeout:30000},editedTitle);
        console.log('PASS native owner joins widget period; commits minimal authorized snapshot; edit updates shared cache');
      } else {assert.ok(reads.every(r=>!r.widgetRange));console.log('PASS no installed widget keeps normal app query range');}
      await context(page,'ctx.setCurrentScreen("reg_settlement");');
      await page.waitForFunction(()=>document.body.innerText.includes('985,000'),{timeout:30000});
      console.log('PASS native owner settlement remains complete');
    } else {assert.ok(reads.length>0);console.log(hungCapabilities?'PASS missing bridge callback times out and keeps persistent calendar usable':'PASS old APK uses persistent projected calendar without native sharing');}
    assert.equal(widgetRequests,0,'one app response supplies widget without another widget API request');assert.deepEqual(errors,[]);
  } catch(error){console.log(JSON.stringify({error:error.message,errors,reads,native:await page.evaluate(()=>({calls:window.__nativeQA.calls,commits:window.__nativeQA.commits.map(c=>({ticket:c.ticket,event0:c.snapshot.events.find(e=>e.id==='event_000')?.title}))}))}));throw error;} finally{await isolated.close();}
}
try{await run({supported:true,widget:true});await run({supported:true,widget:true,deltaVersion:0});await run({supported:true,widget:false});await run({supported:false,widget:false});await run({supported:true,widget:false,hungCapabilities:true});console.log('Widget sharing browser flows passed.');}finally{await browser.close();await db.terminate();}
