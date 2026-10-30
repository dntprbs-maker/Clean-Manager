import { createHash } from 'node:crypto';
import { expandRecurringForFeed, addDays } from './recurring.js';

// Import markers are authoritative; titles are never used to guess identity.
export const isImportedEvent = e => Boolean(e.gcalSync || e.icsRaw || e.icsUid || /^(ics_import|gcal_push|google_calendar)$/.test(e.source || ''));
function sourceStatus(e, reports) {
  if (/^(cancelled|canceled|취소|completed|done|완료|deleted)$/i.test(e.status || '')) return e.status;
  if(e.completed === true) return 'completed';
  const rows=reports.filter(r=>r.eventId===e.id && (!e.repeat || e.repeat==='none' || r.date===(e._origDate || e.start)));
  if(rows.some(r=>r.status==='진행중')) return 'in_progress';
  if(rows.some(r=>r.status==='완료')) return 'completed';
  return e.status || 'confirmed';
}
export function buildHubFeed(events, teams, { start, end, offset = 0, snapshot } = {}, reports = []) {
  const valid = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '') && new Date(`${s}T00:00:00Z`).toISOString().slice(0,10) === s;
  if (!valid(start) || !valid(end) || end < start || (Date.parse(end)-Date.parse(start))/86400000 > 366) throw new Error('valid start/end within 366 days required');
  const native = events.filter(e => !isImportedEvent(e)).sort((a,b)=>a.id.localeCompare(b.id));
  const reportState=reports.map(r=>({eventId:r.eventId,date:r.date,status:r.status}));
  const revision = createHash('sha256').update(JSON.stringify([native, teams, reportState, start, end])).digest('hex');
  if (snapshot && snapshot !== revision) throw new Error('snapshot_changed: retry complete sync');
  const rows = expandRecurringForFeed(native.filter(e=>e.status !== 'deleted'), { start, end })
    .filter(e => e.start <= end && (e.end || e.start) >= start)
    .map(e => ({
      source_id: e.repeat && e.repeat !== 'none' ? `${e.id}@${e._origDate || e.start}` : e.id,
      event_id: e.id, title: e.title || '(제목 없음)', description: e.description || null,
      source_status: sourceStatus(e, reportState),
      source_updated_at: e.__hubUpdatedAt || (typeof e.updatedAt === 'string' ? e.updatedAt : null),
      start_at: e.allDay ? e.start : `${e.start}T${e.startTime || '00:00'}:00+09:00`,
      end_at: e.allDay ? addDays(e.end || e.start, 1) : `${e.end || e.start}T${e.endTime || e.startTime || '00:00'}:00+09:00`,
      all_day: Boolean(e.allDay), timezone: 'Asia/Seoul', location: e.place || null,
      recurring_event_id: e.repeat && e.repeat !== 'none' ? e.id : null,
      recurrence: e.repeat && e.repeat !== 'none' ? JSON.stringify(Object.fromEntries(Object.entries(e).filter(([k])=>k.startsWith('repeat')))) : null,
      calendar_id: e.calId || null, worker: e.team || teams[e.calId] || null,
      source_url: 'https://clean-manager-60bc9.web.app/',
    })).sort((a,b)=>a.source_id.localeCompare(b.source_id));
  return { schema_version: 1, snapshot: revision, window_from: start, window_to: addDays(end,1), total: rows.length,
    items: rows.slice(offset, offset+200), next_offset: offset+200 < rows.length ? offset+200 : null,
    excluded_imported: events.length-native.length };
}
