import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeReadScope, readScopeKey, prepareScopedRead, loadScopedEventSnapshots, loadScopedReportSnapshots, widgetErrorStatus } from '../lib/appScopedReads.js';

test('widget storage failure is retryable and never expires a valid session', () => {
  for (const code of [9, 14, 'unavailable', 'failed-precondition', undefined]) assert.equal(widgetErrorStatus(code),503);
  for (const code of ['unauthenticated','auth/id-token-expired','auth/id-token-revoked']) assert.equal(widgetErrorStatus(code),401);
  assert.equal(widgetErrorStatus('permission-denied'),403);
  assert.equal(widgetErrorStatus('invalid-argument'),400);
});

function querySpy(initial = {}) {
  const documents = new Map(Object.entries(initial));
  const calls = [];
  const snapshot = path => ({ id: path.split('/').at(-1), exists: documents.has(path), data: () => documents.get(path), updateTime: { toMillis: () => 1 } });
  const doc = path => ({ path, get: async () => { calls.push({ type: 'get', path, count: 1 }); return snapshot(path); } });
  const col = (path, filters = []) => ({
    where(field, op, value) { return col(path, [...filters, { field, op, value }]); },
    async get() {
      const docs = [...documents.keys()].filter(p => p.slice(0, p.lastIndexOf('/')) === path).map(snapshot).filter(d => filters.every(({ field, op, value }) => {
        const actual = d.data()[field];
        if (actual === undefined) return false;
        return op === '>=' ? actual >= value : op === '<=' ? actual <= value : op === 'in' ? value.includes(actual) : op === '==' ? actual === value : assert.fail('unexpected query operator');
      }));
      calls.push({ type: 'query', path, filters, count: docs.length, ids: docs.map(d => d.id) });
      return { docs, size: docs.length, empty: docs.length === 0 };
    },
  });
  return {
    calls, documents, collection: path => col(path), doc,
    getAll: async (...refs) => { calls.push({ type: 'getAll', paths: refs.map(r => r.path), count: refs.length }); return refs.map(ref => snapshot(ref.path)); },
  };
}
const root = 'companies/co1';
const principal = { user: { companyId: 'co1', uid: 'staff1', role: '팀원', memberships: [{ team: 'A', role: '팀원' }] }, kind: 'staff', claims: { cmv: 'session1' } };
const request = { from: '2026-11-05', to: '2026-11-06' };

test('normal range unions starts, overlapping ends and all recurrence sources without a collection-wide read', async () => {
  const initial = {
    [`${root}/events/noEnd`]: { start: '2026-11-05' },
    [`${root}/events/long`]: { start: '2020-01-01', end: '2026-11-06' },
    [`${root}/events/oldRepeat`]: { start: '2000-01-01', repeat: 'weekly' },
    [`${root}/events/movedFromFuture`]: { start: '2040-01-01', repeat: 'daily', repeatUntil: '2041-01-01', exceptions: { '2040-01-01': { start: '2026-11-05', end: '2026-11-05' } } },
    [`${root}/events/duplicate`]: { start: '2026-11-05', end: '2026-11-05', repeat: 'daily' },
  };
  for (let i = 0; i < 1000; i++) initial[`${root}/events/irrelevant${i}`] = { start: '2000-01-01', end: '2000-01-01' };
  const db = querySpy(initial);
  const result = await loadScopedEventSnapshots(db, 'co1', normalizeReadScope(request));
  assert.deepEqual(result.docs.map(d => d.id).sort(), ['duplicate', 'long', 'movedFromFuture', 'noEnd', 'oldRepeat']);
  assert.equal(db.calls.length, 3);
  assert.ok(db.calls.every(c => c.type === 'query' && c.filters.length > 0));
  assert.equal(db.calls.reduce((n, c) => n + c.count, 0), 7, 'only matching candidate documents read, including expected union duplicates');
  assert.ok(db.calls.every(c => c.ids.every(id => !id.startsWith('irrelevant'))));
});

test('pinned IDs use direct batch reads and duplicate pins neither duplicate rows nor reread union documents', async () => {
  const db = querySpy({ [`${root}/events/current`]: { start: '2026-11-05' }, [`${root}/events/pin`]: { start: '2030-01-01' } });
  const scope = normalizeReadScope({ ...request, eventIds: ['pin', 'current', 'pin', 'missing'] });
  const result = await loadScopedEventSnapshots(db, 'co1', scope);
  assert.deepEqual(result.docs.map(d => d.id).sort(), ['current', 'pin']);
  assert.deepEqual(db.calls.find(c => c.type === 'getAll').paths, [`${root}/events/missing`, `${root}/events/pin`]);
  assert.equal(db.calls.length, 4);
});

test('reports read only selected event IDs in groups of at most 30; empty selection reads zero reports', async () => {
  const initial = {};
  for (let i = 0; i < 1000; i++) initial[`${root}/reports/r${i}`] = { eventId: `e${i}` };
  const db = querySpy(initial);
  const ids = Array.from({ length: 61 }, (_, i) => `e${i}`);
  const result = await loadScopedReportSnapshots(db, 'co1', [...ids, 'e0']);
  assert.equal(result.size, 61);
  assert.equal(db.calls.length, 3);
  assert.ok(db.calls.every(c => c.filters[0].field === 'eventId' && c.filters[0].op === 'in' && c.filters[0].value.length <= 30));
  assert.equal(db.calls.reduce((n, c) => n + c.count, 0), 61);
  db.calls.length = 0;
  assert.equal((await loadScopedReportSnapshots(db, 'co1', [])).size, 0);
  assert.equal(db.calls.length, 0);
});

test('selected recurring-series reports retain historical and missing-date records; relationship scope has no per-series cap', async () => {
  const initial = { [`${root}/reports/undated`]: { eventId: 'series', status: '진행중' } };
  for (let i = 0; i < 1000; i++) initial[`${root}/reports/history${i}`] = { eventId: 'series', date: '2000-01-01', status: '완료' };
  initial[`${root}/reports/unrelated`] = { eventId: 'other', date: '2026-11-05' };
  const db = querySpy(initial);
  const result = await loadScopedReportSnapshots(db, 'co1', ['series']);
  assert.equal(result.size, 1001, 'all selected-series history is intentionally preserved for current eventId-only consumers');
  assert.ok(result.docs.some(d => d.id === 'undated'));
  assert.equal(db.calls.length, 1);
  assert.equal(db.calls[0].count, 1001, 'related-report count, not visible calendar dates, remains the billing bound');
  assert.equal(result.docs.some(d => d.id === 'unrelated'), false);
});

test('explicit full mode retains whole-source compatibility and is never inferred from absent dates', async () => {
  const db = querySpy({ [`${root}/events/e`]: { start: '1900-01-01' }, [`${root}/reports/r`]: { eventId: 'e' } });
  assert.equal((await loadScopedEventSnapshots(db, 'co1', normalizeReadScope({ full: true }))).size, 1);
  assert.equal((await loadScopedReportSnapshots(db, 'co1', [], { full: true })).size, 1);
  assert.equal(db.calls.length, 2);
  assert.ok(db.calls.every(c => c.filters.length === 0));
  assert.throws(() => normalizeReadScope({}), { code: 'invalid-argument' });
});

test('unchanged head and server-issued scope key perform exactly one head read and no collection reads', async () => {
  const db = querySpy({ [`${root}/meta/readRevision`]: { revision: 12 } });
  const first = await prepareScopedRead(db, 'co1', request, principal);
  assert.equal(first.notModified, false);
  db.calls.length = 0;
  const next = await prepareScopedRead(db, 'co1', { ...request, knownRevision: 12, scopeKey: first.scopeKey }, principal);
  assert.equal(next.notModified, true);
  assert.deepEqual(db.calls, [{ type: 'get', path: `${root}/meta/readRevision`, count: 1 }]);
});

test('scope or live principal changes invalidate a matching numeric revision; absent or invalid heads never cache', async () => {
  const db = querySpy({ [`${root}/meta/readRevision`]: { revision: 12 } });
  const scopeKey = readScopeKey(normalizeReadScope(request), principal);
  const known = { ...request, knownRevision: 12, scopeKey };
  assert.equal((await prepareScopedRead(db, 'co1', { ...known, to: '2026-11-07' }, principal)).notModified, false);
  assert.equal((await prepareScopedRead(db, 'co1', { ...known, eventIds: ['new-pin'] }, principal)).notModified, false);
  assert.equal((await prepareScopedRead(db, 'co1', known, { ...principal, user: { ...principal.user, memberships: [] } })).notModified, false);
  assert.equal((await prepareScopedRead(db, 'co1', known, { ...principal, claims: { cmv: 'new-session' } })).notModified, false);
  assert.equal((await prepareScopedRead(db, 'co1', { ...known, knownRevision: 11 }, principal)).notModified, false);
  db.documents.delete(`${root}/meta/readRevision`);
  const absent = await prepareScopedRead(db, 'co1', { ...known, knownRevision: 0 }, principal);
  assert.equal(absent.revision, null);
  assert.equal(absent.notModified, false);
  db.documents.set(`${root}/meta/readRevision`, { revision: '12' });
  assert.equal((await prepareScopedRead(db, 'co1', known, principal)).notModified, false);
});

test('calendar dates, maximum range, pins and canonical pin ordering are validated without silent truncation', () => {
  assert.throws(() => normalizeReadScope({ from: '2026-02-30', to: '2026-03-01' }), { code: 'invalid-argument' });
  assert.throws(() => normalizeReadScope({ from: '2026-01-01', to: '2027-01-08' }), { code: 'invalid-argument' });
  assert.throws(() => normalizeReadScope({ ...request, eventIds: ['a/b'] }), { code: 'invalid-argument' });
  assert.throws(() => normalizeReadScope({ ...request, eventIds: ['가'.repeat(501)] }), { code: 'invalid-argument' });
  assert.throws(() => normalizeReadScope({ ...request, eventIds: Array(2001).fill('pin') }), { code: 'resource-exhausted' });
  assert.throws(() => normalizeReadScope({ ...request, full: 'true' }), { code: 'invalid-argument' });
  assert.equal(readScopeKey(normalizeReadScope({ ...request, eventIds: ['b', 'a', 'b'] }), principal), readScopeKey(normalizeReadScope({ ...request, eventIds: ['a', 'b'] }), principal));
});

test('distant displayed month and selected day use separate bounded windows without reading intervening years', async () => {
  const ranges = [{ from: '2000-02-01', to: '2000-02-29' }, { from: '2026-11-05', to: '2026-11-05' }];
  const scope = normalizeReadScope({ from: '2000-02-01', to: '2026-11-05', ranges });
  assert.equal(scope.ranges.length, 2);
  const initial = {
    [`${root}/events/pastMonth`]: { start: '2000-02-14' },
    [`${root}/events/selectedToday`]: { start: '2026-11-05' },
    [`${root}/events/repeat`]: { start: '1999-01-01', repeat: 'monthly' },
  };
  for (let i = 0; i < 1000; i++) initial[`${root}/events/intervening${i}`] = { start: '2010-01-01', end: '2010-01-01' };
  const db = querySpy(initial);
  const result = await loadScopedEventSnapshots(db, 'co1', scope);
  assert.deepEqual(result.docs.map(d => d.id).sort(), ['pastMonth', 'repeat', 'selectedToday']);
  assert.equal(db.calls.length, 5, 'two bounded queries per window and only one recurrence query');
  assert.equal(db.calls.reduce((sum, call) => sum + call.count, 0), 3);
  assert.ok(db.calls.every(call => call.ids.every(id => !id.startsWith('intervening'))));
  assert.equal(readScopeKey(scope, principal), readScopeKey(normalizeReadScope({ ranges: [...ranges].reverse() }), principal));
  assert.throws(() => normalizeReadScope({ ranges: Array(4).fill(ranges[0]) }), { code: 'invalid-argument' });
  assert.throws(() => normalizeReadScope({ ranges: [{ from: '2000-01-01', to: '2026-01-01' }] }), { code: 'invalid-argument' });
});
