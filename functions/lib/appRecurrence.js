// Shared app/widget recurrence engine. Date-only arithmetic is UTC; the default
// evaluation date is Asia/Seoul, so server and client agree across time zones.
const fmt = d => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
const pd = s => {
  const [y, m, d] = String(s || "").split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
const diff = (s, e) => Math.round((pd(e) - pd(s)) / 86400000);
const add = (s, days) => {
  const d = pd(s);
  d.setUTCDate(d.getUTCDate() + days);
  return fmt(d);
};
const nthWeekdayOfMonth = (year, month, weekday, ordinal) => {
  if (ordinal === -1) {
    const last = new Date(Date.UTC(year, month + 1, 0));
    last.setUTCDate(last.getUTCDate() - (last.getUTCDay() - weekday + 7) % 7);
    return last;
  }
  const first = new Date(Date.UTC(year, month, 1));
  return new Date(Date.UTC(year, month, 1 + (weekday - first.getUTCDay() + 7) % 7 + (ordinal - 1) * 7));
};

// ── 반복 일정 전개 ────────────────────────────────────────────────
// start/end are inclusive calendar dates, matching the app's stored end field.
// Jump to the requested window instead of truncating old series at 400 instances.
export function expandRecurring(events, window = {}) {
  const now = pd(window.evaluationDate || new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10));
  const defaultUntil = fmt(new Date(Date.UTC(now.getUTCFullYear() + 1, now.getUTCMonth(), now.getUTCDate())));
  const out = [];
  const validDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s || "") && fmt(pd(s)) === s;
  if ((window.start && !validDate(window.start)) || (window.end && !validDate(window.end))) {
    throw new RangeError("Invalid recurrence window");
  }
  if (window.start && window.end && window.start > window.end) return [];
  const overlaps = (start, end) => (!window.start || end >= window.start) && (!window.end || start <= window.end);
  for (const ev of events) {
    if (!ev.repeat || ev.repeat === "none" || !["daily", "weekly", "monthly", "yearly"].includes(ev.repeat)) {
      if (overlaps(ev.start, ev.end || ev.start)) out.push(ev);
      continue;
    }
    if (!validDate(ev.start)) throw new RangeError("Invalid recurrence start");
    const startD = pd(ev.start);
    const dur = Math.max(0, diff(ev.start, ev.end || ev.start));
    const until = ev.repeatUntil || defaultUntil;
    if (!validDate(until)) throw new RangeError("Invalid recurrence end");
    const interval = Number.isFinite(Number(ev.repeatInterval)) ? Math.max(1, Math.floor(Number(ev.repeatInterval))) : 1;
    const monthDate = idx => {
      const month = startD.getUTCMonth() + idx * interval;
      const y = startD.getUTCFullYear() + Math.floor(month / 12);
      const mo = ((month % 12) + 12) % 12;
      return ev.repeatMonthlyType === "weekday"
        ? nthWeekdayOfMonth(y, mo, ev.repeatMonthlyWeekday ?? startD.getUTCDay(), ev.repeatMonthlyOrdinal || 1)
        : new Date(Date.UTC(y, mo, Math.min(ev.repeatMonthlyDay || startD.getUTCDate(), new Date(Date.UTC(y, mo + 1, 0)).getUTCDate())));
    };
    const yearDate = idx => {
      const y = startD.getUTCFullYear() + idx * interval;
      const mo = (ev.repeatYearlyMonth || startD.getUTCMonth() + 1) - 1;
      return ev.repeatYearlyType === "weekday"
        ? nthWeekdayOfMonth(y, mo, ev.repeatYearlyWeekday ?? startD.getUTCDay(), ev.repeatYearlyOrdinal || 1)
        : new Date(Date.UTC(y, mo, Math.min(ev.repeatYearlyDay || startD.getUTCDate(), new Date(Date.UTC(y, mo + 1, 0)).getUTCDate())));
    };
    const weekdays = ev.repeatWeekdays?.length ? ev.repeatWeekdays : [startD.getUTCDay()];
    const weekStart = add(ev.start, -startD.getUTCDay());
    const isOccurrence = date => {
      if (!validDate(date) || date < ev.start || date > until) return false;
      const d = pd(date);
      if (ev.repeat === "daily") return diff(ev.start, date) % interval === 0;
      if (ev.repeat === "weekly") return Math.floor(diff(weekStart, date) / 7) % interval === 0 && weekdays.includes(d.getUTCDay());
      const distance = ev.repeat === "monthly"
        ? (d.getUTCFullYear() - startD.getUTCFullYear()) * 12 + d.getUTCMonth() - startD.getUTCMonth()
        : d.getUTCFullYear() - startD.getUTCFullYear();
      const idx = Math.floor(distance / interval);
      const candidate = ev.repeat === "monthly" ? monthDate : yearDate;
      // A fifth weekday may spill into the next month (legacy semantics).
      return [idx - 1, idx].some(i => i >= 0 && fmt(candidate(i)) === date);
    };
    const seen = new Set();
    let work = 0;
    const guard = () => {
      if (++work > 100000) throw new RangeError("Recurrence overflow: narrow the requested range");
    };
    const push = date => {
      guard();
      if (seen.has(date)) return;
      seen.add(date);
      const ex = ev.exceptions?.[date];
      if (ex?._deleted) return;
      const merged = ex ? { ...ev, ...ex } : ev;
      const start = ex?.start || date;
      const end = ex?.end || add(start, dur);
      if (!overlaps(start, end)) return;
      // Exceptions must not replace the authoritative series ID.
      out.push({ ...merged, id: ev.id, _origDate: date, start, end, _recurring: true, _hasException: !!ex });
    };
    const low = window.start ? (add(window.start, -dur) > ev.start ? add(window.start, -dur) : ev.start) : ev.start;
    const high = window.end && window.end < until ? window.end : until;
    if (ev.repeat === "daily") {
      let date = add(ev.start, Math.max(0, Math.ceil(diff(ev.start, low) / interval)) * interval);
      while (date <= high) { push(date); date = add(date, interval); }
    } else if (ev.repeat === "weekly") {
      for (let date = low; date <= high; date = add(date, 1)) {
        guard();
        if (isOccurrence(date)) push(date);
      }
    } else {
      const lowD = pd(low);
      const distance = ev.repeat === "monthly"
        ? (lowD.getUTCFullYear() - startD.getUTCFullYear()) * 12 + lowD.getUTCMonth() - startD.getUTCMonth()
        : lowD.getUTCFullYear() - startD.getUTCFullYear();
      const candidate = ev.repeat === "monthly" ? monthDate : yearDate;
      for (let idx = Math.max(0, Math.floor(distance / interval) - 1); ; idx++) {
        guard();
        const date = fmt(candidate(idx));
        if (date > high) break;
        if (date >= low && date >= ev.start) push(date);
      }
    }
    // A valid original occurrence outside the window can be moved into it.
    // Validate the original date so arbitrary exception keys cannot create work.
    for (const date of Object.keys(ev.exceptions || {})) {
      guard();
      if (!seen.has(date) && isOccurrence(date)) push(date);
    }
  }
  return out;
}

