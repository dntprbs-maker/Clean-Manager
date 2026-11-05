import { browserOrigin } from './emulatorConfig.mjs';
import puppeteer from 'puppeteer';
import fs from 'node:fs';
const browser=await puppeteer.launch({headless:true,args:['--no-sandbox']});const page=await browser.newPage();await page.setViewport({width:430,height:932,isMobile:true});
const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',async d=>{console.log('DIALOG:',d.message());await d.dismiss();});
await page.goto(`${browserOrigin}/`,{waitUntil:'networkidle2'});
await page.type('input[placeholder="아이디 또는 전화번호"]','qaowner');await page.type('input[placeholder="비밀번호"]','qa-local-only');
await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='로그인').click());
try{await page.waitForFunction(()=>document.body.innerText.includes('QA 페이지네이션'),{timeout:40000});await page.waitForNetworkIdle({idleTime:1000,timeout:15000}).catch(()=>{});}catch{}
await page.screenshot({path:'test/.artifacts/calendar.png',fullPage:true});
console.log(JSON.stringify({text:await page.evaluate(()=>document.body.innerText.slice(0,1700)),errors}));
fs.writeFileSync('test/.artifacts/initial-dom.html',await page.content());await browser.close();
