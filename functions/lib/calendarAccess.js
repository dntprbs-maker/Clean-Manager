import { getMemberships } from './membership.js';

// null retains the historical policy; false is an explicit denial.
export function calendarViewDecision(cal, principal) {
  if (cal?.viewAccess?.mode !== 'selected') return null;
  if (principal.kind === 'admin' || principal.master) return true;
  const uid = principal.user?.uid || principal.user?.id;
  if (cal.personal && cal.ownerId === uid) return true;
  const { teams = [], people = [] } = cal.viewAccess;
  return people.includes(uid) || getMemberships(principal.user).some(m => teams.includes(m.team));
}

export class CalendarAccessError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
const fail = (code, message) => { throw new CalendarAccessError(code, message); };
const validId = id => typeof id === 'string' && id.length > 0 && id.length <= 200 && !id.includes('/');

// Reads calendar, team configuration and selected employees only. Never events.
export async function saveCalendarAccess(db, principal, input = {}) {
  if (principal.kind !== 'admin') fail('permission-denied', '회사 관리자만 열람 대상을 변경할 수 있습니다.');
  const { calendarId, mode, teams = [], people = [], expectedVersion = 0 } = input;
  if (!validId(calendarId) || !['legacy', 'selected'].includes(mode)
    || !Array.isArray(teams) || !Array.isArray(people) || teams.length > 200 || people.length > 500
    || teams.some(t => typeof t !== 'string' || !t || t.length > 100) || people.some(id => !validId(id))
    || !Number.isSafeInteger(expectedVersion) || expectedVersion < 0) fail('invalid-argument', '열람 대상과 캘린더를 확인해주세요.');
  const root = `companies/${principal.user.companyId}`;
  const ref = db.doc(`${root}/cals/${calendarId}`);
  const head = db.doc(`${root}/meta/readRevision`);
  return db.runTransaction(async tx => {
    const cal = await tx.get(ref);
    const config = await tx.get(db.doc(`${root}/meta/config`));
    const revision = await tx.get(head);
    if (!cal.exists || cal.data().status === 'deleted') fail('not-found', '캘린더를 찾을 수 없습니다.');
    if ((cal.data().viewAccess?.version || 0) !== expectedVersion) fail('aborted', '다른 관리자가 변경했습니다. 다시 열어 확인해주세요.');
    const names = config.data()?.teams || [];
    if (mode === 'selected' && teams.some(t => !names.includes(t))) fail('invalid-argument', '현재 등록된 팀을 선택해주세요.');
    for (const id of mode === 'selected' ? [...new Set(people)] : []) {
      const employee = await tx.get(db.doc(`${root}/users/${id}`));
      if (!employee.exists || employee.data().status === 'deleted') fail('invalid-argument', '현재 회사에 등록된 사람을 선택해주세요.');
    }
    const viewAccess = { mode, teams: mode === 'selected' ? [...new Set(teams)] : [],
      people: mode === 'selected' ? [...new Set(people)] : [], version: expectedVersion + 1 };
    tx.set(ref, { viewAccess }, { merge: true });
    // Synchronous invalidation closes the trigger delivery gap. A missing
    // journal sequence forces a fresh scoped snapshot, clearing revoked rows.
    tx.set(head, { revision: (revision.data()?.revision || 0) + 1, journalVersion: 1 }, { merge: true });
    return { calendarId, viewAccess };
  });
}
