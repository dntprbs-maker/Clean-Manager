import puppeteer from 'puppeteer';
const browser = await puppeteer.launch({headless:true, executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--no-sandbox']});
const page = await browser.newPage();
await page.setViewport({width:390,height:844});
page.on('pageerror', e=>console.log('PAGEERROR',e.message));
await page.evaluateOnNewDocument(()=>{
 window.androidBridge={};window.__backListeners=new Map();window.__minimized=0;let seq=0;
 window.Capacitor={PluginHeaders:[{name:'App',methods:[{name:'addListener'},{name:'removeListener',rtype:'promise'},{name:'minimizeApp',rtype:'promise'}]}],nativeCallback:(plugin,method,options,callback)=>{const id=String(++seq);window.__backListeners.set(id,callback);return Promise.resolve(id);},nativePromise:async(plugin,method,options)=>{if(method==='removeListener')window.__backListeners.delete(options.callbackId);if(method==='minimizeApp')window.__minimized++;}};
 window.__pressBack=()=>{for(const fn of window.__backListeners.values())fn({canGoBack:false});};
});
await page.goto('http://127.0.0.1:5188/?demo=true');
await page.waitForSelector('button');
// The existing demo banner overlaps modal headers; it is absent in signed-in production.
await page.addStyleTag({content:'.fixed.top-0.z-\\[1000\\]{pointer-events:none}'});
await new Promise(r=>setTimeout(r,1200));

const assert = (await import('node:assert/strict')).default;
const pause=()=>new Promise(r=>setTimeout(r,600));
const back=async()=>{await page.evaluate(()=>window.__pressBack());await pause();};
const has=txt=>page.evaluate(t=>document.body.innerText.includes(t),txt);
const click=txt=>page.evaluate(t=>{const e=[...document.querySelectorAll('button,p')].find(e=>e.textContent.trim()===t);if(!e)throw new Error('missing '+t);e.click();},txt);
await click('오전 역촌동 입주청소 25평');await pause();
assert(await has('일정 수정'));
await back();assert(!(await has('일정 수정')));assert.equal(await page.evaluate(()=>window.__minimized),0);
console.log('PASS editor -> calendar');
await click('오전 역촌동 입주청소 25평');await pause();
const title=await page.$('input[value="오전 역촌동 입주청소 25평"]');
assert(title);await title.type(' 뒤로가기 검증');await back();assert(await has('변경사항이 있습니다'));
await back();assert(!(await has('변경사항이 있습니다')));assert(await has('일정 수정'));
await back();assert(await has('변경사항이 있습니다'));
await click('저장없이 나가기');await pause();assert(!(await has('일정 수정')));
console.log('PASS dirty -> confirm -> editor -> confirm -> discard');

await page.evaluate(()=>document.querySelector('svg.lucide-search').closest('button').click());await pause();
await page.type('input[placeholder="제목, 내용, 장소, 연락처 검색"]','역촌동');await pause();
await page.click('div.cursor-pointer.bg-white.p-4');await pause();
assert(!(await has('일정 수정')));
await page.click('button[aria-label="일정 수정"]');await pause();assert(await has('일정 수정'));
await back();assert(!(await has('일정 수정')));assert(await page.$('button[aria-label="일정 수정"]'));console.log('PASS detail -> edit -> detail');
await back();assert(!(await page.$('button[aria-label="일정 수정"]')));assert.equal(await page.$eval('input[placeholder="제목, 내용, 장소, 연락처 검색"]',e=>e.value),'역촌동');console.log('PASS detail -> search with query preserved');await back();
await back();assert.equal(await page.evaluate(()=>window.__minimized),1);console.log('PASS root minimizes only at root');
assert.equal(await page.evaluate(()=>window.__backListeners.size),1);

await page.evaluate(async()=>{const m=await import('/src/components/shared/RecurringScopeSheet.jsx');window.__scopeResult='pending';m.askRecurringScope({_recurring:true,title:'시험',start:'2026-11-12'},'edit').then(v=>window.__scopeResult=v);});await pause();
assert(await has('반복일정 수정'));await back();assert.equal(await page.evaluate(()=>window.__scopeResult),null);console.log('PASS recurring scope canceled without changing screen');
await browser.close();
