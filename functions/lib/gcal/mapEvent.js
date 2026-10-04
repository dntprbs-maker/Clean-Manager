// Google Calendar API의 Event 리소스 → 클린메니져 일정 필드 변환.
// 필드 구성은 기존 ICS 구독 동기화(index.js syncIcsForCal의 incoming)와 똑같이 맞춘다.
import { PAST_CUTOFF_DAYS, RECURRING_HORIZON_DAYS } from "./config.js";

const pad = (n) => String(n).padStart(2, "0");
const KST_OFFSET_MS = 9 * 3600 * 1000;

// 문서 ID 규칙 — functions/lib/ics.js의 UID 처리와 동일(같은 일정이 같은 문서로 이어지도록).
export const sanitizeId = (s) => String(s || "").trim().replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 100);

// 단일 일정은 iCalUID 기반(ICS 구독이 만든 문서와 같은 ID), 반복 일정의 각 회차는
// 회차마다 다른 event.id 기반(iCalUID는 시리즈 전체가 같아서 쓰면 회차끼리 덮어씀).
export function docIdFor(ev) {
  if (ev.recurringEventId) return `gcal_${sanitizeId(ev.id)}`;
  return sanitizeId(ev.iCalUID || ev.id);
}

// RFC3339 → KST 날짜/시간 ("2026-10-05", "10:00")
export function toKst(dateTime) {
  const t = Date.parse(dateTime);
  if (Number.isNaN(t)) return null;
  const d = new Date(t + KST_OFFSET_MS);
  return {
    date: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`,
    time: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`,
  };
}

export function addDaysStr(dateStr, n) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

export const kstToday = (nowMs) => toKst(new Date(nowMs).toISOString()).date;

// 설명란은 HTML이 섞여 올 수 있어(구글 웹에서 서식 사용 시) 일반 텍스트로 정리.
export function htmlToText(s) {
  if (!s) return "";
  if (!/<[a-z][\s\S]*>/i.test(s)) return s;
  return s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// cancelled가 아닌 이벤트 → { docId, incoming }. 날짜 정보가 없으면 null.
export function mapEvent(ev) {
  const docId = docIdFor(ev);
  let start, startTime, end, endTime, allDay;
  if (ev.start?.date) {
    allDay = true;
    start = ev.start.date;
    // 구글의 종일 일정 end.date는 "다음날"(배타적) — 클린메니져는 마지막 날을 포함하는 방식
    end = ev.end?.date ? addDaysStr(ev.end.date, -1) : start;
    if (end < start) end = start;
  } else if (ev.start?.dateTime) {
    allDay = false;
    const s = toKst(ev.start.dateTime);
    const e = ev.end?.dateTime ? toKst(ev.end.dateTime) : null;
    if (!s) return null;
    start = s.date; startTime = s.time;
    end = e?.date || s.date; endTime = e?.time || null;
  } else {
    return null;
  }
  return {
    docId,
    incoming: {
      title: (ev.summary || "").trim() || "제목 없음",
      start,
      startTime: startTime || "09:00",
      end,
      endTime: endTime || "10:00",
      allDay,
      place: ev.location || "",
      description: htmlToText(ev.description || ""),
    },
  };
}

// 새로 만들지 여부(이미 있는 문서는 창 밖이어도 계속 갱신한다).
// - 지난 30일보다 오래된 일정은 만들지 않음(기존 ICS 규칙과 동일)
// - 반복 일정 회차는 1년 뒤까지만 만듦
export function isInCreateWindow(incoming, ev, nowMs) {
  const today = kstToday(nowMs);
  if (incoming.start < addDaysStr(today, -PAST_CUTOFF_DAYS)) return false;
  if (ev.recurringEventId && incoming.start > addDaysStr(today, RECURRING_HORIZON_DAYS)) return false;
  return true;
}
