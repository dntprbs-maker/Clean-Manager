import { fmt, pd, diff, add, WD } from "./dateTime";
import { nthWeekdayOfMonth } from "./dateTime";

// 반복 유형 선택지 (일정/배정 공용)
export const REPEAT_OPTS = [
  {value:"none",label:"반복 없음"},{value:"daily",label:"매일"},
  {value:"weekly",label:"매주"},{value:"monthly",label:"매월"},{value:"yearly",label:"매년"},
];
export const REPEAT_ORD_OPTS = [{v:1,l:"첫째"},{v:2,l:"둘째"},{v:3,l:"셋째"},{v:4,l:"넷째"},{v:5,l:"다섯째"},{v:-1,l:"마지막"}];

// 정기청소 배정 급여 유형 — 일급/주급/월급 중 택1
export const WAGE_TYPES = [
  { value: "daily",   label: "일급" },
  { value: "weekly",  label: "주급" },
  { value: "monthly", label: "월급" },
];
export const wageTypeLabel = t => WAGE_TYPES.find(w => w.value === t)?.label || "일급";

// ── 반복 일정 전개 ────────────────────────────────────────────────
// repeat(daily/weekly/monthly) 일정을 repeatUntil(없으면 1년) 까지 개별 일정으로 펼친다.
// 각 인스턴스는 원본 id 를 그대로 유지(상세/수정/삭제는 시리즈 단위로 동작).
export function expandRecurring(events) {
  const HARD_CAP = 400; // 안전장치 (무한 루프 방지)
  const now = new Date();
  const defaultUntil = fmt(new Date(now.getFullYear() + 1, now.getMonth(), now.getDate()));
  const out = [];
  for (const ev of events) {
    if (!ev.repeat || ev.repeat === "none") { out.push(ev); continue; }
    const dur      = diff(ev.start, ev.end || ev.start); // 일정 길이(일)
    const until    = ev.repeatUntil || defaultUntil;
    const untilD   = pd(until);
    const startD   = pd(ev.start);
    const interval = Math.max(1, Number(ev.repeatInterval) || 1);
    const push = (dStr) => {
      const ex = ev.exceptions?.[dStr];
      if (ex && ex._deleted) return; // 이 회차만 삭제된 경우 건너뜀
      const merged = ex ? { ...ev, ...ex } : ev;
      // 예외에 start(단건 일정 변경)가 있으면 그 날짜/기간을 그대로 사용, 없으면 반복 규칙대로 계산
      const outStart = ex?.start || dStr;
      const outEnd   = ex?.end   || add(outStart, dur);
      out.push({ ...merged, _origDate: dStr, start: outStart, end: outEnd, _recurring: true, _hasException: !!ex });
    };
    let count = 0;

    if (ev.repeat === "daily") {
      let cur = ev.start;
      while (cur <= until && count < HARD_CAP) { push(cur); count++; cur = add(cur, interval); }

    } else if (ev.repeat === "weekly") {
      const weekdays  = (ev.repeatWeekdays && ev.repeatWeekdays.length) ? ev.repeatWeekdays : [startD.getDay()];
      const weekStart = new Date(startD); weekStart.setDate(weekStart.getDate() - weekStart.getDay());
      let cur = new Date(startD);
      while (cur <= untilD && count < HARD_CAP) {
        const weekIdx = Math.floor((cur - weekStart) / (7*864e5));
        if (weekIdx % interval === 0 && weekdays.includes(cur.getDay())) { push(fmt(cur)); count++; }
        cur.setDate(cur.getDate() + 1);
      }

    } else if (ev.repeat === "monthly") {
      let idx = 0;
      while (count < HARD_CAP && idx < 400) {
        const monTotal = startD.getMonth() + idx*interval;
        const y  = startD.getFullYear() + Math.floor(monTotal/12);
        const mo = ((monTotal%12)+12)%12;
        const d  = ev.repeatMonthlyType === "weekday"
          ? nthWeekdayOfMonth(y, mo, ev.repeatMonthlyWeekday ?? startD.getDay(), ev.repeatMonthlyOrdinal || 1)
          : new Date(y, mo, Math.min(ev.repeatMonthlyDay || startD.getDate(), new Date(y, mo+1, 0).getDate()));
        if (d > untilD) break;
        if (d >= startD) { push(fmt(d)); count++; }
        idx++;
      }

    } else if (ev.repeat === "yearly") {
      let idx = 0;
      while (count < HARD_CAP && idx < 200) {
        const year = startD.getFullYear() + idx*interval;
        const mo   = (ev.repeatYearlyMonth || startD.getMonth()+1) - 1;
        const d    = ev.repeatYearlyType === "weekday"
          ? nthWeekdayOfMonth(year, mo, ev.repeatYearlyWeekday ?? startD.getDay(), ev.repeatYearlyOrdinal || 1)
          : new Date(year, mo, Math.min(ev.repeatYearlyDay || startD.getDate(), new Date(year, mo+1, 0).getDate()));
        if (d > untilD) break;
        if (d >= startD) { push(fmt(d)); count++; }
        idx++;
      }

    } else {
      out.push(ev);
    }
  }
  return out;
}

// ── 정기청소 배정 반복 규칙 ────────────────────────────────────────
// 배정도 일정과 똑같은 반복 규칙(repeat/repeatWeekdays/repeatMonthlyType 등)을 쓴다.
// 레거시 배정(옛 스키마: days=요일 배열만 있고 repeat 필드가 없음)은 "매주 그 요일들"로 취급해 하위호환한다.
export const assignmentRepeatRule = a => {
  if (a.repeat) return a;
  if (a.days?.length) return { ...a, repeat: "weekly", repeatWeekdays: a.days, start: a.start || "2020-01-01" };
  return a;
};
// 이 배정이 특정 날짜(YYYY-MM-DD)에 해당하는지 — expandRecurring을 그대로 재사용해 일정 반복 로직과 100% 동일하게 판단
export function assignmentOccursOn(assignment, dateStr) {
  const a = assignmentRepeatRule(assignment);
  if (!a.start || !a.repeat || dateStr < a.start) return false;
  const synthetic = {
    id: a.id, start: a.start, end: a.start,
    repeat: a.repeat, repeatInterval: a.repeatInterval,
    repeatWeekdays: a.repeatWeekdays,
    repeatMonthlyType: a.repeatMonthlyType, repeatMonthlyDay: a.repeatMonthlyDay,
    repeatMonthlyOrdinal: a.repeatMonthlyOrdinal, repeatMonthlyWeekday: a.repeatMonthlyWeekday,
    repeatYearlyType: a.repeatYearlyType, repeatYearlyMonth: a.repeatYearlyMonth,
    repeatYearlyDay: a.repeatYearlyDay, repeatYearlyOrdinal: a.repeatYearlyOrdinal, repeatYearlyWeekday: a.repeatYearlyWeekday,
    repeatUntil: a.repeatUntil || "",
  };
  return expandRecurring([synthetic]).some(inst => inst.start === dateStr);
}
// 배정의 반복 규칙을 사람이 읽는 문구로 ("매주 월,수" / "매월 둘째 토요일" 등)
export function describeRepeat(assignment) {
  const a = assignmentRepeatRule(assignment);
  const interval = a.repeatInterval || 1;
  switch (a.repeat) {
    case "daily":
      return interval > 1 ? `${interval}일마다` : "매일";
    case "weekly": {
      const days = (a.repeatWeekdays || []).slice().sort((x,y)=>x-y).map(i=>WD[i]).join(",");
      return interval > 1 ? `${interval}주마다 ${days}` : `매주 ${days}`;
    }
    case "monthly": {
      if (a.repeatMonthlyType === "weekday") {
        const ord = REPEAT_ORD_OPTS.find(o=>o.v===a.repeatMonthlyOrdinal)?.l || "";
        return `매월 ${ord} ${WD[a.repeatMonthlyWeekday]}요일`;
      }
      return `매월 ${a.repeatMonthlyDay}일`;
    }
    case "yearly": {
      if (a.repeatYearlyType === "weekday") {
        const ord = REPEAT_ORD_OPTS.find(o=>o.v===a.repeatYearlyOrdinal)?.l || "";
        return `매년 ${ord} ${WD[a.repeatYearlyWeekday]}요일`;
      }
      return `매년 ${a.repeatYearlyMonth}월 ${a.repeatYearlyDay}일`;
    }
    default:
      return "반복 미설정";
  }
}
// 배정의 반복 규칙 필드만 뽑아 문자열로 비교 — 규칙이 실제로 바뀌었는지 판단할 때 사용
export const REPEAT_FIELDS = ["repeat","repeatInterval","repeatWeekdays","repeatMonthlyType","repeatMonthlyDay","repeatMonthlyOrdinal","repeatMonthlyWeekday","repeatYearlyType","repeatYearlyMonth","repeatYearlyDay","repeatYearlyOrdinal","repeatYearlyWeekday"];
export const pickRepeatFields = a => JSON.stringify(REPEAT_FIELDS.map(k => a[k] ?? null));
// 배정 폼 저장 전 유효성 — 반복 유형별로 필수값이 채워졌는지
export function repeatRuleValid(form) {
  switch (form.repeat) {
    case "weekly":  return (form.repeatWeekdays||[]).length > 0;
    case "monthly": return form.repeatMonthlyType === "weekday" ? (form.repeatMonthlyOrdinal && form.repeatMonthlyWeekday != null) : !!form.repeatMonthlyDay;
    case "yearly":  return form.repeatYearlyType === "weekday" ? (form.repeatYearlyOrdinal && form.repeatYearlyWeekday != null) : (!!form.repeatYearlyMonth && !!form.repeatYearlyDay);
    case "daily":   return true;
    default:        return false;
  }
}
