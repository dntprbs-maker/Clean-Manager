import { createHash } from "node:crypto";
import { expandRecurring } from "./appRecurrence.js";

const DAY_MS = 86400000;
const shiftDate = (date, days) => new Date(Date.parse(date) + days * DAY_MS).toISOString().slice(0, 10);
export const isOccurrenceDate = date => typeof date === "string"
  && /^\d{4}-\d{2}-\d{2}$/.test(date)
  && Number.isFinite(Date.parse(date))
  && shiftDate(date, 0) === date;

export class OccurrenceError extends Error {}

export async function readEventTarget(reader, ref, occurrenceDate) {
  const get = document => reader ? reader.get(document) : document.get();
  const snap = await get(ref);
  const series = snap.data();
  if (!snap.exists || series.status === "deleted") throw new OccurrenceError("일정을 찾을 수 없습니다.");
  if (!occurrenceDate) return { ref, current: series, version: snap.updateTime };

  const exception = series.exceptions?.[occurrenceDate] || {};
  if (exception.detachedEventId) {
    const standaloneRef = ref.parent.doc(exception.detachedEventId);
    const standalone = await get(standaloneRef);
    if (!standalone.exists || standalone.data().status === "deleted") {
      throw new OccurrenceError("분리한 단건 일정을 찾을 수 없습니다.");
    }
    return { ref: standaloneRef, current: standalone.data(), version: standalone.updateTime };
  }

  const [base] = expandRecurring([{ ...series, id: ref.id, exceptions: {} }], {
    start: occurrenceDate, end: occurrenceDate,
  }).filter(event => event._origDate === occurrenceDate);
  if (!base || exception._deleted) throw new OccurrenceError(`반복 일정의 ${occurrenceDate} 회차를 찾을 수 없습니다.`);

  const start = exception.start || base.start;
  const duration = (Date.parse(base.end) - Date.parse(base.start)) / DAY_MS;
  const current = {
    ...base, ...exception, id: ref.id, _origDate: occurrenceDate,
    start, end: exception.end || shiftDate(start, duration),
  };
  const key = createHash("sha256").update(JSON.stringify([ref.id, occurrenceDate])).digest("hex");
  return { ref: ref.parent.doc(`occurrence_${key}`), current, seriesRef: ref, occurrenceDate, version: snap.updateTime };
}

export function standaloneEvent(target, patch) {
  const { exceptions, gcalSync, icsRaw, icsUid, ...fields } = { ...target.current, ...patch };
  const event = Object.fromEntries(Object.entries(fields)
    .filter(([key, value]) => !key.startsWith("_") && !key.startsWith("repeat") && value !== undefined));
  return {
    ...event,
    id: target.ref.id,
    repeat: "none",
    detachedFrom: { eventId: target.seriesRef.id, occurrenceDate: target.occurrenceDate },
  };
}

export async function writeEventTarget(transaction, target, patch) {
  if (!target.seriesRef) {
    transaction.update(target.ref, patch);
    return;
  }

  // A report belongs to the occurrence it was started for. Keep its original
  // work date even when the calendar entry is rescheduled.
  const reportDocs = (await transaction.get(target.seriesRef.parent.parent.collection("reports")
    .where("eventId", "==", target.seriesRef.id)
    .where("date", "==", target.current.start))).docs;
  transaction.set(target.ref, standaloneEvent(target, patch));
  transaction.update(target.seriesRef, {
    [`exceptions.${target.occurrenceDate}`]: { _deleted: true, detachedEventId: target.ref.id },
  });
  for (const report of reportDocs) transaction.update(report.ref, { eventId: target.ref.id });
}
