import puppeteer from 'puppeteer';
import { mkdirSync } from 'fs';

mkdirSync('public/faq', { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });

// 로그인
await page.goto('http://localhost:57396', { waitUntil: 'networkidle0', timeout: 15000 });
await page.waitForSelector('input', { timeout: 10000 });
const inputs = await page.$$('input');
await inputs[0].type('test');
await sleep(300);
const inputs2 = await page.$$('input');
if (inputs2[1]) await inputs2[1].type('1234');
const loginBtn = await page.$('button.w-full');
if (loginBtn) await loginBtn.click();
await sleep(2500);

// 1. 캘린더 메인
await page.screenshot({ path: 'public/faq/faq-calendar.png' });
console.log('✅ 캘린더 화면 저장');

// 2. + 버튼 → 4탭 화면
const plusBtn = await page.$('button.w-14');
if (plusBtn) await plusBtn.click();
await sleep(600);
await page.screenshot({ path: 'public/faq/faq-tabs.png' });
console.log('✅ 4탭 화면 저장');

// 3. 직접 탭
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '직접' || b.textContent.includes('직접'));
  if (btn) btn.click();
});
await sleep(600);
await page.screenshot({ path: 'public/faq/faq-direct-form.png' });
console.log('✅ 직접 입력 폼 저장');

// 4. 날짜 클릭 → 드럼롤
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('26. 6.'));
  if (btn) btn.click();
});
await sleep(600);
await page.screenshot({ path: 'public/faq/faq-date-picker.png' });
console.log('✅ 날짜 드럼롤 피커 저장');

// 5. 담당팀 드롭다운 (날짜 피커 닫고)
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('팀배정'));
  if (btn) btn.click();
});
await sleep(400);
await page.screenshot({ path: 'public/faq/faq-team-dropdown.png' });
console.log('✅ 팀 드롭다운 저장');

// 6. 닫기 → FAQ 화면
await page.evaluate(() => {
  const x = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '✕' || b.getAttribute('class')?.includes('close'));
  if (!x) {
    // X 버튼 찾기
    const btns = [...document.querySelectorAll('button')];
    const closeBtn = btns.find(b => {
      const svg = b.querySelector('svg');
      return svg && b.closest('[class*="z-50"]');
    });
    if (closeBtn) closeBtn.click();
  } else x.click();
});
await sleep(300);
// 사이드 메뉴 열기
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find(b => {
    const svg = b.querySelector('svg');
    return svg && b.textContent.trim() === '';
  });
  if (btn) btn.click();
});
await sleep(400);
// FAQ 버튼 클릭
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('FAQ'));
  if (btn) btn.click();
});
await sleep(500);
await page.screenshot({ path: 'public/faq/faq-faq-screen.png' });
console.log('✅ FAQ 화면 저장');

// 7. 팀 관리 화면
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('설정 가이드'));
  if (btn) btn.click();
});
await sleep(300);
// 뒤로가고 사이드메뉴 다시
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find(b => {
    const svg = b.querySelector('svg');
    return svg && b.closest('div[class*="flex items-center gap"]');
  });
  if (btn) btn.click();
});
await sleep(300);
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('팀 관리'));
  if (btn) btn.click();
});
await sleep(500);
await page.screenshot({ path: 'public/faq/faq-team-manage.png' });
console.log('✅ 팀 관리 화면 저장');

await browser.close();
console.log('\n🎉 모든 스크린샷 완료! public/faq/ 폴더 확인');
