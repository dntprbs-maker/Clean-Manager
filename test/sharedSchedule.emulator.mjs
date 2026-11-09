import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { authHost, browserOrigin, firestoreHost, functionsOrigin } from './emulatorConfig.mjs';

const project = 'demo-clean-manager';
const require = createRequire(new URL('../functions/package.json', import.meta.url));
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const db = getFirestore(initializeApp({ projectId: project }, 'sharing-regression'));
const password = 'local-test-only';

async function call(name, data, token) {
  const response = await fetch(`${functionsOrigin}/${project}/asia-northeast3/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ data }),
  });
  return { status: response.status, body: await response.json() };
}

async function login(identifier) {
  const auth = await call('appAuth', { identifier, password });
  assert.equal(auth.status, 200, JSON.stringify(auth.body.error));
  const exchange = await fetch(`http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=local-test`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: auth.body.result.token, returnSecureToken: true }),
  });
  assert.equal(exchange.status, 200);
  return (await exchange.json()).idToken;
}

const home = 'sharing_guest_company';
const host = 'sharing_host_company';
const phone = '01000009876';
const independentPhone = '01000009877';
const guest = { name: '시험 직원', phone, pw: password, companyId: home };
await Promise.all([
  db.doc(`companies/${host}`).set({ name: '공유 회사' }),
  db.doc(`companies/${home}`).set({ name: '수신 회사' }),
  db.doc('admins/sharing_owner').set({ id: 'sharingowner', name: '시험 관리자', pw: password, companyId: host }),
  db.doc('staffs/sharing_guest').set(guest),
  db.doc('staffs/sharing_independent').set({ name: '무소속 시험 회원', phone: independentPhone, pw: password }),
  db.doc(`companies/${home}/users/sharing_guest`).set(guest),
  db.doc(`companies/${host}/events/one`).set({ title: '공유 일정', start: '2026-11-10', calId: 'hidden', finance: { amount: 1 } }),
  db.doc(`companies/${host}/events/two`).set({ title: '비공개 일정', start: '2026-11-10', calId: 'hidden' }),
  db.doc(`companies/${host}/cals/hidden`).set({ label: '비공개 캘린더' }),
]);
const [owner, member] = await Promise.all([login('sharingowner'), login(phone)]);
const independent = await login(independentPhone);
const share = (data, token) => call('appSharedSchedule', data, token);
assert.equal((await share({ action: 'received' })).status, 401);
assert.equal((await share({ action: 'invite', eventId: 'one', phone }, owner)).status, 200);
assert.equal((await share({ action: 'invite', eventId: 'one', phone: independentPhone }, owner)).status, 200);
assert.equal((await call('appAuth', { action: 'restore' }, independent)).body.result.user.companyId, '');
assert.equal((await call('appReadData', {}, independent)).status, 403);
assert.equal((await share({ action: 'received' }, independent)).body.result.events.length, 1);
const received = await share({ action: 'received' }, member);
assert.equal(received.status, 200);
assert.equal(received.body.result.events.length, 1);
assert.equal(received.body.result.events[0].title, '공유 일정');
assert.equal('finance' in received.body.result.events[0], false);
const sent = await share({ action: 'sent', eventId: 'one' }, owner);
assert.equal(sent.status, 200);
for (const path of [`companies/${host}/cals/hidden`, `companies/${host}/events/one`, `companies/${host}/events/two`, `appAuthScheduleGrants/${sent.body.result.invites[0].id}`]) {
  const raw = await fetch(`http://${firestoreHost}/v1/projects/${project}/databases/(default)/documents/${path}`, {
    headers: { Authorization: `Bearer ${member}` },
  });
  assert.equal(raw.status, 403);
}
for (const invite of sent.body.result.invites) {
  assert.equal((await share({ action: 'remove', eventId: 'one', grantId: invite.id }, owner)).status, 200);
}
assert.deepEqual((await share({ action: 'received' }, member)).body.result.events, []);
assert.deepEqual((await share({ action: 'received' }, independent)).body.result.events, []);
assert.equal((await db.doc(`companies/${host}/events/one`).get()).exists, true);
console.log('PASS: authenticated invite, cross-company read, direct database denial, revocation');

const team = '시험 팀';
const teamPhone = '01000009878';
const teamAccount = { name: '팀원', phone: teamPhone, pw: password, companyId: host, memberships: [{ team, role: '팀원' }] };
const day = offset => new Date(Date.now() + (9 + 24 * offset) * 3600000).toISOString().slice(0, 10);
await Promise.all([
  db.doc(`companies/${host}/meta/config`).set({ teams: [team] }),
  db.doc('staffs/sharing_team').set(teamAccount),
  db.doc(`companies/${host}/users/sharing_team`).set(teamAccount),
  db.doc(`companies/${home}/users/sharing_guest`).update({ memberships: [{ team, role: '팀원' }] }),
  db.doc(`companies/${host}/events/series`).set({ title: '반복 시험', start: day(0), repeat: 'daily', repeatUntil: day(2), calId: 'hidden',
    exceptions: { [day(1)]: { start: day(3), title: '이동한 회차' } } }),
  db.doc(`companies/${host}/events/moved_into`).set({ title: '다른 캘린더의 반복', start: day(0), repeat: 'daily', repeatUntil: day(1), calId: 'other',
    exceptions: { [day(1)]: { calId: 'hidden', title: '공유 캘린더로 이동' } } }),
  db.doc(`companies/${host}/events/old`).set({ title: '지난 공유 일정', start: day(-200), calId: 'hidden' }),
]);
const teamMember = await login(teamPhone);
const receive = async token => {
  const result = await share({ action: 'received' }, token);
  assert.equal(result.status, 200, JSON.stringify(result.body.error));
  return result.body.result.events;
};
const change = async (data, token = owner) => {
  const result = await share(data, token);
  assert.equal(result.status, 200, JSON.stringify(result.body.error));
  return result.body.result;
};
const calendar = { calendarId: 'hidden' };
const instance = { eventId: 'series', day: day(1) };
await change({ action: 'inviteTeam', ...calendar, team });
assert.equal((await receive(teamMember)).filter(row => ['반복 시험', '이동한 회차'].includes(row.title)).length, 3);
assert.equal((await receive(teamMember)).some(row => row.title === '공유 캘린더로 이동'), true);
assert.equal((await receive(teamMember)).some(row => row.title === '다른 캘린더의 반복'), false);
assert.deepEqual((await change({ action: 'received', from: day(-200), to: day(-200) }, teamMember)).events.map(row => row.title), ['지난 공유 일정']);
assert.deepEqual(await receive(member), [], 'the same team name in another company must not grant access');
await change({ action: 'invite', ...calendar, phone });
assert.equal((await receive(member)).filter(row => ['반복 시험', '이동한 회차'].includes(row.title)).length, 3);
await change({ action: 'invite', ...instance, phone });
assert.equal((await receive(member)).filter(row => row.title === '이동한 회차').length, 1, 'overlapping grants deduplicate');
const calendarInvites = (await change({ action: 'sent', ...calendar })).invites;
await change({ action: 'remove', ...calendar, grantId: calendarInvites.find(row => row.phoneTail).id });
assert.deepEqual((await receive(member)).map(row => [row.title, row.start]), [['이동한 회차', day(3)]]);
await db.doc(`companies/${host}/users/sharing_team`).update({ memberships: [] });
assert.deepEqual(await receive(teamMember), [], 'removed team member loses the grant');
await db.doc(`companies/${host}/users/sharing_team`).update({ memberships: teamAccount.memberships });
await change({ action: 'remove', ...calendar, grantId: calendarInvites.find(row => row.team).id });
assert.deepEqual(await receive(teamMember), [], 'removed team grant blocks former recipients');
const instanceInvite = (await change({ action: 'sent', ...instance })).invites[0];
await change({ action: 'remove', ...instance, grantId: instanceInvite.id });
assert.deepEqual(await receive(member), []);
console.log('PASS: calendar grants, team boundaries and removal, moved recurring occurrence and revocation');

if (process.env.QA_BROWSER_ORIGIN) {
  const { default: puppeteer } = await import('puppeteer');
  const browser = await puppeteer.launch({ headless: true });
  try {
    const ownerPage = await browser.newPage();
    const guestPage = await (await browser.createBrowserContext()).newPage();
    const click = async (page, label) => {
      const handle = await page.waitForFunction(label =>
        [...document.querySelectorAll('button')].find(node => !node.disabled && node.textContent.trim() === label),
      { timeout: 20000 }, label);
      await handle.evaluate(button => button.click());
      await handle.dispose();
    };
    const wait = (page, label) => page.waitForFunction(label => document.body.innerText.includes(label), { timeout: 20000 }, label);
    const enter = async (page, identifier) => {
      await page.goto(browserOrigin, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('input[placeholder="아이디 또는 전화번호"]');
      await page.type('input[placeholder="아이디 또는 전화번호"]', identifier);
      await page.waitForSelector('input[placeholder="비밀번호"]');
      await page.type('input[placeholder="비밀번호"]', password);
      await click(page, '로그인');
    };
    await enter(ownerPage, 'sharingowner');
    await wait(ownerPage, '공유 회사');
    const event = (await db.doc(`companies/${host}/events/one`).get()).data();
    await ownerPage.evaluate(event => {
      for (const node of document.querySelectorAll('*')) {
        const key = Object.keys(node).find(name => name.startsWith('__reactFiber$'));
        for (let fiber = key && node[key]; fiber; fiber = fiber.return) {
          const context = fiber.memoizedProps?.value;
          if (context?.setDetEv) { context.setDetEv(event); return; }
        }
      }
      throw new Error('Calendar provider missing');
    }, { id: 'one', ...event });
    await wait(ownerPage, '이 일정 공유');
    await click(ownerPage, '이 일정 공유');
    await ownerPage.type('input[aria-label="기존 회원 전화번호"]', independentPhone);
    await click(ownerPage, '초대');
    await wait(ownerPage, '번호 끝 9877');
    await enter(guestPage, independentPhone);
    await wait(guestPage, '공유 일정');
    assert.equal(await guestPage.evaluate(() => document.body.innerText.includes('비공개 일정')), false);
    ownerPage.once('dialog', dialog => dialog.accept());
    await click(ownerPage, '초대 제거');
    await ownerPage.waitForFunction(() => !document.body.innerText.includes('번호 끝 9877'));
    await guestPage.reload({ waitUntil: 'domcontentloaded' });
    await wait(guestPage, '공유받은 일정이 없습니다.');
    await ownerPage.reload({ waitUntil: 'domcontentloaded' });
    await wait(ownerPage, '공유 회사');
    await ownerPage.evaluate(() => {
      for (const node of document.querySelectorAll('*')) {
        const key = Object.keys(node).find(name => name.startsWith('__reactFiber$'));
        for (let fiber = key && node[key]; fiber; fiber = fiber.return) {
          const context = fiber.memoizedProps?.value;
          if (context?.setDrawer) { context.setDrawer(true); return; }
        }
      }
      throw new Error('Calendar provider missing');
    });
    await click(ownerPage, '캘린더 공유 관리');
    await wait(ownerPage, '비공개 캘린더');
    await ownerPage.evaluate(() => {
      [...document.querySelectorAll('summary')].find(node => node.textContent.trim() === '비공개 캘린더').click();
    });
    await click(ownerPage, '이 캘린더 공유');
    await ownerPage.waitForFunction(team => [...document.querySelectorAll('select[aria-label="공유할 팀"] option')].some(option => option.value === team), {}, team);
    assert.deepEqual(await ownerPage.select('select[aria-label="공유할 팀"]', team), [team]);
    await click(ownerPage, '팀에 공유');
    await wait(ownerPage, '초대 제거');
    await ownerPage.type('input[aria-label="기존 회원 전화번호"]', independentPhone);
    await click(ownerPage, '초대');
    await wait(ownerPage, '번호 끝 9877');
    await guestPage.reload({ waitUntil: 'domcontentloaded' });
    await wait(guestPage, '이동한 회차');
    const sentCalendar = (await change({ action: 'sent', ...calendar })).invites;
    await change({ action: 'remove', ...calendar, grantId: sentCalendar.find(row => row.phoneTail).id });
    await ownerPage.evaluate(event => {
      for (const node of document.querySelectorAll('*')) {
        const key = Object.keys(node).find(name => name.startsWith('__reactFiber$'));
        for (let fiber = key && node[key]; fiber; fiber = fiber.return) {
          const context = fiber.memoizedProps?.value;
          if (context?.setDetEv) { context.setDetEv(event); return; }
        }
      }
      throw new Error('Calendar provider missing');
    }, { id: 'series', _origDate: day(1), _recurring: true, title: '이동한 회차', start: day(3), calId: 'hidden' });
    await click(ownerPage, '이 회차만 공유');
    const detailPhone = 'input[aria-label="기존 회원 전화번호"]';
    await ownerPage.waitForFunction(() => {
      const form = [...document.querySelectorAll('input[aria-label="기존 회원 전화번호"]')].at(-1)?.form;
      return form?.closest('section')?.querySelector('h3')?.textContent === '이 회차만 공유' && !form.querySelector('button').disabled;
    });
    const inputs = await ownerPage.$$(detailPhone);
    await inputs.at(-1).type(independentPhone);
    await ownerPage.evaluate(() => {
      const form = [...document.querySelectorAll('input[aria-label="기존 회원 전화번호"]')].at(-1).form;
      form.requestSubmit();
    });
    await ownerPage.waitForFunction(() => [...document.querySelectorAll('section')].some(section =>
      section.querySelector('h3')?.textContent === '이 회차만 공유' && section.innerText.includes('번호 끝 9877')));
    await guestPage.reload({ waitUntil: 'domcontentloaded' });
    await wait(guestPage, '이동한 회차');
    assert.equal(await guestPage.evaluate(() => document.body.innerText.includes('반복 시험')), false);
    console.log('PASS: browser direct and calendar sharing, team setup, and isolated recurring occurrence');
  } finally {
    await browser.close();
  }
}
