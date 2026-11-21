import './emulatorConfig.mjs';
import puppeteer from 'puppeteer';import assert from 'node:assert/strict';import {createRequire}from'node:module';
const require=createRequire(new URL('../functions/package.json',import.meta.url));const{initializeApp}=require('firebase-admin/app'),{getFirestore}=require('firebase-admin/firestore');const db=getFirestore(initializeApp({projectId:'demo-clean-manager'},'acl-screen'));
const browser=await puppeteer.launch({headless:true,args:['--no-sandbox']});const page=await browser.newPage();await page.setViewport({width:430,height:932,isMobile:true});const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
const getCtx=()=>{for(const el of document.querySelectorAll('*')){const k=Object.keys(el).find(k=>k.startsWith('__reactFiber$'));let f=k&&el[k];while(f){if(f.memoizedProps?.value?.setCurrentScreen)return f.memoizedProps.value;f=f.return;}}return null;};
async function ctx(page,code){return page.evaluate(({source,code})=>new Function('ctx',code)(eval('('+source+')')()),{source:getCtx.toString(),code});}
async function login(page,id){await page.goto('http://127.0.0.1:5277/',{waitUntil:'domcontentloaded'});await page.waitForSelector('input[placeholder="아이디 또는 전화번호"]');await page.type('input[placeholder="아이디 또는 전화번호"]',id);await page.waitForSelector('input[placeholder="비밀번호"]');await page.type('input[placeholder="비밀번호"]','qa-local-only');await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='로그인').click());await page.waitForFunction(source=>!!eval('('+source+')')()?.dataReady,{timeout:45000},getCtx.toString());}
const choose=async(text)=>page.evaluate(text=>{const form=document.querySelector('form[aria-label="열람권한 검증 달력 열람 대상"]');const label=[...form.querySelectorAll('label')].find(e=>e.textContent.trim()===text||e.textContent.trim().startsWith(text+' ('));if(!label)throw Error('선택 항목 없음 '+text);label.querySelector('input').click();},text);
const save=async()=>{await page.evaluate(()=>document.querySelector('form[aria-label="열람권한 검증 달력 열람 대상"] button').click());await page.waitForFunction(()=>document.body.innerText.includes('열람 대상을 저장했습니다.'),{timeout:20000});};
try{
 await login(page,'qaaclowner');await ctx(page,"ctx.setCurrentScreen('share_calendars');");await page.waitForSelector('summary');await page.evaluate(()=>[...document.querySelectorAll('summary')].find(s=>s.textContent==='열람권한 검증 달력').click());
 await choose('팀과 사람 직접 선택');await choose('B팀');await choose('개별 선택 직원');await save();
 let saved=(await db.doc('companies/acl_qa/cals/calA').get()).data();assert.deepEqual(saved.viewAccess.teams,['B팀']);assert.deepEqual(saved.viewAccess.people,['u1']);
 await page.screenshot({path:'../acl-ui-selected.png',fullPage:true});console.log('PASS 실제 화면 팀·사람 선택 후 저장');
 const session=await browser.createBrowserContext();const staff=await session.newPage();staff.on('pageerror',e=>errors.push(e.message));await login(staff,'01000002221');assert((await ctx(staff,'return ctx.visibleEvents.map(e=>e.id)')).includes('acl_event'));console.log('PASS 선택된 직원 실제 로그인 후 달력 표시');
 await choose('B팀');await choose('개별 선택 직원');await save();await staff.reload({waitUntil:'networkidle2'});await staff.waitForFunction(source=>!!eval('('+source+')')()?.dataReady,{timeout:45000},getCtx.toString());assert(!(await ctx(staff,'return ctx.visibleEvents.map(e=>e.id)')).includes('acl_event'));console.log('PASS 화면 권한회수 후 재접속·캐시에서 일정 제거');
 assert.deepEqual(errors,[]);console.log('PASS 브라우저 오류 0, 운영 데이터 조회 없음');
}finally{await browser.close();await db.terminate();}
