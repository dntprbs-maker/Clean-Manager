import { test } from 'node:test';
import assert from 'node:assert/strict';
import { widgetRelevantChange, buildWidgetMessage, queueWidgetChange } from '../lib/widgetPush.js';

// 트랜잭션·문서 조회만 흉내 낸 최소 가짜 db. queueWidgetChange 가 db.doc / db.runTransaction
// 만 쓰기 때문에 이 정도면 충분하다.
function makeDb() {
  const store = new Map();
  return {
    store,
    seed(path, value) { store.set(path, { ...value }); },
    doc: (path) => ({ path }),
    async runTransaction(fn) {
      const tx = {
        async get(ref) {
          const v = store.get(ref.path);
          return { exists: v !== undefined, data: () => (v === undefined ? undefined : { ...v }) };
        },
        set(ref, value) { store.set(ref.path, { ...value }); },
      };
      return fn(tx);
    },
  };
}

function makeMessaging() {
  const sent = [];
  return {
    sent,
    async send(msg) { sent.push(msg); return `projects/x/messages/${sent.length}`; },
  };
}

const tick = () => new Promise((r) => setTimeout(r, 0));
const noSleep = () => Promise.resolve();

test('widgetRelevantChange: 생성·삭제는 true, 둘 다 없으면 false', () => {
  assert.equal(widgetRelevantChange(null, { title: 'a' }), true);
  assert.equal(widgetRelevantChange({ title: 'a' }, null), true);
  assert.equal(widgetRelevantChange(undefined, undefined), false);
  assert.equal(widgetRelevantChange(null, null), false);
});

test('widgetRelevantChange: 위젯에 보이는 필드가 바뀔 때만 true', () => {
  const base = {
    title: '청소', start: '2026-10-30', end: '2026-10-30', startTime: '09:00',
    endTime: '10:00', allDay: false, place: '', calId: 'c1', status: 'active',
  };
  assert.equal(widgetRelevantChange(base, { ...base, title: '청소2' }), true);
  assert.equal(widgetRelevantChange(base, { ...base, start: '2026-10-31' }), true);
  assert.equal(widgetRelevantChange(base, { ...base, status: 'deleted' }), true);
  assert.equal(widgetRelevantChange(base, { ...base, description: '메모만 변경' }), false);
  assert.equal(widgetRelevantChange(base, { ...base }), false);
});

test('buildWidgetMessage: 토픽·데이터가 모두 문자열이고 중복은 제거된다', () => {
  const msg = buildWidgetMessage('c_x', ['e1', 'e1', 'e2'], false);
  assert.equal(msg.topic, 'widget_c_x');
  assert.equal(msg.data.type, 'widget_changed');
  assert.equal(msg.data.company, 'c_x');
  assert.equal(msg.data.ids, 'e1,e2');
  assert.equal(msg.data.cals, '0');
  assert.equal(msg.android.priority, 'high');
  for (const v of Object.values(msg.data)) assert.equal(typeof v, 'string');
});

test('buildWidgetMessage: 고유 id 가 20개를 넘으면 ALL', () => {
  const twenty = Array.from({ length: 20 }, (_, i) => `e${i}`);
  const twentyOne = [...twenty, 'e20'];
  assert.equal(buildWidgetMessage('c_x', twentyOne, true).data.ids, 'ALL');
  assert.equal(buildWidgetMessage('c_x', twenty, true).data.ids, twenty.join(','));
  assert.equal(buildWidgetMessage('c_x', twenty, true).data.cals, '1');
});

test('queueWidgetChange: 첫 호출만 발송 담당, 대기 중 두 번째는 큐에만 합쳐진다', async () => {
  const db = makeDb();
  const messaging = makeMessaging();
  const resolvers = [];
  const sleep = () => new Promise((r) => resolvers.push(r));

  const p1 = queueWidgetChange(db, messaging, { companyId: 'c_x', eventId: 'e1' }, { sleep, now: () => 1000 });
  await tick();
  assert.equal(resolvers.length, 1, '첫 호출이 sleep 에 도달해야 한다');

  const r2 = await queueWidgetChange(db, messaging, { companyId: 'c_x', eventId: 'e2' }, { sleep, now: () => 1000 });
  assert.equal(r2.sender, false);
  assert.equal(messaging.sent.length, 0);

  resolvers[0]();
  const r1 = await p1;
  assert.equal(r1.sender, true);
  assert.equal(messaging.sent.length, 1);
  assert.equal(r1.sent.data.ids, 'e1,e2');
  assert.equal(db.store.get('widgetPush/c_x').pending, false);
});

test('queueWidgetChange: pending 이 stale 이면 새 호출이 발송 담당이 된다', async () => {
  const db = makeDb();
  const messaging = makeMessaging();
  db.seed('widgetPush/c_y', { pending: true, startedAt: 0, ids: [], cals: false });

  const r = await queueWidgetChange(db, messaging, { companyId: 'c_y', eventId: 'e9' },
    { sleep: noSleep, now: () => 1_000_000 });
  assert.equal(r.sender, true);
  assert.equal(messaging.sent.length, 1);
  assert.equal(r.sent.data.ids, 'e9');
  assert.equal(db.store.get('widgetPush/c_y').pending, false);
});

test('queueWidgetChange: 캘린더 변경(calsChanged)도 한 번 발송한다', async () => {
  const db = makeDb();
  const messaging = makeMessaging();
  const r = await queueWidgetChange(db, messaging, { companyId: 'c_z', calsChanged: true },
    { sleep: noSleep, now: () => 1 });
  assert.equal(r.sender, true);
  assert.equal(messaging.sent.length, 1);
  assert.equal(r.sent.data.cals, '1');
  assert.equal(r.sent.data.ids, '');
});

test('queueWidgetChange: 회사별로 문서와 토픽이 분리된다', async () => {
  const db = makeDb();
  const messaging = makeMessaging();
  const a = await queueWidgetChange(db, messaging, { companyId: 'c_a', eventId: 'e1' }, { sleep: noSleep, now: () => 1 });
  const b = await queueWidgetChange(db, messaging, { companyId: 'c_b', eventId: 'e2' }, { sleep: noSleep, now: () => 1 });
  assert.equal(a.sent.topic, 'widget_c_a');
  assert.equal(b.sent.topic, 'widget_c_b');
  assert.equal(db.store.get('widgetPush/c_a').pending, false);
  assert.equal(db.store.get('widgetPush/c_b').pending, false);
  assert.equal(db.store.get('widgetPush/c_a').ids.length, 0);
});
