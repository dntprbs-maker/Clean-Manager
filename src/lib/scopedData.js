import { collection, doc, query, where, orderBy, limit, documentId, onSnapshot } from 'firebase/firestore';
import { expandRecurring } from './repeat.js';

export function calendarRange(current, selected, extraDay) {
  const date = (y, m, d) => { const v = new Date(y, m, d); return `${v.getFullYear()}-${String(v.getMonth()+1).padStart(2,'0')}-${String(v.getDate()).padStart(2,'0')}`; };
  const y = current.getFullYear(), m = current.getMonth();
  const first = new Date(y,m,1), last = new Date(y,m+1,0);
  const from = date(y,m,1-first.getDay());
  const to = date(y,m+1,6-last.getDay());
  return { start: [from,selected,extraDay].filter(Boolean).sort()[0], end: [to,selected,extraDay].filter(Boolean).sort().at(-1) };
}

// A distant selected day must not turn a month view into a multi-year scan.
export function calendarWindows(current, selected, extraDay) {
  const month = calendarRange(current, null, null);
  const windows = [{ from: month.start, to: month.end }];
  for (const day of [...new Set([selected, extraDay].filter(Boolean))]) {
    if (!windows.some(w => day >= w.from && day <= w.to)) windows.push({ from: day, to: day });
  }
  return windows.sort((a,b)=>a.from.localeCompare(b.from));
}

export function expandEventsInWindows(events, windows) {
  const rows = new Map();
  for (const window of windows) for (const event of expandRecurring(events, { start: window.from, end: window.to })) {
    rows.set(`${event.id}:${event._origDate || event.start}`, event);
  }
  return [...rows.values()];
}

// Each snapshot replaces membership of its own query. A 'removed' document can
// still belong to another range/pinned query; never infer a global delete.
export function subscribeGroup(companyId, specs, receive, status) {
  let alive = true;
  const rows = specs.map(() => []), ready = specs.map(() => false), cached = specs.map(() => true), errors = specs.map(() => null);
  const publish = () => {
    if (!alive) return;
    const map = new Map();
    rows.flat().forEach(row => map.set(row.id, row));
    receive([...map.values()]);
    status({ ready: ready.every(Boolean), cached: cached.some(Boolean), error: errors.find(Boolean) || null });
  };
  status({ ready: false, cached: true, error: null });
  receive([]);
  const unsubs = specs.map((s,i) => {
    const base = s.id ? doc(s.db, 'companies', companyId, s.collection, s.id) : collection(s.db, 'companies', companyId, s.collection);
    const clauses = (s.where || []).map(([field,op,value]) => where(field,op,value));
    (s.order || []).forEach(([field,dir]) => clauses.push(orderBy(field === '__name__' ? documentId() : field,dir)));
    if (s.limit) clauses.push(limit(s.limit));
    const target = s.id ? base : clauses.length ? query(base,...clauses) : base;
    return onSnapshot(target, { includeMetadataChanges: true }, snap => {
      if (!alive) return;
      const docs = s.id ? (snap.exists() ? [snap] : []) : snap.docs;
      errors[i] = null;
      rows[i] = docs.map(d => ({ ...d.data(), id:d.id }));
      cached[i] = snap.metadata.fromCache || snap.metadata.hasPendingWrites;
      ready[i] = !cached[i];
      publish();
    }, err => {
      if (!alive) return;
      ready[i] = false;
      errors[i] = err.code || "unknown";
      status({ ready:false, cached:cached.some(Boolean), error:err.code || 'unknown' });
    });
  });
  if (!specs.length) publish();
  return () => { alive = false; unsubs.forEach(u => u()); };
}
