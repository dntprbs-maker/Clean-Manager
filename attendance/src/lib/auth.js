import { db } from '../firebase';
import { collection, doc, addDoc, getDoc, getDocs, updateDoc, query, where } from 'firebase/firestore';
import { onlyDigits } from './phone';
import { isDevMode } from './devMode';

const STORAGE_KEY = 'attendanceLoginUser';
const accountsCol = collection(db, 'attendance_accounts');
const workersCol = collection(db, 'attendance_workers');

const isPhoneId = (id) => /^0\d{9,10}$/.test(id.trim().replace(/-/g, ''));

export function loadStoredUser() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function storeUser(user) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(user)); } catch { /* 무시 */ }
}

export function clearStoredUser() {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* 무시 */ }
}

// 매니저/최고관리자 계정 — 이 앱 전용 attendance_accounts 기준(클린매니저와 무관).
export async function hasAnyAccount() {
  const snap = await getDocs(accountsCol);
  return !snap.empty;
}

// 아이디 입력값을 보고 로그인 흐름을 판단한다.
// 전화번호 형태 → 직원(용역자, attendance_workers), 그 외 → 매니저/최고관리자(attendance_accounts).
export async function checkLoginId(id) {
  if (!id || !isPhoneId(id)) return { kind: 'account' };
  const phone = onlyDigits(id);
  const snap = await getDocs(query(workersCol, where('phone', '==', phone)));
  const found = snap.docs.find((d) => d.data().active !== false);
  if (!found) return { kind: 'unknown-phone' };
  const data = found.data();
  return data.pw
    ? { kind: 'worker-has-pw' }
    : { kind: 'worker-needs-setup', workerId: found.id, name: data.name };
}

// 직원(용역자) 전화번호 로그인 — 클린매니저처럼 직원 등록 시 입력한 전화번호가 곧 아이디.
export async function loginWorker(id, pw) {
  const phone = onlyDigits(id);
  const snap = await getDocs(query(workersCol, where('phone', '==', phone)));
  const found = snap.docs.find((d) => d.data().active !== false);
  if (!found) throw new Error('등록되지 않은 전화번호입니다.');
  const data = found.data();
  if (!data.pw) throw new Error('아직 비밀번호가 설정되지 않았습니다.');
  if (data.pw !== pw) throw new Error('비밀번호가 올바르지 않습니다.');
  return { name: data.name, id: phone, role: '용역자', workerId: found.id };
}

// 직원의 최초 로그인 — 비밀번호를 새로 설정하면서 바로 로그인 처리.
export async function setWorkerPassword(workerId, pw) {
  await updateDoc(doc(workersCol, workerId), { pw });
  const snap = await getDoc(doc(workersCol, workerId));
  const data = snap.data();
  return { name: data.name, id: data.phone, role: '용역자', workerId };
}

// 매니저/최고관리자 로그인 (전화번호가 아닌 아이디)
export async function login(id, pw) {
  const snap = await getDocs(query(accountsCol, where('id', '==', id.trim())));
  const found = snap.docs.find((d) => d.data().active !== false);
  if (!found) throw new Error('등록되지 않은 아이디입니다.');
  const data = found.data();
  if (data.pw !== pw) throw new Error('비밀번호가 올바르지 않습니다.');
  return { ...data, uid: found.id };
}

// 최초 1회, 계정이 하나도 없을 때만 대표(최고관리자) 계정을 스스로 만들 수 있음.
export async function registerFirstAdmin({ id, pw, name }) {
  if (await hasAnyAccount()) throw new Error('이미 계정이 있습니다. 로그인해주세요.');
  const account = { id: id.trim(), pw, name: name.trim(), role: '최고관리자', active: true };
  const ref = await addDoc(accountsCol, account);
  return { ...account, uid: ref.id };
}

// -------------------------------------------------
// DEV LOGIN
// UI 테스트용 기능
// 운영모드에서는 반드시 비활성화
// -------------------------------------------------
// isDevMode()가 false면(운영 배포) 무조건 예외를 던져 절대 우회 로그인이
// 일어나지 않도록 함수 내부에서도 다시 한번 막는다(호출부의 분기 실수에 대한 방어).

// 전화번호만으로 직원(용역자) 정보를 조회해 비밀번호 검사 없이 로그인 처리.
export async function devLoginWorkerByPhone(id) {
  if (!isDevMode()) throw new Error('개발모드가 아닙니다.');
  const phone = onlyDigits(id);
  const snap = await getDocs(query(workersCol, where('phone', '==', phone)));
  const found = snap.docs.find((d) => d.data().active !== false);
  if (!found) throw new Error('등록되지 않은 용역자입니다.');
  const data = found.data();
  return { name: data.name, id: phone, role: '용역자', workerId: found.id };
}

// 아이디만으로 매니저/최고관리자 계정을 조회해 비밀번호 검사 없이 로그인 처리.
export async function devLoginAccountById(id) {
  if (!isDevMode()) throw new Error('개발모드가 아닙니다.');
  const snap = await getDocs(query(accountsCol, where('id', '==', id.trim())));
  const found = snap.docs[0];
  if (!found) throw new Error('등록되지 않은 계정입니다.');
  const data = found.data();
  return { ...data, uid: found.id };
}
