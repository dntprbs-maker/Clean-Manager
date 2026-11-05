import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { getMemberships, isAdminStaff } from './membership.js';

export class AppAuthError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
const fail = (code, message) => { throw new AppAuthError(code, message); };
const active = d => d && d.status !== 'deleted';
const hash = s => createHash('sha256').update(s).digest('hex');
const equal = (a, b) => timingSafeEqual(Buffer.from(hash(String(a))), Buffer.from(hash(String(b))));
const safeUser = (data, uid, company, kind) => {
  // Never return account password, tokens, or administrative internals.
  const keys = ['id', 'name', 'phone', 'team', 'role', 'memberships', 'dailyAllowance', 'email'];
  const user = Object.fromEntries(keys.filter(k => data[k] !== undefined).map(k => [k, data[k]]));
  return { ...user, uid, companyId: data.companyId, companyName: company.name || '클린메니져', companyLogoUrl: company.logoUrl || null,
    ...(kind === 'admin' ? { role: '최고관리자' } : user.role === '최고관리자' ? { role: '팀장' } : {}) };
};

export const publicProfile = data => Object.fromEntries([
  'id', 'name', 'phone', 'team', 'role', 'memberships', 'dailyAllowance', 'email', 'order', 'status', 'createdAt',
].filter(k => data[k] !== undefined).map(k => [k, data[k]]));

export function projectCalendar(cal, principal) {
  if (cal.status === 'deleted') return null;
  const ownPersonal = cal.personal === true && cal.ownerId === principal.user.uid;
  const owner = principal.kind === 'admin' || principal.master;
  if (cal.personal && !ownPersonal && !owner) return null;
  const managesShared = !cal.personal && isAdminStaff(principal.user);
  const mySharedTeam = !cal.personal && cal.id !== 'regular_cleaning'
    && getMemberships(principal.user).some(m => m.team === cal.label);
  const fields = ['id', 'label', 'name', 'color', 'checked', 'isField', 'personal', 'ownerId'];
  // A regular-cleaning feed contains all assignments, so assignment membership
  // alone must never disclose its bearer token to an ordinary staff member.
  if (owner || ownPersonal || managesShared || mySharedTeam) fields.push('feedToken');
  if (owner || ownPersonal || managesShared) fields.push('icsSubscriptionUrl', 'icsSubscriptionLastSyncAt', 'icsSubscriptionLastError');
  const result = Object.fromEntries(fields.filter(k => cal[k] !== undefined).map(k => [k, cal[k]]));
  if ((owner || ownPersonal || managesShared) && cal.gcalPushStatus) {
    result.gcalPushStatus = Object.fromEntries(['enabled', 'lastSuccessAt', 'needsReauth', 'lastError']
      .filter(k => cal.gcalPushStatus[k] !== undefined).map(k => [k, cal.gcalPushStatus[k]]));
  }
  return result;
}

export function canViewWidgetEvent(event, principal, cals, assignments) {
  if (event.status === 'deleted') return false;
  const cal = cals.find(c => c.id === event.calId);
  if (cal?.status === 'deleted') return false;
  if (cal?.personal && cal.ownerId !== principal.user.uid && principal.kind !== 'admin') return false;
  if (principal.kind === 'admin' || isAdminStaff(principal.user)) return true;
  const membership = getMemberships(principal.user).map(m => m.team);
  const ownAssignments = new Set(assignments.filter(a => a.employeeId === principal.user.uid).map(a => a.id));
  if (!membership.length && !ownAssignments.size) return true;
  return membership.includes(cal?.label) || !!cal?.personal || (event.source === 'regular' && ownAssignments.has(event.assignmentId));
}

export async function verifyAppPrincipal(db, claims) {
  if (!claims || !['admin', 'staff'].includes(claims.cmk) || !claims.cmid || !claims.cmCompany) fail('unauthenticated', '다시 로그인해주세요.');
  const snap = await db.doc(`${claims.cmk === 'admin' ? 'admins' : 'staffs'}/${claims.cmid}`).get();
  const data = snap.data();
  if (!active(data) || !data.pw || data.companyId !== claims.cmCompany || data.authVersion !== claims.cmv) fail('unauthenticated', '로그인이 만료되었습니다.');
  const company = (await db.doc(`companies/${data.companyId}`).get()).data();
  if (!active(company)) fail('permission-denied', '사용할 수 없는 회사입니다.');
  const config = (await db.doc('appAuthConfig/master').get()).data() || {};
  const master = claims.cmk === 'admin' && config.accountIds?.includes(snap.id) === true;
  let profile = data;
  if (claims.cmk === 'staff') {
    const current = (await db.doc(`companies/${data.companyId}/users/${snap.id}`).get()).data();
    if (!current || current.status === 'deleted') fail('permission-denied', '사용할 수 없는 계정입니다.');
    profile = { ...data, ...current, companyId: data.companyId };
  }
  return { user: safeUser(profile, snap.id, company, claims.cmk), master, kind: claims.cmk, claims };
}

/** Existing account migration; no database/provider provisioning happens here. */
export function createAppAuthService({ db, issueToken, now = Date.now }) {
  async function accounts(identifier) {
    const phone = String(identifier || '').replace(/-/g, '').trim();
    const kind = /^0\d{9,10}$/.test(phone) ? 'staff' : 'admin';
    const col = kind === 'staff' ? 'staffs' : 'admins';
    let snap = await db.collection(col).where(kind === 'staff' ? 'phone' : 'id', '==', kind === 'staff' ? phone : String(identifier).trim()).get();
    if (kind === 'staff' && snap.empty) {
      const formatted = phone.length === 11 ? `${phone.slice(0,3)}-${phone.slice(3,7)}-${phone.slice(7)}` : `${phone.slice(0,3)}-${phone.slice(3,6)}-${phone.slice(6)}`;
      snap = await db.collection(col).where('phone', '==', formatted).get();
    }
    return { kind, col, docs: snap.docs.filter(d => active(d.data())) };
  }
  async function rateLimit(identifier, ip) {
    const key = hash(`${ip || 'unknown'}:${String(identifier).trim()}`);
    const ref = db.doc(`appAuthAttempts/${key}`);
    await db.runTransaction(async tx => {
      const d = (await tx.get(ref)).data() || {};
      const current = now();
      const same = current - (d.windowStart || 0) < 60000;
      const count = same ? Number(d.count || 0) + 1 : 1;
      if (count > 20) fail('resource-exhausted', '잠시 후 다시 시도해주세요.');
      tx.set(ref, { windowStart: same ? d.windowStart : current, count });
    });
  }
  async function session(doc, kind, expectedPassword) {
    const ref = doc.ref;
    const data = await db.runTransaction(async tx => {
      const live = (await tx.get(ref)).data();
      if (!active(live) || !live.pw) fail('unauthenticated', '다시 로그인해주세요.');
      if (expectedPassword !== undefined && !equal(live.pw, expectedPassword)) fail('unauthenticated', '비밀번호가 변경되었습니다. 다시 로그인해주세요.');
      if (!live.authVersion) {
        live.authVersion = randomUUID();
        tx.set(ref, { authVersion: live.authVersion }, { merge: true });
      }
      return live;
    });
    const company = (await db.doc(`companies/${data.companyId}`).get()).data();
    if (!active(company)) fail('permission-denied', '사용할 수 없는 회사입니다.');
    const config = (await db.doc('appAuthConfig/master').get()).data() || {};
    const claims = { cmCompany: data.companyId, cmid: doc.id, cmk: kind, cmv: data.authVersion,
      cmMaster: kind === 'admin' && Array.isArray(config.accountIds) && config.accountIds.includes(doc.id) };
    const token = await issueToken(`cm_${kind}_${doc.id}`, claims);
    return { token, user: safeUser(data, doc.id, company, kind), master: claims.cmMaster };
  }
  async function restore(claims) {
    const { user, master } = await verifyAppPrincipal(db, claims);
    return { user, master };
  }
  return async function execute(input, auth, ip) {
    if (input?.action === 'restore') return restore(auth?.token);
    if (['companies', 'switch'].includes(input?.action)) {
      const principal = await verifyAppPrincipal(db, auth?.token);
      if (principal.kind !== 'staff') return input.action === 'companies' ? { companies: [] } : fail('permission-denied', '직원 계정으로 로그인해주세요.');
      const own = (await db.doc(`staffs/${principal.user.uid}`).get()).data();
      const found = await accounts(own.phone);
      const eligible = found.docs.filter(d => d.data().pw && equal(d.data().pw, own.pw));
      if (input.action === 'switch') {
        const target = eligible.find(d => d.data().companyId === input.companyId);
        if (!target) fail('permission-denied', '대상 회사 계정으로 다시 로그인해주세요.');
        return session(target, 'staff', own.pw);
      }
      const companies = [];
      for (const d of eligible) {
        const company = (await db.doc(`companies/${d.data().companyId}`).get()).data();
        if (active(company)) companies.push({ companyId: d.data().companyId, companyName: company.name || '클린메니져' });
      }
      return { companies };
    }
    const { action = 'login', identifier = '', password = '', companyId } = input || {};
    if (typeof identifier !== 'string' || !identifier.trim() || identifier.length > 100 || typeof password !== 'string' || password.length > 200) fail('invalid-argument', '입력값을 확인해주세요.');
    await rateLimit(identifier, ip);
    if (action === 'register') {
      if (identifier.trim().startsWith('0') || password.length < 4) fail('invalid-argument', '아이디와 비밀번호를 확인해주세요.');
      const found = await accounts(identifier);
      if (found.docs.length) fail('already-exists', '이미 사용 중인 아이디입니다.');
      const company = `c_${randomUUID().replaceAll('-', '').slice(0,12)}`;
      const admin = `a_${randomUUID().replaceAll('-', '').slice(0,12)}`;
      const nameRef = db.doc(`appAuthNames/${hash(identifier.trim())}`);
      const adminRef = db.doc(`admins/${admin}`);
      await db.runTransaction(async tx => {
        if ((await tx.get(nameRef)).exists) fail('already-exists', '이미 사용 중인 아이디입니다.');
        tx.set(nameRef, { accountId: admin });
        tx.set(db.doc(`companies/${company}`), { name: '내 회사', companyId: company, createdAt: new Date(now()).toISOString(), aiTextExtraction: false, aiImageExtraction: false });
        tx.set(adminRef, { id: identifier.trim(), pw: password, name: identifier.trim(), companyId: company, role: '최고관리자', team: '사장', createdAt: new Date(now()).toISOString(), authVersion: randomUUID() });
      });
      // Default calendars/config are seeded by authenticated client after login.
      return session(await adminRef.get(), 'admin');
    }
    const { kind, docs } = await accounts(identifier);
    if (action === 'check') return { needsSetup: kind === 'staff' && docs.length > 0 && !docs[0].data().pw };
    if (!docs.length) fail('unauthenticated', '아이디 또는 비밀번호를 확인해주세요.');
    if (kind === 'staff' && !docs[0].data().pw && action === 'login') return { needsSetup: true, name: docs[0].data().name || '' };
    if (action === 'setup') {
      // This preserves legacy phone-first setup. Enable only after the owner
      // explicitly confirms this policy; default fail closed.
      const config = (await db.doc('appAuthConfig/policy').get()).data() || {};
      if (config.allowPhoneFirstSetup !== true) fail('failed-precondition', '관리자에게 초기 비밀번호 설정을 요청해주세요.');
      if (kind !== 'staff' || password.length < 4) fail('invalid-argument', '비밀번호를 확인해주세요.');
      const target = companyId ? docs.find(d => d.data().companyId === companyId) : docs[0];
      if (!target) fail('permission-denied', '소속 회사를 확인해주세요.');
      await db.runTransaction(async tx => {
        const live = (await tx.get(target.ref)).data();
        if (!active(live) || live.pw) fail('failed-precondition', '이미 설정되었습니다. 다시 로그인해주세요.');
        tx.set(target.ref, { pw: password, authVersion: randomUUID() }, { merge: true });
        tx.set(db.doc(`companies/${live.companyId}/users/${target.id}`), { pw: password }, { merge: true });
      });
      return session(await target.ref.get(), kind);
    }
    if (action !== 'login') fail('invalid-argument', '지원하지 않는 요청입니다.');
    // Validate each company account independently; never use one company's
    // password to grant access to another company's account with same phone.
    const valid = docs.filter(d => d.data().pw && equal(d.data().pw, password));
    if (!valid.length) fail('unauthenticated', '아이디 또는 비밀번호를 확인해주세요.');
    if (!companyId && valid.length > 1) {
      const companies = [];
      for (const d of valid) {
        const c = (await db.doc(`companies/${d.data().companyId}`).get()).data();
        if (active(c)) companies.push({ companyId: d.data().companyId, companyName: c.name || '클린메니져' });
      }
      return { companies };
    }
    const target = companyId ? valid.find(d => d.data().companyId === companyId) : valid[0];
    if (!target) fail('permission-denied', '소속 회사를 확인해주세요.');
    return session(target, kind, password);
  };
}
