import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeDb } from './helpers/fakeFirestore.js';
import { createAppAuthService, publicProfile, canViewWidgetEvent, projectCalendar } from '../lib/appAuthCore.js';

async function setup() {
  const db = createFakeDb();
  await db.doc('companies/co1').set({ name: '회사1' });
  await db.doc('companies/co2').set({ name: '회사2' });
  await db.doc('admins/a1').set({ id: 'owner', pw: 'pass1', companyId: 'co1', name: '관리자' });
  await db.doc('staffs/s1').set({ phone: '01011112222', pw: 'work1', companyId: 'co1', name: '직원', role: '팀원' });
  await db.doc('companies/co1/users/s1').set({ name: '직원', role: '팀원' });
  const tokens = [];
  const call = createAppAuthService({ db, issueToken: async (uid, claims) => { tokens.push({ uid, claims }); return 'custom-token'; }, now: () => 200000 });
  return { db, call, tokens };
}
test('server login emits scoped token and excludes all secrets', async () => {
  const { db, call, tokens } = await setup();
  await db.doc('appAuthConfig/master').set({ accountIds: ['a1'] });
  const result = await call({ identifier: 'owner', password: 'pass1' }, null, 'ip');
  assert.equal(result.token, 'custom-token');
  assert.equal(result.user.uid, 'a1');
  assert.equal(result.user.role, '최고관리자');
  assert.equal(result.user.pw, undefined);
  assert.equal(result.user.authVersion, undefined);
  assert.equal(tokens[0].uid, 'cm_admin_a1');
  assert.equal(tokens[0].claims.cmCompany, 'co1');
  assert.equal(tokens[0].claims.cmMaster, true);
});
test('wrong password and deleted company cannot authenticate', async () => {
  const { db, call } = await setup();
  await assert.rejects(call({ identifier: 'owner', password: 'wrong' }), { code: 'unauthenticated' });
  await db.doc('companies/co1').set({ status: 'deleted' }, { merge: true });
  await assert.rejects(call({ identifier: 'owner', password: 'pass1' }), { code: 'permission-denied' });
});
test('same phone in other company requires that account own password', async () => {
  const { db, call } = await setup();
  await db.doc('staffs/s2').set({ phone: '01011112222', pw: 'other', companyId: 'co2', name: '직원2' });
  await assert.rejects(call({ identifier: '01011112222', password: 'work1', companyId: 'co2' }), { code: 'permission-denied' });
  const result = await call({ identifier: '01011112222', password: 'work1' });
  assert.equal(result.user.companyId, 'co1');
});
test('multi-company menu includes only accounts passing password validation', async () => {
  const { db, call } = await setup();
  await db.doc('staffs/s2').set({ phone: '01011112222', pw: 'work1', companyId: 'co2', name: '직원2' });
  const result = await call({ identifier: '01011112222', password: 'work1' });
  assert.deepEqual(result.companies.map(c => c.companyId), ['co1', 'co2']);
  assert.equal(result.token, undefined);
});
test('restore checks live account version, membership and disabled state', async () => {
  const { db, call, tokens } = await setup();
  await call({ identifier: 'owner', password: 'pass1' });
  const auth = { token: tokens[0].claims };
  assert.equal((await call({ action: 'restore' }, auth)).user.companyId, 'co1');
  await db.doc('admins/a1').set({ companyId: 'co2' }, { merge: true });
  await assert.rejects(call({ action: 'restore' }, auth), { code: 'unauthenticated' });
});
test('first password is default denied and cannot overwrite existing password', async () => {
  const { db, call } = await setup();
  await db.doc('staffs/s1').set({ pw: '' }, { merge: true });
  assert.equal((await call({ action: 'check', identifier: '01011112222' })).needsSetup, true);
  await assert.rejects(call({ action: 'setup', identifier: '01011112222', password: 'new1' }), { code: 'failed-precondition' });
  await db.doc('appAuthConfig/policy').set({ allowPhoneFirstSetup: true });
  assert.equal((await call({ action: 'setup', identifier: '01011112222', password: 'new1' })).user.uid, 's1');
  await assert.rejects(call({ action: 'setup', identifier: '01011112222', password: 'new2' }), { code: 'failed-precondition' });
});
test('server registration is scoped and duplicate usernames are rejected', async () => {
  const { call } = await setup();
  const result = await call({ action: 'register', identifier: 'newadmin', password: 'pass1' });
  assert.equal(result.user.role, '최고관리자');
  assert.equal(result.master, false);
  await assert.rejects(call({ action: 'register', identifier: 'newadmin', password: 'pass1' }), { code: 'already-exists' });
});
test('rate limiter bounds repeated credential requests without storing password', async () => {
  const { db, call } = await setup();
  for (let i = 0; i < 20; i++) await call({ action: 'check', identifier: 'owner' }, null, 'same-ip');
  await assert.rejects(call({ action: 'check', identifier: 'owner' }, null, 'same-ip'), { code: 'resource-exhausted' });
  const values = [...db._store.entries()].filter(([p]) => p.startsWith('appAuthAttempts/'));
  assert.equal(values.length, 1);
  assert.deepEqual(Object.keys(values[0][1]).sort(), ['count', 'windowStart']);
});
test('company switching never grants a differently protected same-phone account', async () => {
  const { db, call, tokens } = await setup();
  await call({ identifier: '01011112222', password: 'work1' });
  const auth = { token: tokens[0].claims };
  await db.doc('staffs/s2').set({ phone: '01011112222', pw: 'other', companyId: 'co2' });
  assert.deepEqual((await call({ action: 'companies' }, auth)).companies.map(c => c.companyId), ['co1']);
  await assert.rejects(call({ action: 'switch', companyId: 'co2' }, auth), { code: 'permission-denied' });
});
test('public staff profile never carries credential or notification-token fields', () => {
  assert.deepEqual(publicProfile({ name: '직원', pw: 'secret', passwordHash: 'hash', authVersion: 'version', fcmTokens: ['token'], memberships: [{ team: 'A', role: '팀원' }] }), { name: '직원', memberships: [{ team: 'A', role: '팀원' }] });
});
test('widget projection enforces private calendar, team, assigned regular work and deletion', () => {
  const principal = { kind: 'staff', user: { uid: 's1', memberships: [{ team: 'A', role: '팀원' }] } };
  const cals = [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'p', personal: true, ownerId: 's2' }];
  const can = event => canViewWidgetEvent(event, principal, cals, [{ id: 'assignment1', employeeId: 's1' }]);
  assert.equal(can({ calId: 'a' }), true);
  assert.equal(can({ calId: 'b' }), false);
  assert.equal(can({ calId: 'p' }), false);
  assert.equal(can({ calId: 'a', status: 'deleted' }), false);
  assert.equal(can({ calId: 'regular', source: 'regular', assignmentId: 'assignment1' }), true);
});
test('staff profile fields cannot promote credential kind or redirect trusted company', async () => {
  const { db, call, tokens } = await setup();
  await db.doc('companies/co1/users/s1').set({ companyId: 'co2', role: '최고관리자' }, { merge: true });
  const login = await call({ identifier: '01011112222', password: 'work1' });
  assert.equal(tokens[0].claims.cmk, 'staff');
  assert.equal(tokens[0].claims.cmMaster, false);
  const restored = await call({ action: 'restore' }, { token: tokens[0].claims });
  assert.equal(restored.user.companyId, 'co1');
  assert.notEqual(restored.user.role, '최고관리자');
  assert.notEqual(login.user.role, '최고관리자');
});
test('staff calendar projection never exposes another personal or regular-cleaning bearer feed', () => {
  const principal = { kind: 'staff', user: { uid: 's1', memberships: [{ team: 'A', role: '팀원' }] } };
  const cal = { id: 'a', label: 'A', name: 'A', color: '#123', checked: true, isField: true, feedToken: 'team-secret', icsSubscriptionUrl: 'external-secret', arbitrarySecret: 'do-not-send' };
  assert.deepEqual(projectCalendar(cal, principal), { id: 'a', label: 'A', name: 'A', color: '#123', checked: true, isField: true, feedToken: 'team-secret' });
  assert.equal(projectCalendar({ ...cal, id: 'b', label: 'B' }, principal).feedToken, undefined);
  assert.equal(projectCalendar({ ...cal, id: 'regular_cleaning', label: 'A' }, principal).feedToken, undefined);
  assert.equal(projectCalendar({ ...cal, personal: true, ownerId: 's2' }, principal), null);
  assert.equal(projectCalendar({ ...cal, personal: true, ownerId: 's1' }, principal).icsSubscriptionUrl, 'external-secret');
  const management = { kind: 'staff', user: { uid: 'm1', memberships: [{ team: '관리팀', role: '팀원' }] } };
  assert.equal(projectCalendar(cal, management).icsSubscriptionUrl, 'external-secret');
  assert.equal(projectCalendar({ ...cal, personal: true, ownerId: 's2' }, management), null);
});
