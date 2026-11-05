// Network integration test fixed to local demo emulators. No production writes.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../functions/package.json', import.meta.url));
process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST ||= '127.0.0.1:9099';
const functionsOrigin = (process.env.FUNCTIONS_EMULATOR_ORIGIN || 'http://127.0.0.1:5001').replace(/\/$/, '');
for (const host of [process.env.FIRESTORE_EMULATOR_HOST, process.env.FIREBASE_AUTH_EMULATOR_HOST]) {
  assert.match(host, /^(127\.0\.0\.1|localhost):\d+$/, 'integration tests permit only loopback emulator hosts');
}
assert.match(functionsOrigin, /^http:\/\/(127\.0\.0\.1|localhost):\d+$/, 'integration tests permit only loopback Functions origin');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const project = 'demo-clean-manager';
for (const origin of [`http://${process.env.FIRESTORE_EMULATOR_HOST}`, `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`, functionsOrigin]) {
  try { await fetch(`${origin}/`, { signal: AbortSignal.timeout(3000) }); }
  catch { throw new Error(`Required local emulator ${origin} is not ready; no fixture writes performed.`); }
}
const db = getFirestore(initializeApp({ projectId: project }, 'scoped-read-regression'));
const company = 'qa_scoped_reads';
const root = `companies/${company}`;
const put = (path, value) => db.doc(path).set(value);
await put(root, { name: '범위 조회 회귀용 가상 회사' });
const user = { name: '범위 조회 가상직원', phone: '01000007777', companyId: company, pw: 'qa-scope-only', role: '팀원', memberships: [{ team: 'A', role: '팀원' }] };
await put('staffs/qa_scoped_staff', user);
await put(`${root}/users/qa_scoped_staff`, user);
await put(`${root}/cals/teamA`, { name: 'A', label: 'A', color: '#123456', checked: true });
await put(`${root}/cals/private`, { name: '타인개인', personal: true, ownerId: 'other', feedToken: 'qa-private-feed' });
await Promise.all([
  put(`${root}/events/noEnd`, { title: '종료일 없는 당일', start: '2026-11-05', calId: 'teamA' }),
  put(`${root}/events/long`, { title: '과거부터 걸친 장기', start: '2020-01-01', end: '2026-11-06', calId: 'teamA' }),
  put(`${root}/events/oldRepeat`, { title: '오래된 매주 반복', start: '2000-01-01', repeat: 'weekly', repeatWeekdays: [4], repeatUntil: '2027-01-01', calId: 'teamA' }),
  put(`${root}/events/futureMoved`, { title: '미래 원본 이동', start: '2040-01-01', repeat: 'daily', repeatUntil: '2041-01-01', calId: 'teamA', exceptions: { '2040-01-01': { start: '2026-11-05', end: '2026-11-05', title: '기간 안 이동' } } }),
  put(`${root}/events/isolated`, { title: '금지 원본', start: '2040-01-01', repeat: 'daily', repeatUntil: '2041-01-01', calId: 'private', exceptions: {
    '2040-01-01': { start: '2026-11-05', end: '2026-11-05', calId: 'teamA', title: '허용된 독립회차' },
    '2040-01-02': { title: 'qa-private-exception-secret', contact: 'qa-private-contact' },
  } }),
  put(`${root}/events/deletedSource`, { start: '2026-11-05', calId: 'teamA', status: 'deleted' }),
  put(`${root}/reports/preservedDeleted`, { eventId: 'deletedSource', status: '완료' }),
  put(`${root}/reports/preservedMissing`, { eventId: 'missingSource', status: '완료' }),
  put(`${root}/reports/preservedNoEventId`, { status: '완료' }),
  put(`${root}/events/widgetOnly`, { title: '위젯 범위 전용', start: '2026-11-02', end: '2026-11-02', calId: 'teamA' }),
  put(`${root}/reports/widgetOnlyReport`, { eventId: 'widgetOnly', date: '2026-11-02', status: '완료' }),
  put(`${root}/events/outside`, { title: '먼 과거 일반 일정', start: '2000-01-01', end: '2000-01-01', calId: 'teamA' }),
  put(`${root}/events/pinned`, { title: '핀으로만 조회', start: '2050-01-01', end: '2050-01-01', calId: 'teamA' }),
  put(`${root}/events/pastMonth`, { title: '오래 전 표시 월', start: '1990-02-14', calId: 'teamA' }),
  put(`${root}/events/intervening`, { title: '중간 연도 비표시', start: '2010-01-01', end: '2010-01-01', calId: 'teamA' }),
  put(`${root}/events/revisionAdded`, { title: '변경 시험 전 범위 밖', start: '2030-01-01', calId: 'teamA' }),
  put(`${root}/reports/noEndReport`, { eventId: 'noEnd', date: '2026-11-05', status: '진행중' }),
  put(`${root}/reports/oldRepeatHistoric`, { eventId: 'oldRepeat', date: '2000-01-01', status: '완료' }),
  put(`${root}/reports/oldRepeatUndated`, { eventId: 'oldRepeat', status: '진행중' }),
  put(`${root}/reports/unrelated`, { eventId: 'outside', date: '2000-01-01', status: '완료' }),
]);
async function callable(name, input, token) {
  const response = await fetch(`${functionsOrigin}/${project}/asia-northeast3/${name}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ data: input }),
  });
  return { status: response.status, ...(await response.json()) };
}
const auth = await callable('appAuth', { identifier: user.phone, password: user.pw });
assert.equal(auth.status, 200, 'server credentials authenticate in demo emulator');
const exchange = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=local-only`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: auth.result.token, returnSecureToken: true }) });
const token = (await exchange.json()).idToken;
assert.ok(token, 'Firebase ID token issued; token is never printed');
const scope = { from: '2026-11-05', to: '2026-11-05' };
let first = await callable('appReadData', scope, token);
assert.equal(first.status, 200);
assert.deepEqual(first.result.events.map(e => e.id).sort(), ['futureMoved', 'long', 'noEnd', 'oldRepeat']);
assert.equal(first.result.instances.length, 1);
assert.equal(first.result.instances[0]._origDate, '2040-01-01');
assert.equal(first.result.instances[0].exceptions, undefined, 'allowed isolated occurrence cannot carry private exception map');
assert.equal(JSON.stringify(first.result).includes('qa-private-exception-secret'), false);
assert.deepEqual(first.result.reports.map(r => r.id).sort(), ['noEndReport', 'oldRepeatHistoric', 'oldRepeatUndated']);
assert.ok(first.result.scopeKey?.startsWith('v1:'), 'server-issued normalized scope cache key returned');
if (first.result.revision === null) {
  const noHead = await callable('appReadData', { ...scope, knownRevision: 0, scopeKey: first.result.scopeKey }, token);
  assert.equal(noHead.result.notModified, undefined, 'missing head never pretends to be unchanged revision zero');
  // A reduced emulator entry point need not run background triggers. Create a
  // fixture-only head explicitly to test the read shortcut independently.
  await put(`${root}/meta/readRevision`, { revision: 100 });
  first = await callable('appReadData', scope, token);
}
// Eventarc invalidations can arrive after reads. Retry only while a newer head
// is observed; never assume the trigger queue is immediately quiescent.
let unchanged;
for (let i = 0; i < 20; i++) {
  unchanged = await callable('appReadData', { ...scope, knownRevision: first.result.revision, scopeKey: first.result.scopeKey }, token);
  if (unchanged.result.notModified) break;
  first = unchanged;
  await new Promise(resolve => setTimeout(resolve, 200));
}
assert.equal(unchanged.result.notModified, true);
assert.equal(unchanged.result.events, undefined);
assert.equal(unchanged.result.reports, undefined);
assert.equal(unchanged.result.cals, undefined);
const widgetRange = { from: '2026-11-01', to: '2026-11-06' };
const shared = await callable('appReadData', { ...scope, widgetRange }, token);
assert.equal(shared.status, 200);
assert.equal(shared.result.events.some(e => e.id === 'widgetOnly'), false, 'widget-only candidates never enter application events');
assert.equal(shared.result.reports.some(e => e.id === 'widgetOnlyReport'), false, 'widget-only candidates never select application reports');
assert.ok(shared.result.sharedWidget.events.some(e => e.id === 'widgetOnly'));
assert.ok(shared.result.sharedWidget.events.some(e => e.title === '허용된 독립회차'));
assert.equal(JSON.stringify(shared.result.sharedWidget).includes('qa-private-exception-secret'), false);
assert.equal(shared.result.sharedWidget.userId, 'cm_staff_qa_scoped_staff');
assert.equal(shared.result.sharedWidget.companyId, company);
assert.equal(shared.result.sharedWidget.scopeKey, shared.result.scopeKey);
assert.equal(shared.result.sharedWidget.revision, shared.result.revision);
assert.equal(shared.result.sharedWidget.serverAt, shared.result.serverAt);
assert.deepEqual({ from: shared.result.sharedWidget.from, to: shared.result.sharedWidget.to }, widgetRange);
assert.equal(first.result.sharedWidget, undefined);
const sharedUnchanged = await callable('appReadData', { ...scope, widgetRange, knownRevision: shared.result.revision, scopeKey: shared.result.scopeKey }, token);
assert.equal(sharedUnchanged.result.notModified, true);
assert.equal(sharedUnchanged.result.sharedWidget, undefined);
const emptyWidget = await callable('appReadData', { ...scope, widgetRange: { from: '1980-01-01', to: '1980-01-02' }, knownRevision: shared.result.revision, scopeKey: shared.result.scopeKey }, token);
assert.equal(emptyWidget.result.notModified, undefined);
assert.deepEqual(emptyWidget.result.sharedWidget.events, []);
assert.deepEqual(emptyWidget.result.sharedWidget.calendars, []);
assert.equal((await callable('appReadData', { ...scope, widgetRange: { from: '2026-02-30', to: '2026-03-01' } }, token)).status, 400);
const pinned = await callable('appReadData', { ...scope, eventIds: ['pinned'], knownRevision: first.result.revision, scopeKey: first.result.scopeKey }, token);
assert.equal(pinned.result.notModified, undefined, 'changed pins invalidate old scope key');
assert.ok(pinned.result.events.some(e => e.id === 'pinned'));
const changedDate = await callable('appReadData', { from: '2026-11-06', to: '2026-11-06', knownRevision: first.result.revision, scopeKey: first.result.scopeKey }, token);
assert.equal(changedDate.result.notModified, undefined, 'changed date invalidates old scope key');
assert.equal((await callable('appReadData', { from: '2026-01-01', to: '2027-02-01' }, token)).status, 400);
const distant = await callable('appReadData', {
  from: '1990-02-01', to: '2026-11-05', ranges: [{ from: '1990-02-01', to: '1990-02-28' }, scope],
}, token);
assert.equal(distant.status, 200, `distant windows each stay bounded while outer min/max may exceed 370 days: ${distant.error?.message || ''}`);
assert.ok(distant.result.events.some(e => e.id === 'pastMonth'));
assert.ok(distant.result.events.some(e => e.id === 'noEnd'));
assert.equal(distant.result.events.some(e => e.id === 'intervening'), false);
const revisionBeforeChange = await callable('appReadData', scope, token);
await put(`${root}/events/revisionAdded`, { title: '변경 순번 재조회', start: '2026-11-05', calId: 'teamA' });
await put(`${root}/meta/readRevision`, { revision: Number(revisionBeforeChange.result.revision || 0) + 1 });
const revisionChanged = await callable('appReadData', { ...scope, knownRevision: revisionBeforeChange.result.revision, scopeKey: revisionBeforeChange.result.scopeKey }, token);
assert.equal(revisionChanged.result.notModified, undefined);
assert.ok(revisionChanged.result.events.some(e => e.id === 'revisionAdded'));
const widget = await fetch(`${functionsOrigin}/${project}/asia-northeast3/appWidgetData`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(scope) });
const widgetData = await widget.json();
assert.equal(widget.status, 200);
assert.ok(widgetData.events.some(e => e.title === '기간 안 이동'));
assert.ok(widgetData.events.some(e => e.title === '허용된 독립회차'));
assert.equal(JSON.stringify(widgetData).includes('qa-private-exception-secret'), false);
await put(`${root}/users/qa_scoped_staff`, { ...user, memberships: [{ team: 'B', role: '팀원' }] });
const permissionChanged = await callable('appReadData', { ...scope, knownRevision: revisionChanged.result.revision, scopeKey: revisionChanged.result.scopeKey }, token);
assert.equal(permissionChanged.result.notModified, undefined, 'live permission changes invalidate cached scope even with same token');
assert.equal(permissionChanged.result.events.some(e => e.id === 'noEnd'), false);
const preserved = ['preservedDeleted', 'preservedMissing', 'preservedNoEventId'];
await put('admins/qa_scoped_admin', { id: 'qa_scoped_admin', pw: 'qa-scope-owner-only', companyId: company, name: '가상 관리자' });
const ownerLogin = await callable('appAuth', { identifier: 'qa_scoped_admin', password: 'qa-scope-owner-only' });
assert.equal(ownerLogin.status, 200);
const ownerExchange = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=local-only`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: ownerLogin.result.token, returnSecureToken: true }) });
const ownerToken = (await ownerExchange.json()).idToken;
const ownerFull = await callable('appReadData', { full: true }, ownerToken);
assert.equal(ownerFull.status, 200);
for (const id of preserved) assert.ok(ownerFull.result.reports.some(r => r.id === id), 'owner full history preserves orphan ledger');
const ownerPeriod = await callable('appReadData', scope, ownerToken);
for (const id of preserved) assert.equal(ownerPeriod.result.reports.some(r => r.id === id), false, 'period reads keep selected-event semantics');
const staffFull = await callable('appReadData', { full: true }, token);
for (const id of preserved) assert.equal(staffFull.result.reports.some(r => r.id === id), false, 'staff never gains orphan history access');
await put(`${root}/users/qa_scoped_staff`, { ...user, memberships: [{ team: '관리팀', role: '팀원' }] });
const managerFull = await callable('appReadData', { full: true }, token);
for (const id of preserved) assert.equal(managerFull.result.reports.some(r => r.id === id), false, 'management staff retain event ACL');
await db.terminate();
console.log('Scoped read emulator regression passed: ranges, missing end, long/old recurrence, moved private exceptions, related reports, scope-bound revision cache, pins and widget. No token printed.');
