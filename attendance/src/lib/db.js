import { db } from '../firebase';
import {
  collection, doc, addDoc, updateDoc, deleteDoc, setDoc, getDoc,
  onSnapshot, query, where, orderBy, serverTimestamp,
} from 'firebase/firestore';
import { onlyDigits } from './phone';

// 클린매니저와 같은 Firestore를 공유하므로 attendance_ 접두사로 컬렉션을 분리한다.
const workersCol = collection(db, 'attendance_workers');
const workLogsCol = collection(db, 'attendance_workLogs');
const settlementsCol = collection(db, 'attendance_settlements');
const sitesCol = collection(db, 'attendance_sites');

const WITHHOLDING_RATE = 0.033; // 사업소득 3.3% 원천징수

// ---- 용역자 ----
export function subscribeWorkers(cb) {
  return onSnapshot(query(workersCol, orderBy('name')), (snap) => {
    cb(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}

export function addWorker({ name, phone, payType, payRate, note }) {
  return addDoc(workersCol, {
    name,
    phone: onlyDigits(phone),
    payType: payType || 'hourly',
    payRate: Number(payRate) || 0,
    note: note || '',
    active: true,
    pw: '', // 최초 로그인 시 본인이 설정
    createdAt: serverTimestamp(),
  });
}

export function updateWorker(id, patch) {
  return updateDoc(doc(workersCol, id), patch);
}

export function deleteWorker(id) {
  return deleteDoc(doc(workersCol, id));
}

// payType/payRate 도입 전 만들어진 기존 직원(hourlyRate만 있음) 호환용.
export function payInfoOf(worker) {
  return {
    type: worker.payType || 'hourly',
    rate: worker.payRate ?? worker.hourlyRate ?? 0,
  };
}

// ---- 현장 ----
export function subscribeSites(cb) {
  return onSnapshot(query(sitesCol, orderBy('name')), (snap) => {
    cb(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}

export function addSite({ name, address, note, workerIds }) {
  return addDoc(sitesCol, {
    name,
    address: address || '',
    note: note || '',
    workerIds: workerIds || [],
    active: true,
    createdAt: serverTimestamp(),
  });
}

export function updateSite(id, patch) {
  return updateDoc(doc(sitesCol, id), patch);
}

export function deleteSite(id) {
  return deleteDoc(doc(sitesCol, id));
}

// ---- 근무기록 ----
export function subscribeWorkLogsForMonth(yearMonth, cb) {
  // where+orderBy 조합은 복합 색인이 필요해, 정렬은 클라이언트에서 처리한다.
  return onSnapshot(
    query(workLogsCol, where('yearMonth', '==', yearMonth)),
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => a.date.localeCompare(b.date)))
  );
}

// 오늘자 근무기록(출근~퇴근) 하나를 구독 — 없으면 근무전, clockOut 없으면 근무중, 있으면 근무완료.
export function subscribeTodayLog(workerId, date, cb) {
  return onSnapshot(
    query(workLogsCol, where('workerId', '==', workerId), where('date', '==', date)),
    (snap) => {
      const d = snap.docs.find((doc) => !doc.data().deleted);
      cb(d ? { id: d.id, ...d.data() } : null);
    }
  );
}

export function clockIn({ workerId, workerName, date, siteId, siteName }) {
  return addDoc(workLogsCol, {
    workerId,
    workerName,
    date, // "YYYY-MM-DD"
    yearMonth: date.slice(0, 7), // "YYYY-MM"
    siteId: siteId || null,
    siteName: siteName || '',
    clockIn: serverTimestamp(),
    clockOut: null,
    hours: null,
    status: 'working',
    createdAt: serverTimestamp(),
  });
}

export function clockOut(id, clockInAt) {
  const hours = Math.round(((Date.now() - clockInAt.getTime()) / 3600000) * 100) / 100;
  return updateDoc(doc(workLogsCol, id), { clockOut: serverTimestamp(), hours, status: 'done' });
}

// 퇴근 취소 — 퇴근 기록만 지우고 출근 상태(근무중)로 되돌림.
export function cancelClockOut(id) {
  return updateDoc(doc(workLogsCol, id), { clockOut: null, hours: null, status: 'working' });
}

export function deleteWorkLog(id) {
  return updateDoc(doc(workLogsCol, id), { deleted: true });
}

// 관리자가 직접 추가/수정 — clockIn/clockOut은 JS Date 또는 null.
export function adminSaveWorkLog(id, { workerId, workerName, date, siteId, siteName, clockIn, clockOut }) {
  const hours = clockIn && clockOut ? Math.round(((clockOut.getTime() - clockIn.getTime()) / 3600000) * 100) / 100 : null;
  const data = {
    workerId,
    workerName,
    date,
    yearMonth: date.slice(0, 7),
    siteId: siteId || null,
    siteName: siteName || '',
    clockIn: clockIn || null,
    clockOut: clockOut || null,
    hours,
    status: clockOut ? 'done' : 'working',
  };
  if (id) return updateDoc(doc(workLogsCol, id), data);
  return addDoc(workLogsCol, { ...data, createdAt: serverTimestamp() });
}

// ---- 정산 ----
export function subscribeSettlementsForMonth(yearMonth, cb) {
  return onSnapshot(
    query(settlementsCol, where('yearMonth', '==', yearMonth)),
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((s) => !s.deleted))
  );
}

export function deleteSettlement(id) {
  return updateDoc(doc(settlementsCol, id), { deleted: true });
}

// 날짜(YYYY-MM-DD)가 속한 주의 월요일 — 주급 계산 시 "몇 주 근무했는지" 세는 기준.
function weekKeyOf(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  const diffToMonday = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - diffToMonday);
  return d.toISOString().slice(0, 10);
}

// 근무기록을 "용역자 × 현장"별로 집계해 정산 초안을 만든다(현장별로 정산 건이 따로 생김).
// 매니저확정 이후 단계인 건 재집계로 덮어쓰지 않는다.
// 참고: 시급/일급은 현장별 실제 시간·일수 기준이라 정확하지만, 주급/월급은 같은 달에 두 현장을
// 걸쳐 일한 경우 각 현장에서 "일한 주(또는 달)"로 각각 카운트돼 중복 지급처럼 보일 수 있음(드문 케이스).
export async function generateSettlements(yearMonth, workLogs, workers) {
  const byKey = new Map(); // `${workerId}__${siteId}` -> { workerId, siteId, siteName, hours, days:Set }
  for (const log of workLogs) {
    if (log.deleted) continue;
    const siteId = log.siteId || 'unassigned';
    const siteName = log.siteName || '현장 미지정';
    const key = `${log.workerId}__${siteId}`;
    const cur = byKey.get(key) || { workerId: log.workerId, siteId, siteName, hours: 0, days: new Set() };
    cur.hours += Number(log.hours || 0);
    cur.days.add(log.date);
    byKey.set(key, cur);
  }

  for (const { workerId, siteId, siteName, hours, days } of byKey.values()) {
    const worker = workers.find((w) => w.id === workerId);
    if (!worker) continue;
    const settlementId = `${yearMonth}_${workerId}_${siteId}`;
    const ref = doc(settlementsCol, settlementId);
    const existing = await getDoc(ref);
    if (existing.exists() && existing.data().status !== 'draft') continue; // 확정 이후 단계는 재집계로 덮어쓰지 않음

    const { type: payType, rate: payRate } = payInfoOf(worker);
    const totalHours = Math.round(hours * 100) / 100;
    const workDays = days.size;
    const workWeeks = new Set([...days].map(weekKeyOf)).size;

    let grossAmount = 0;
    if (payType === 'hourly') grossAmount = Math.round(totalHours * payRate);
    else if (payType === 'daily') grossAmount = Math.round(workDays * payRate);
    else if (payType === 'weekly') grossAmount = Math.round(workWeeks * payRate);
    else if (payType === 'monthly') grossAmount = workDays > 0 ? Math.round(payRate) : 0;

    const withholdingTax = Math.round(grossAmount * WITHHOLDING_RATE);
    const netAmount = grossAmount - withholdingTax;

    await setDoc(ref, {
      yearMonth,
      workerId,
      workerName: worker.name,
      siteId,
      siteName,
      payType,
      payRate,
      totalHours,
      workDays,
      workWeeks,
      grossAmount,
      withholdingTax,
      netAmount,
      status: 'draft',
      updatedAt: serverTimestamp(),
    }, { merge: true });
  }
}

export function confirmByManager(id) {
  return updateDoc(doc(settlementsCol, id), {
    status: 'managerConfirmed',
    managerConfirmedAt: serverTimestamp(),
  });
}

export function approveByAdmin(id) {
  return updateDoc(doc(settlementsCol, id), {
    status: 'adminApproved',
    adminApprovedAt: serverTimestamp(),
  });
}

export function markPaid(id) {
  return updateDoc(doc(settlementsCol, id), {
    status: 'paid',
    paidAt: serverTimestamp(),
  });
}
