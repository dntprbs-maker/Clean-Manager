import assert from 'node:assert/strict';
import test from 'node:test';
import { handleSharedSchedule } from '../lib/sharedSchedule.js';
import { createFakeDb } from './helpers/fakeFirestore.js';

const owner = { kind: 'admin', user: { uid: 'owner', companyId: 'host' } };
const guest = { kind: 'staff', user: { uid: 'guest', companyId: 'other' } };
const outsider = { kind: 'staff', user: { uid: 'outsider', companyId: 'other' } };
const invite = { action: 'invite', eventId: 'one', phone: '010-1234-5678' };

async function fixture() {
  const db = createFakeDb();
  await db.doc('companies/host').set({ name: '시험 업체' });
  await db.doc('companies/host/events/one').set({ title: '공유 일정', start: '2026-11-10', finance: { amount: 10 }, calId: 'private' });
  await db.doc('companies/host/events/two').set({ title: '비공개 일정' });
  await db.doc('staffs/guest').set({ phone: '01012345678', pw: 'synthetic', companyId: 'other' });
  return db;
}

test('타사 직원 계정에 선택 일정만 공유하며 초대 제거 후 조회에서 즉시 빠진다', async () => {
  const db = await fixture();
  const read = principal => handleSharedSchedule(db, principal, { action: 'received' });
  await handleSharedSchedule(db, owner, invite);
  await handleSharedSchedule(db, owner, invite);
  const { events } = await read(guest);
  assert.equal(events.length, 1);
  assert.equal(events[0].title, '공유 일정');
  assert.equal('finance' in events[0], false);
  assert.equal('calId' in events[0], false);
  assert.deepEqual((await read(outsider)).events, []);
  const { invites } = await handleSharedSchedule(db, owner, { action: 'sent', eventId: 'one' });
  assert.equal(invites[0].phoneTail, '5678');
  const removal = { action: 'remove', eventId: 'one', grantId: invites[0].id };
  await assert.rejects(handleSharedSchedule(db, { ...owner, user: { ...owner.user, companyId: 'other' } }, removal), { code: 'not-found' });
  await handleSharedSchedule(db, owner, removal);
  assert.deepEqual((await read(guest)).events, []);
  assert.equal((await db.doc('companies/host/events/one').get()).exists, true);
});

test('비회원·중복 번호·반복 일정·관리자 아닌 초대 요청을 차단한다', async () => {
  const db = await fixture();
  await assert.rejects(handleSharedSchedule(db, guest, invite), { code: 'permission-denied' });
  await assert.rejects(handleSharedSchedule(db, owner, { ...invite, phone: '01099999999' }), { code: 'failed-precondition' });
  await db.doc('companies/host/events/two').set({ title: '반복', repeat: 'weekly' });
  await assert.rejects(handleSharedSchedule(db, owner, { ...invite, eventId: 'two' }), { code: 'failed-precondition' });
  await db.doc('staffs/outsider').set({ phone: '010-1234-5678', pw: 'synthetic' });
  await assert.rejects(handleSharedSchedule(db, owner, invite), { code: 'failed-precondition' });
});
