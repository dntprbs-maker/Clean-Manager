// ── 반복 일정 전개 헬퍼 ──────────────────────────────────────────────
// 앱 캘린더 화면의 expandRecurring과 동일한 규칙으로 반복 일정을 개별 회차로 전개.
// calendarFeed(.ics)와 MCP list_events 도구가 함께 쓴다.
export const fmtDate = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
export const parseDate = s => { if (!s) return null; const [y,m,dd] = s.split("-").map(Number); return new Date(y,m-1,dd); };
export const diffDays = (s,e) => !s||!e?0:Math.round((parseDate(e)-parseDate(s))/864e5);
export const addDays = (s,n) => { const d=parseDate(s); d.setDate(d.getDate()+n); return fmtDate(d); };
export const nthWeekdayOfMonthF = (year, monthIndex, weekday, ordinal) => {
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

export function expandRecurringForFeed(events) {
  const HARD_CAP = 400;
  const now = new Date();
  const defaultUntil = fmtDate(new Date(now.getFullYear(), now.getMonth() + 6, now.getDate()));
  const out = [];
  for (const ev of events) {
    if (!ev.repeat || ev.repeat === "none") { out.push(ev); continue; }
    const dur      = diffDays(ev.start, ev.end || ev.start);
    const until    = ev.repeatUntil || defaultUntil;
    const untilD   = parseDate(until);
    const startD   = parseDate(ev.start);
    const interval = Math.max(1, Number(ev.repeatInterval) || 1);
    const push = (dStr) => {
      const ex = ev.exceptions?.[dStr];
      if (ex && ex._deleted) return;
      const merged = ex ? { ...ev, ...ex } : ev;
      const outStart = ex?.start || dStr;
      const outEnd   = ex?.end   || addDays(outStart, dur);
      out.push({ ...merged, _origDate: dStr, start: outStart, end: outEnd });
    };
    let count = 0;
    if (ev.repeat === "daily") {
      let cur = ev.start;
      while (cur <= until && count < HARD_CAP) { push(cur); count++; cur = addDays(cur, interval); }
    } else if (ev.repeat === "weekly") {
      const weekdays  = (ev.repeatWeekdays && ev.repeatWeekdays.length) ? ev.repeatWeekdays : [startD.getDay()];
      const weekStart = new Date(startD); weekStart.setDate(weekStart.getDate() - weekStart.getDay());
      let cur = new Date(startD);
      while (cur <= untilD && count < HARD_CAP) {
        const weekIdx = Math.floor((cur - weekStart) / (7*864e5));
        if (weekIdx % interval === 0 && weekdays.includes(cur.getDay())) { push(fmtDate(cur)); count++; }
        cur.setDate(cur.getDate() + 1);
      }
    } else if (ev.repeat === "monthly") {
      let idx = 0;
      while (count < HARD_CAP && idx < 400) {
        const monTotal = startD.getMonth() + idx*interval;
        const y  = startD.getFullYear() + Math.floor(monTotal/12);
        const mo = ((monTotal%12)+12)%12;
        const d  = ev.repeatMonthlyType === "weekday"
          ? nthWeekdayOfMonthF(y, mo, ev.repeatMonthlyWeekday ?? startD.getDay(), ev.repeatMonthlyOrdinal || 1)
          : new Date(y, mo, Math.min(ev.repeatMonthlyDay || startD.getDate(), new Date(y, mo+1, 0).getDate()));
        if (d > untilD) break;
        if (d >= startD) { push(fmtDate(d)); count++; }
        idx++;
      }
    } else if (ev.repeat === "yearly") {
      let idx = 0;
      while (count < HARD_CAP && idx < 200) {
        const year = startD.getFullYear() + idx*interval;
        const mo   = (ev.repeatYearlyMonth || startD.getMonth()+1) - 1;
        const d    = ev.repeatYearlyType === "weekday"
          ? nthWeekdayOfMonthF(year, mo, ev.repeatYearlyWeekday ?? startD.getDay(), ev.repeatYearlyOrdinal || 1)
          : new Date(year, mo, Math.min(ev.repeatYearlyDay || startD.getDate(), new Date(year, mo+1, 0).getDate()));
        if (d > untilD) break;
        if (d >= startD) { push(fmtDate(d)); count++; }
        idx++;
      }
    } else {
      out.push(ev);
    }
  }
  return out;
}
