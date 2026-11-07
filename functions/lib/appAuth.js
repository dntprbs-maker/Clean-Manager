import { onCall, onRequest, HttpsError } from 'firebase-functions/v2/https';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { randomUUID } from 'node:crypto';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getApps, initializeApp } from 'firebase-admin/app';
import { createAppAuthService, AppAuthError, verifyAppPrincipal, publicProfile, canViewWidgetEvent, projectCalendar } from './appAuthCore.js';
import { recordAppReadChange, readAppChanges, getSourceIds } from './appReadChanges.js';
import { expandRecurring } from './appRecurrence.js';
import { handleSharedSchedule } from './sharedSchedule.js';
import { getMemberships, isAdminStaff, isLeaderOf } from './membership.js';
import { prepareScopedRead, readScopeKey, normalizeReadScope, loadScopedEventSnapshots, loadScopedReportSnapshots, ScopedReadError, widgetErrorStatus, widgetEvent, projectWidgetRange, mayReadFullReportLedger } from './appScopedReads.js';

if (!getApps().length) initializeApp();
const service = createAppAuthService({ db: getFirestore(), issueToken: (uid, claims) => getAuth().createCustomToken(uid, claims) });
export const verifyLiveAppSession = async (request, options) => {
  if (!request.auth) throw new HttpsError('unauthenticated', '로그인이 필요합니다.');
  try { return await verifyAppPrincipal(getFirestore(), request.auth.token, options); }
  catch (e) { throw new HttpsError(e.code || 'unauthenticated', e.message); }
};
export const appAuth = onCall({ region: 'asia-northeast3', maxInstances: 5 }, async request => {
  try { return await service(request.data, request.auth, request.rawRequest.ip); }
  catch (e) {
    if (e instanceof AppAuthError) throw new HttpsError(e.code, e.message);
    // Do not log request credentials or raw account documents.
    console.error('[appAuth] request failed', e.code || e.name);
    throw new HttpsError('internal', '로그인 처리 중 문제가 발생했습니다. 다시 시도해주세요.');
  }
});

export const appSharedSchedule = onCall({ region: 'asia-northeast3', maxInstances: 5 }, async request => {
  const principal = await verifyLiveAppSession(request, { allowIndependent: true });
  try { return await handleSharedSchedule(getFirestore(), principal, request.data); }
  catch (e) {
    if (e instanceof AppAuthError) throw new HttpsError(e.code, e.message);
    throw e;
  }
});

export const appProfileChanged = onDocumentWritten({ region: 'asia-northeast3', document: 'companies/{companyId}/users/{userId}', retry: true }, async event => {
  const db = getFirestore();
  await db.runTransaction(async tx => {
    const source = await tx.get(db.doc(`companies/${event.params.companyId}/users/${event.params.userId}`));
    tx.set(db.doc(`companies/${event.params.companyId}/profiles/${event.params.userId}`), source.exists ? publicProfile(source.data()) : { status: 'deleted' });
  });
});

const rotateVersion = collection => onDocumentWritten({ region: 'asia-northeast3', document: `${collection}/{accountId}`, retry: true }, async event => {
  const before = event.data?.before.data();
  const after = event.data?.after.data();
  if (!after || before?.pw === after.pw || !before || before.authVersion !== after.authVersion) return;
  // Only rotate when this delivery still describes the current password.
  await getFirestore().runTransaction(async tx => {
    const ref = getFirestore().doc(`${collection}/${event.params.accountId}`);
    const live = (await tx.get(ref)).data();
    if (live && live.pw === after.pw && live.authVersion === after.authVersion) tx.set(ref, { authVersion: randomUUID() }, { merge: true });
  });
});
export const appAdminCredentialChanged = rotateVersion('admins');
export const appStaffCredentialChanged = rotateVersion('staffs');

const invalidateRead = collection => onDocumentWritten({ region: 'asia-northeast3', document: `companies/{companyId}/${collection}/{id}`, retry: true }, event => recordAppReadChange(getFirestore(), event, collection));
export const appReadEventChanged = invalidateRead('events');
export const appReadReportChanged = invalidateRead('reports');
export const appReadCalendarChanged = invalidateRead('cals');
export const appReadAssignmentChanged = invalidateRead('assignments');
export const appReadUserChanged = invalidateRead('users');

export const appReadData = onCall({ region: 'asia-northeast3', maxInstances: 5 }, async request => {
  const principal = await verifyLiveAppSession(request);
  const db = getFirestore();
  let prepared;
  try { prepared = await prepareScopedRead(db, principal.user.companyId, request.data || {}, principal); }
  catch (e) { if (e instanceof ScopedReadError) throw new HttpsError(e.code, e.message); throw e; }
  const { scope: input, scopeKey, revision } = prepared;
  if (prepared.notModified) return { notModified: true, revision, scopeKey, serverAt: new Date().toISOString() };
  const delta = await readAppChanges(db, principal.user.companyId, request.data || {}, prepared);
  const ids = new Set(input.eventIds);
  const root = `companies/${principal.user.companyId}`;
  const [cals, assignments, source] = await Promise.all([
    db.collection(`${root}/cals`).get(), db.collection(`${root}/assignments`).get(),
    delta ? getSourceIds(db, principal.user.companyId, 'events', delta.sourceIds) : loadScopedEventSnapshots(db, principal.user.companyId, input),
  ]);
  const calRows = cals.docs.map(d => ({ ...d.data(), id: d.id }));
  const assignmentRows = assignments.docs.map(d => ({ ...d.data(), id: d.id }));
  const raw = source.docs.map(d => ({ ...d.data(), id: d.id, __readVersion: d.updateTime.toDate().toISOString() }));
  const mayRead = event => canViewWidgetEvent(event, principal, calRows, assignmentRows);
  const allowed = [];
  const instances = [];
  for (const event of raw) {
    if (event.status === 'deleted') continue;
    if (mayRead(event)) {
      const exceptions = Object.fromEntries(Object.entries(event.exceptions || {}).map(([date, exception]) => [date,
        !exception ? exception : exception._deleted ? { _deleted: true } : mayRead({ ...event, ...exception }) ? exception : { _deleted: true }]));
      allowed.push({ ...event, ...(event.exceptions ? { exceptions } : {}) });
    } else if (event.repeat && event.repeat !== 'none') {
      for (const [date, exception] of Object.entries(event.exceptions || {})) {
        if (!exception || exception._deleted || !mayRead({ ...event, ...exception })) continue;
        const start = exception.start || date;
        const end = exception.end || start;
        const occurrence = expandRecurring([event], { start, end }).find(e => e._origDate === date);
        if (occurrence && (input.full || ids.has(event.id) || input.ranges.some(range => occurrence.start <= range.to && (occurrence.end || occurrence.start) >= range.from))) {
          // An allowed isolated occurrence must not carry the source's other,
          // potentially private exception payloads to the client.
          const { exceptions: _hiddenExceptions, ...visibleOccurrence } = occurrence;
          instances.push({ ...visibleOccurrence, repeat: 'none', __seriesRepeat: event.repeat, __occurrenceOnly: true });
        }
      }
    }
  }
  let selected = allowed;
  if (!input.full) {
    for (const range of input.ranges) for (const e of expandRecurring(allowed, { start: range.from, end: range.to })) ids.add(e.id);
    selected = allowed.filter(e => ids.has(e.id));
  }
  const selectedIds = new Set([...selected, ...instances].map(e => e.id));
  const reports = delta ? { docs: [...new Map((await Promise.all([
    loadScopedReportSnapshots(db, principal.user.companyId, delta.eventIds.filter(id => mayReadFullReportLedger(input,principal) || selectedIds.has(id))),
    getSourceIds(db, principal.user.companyId, 'reports', delta.reportIds),
  ])).flatMap(s => s.docs).map(d => [d.id, d])).values()] }
    : await loadScopedReportSnapshots(db, principal.user.companyId, [...selectedIds], { full: input.full });
  const reportRows = reports.docs.filter(d => {
    if (mayReadFullReportLedger(input, principal)) return true;
    const report = d.data();
    const original = raw.find(e => e.id === report.eventId);
    if (!selectedIds.has(report.eventId) || !original || original.status === 'deleted') return false;
    const exception = Object.entries(original.exceptions || {}).find(([date, value]) => (value?.start || date) === report.date)?.[1];
    return mayRead({ ...original, ...exception });
  }).map(d => ({ ...d.data(), id: d.id, __readVersion: d.updateTime.toDate().toISOString() }));
  const financialView = principal.kind === 'admin' || principal.master || isAdminStaff(principal.user);
  const serialize = event => {
    if (financialView) return event;
    const { finance: _finance, ...safe } = event;
    if (safe.exceptions) safe.exceptions = Object.fromEntries(Object.entries(safe.exceptions).map(([date, exception]) => {
      if (!exception) return [date, exception];
      const { finance: _exceptionFinance, ...fields } = exception;
      return [date, fields];
    }));
    return safe;
  };
  const serverAt = new Date().toISOString();
  const sharedWidget = input.widgetRange ? {
    ...projectWidgetRange(delta ? raw.filter(e=>delta.eventIds.includes(e.id)) : raw, principal, calRows, assignmentRows, input.widgetRange),
    ...(delta ? { replaceEventIds: delta.eventIds } : {}),
    ...(request.data?.deltaVersion === 1 ? {widgetScopeKey:readScopeKey(normalizeReadScope(input.widgetRange),principal)}:{}),
    ...input.widgetRange, companyId: principal.user.companyId,
    userId: request.auth.uid, revision, scopeKey, serverAt,
  } : undefined;
  return { ...(delta ? { delta: { replaceEventIds: delta.sourceIds, replaceReportEventIds: delta.eventIds, replaceReportIds: delta.reportIds } } : {}), ...(sharedWidget ? { sharedWidget } : {}), events: selected.map(serialize), instances: instances.map(serialize), reports: reportRows,
    cals: calRows.map(cal => projectCalendar(cal, principal)).filter(Boolean),
    serverAt, revision, scopeKey };
});

export const appWriteData = onCall({ region: 'asia-northeast3', maxInstances: 5 }, async request => {
  const principal = await verifyLiveAppSession(request);
  const { kind, id, value = {}, merge = false, remove = false, expectedVersion, arrayUnionFields = {} } = request.data || {};
  if (!['events', 'reports'].includes(kind) || (id !== undefined && (typeof id !== 'string' || !id || id.includes('/')))
    || !value || typeof value !== 'object' || Array.isArray(value)) throw new HttpsError('invalid-argument', '저장할 자료를 확인해주세요.');
  const db = getFirestore();
  const root = `companies/${principal.user.companyId}`;
  const ref = db.doc(`${root}/${kind}/${id || randomUUID()}`);
  const [calSnap, assignmentSnap] = await Promise.all([db.collection(`${root}/cals`).get(), db.collection(`${root}/assignments`).get()]);
  const cals = calSnap.docs.map(d => ({ ...d.data(), id: d.id }));
  const assignments = assignmentSnap.docs.map(d => ({ ...d.data(), id: d.id }));
  const withoutUiFields = data => Array.isArray(data) ? data.map(withoutUiFields)
    : data && typeof data === 'object' ? Object.fromEntries(Object.entries(data)
      .filter(([key]) => !key.startsWith('__') && !['_recurring', '_origDate', '_hasException'].includes(key))
      .map(([key, item]) => [key, withoutUiFields(item)])) : data;
  const clean = withoutUiFields(Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'id' && !key.startsWith('_'))));
  const eventKeys = new Set(['title', 'description', 'start', 'end', 'startTime', 'endTime', 'allDay', 'calId', 'place', 'url', 'contact', 'photos', 'exceptions', 'reminderModes', 'leaderComment', 'leaderCommentBy', 'leaderCommentAt', 'finance', 'completed', 'status', 'team', 'source', 'siteId', 'assignmentId', 'createdAt', 'createdBy']);
  const reportKeys = new Set(['eventId', 'title', 'date', 'startTime', 'calId', 'teamName', 'teamColor', 'reporter', 'startMemo', 'memo', 'beforePhotos', 'beforeTotal', 'afterPhotos', 'afterTotal', 'place', 'workStart', 'workEnd', 'status', 'createdAt', 'completedAt', 'price', 'duration', 'updatedAt']);
  if (Object.keys(clean).some(key => kind === 'events'
    ? !eventKeys.has(key) && !key.startsWith('repeat') && !/^exceptions\.\d{4}-\d{2}-\d{2}$/.test(key)
    : !reportKeys.has(key))) throw new HttpsError('invalid-argument', '허용되지 않는 필드입니다.');
  if (Object.keys(arrayUnionFields).some(key => !['beforePhotos', 'afterPhotos'].includes(key)) || (kind !== 'reports' && Object.keys(arrayUnionFields).length)) throw new HttpsError('invalid-argument', '사진 필드를 확인해주세요.');
  for (const photos of Object.values(arrayUnionFields)) if (!Array.isArray(photos) || photos.length > 100 || photos.some(p => !p || typeof p.url !== 'string' || typeof p.name !== 'string')) throw new HttpsError('invalid-argument', '사진 자료를 확인해주세요.');

  const mayRead = e => canViewWidgetEvent(e, principal, cals, assignments);
  const label = e => cals.find(c => c.id === e.calId)?.label;
  const mayEditEvent = e => {
    if (principal.kind === 'admin' || principal.master) return true;
    if (!mayRead(e) || !isAdminStaff(principal.user)) return false;
    const fields = getMemberships(principal.user).map(m => m.team).filter(t => !['관리팀', '영업팀'].includes(t));
    return fields.length === 0 || fields.includes(label(e));
  };
  await db.runTransaction(async tx => {
    const current = await tx.get(ref);
    const old = current.data();
    if (id && !current.exists && (merge || remove || expectedVersion !== undefined)) throw new HttpsError('not-found', '자료가 삭제되었습니다.');
    if (expectedVersion !== undefined && current.updateTime?.toDate().toISOString() !== expectedVersion) throw new HttpsError('aborted', '다른 사용자가 수정했습니다. 새로 확인해주세요.');
    const next = { ...old, ...clean, id: ref.id };
    if (kind === 'events') {
      const commentsOnly = !remove && current.exists && Object.keys(clean).every(key => ['leaderComment', 'leaderCommentBy', 'leaderCommentAt'].includes(key));
      const canComment = commentsOnly && mayRead(old) && isLeaderOf(principal.user, label(old));
      const keys = Object.keys(clean);
      const exceptionsOnly = !remove && current.exists && keys.length > 0 && keys.every(key => /^exceptions\.\d{4}-\d{2}-\d{2}$/.test(key));
      const canEditExceptions = exceptionsOnly && keys.every(key => {
        const date = key.slice('exceptions.'.length);
        const before = { ...old, ...old.exceptions?.[date] };
        const after = { ...old, ...clean[key] };
        return mayEditEvent(before) && (clean[key]?._deleted || mayEditEvent(after));
      });
      if (!canComment && !canEditExceptions && (!mayEditEvent(next) || (old && !mayEditEvent(old)))) throw new HttpsError('permission-denied', '일정을 수정할 권한이 없습니다.');
    } else {
      if (old && clean.eventId !== undefined && old.eventId !== clean.eventId) throw new HttpsError('permission-denied', '연결된 일정은 변경할 수 없습니다.');
      const eventId = old?.eventId || clean.eventId;
      if (typeof eventId !== 'string' || !eventId || eventId.includes('/')) throw new HttpsError('invalid-argument', '연결된 일정을 확인해주세요.');
      const eventSnap = await tx.get(db.doc(`${root}/events/${eventId}`));
      const originalEvent = eventSnap.data();
      const effectiveEvent = date => {
        const exception = Object.entries(originalEvent?.exceptions || {}).find(([original, value]) => (value?.start || original) === date)?.[1];
        return { ...originalEvent, ...exception };
      };
      const event = effectiveEvent(next.date);
      if (!originalEvent || originalEvent.status === 'deleted' || !mayRead(event) || (old && !mayRead(effectiveEvent(old.date)))
        || !(principal.kind === 'admin' || principal.master || isAdminStaff(principal.user) || isLeaderOf(principal.user, label(event)))) throw new HttpsError('permission-denied', '보고서를 수정할 권한이 없습니다.');
      if (remove && principal.kind !== 'admin' && !principal.master) throw new HttpsError('permission-denied', '보고서를 삭제할 권한이 없습니다.');
    }
    if (remove) { tx.delete(ref); return; }
    const patch = { ...clean };
    for (const [field, photos] of Object.entries(arrayUnionFields)) patch[field] = FieldValue.arrayUnion(...photos);
    if (current.exists) tx.update(ref, patch);
    else tx.set(ref, { ...patch, id: ref.id });
  });
  const saved = await ref.get();
  return { id: ref.id, version: saved.updateTime?.toDate().toISOString() || null };
});

export const appAccount = onCall({ region: 'asia-northeast3', maxInstances: 5 }, async request => {
  const principal = await verifyLiveAppSession(request);
  const db = getFirestore();
  const { action, employeeId, oldPassword, newPassword } = request.data || {};
  if (action === 'backfillProfiles') {
    if (!principal.master) throw new HttpsError('permission-denied', '마스터 관리자 권한이 필요합니다.');
    const companyId = request.data.companyId;
    if (typeof companyId !== 'string' || !companyId || companyId.includes('/')) throw new HttpsError('invalid-argument', '회사를 확인해주세요.');
    const source = await db.collection(`companies/${companyId}/users`).get();
    // No source field is removed or overwritten. Re-read within transactions
    // so a backfill cannot overwrite a more recent trigger projection.
    for (let i = 0; i < source.docs.length; i += 400) {
      await db.runTransaction(async tx => {
        const current = await Promise.all(source.docs.slice(i, i + 400).map(d => tx.get(d.ref)));
        for (const d of current) tx.set(db.doc(`companies/${companyId}/profiles/${d.id}`), d.exists ? publicProfile(d.data()) : { status: 'deleted' });
      });
    }
    return { count: source.size };
  }
  if (typeof newPassword !== 'string' || newPassword.length > 200 || (newPassword.length > 0 && newPassword.length < 4)) throw new HttpsError('invalid-argument', '비밀번호를 4자 이상 입력해주세요.');
  const company = principal.user.companyId;
  const targetId = action === 'changePassword' ? principal.user.uid : employeeId;
  if (typeof targetId !== 'string' || !targetId || targetId.includes('/')) throw new HttpsError('invalid-argument', '계정을 확인해주세요.');
  const kind = action === 'changePassword' ? principal.kind : 'staff';
  if (action !== 'changePassword' && action !== 'setEmployeePassword') throw new HttpsError('invalid-argument', '지원하지 않는 요청입니다.');
  const canManageEmployees = principal.kind === 'admin' || principal.master || getMemberships(principal.user).some(m => m.team === '관리팀');
  if (action === 'setEmployeePassword' && !canManageEmployees) throw new HttpsError('permission-denied', '관리자 권한이 필요합니다.');
  const ref = db.doc(`${kind === 'admin' ? 'admins' : 'staffs'}/${targetId}`);
  await db.runTransaction(async tx => {
    const live = (await tx.get(ref)).data();
    if (!live || live.companyId !== company) throw new HttpsError('permission-denied', '소속 회사를 확인해주세요.');
    if (action === 'changePassword' && (newPassword.length < 4 || typeof oldPassword !== 'string' || live.pw !== oldPassword)) throw new HttpsError('unauthenticated', '현재 비밀번호를 확인해주세요.');
    tx.set(ref, { pw: newPassword, authVersion: randomUUID() }, { merge: true });
    if (kind === 'staff') tx.set(db.doc(`companies/${company}/users/${targetId}`), { pw: newPassword }, { merge: true });
  });
  return { ok: true, requiresLogin: action === 'changePassword' };
});

export const appWidgetData = onRequest({ region: 'asia-northeast3', maxInstances: 5 }, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.status(405).json({ error: 'method-not-allowed' }); return; }
  try {
    const token = /^Bearer (.+)$/.exec(req.get('authorization') || '')?.[1];
    if (!token) throw new AppAuthError('unauthenticated', '로그인이 필요합니다.');
    const claims = await getAuth().verifyIdToken(token, true);
    const db = getFirestore();
    const principal = await verifyAppPrincipal(db, claims);
    const company = principal.user.companyId;
    const body=req.body||{};
    const prepared=body.eventId===undefined?await prepareScopedRead(db,company,body,principal):null;
    if(prepared?.notModified){res.json({notModified:true,revision:prepared.revision,scopeKey:prepared.scopeKey});return;}
    const delta=prepared?await readAppChanges(db,company,body,prepared):null;
    const [cals, assignments] = await Promise.all([db.collection(`companies/${company}/cals`).get(), db.collection(`companies/${company}/assignments`).get()]);
    const calById = new Map(cals.docs.map(d => [d.id, { ...d.data(), id: d.id }]));
    const allowed = e => canViewWidgetEvent(e, principal, [...calById.values()], assignments.docs.map(d => ({ ...d.data(), id: d.id })));
    const { eventId, from, to } = req.body || {};
    if (eventId !== undefined) {
      if (typeof eventId !== 'string' || !eventId || eventId.includes('/')) throw new AppAuthError('invalid-argument', '잘못된 일정입니다.');
      const d = await db.doc(`companies/${company}/events/${eventId}`).get();
      const event = d.exists ? { ...d.data(), id: d.id } : null;
      if (event && allowed(event) && event.repeat && event.repeat !== 'none') { res.json({ refreshRequired: true }); return; }
      res.json(event && allowed(event) ? { event: widgetEvent(event) } : { deleted: true }); return;
    }
    const scope = normalizeReadScope({ from, to });
    const source = delta ? await getSourceIds(db,company,'events',delta.eventIds) : await loadScopedEventSnapshots(db, company, scope);
    const raw = source.docs.map(d => ({ ...d.data(), id: d.id })).filter(e => e.status !== 'deleted');
    res.json({...projectWidgetRange(raw, principal, [...calById.values()], assignments.docs.map(d => ({ ...d.data(), id: d.id })), { from, to }),revision:prepared.revision,scopeKey:prepared.scopeKey,...(delta?{replaceEventIds:delta.eventIds}:{})});
  } catch (e) {
    const code = e.code || '';
    const status = widgetErrorStatus(code);
    res.status(status).json({ error: status === 503 ? 'unavailable' : code });
  }
});
