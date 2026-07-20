export function formatWon(n) {
  return `${Math.round(n || 0).toLocaleString('ko-KR')}원`;
}

export function currentYearMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

// 근무일 — 오전 9시 이전은 전날 근무일로 취급(야간 근무가 자정을 넘겨도 하루로 묶기 위함).
export function currentWorkDay() {
  const d = new Date();
  if (d.getHours() < 9) d.setDate(d.getDate() - 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// "2026년 7월 17일 (금)" 형식
export function formatDateLong(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  return d.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' });
}

// Firestore Timestamp → "7월 17일 오후 2:30" 형식
export function formatDateTime(ts) {
  if (!ts?.toDate) return '';
  const d = ts.toDate();
  const date = d.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' });
  const time = d.toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' });
  return `${date} ${time}`;
}

export const STATUS_LABEL = {
  draft: '집계됨',
  managerConfirmed: '매니저 확정',
  adminApproved: '대표 승인',
  paid: '지급완료',
};

export const WORK_STATUS_LABEL = {
  before: '근무전',
  working: '근무중',
  done: '근무완료',
};

export const PAY_TYPE_LABEL = {
  hourly: '시급',
  daily: '일급',
  weekly: '주급',
  monthly: '월급',
};

// 정산 카드에 보여줄 "OO시간 × 12,000원" 류 계산 근거 한 줄.
export function payBasisLabel(s) {
  const rate = formatWon(s.payRate);
  if (s.payType === 'daily') return `${s.workDays}일 × ${rate}`;
  if (s.payType === 'weekly') return `${s.workWeeks}주 × ${rate}`;
  if (s.payType === 'monthly') return `월급 ${rate}`;
  return `${s.totalHours}시간 × ${rate}`;
}
