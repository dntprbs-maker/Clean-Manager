import { createHash } from 'node:crypto';

const DAY_MS = 86400000;
const REPEATS = ['daily', 'weekly', 'monthly', 'yearly'];
export function widgetErrorStatus(code) {
  if (code === 'invalid-argument') return 400;
  if (code === 'permission-denied') return 403;
  if (code === 'unauthenticated' || String(code).startsWith('auth/')) return 401;
  return 503;
}
export class ScopedReadError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
const invalid = message => { throw new ScopedReadError('invalid-argument', message); };

export function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value;
}

export function normalizeReadScope(input = {}) {
  if (input.full !== undefined && typeof input.full !== 'boolean') invalid('전체 조회 여부를 확인해주세요.');
  const full = input.full === true;
  let ranges = [];
  if (!full) {
    const supplied = input.ranges === undefined ? [{ from: input.from, to: input.to }] : input.ranges;
    if (!Array.isArray(supplied) || supplied.length < 1 || supplied.length > 3) invalid('조회 구간은 1개부터 3개까지 지정해주세요.');
    if (supplied.some(range => !range || !validDate(range.from) || !validDate(range.to) || range.from > range.to
      || (Date.parse(range.to) - Date.parse(range.from)) / DAY_MS > 370)) invalid('각 조회 구간은 올바른 날짜로 370일 이내여야 합니다.');
    ranges = [...new Map(supplied.map(range => [`${range.from}:${range.to}`, { from: range.from, to: range.to }])).values()]
      .sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
  }
  if (input.eventIds !== undefined && !Array.isArray(input.eventIds)) invalid('열린 일정을 확인해주세요.');
  const eventIds = input.eventIds || [];
  if (eventIds.length > 2000) throw new ScopedReadError('resource-exhausted', '열린 일정 범위가 너무 큽니다.');
  if (eventIds.some(id => typeof id !== 'string' || !id || id.includes('/') || id === '.' || id === '..' || Buffer.byteLength(id, 'utf8') > 1500)) invalid('열린 일정 ID를 확인해주세요.');
  return { full, from: full ? null : ranges[0].from, to: full ? null : ranges.reduce((max, range) => range.to > max ? range.to : max, ranges[0].to),
    ranges, eventIds: [...new Set(eventIds)].sort() };
}

export function readScopeKey(scope, principal) {
  const user = principal.user;
  const key = {
    version: 1, scope, companyId: user.companyId, userId: user.uid,
    kind: principal.kind, master: !!principal.master, credentialVersion: principal.claims?.cmv || null,
    role: user.role || null, team: user.team || null,
    memberships: [...(user.memberships || [])].map(m => ({ team: m.team, role: m.role }))
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  };
  return `v1:${createHash('sha256').update(JSON.stringify(key)).digest('hex')}`;
}

/** Call only AFTER live principal verification. An absent/invalid head is not 0. */
export async function prepareScopedRead(db, companyId, input, principal) {
  const scope = normalizeReadScope(input);
  const scopeKey = readScopeKey(scope, principal);
  const head = await db.doc(`companies/${companyId}/meta/readRevision`).get();
  const value = head.exists ? head.data()?.revision : undefined;
  const revision = Number.isSafeInteger(value) && value >= 0 ? value : null;
  return {
    scope, scopeKey, revision,
    notModified: revision !== null && Number.isSafeInteger(input.knownRevision)
      && input.knownRevision === revision && input.scopeKey === scopeKey,
  };
}

function latest(left, right) {
  const time = d => d.updateTime?.toMillis?.() ?? d.updateTime?.toDate?.().getTime() ?? 0;
  return time(right) >= time(left) ? right : left;
}
const chunks = (items, size) => Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));

/** Snapshot union, intentionally unbounded for recurrence sources (moved exceptions). */
export async function loadScopedEventSnapshots(db, companyId, scope) {
  const root = `companies/${companyId}/events`;
  const col = db.collection(root);
  if (scope.full) return col.get();
  const snapshots = await Promise.all([
    ...scope.ranges.flatMap(range => [
      col.where('start', '>=', range.from).where('start', '<=', range.to).get(),
      col.where('end', '>=', range.from).where('start', '<=', range.to).get(),
    ]),
    col.where('repeat', 'in', REPEATS).get(),
  ]);
  const byId = new Map();
  const include = d => {
    if (!d.exists) return;
    byId.set(d.id, byId.has(d.id) ? latest(byId.get(d.id), d) : d);
  };
  for (const snapshot of snapshots) snapshot.docs.forEach(include);
  // Pins do not force a company-wide query. Existing union members need no reread.
  const missing = scope.eventIds.filter(id => !byId.has(id));
  await Promise.all(chunks(missing, 100).map(async ids => {
    const docs = await db.getAll(...ids.map(id => db.doc(`${root}/${id}`)));
    docs.forEach(include);
  }));
  const docs = [...byId.values()];
  return { docs, size: docs.length, empty: docs.length === 0 };
}

export async function loadScopedReportSnapshots(db, companyId, eventIds, { full = false } = {}) {
  const col = db.collection(`companies/${companyId}/reports`);
  if (full) return col.get();
  const ids = [...new Set(eventIds)];
  // Firestore in queries permit 30 equality alternatives. No selected source
  // means no report query; this must never fall back to the entire collection.
  // This is a relationship scope, NOT a per-period/per-series read bound:
  // existing UI status/resume semantics match eventId without a date. Keep
  // historical and missing-date reports until those consumers are separated.
  const snapshots = await Promise.all(chunks(ids, 30).map(group => col.where('eventId', 'in', group).get()));
  const byId = new Map();
  for (const snap of snapshots) for (const d of snap.docs) byId.set(d.id, byId.has(d.id) ? latest(byId.get(d.id), d) : d);
  const docs = [...byId.values()];
  return { docs, size: docs.length, empty: docs.length === 0 };
}
