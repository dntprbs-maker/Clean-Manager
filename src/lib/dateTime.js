// ── 날짜/시간 유틸 ──────────────────────────────────────────────
export const HOLIDAYS = {
  "2026-01-01":"신정","2026-02-18":"설날","2026-03-01":"삼일절",
  "2026-05-05":"어린이날","2026-06-06":"현충일","2026-08-15":"광복절",
  "2026-09-25":"추석","2026-10-03":"개천절","2026-10-09":"한글날","2026-12-25":"크리스마스",
};
export const WD = ["일","월","화","수","목","금","토"];

// 해당 연/월에서 n번째(ordinal, -1은 마지막) weekday(0=일~6=토)의 날짜
export const nthWeekdayOfMonth = (year, monthIndex, weekday, ordinal) => {
  if (ordinal === -1) {
    const last = new Date(year, monthIndex+1, 0);
    const back = (last.getDay() - weekday + 7) % 7;
    last.setDate(last.getDate() - back);
    return last;
  }
  const first = new Date(year, monthIndex, 1);
  const fwd = (weekday - first.getDay() + 7) % 7;
  return new Date(year, monthIndex, 1 + fwd + (ordinal-1)*7);
};

export const fmt  = d=>{ if(!d)return""; const dt=typeof d==="string"?new Date(d+"T00:00:00"):d; return`${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,"0")}-${String(dt.getDate()).padStart(2,"0")}`; };
export const pd   = s=>{ if(!s)return null; const[y,m,d]=s.split("-").map(Number); return new Date(y,m-1,d); };
export const diff = (s,e)=>!s||!e?0:Math.round((pd(e)-pd(s))/864e5);
export const add  = (s,n)=>{ const d=pd(s); d.setDate(d.getDate()+n); return fmt(d); };
export const addMonths = (s,n)=>{ const d=pd(s); d.setMonth(d.getMonth()+n); return fmt(d); };

// 앱 로드 시점의 "오늘" 날짜 문자열 — 여러 화면에서 "오늘/어제" 라벨링에 공용으로 씀
export const today = fmt(new Date());

// 시간 포맷: "09:00" → "오전 9:00"
export const fmtTime = t => {
  if(!t) return "";
  const [h,mi] = t.split(":").map(Number);
  const ampm = h<12?"오전":"오후";
  const h12  = h===0?12:h>12?h-12:h;
  // 한자리 시간도 두자리로 패딩 (9→09) → 줄 정렬 일치
  return `${ampm} ${String(h12).padStart(2,"0")}:${String(mi).padStart(2,"0")}`;
};
