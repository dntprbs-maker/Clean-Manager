// ICS(iCalendar) 텍스트 파서 — 구독 URL 자동 동기화용.
// src/features/import-calendar/ImportCalendarScreen.jsx의 parseICS()와 동일한 로직을 그대로
// 옮겨둔 것(클라이언트/functions가 별도 빌드 산출물이라 공유 모듈로 못 묶어 부득이 중복 —
// 이 프로젝트의 functions/lib/membership.js, functions/lib/recurring.js와 같은 기존 패턴).
// 파서 로직을 고치면 두 파일 다 같이 고쳐야 함.
export function parseIcs(text) {
  const events = [];
  const normalized = text.split("\r\n").join("\n").split("\r").join("\n");
  const lines = normalized.split("\n");
  let current = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === "BEGIN:VEVENT") {
      current = {};
    } else if (line === "END:VEVENT" && current) {
      if (current.title && current.start) events.push(current);
      current = null;
    } else if (current) {
      if (line.startsWith("SUMMARY:")) {
        current.title = line.replace("SUMMARY:", "").trim();
      } else if (line.startsWith("DTSTART")) {
        const val = line.split(":").pop().trim();
        current.start = val.length >= 8
          ? val.slice(0, 4) + "-" + val.slice(4, 6) + "-" + val.slice(6, 8)
          : val;
        if (val.length > 8) {
          const h = val.slice(9, 11);
          const m = val.slice(11, 13);
          current.startTime = h + ":" + m;
          current.allDay = false;
        } else {
          current.allDay = true;
        }
      } else if (line.startsWith("DTEND")) {
        const val = line.split(":").pop().trim();
        current.end = val.length >= 8
          ? val.slice(0, 4) + "-" + val.slice(4, 6) + "-" + val.slice(6, 8)
          : val;
        if (val.length > 8) {
          const h = val.slice(9, 11);
          const m = val.slice(11, 13);
          current.endTime = h + ":" + m;
        }
      } else if (line.startsWith("LOCATION:")) {
        current.place = line.replace("LOCATION:", "").trim();
      } else if (line.startsWith("DESCRIPTION:")) {
        current.description = line.replace("DESCRIPTION:", "").trim().replace(/\\n/g, "\n");
      } else if (line.startsWith("UID:")) {
        // Firestore 문서 ID로 사용 — 재동기화 시 같은 일정을 덮어쓰기 위함
        current.icsUid = line.replace("UID:", "").trim().replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 100);
      }
    }
  }
  return events;
}
