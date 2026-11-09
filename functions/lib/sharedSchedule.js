import { createHash } from 'node:crypto';
import { AppAuthError } from './appAuthCore.js';
import { getMemberships } from './membership.js';
import { expandRecurring } from './appRecurrence.js';
import { loadScopedEventSnapshots, validDate } from './appScopedReads.js';

const fail = (code, message) => { throw new AppAuthError(code, message); };
const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,180}$/.test(value);
const active = row => row && row.status !== 'deleted';
const recurring = event => event.repeat && event.repeat !== 'none';
const teamVersion = snap => snap.updateTime ? `${snap.updateTime.seconds}:${snap.updateTime.nanoseconds}` : null;
const DAY_MS = 86400000;
const relativeDay = days => new Date(Date.now() + 9 * 3600000 + days * DAY_MS).toISOString().slice(0, 10);
const occurrence = (event, day) => {
  if (!active(event)) return null;
  if (!recurring(event)) return day ? null : event;
  if (!day) return null;
  const moved = event.exceptions?.[day]?.start || day;
  if (!validDate(moved)) return null;
  return expandRecurring([event], { start: moved, end: moved }).find(row => row._origDate === day) || null;
};
const normalizePhone = value => typeof value === 'string' ? value.replace(/[ -]/g, '') : '';
const digest = value => createHash('sha256').update(value).digest('hex');
const string = value => typeof value === 'string' ? value : '';
const eventView = ({ title, start, end, startTime, endTime, allDay }) =>
  ({ title: string(title), start: string(start), end: string(end), startTime: string(startTime), endTime: string(endTime), allDay: allDay === true });

async function limitInviteLookups(db, accountId) {
  const ref = db.doc(`appAuthScheduleInviteLimits/${accountId}`);
  await db.runTransaction(async tx => {
    const previous = (await tx.get(ref)).data();
    const now = Date.now();
    const sameWindow = previous && now - previous.start < 60000;
    const count = sameWindow ? previous.count + 1 : 1;
    if (count > 20) fail('resource-exhausted', '잠시 후 다시 초대해주세요.');
    tx.set(ref, { start: sameWindow ? previous.start : now, count });
  });
}

export async function handleSharedSchedule(db, principal, input) {
  const grants = db.collection('appAuthScheduleGrants');
  const { action, eventId, grantId } = input || {};
  const companyId = principal.user.companyId;
  if (action === 'received') {
    if (principal.kind !== 'staff') return { events: [] };
    const from = input.from ?? relativeDay(-7);
    const to = input.to ?? relativeDay(92);
    if (!validDate(from) || !validDate(to) || from > to || Date.parse(to) - Date.parse(from) > 99 * DAY_MS) {
      fail('invalid-argument', '캘린더 조회 기간을 100일 이내로 선택해주세요.');
    }
    const teamNames = companyId ? getMemberships(principal.user).map(row => row.team) : [];
    const [own, account, config, ...teamGrants] = await Promise.all([
      grants.where('memberId', '==', principal.user.uid).get(),
      db.doc(`staffs/${principal.user.uid}`).get(),
      companyId ? db.doc(`companies/${companyId}/meta/config`).get() : null,
      ...[...new Set(teamNames)].map(team => grants.where('teamKey', '==', digest(JSON.stringify([companyId, team]))).get()),
    ]);
    if (!active(account.data())) return { events: [] };
    const phoneKey = digest(normalizePhone(account.data().phone));
    const direct = own.docs.filter(grant => grant.data().phoneKey === phoneKey);
    const currentTeams = config?.data()?.teams;
    const version = config && teamVersion(config);
    const byTeam = teamGrants.flatMap(snap => snap.docs).filter(grant => {
      const data = grant.data();
      return data.companyId === companyId && version && version === data.teamVersion &&
        Array.isArray(currentTeams) && currentTeams.includes(data.team);
    });
    const targets = new Map([...direct, ...byTeam].map(grant => [grant.data().eventKey, grant]));
    const byHost = new Map();
    const events = await Promise.all([...targets.values()].map(async grant => {
      const { companyId: host, eventId: id, calendarId, day } = grant.data();
      const company = (await db.doc(`companies/${host}`).get()).data();
      if (!active(company)) return [];
      const view = row => ({
        id: digest(JSON.stringify([host, row.id, row._origDate || ''])),
        companyName: string(company.name), ...eventView(row),
      });
      if (calendarId) {
        const calendar = (await db.doc(`companies/${host}/cals/${calendarId}`).get()).data();
        if (!active(calendar)) return [];
        if (!byHost.has(host)) byHost.set(host, loadScopedEventSnapshots(db, host, { ranges: [{ from, to }], eventIds: [] }));
        const { docs } = await byHost.get(host);
        const rows = docs.map(doc => ({ ...doc.data(), id: doc.id })).filter(row => active(row) &&
          (row.calId === calendarId || Object.values(row.exceptions || {}).some(ex => ex?.calId === calendarId)));
        return expandRecurring(rows, { start: from, end: to })
          .filter(row => row.calId === calendarId && active(row)).map(view);
      }
      const event = (await db.doc(`companies/${host}/events/${id}`).get()).data();
      const row = occurrence(event && { ...event, id }, day);
      return row ? [view(row)] : [];
    }));
    return { events: [...new Map(events.flat().map(row => [row.id, row])).values()].sort((a, b) => a.start.localeCompare(b.start)) };
  }

  if (principal.kind !== 'admin' || !validId(companyId)) fail('permission-denied', '회사 관리자만 초대를 관리할 수 있습니다.');
  const { calendarId, day, team } = input || {};
  if (calendarId !== undefined ? !validId(calendarId) || eventId !== undefined || day !== undefined
    : !validId(eventId) || (day !== undefined && !validDate(day))) {
    fail('invalid-argument', '일정 또는 캘린더를 확인해주세요.');
  }
  const eventRef = db.doc(`companies/${companyId}/${calendarId ? 'cals' : 'events'}/${calendarId || eventId}`);
  const eventKey = digest(JSON.stringify(calendarId ? [companyId, 'calendar', calendarId]
    : day ? [companyId, eventId, day] : [companyId, eventId]));
  const target = calendarId ? { calendarId } : day ? { eventId, day } : { eventId };
  const ensureShareable = data => {
    if (!(calendarId ? active(data) : occurrence(data && { ...data, id: eventId }, day))) {
      fail('failed-precondition', '공유할 일정이나 회차를 확인해주세요.');
    }
  };
  if (action === 'sent') {
    if (!active((await eventRef.get()).data())) fail('not-found', '일정을 찾을 수 없습니다.');
    const sent = await grants.where('eventKey', '==', eventKey).get();
    return { invites: sent.docs.map(doc => ({ id: doc.id, phoneTail: doc.data().phoneTail ?? null, team: doc.data().team ?? null })) };
  }
  if (action === 'remove') {
    if (!validId(grantId)) fail('invalid-argument', '초대를 확인해주세요.');
    const ref = grants.doc(grantId);
    await db.runTransaction(async tx => {
      const grant = (await tx.get(ref)).data();
      if (grant?.eventKey !== eventKey) fail('not-found', '초대를 찾을 수 없습니다.');
      tx.delete(ref);
    });
    return { ok: true };
  }
  if (action === 'inviteTeam') {
    if (typeof team !== 'string' || !team || team.length > 100) fail('invalid-argument', '팀을 확인해주세요.');
    const teamKey = digest(JSON.stringify([companyId, team]));
    const ref = grants.doc(digest(JSON.stringify([eventKey, 'team', teamKey])));
    const configRef = db.doc(`companies/${companyId}/meta/config`);
    await db.runTransaction(async tx => {
      const [resource, config] = await Promise.all([tx.get(eventRef), tx.get(configRef)]);
      ensureShareable(resource.data());
      const teams = config.data()?.teams;
      const version = teamVersion(config);
      if (!version || !Array.isArray(teams) || !teams.includes(team)) fail('failed-precondition', '등록된 팀을 확인해주세요.');
      tx.set(ref, { companyId, ...target, eventKey, team, teamKey, teamVersion: version });
    });
    return { ok: true };
  }
  if (action !== 'invite') fail('invalid-argument', '지원하지 않는 요청입니다.');

  const phone = typeof input.phone === 'string' && input.phone.length <= 15 ? normalizePhone(input.phone) : '';
  if (!/^0\d{9,10}$/.test(phone)) fail('invalid-argument', '회원의 전화번호를 확인해주세요.');
  await limitInviteLookups(db, principal.user.uid);
  const formatted = `${phone.slice(0,3)}-${phone.slice(3,-4)}-${phone.slice(-4)}`;
  const accounts = await db.collection('staffs').where('phone', 'in', [phone, formatted]).get();
  const candidates = accounts.docs.filter(doc => active(doc.data()) && !!doc.data().pw);
  if (candidates.length !== 1) fail('failed-precondition', '이 번호로 초대할 기존 회원 계정을 한 개로 확인할 수 없습니다.');
  const member = candidates[0];
  const id = digest(JSON.stringify([eventKey, member.id]));
  await db.runTransaction(async tx => {
    const [event, account] = await Promise.all([tx.get(eventRef), tx.get(member.ref)]);
    ensureShareable(event.data());
    const live = account.data();
    if (!active(live) || !live.pw || ![phone, formatted].includes(live.phone)) fail('failed-precondition', '회원 정보가 변경되었습니다.');
    tx.set(grants.doc(id), { companyId, ...target, eventKey, memberId: member.id, phoneKey: digest(phone), phoneTail: phone.slice(-4) });
  });
  return { ok: true };
}
