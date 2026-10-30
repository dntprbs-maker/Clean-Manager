// ── calendarFeed(.ics) 조회 범위 제한 헬퍼 ──────────────────────────────
// 외부 캘린더 앱이 구독 피드를 자주(하루 수백 회) 물어보는데, 기존에는 팀 일정을
// 전부 읽어 메모리에서 걸렀다. 여기서 필요한 기간만 Firestore 쿼리로 가져온다.
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

// 서울 기준 날짜를 기존 fmtDate 와 같은 YYYY-MM-DD 형식으로 만든다.
function seoulDateStr(ms) {
  const d = new Date(ms + KST_OFFSET_MS);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function addDaysStr(dateStr, n) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

/**
 * 피드에 필요한 일정만 읽는다.
 * - 기간 내 일반 일정: start 가 [cutoff, horizon] 안에 있는 문서
 * - 반복 일정: 시작일이 과거여도 회차가 기간에 걸칠 수 있으므로 repeat 값을 가진 문서 전부
 * 두 결과를 문서 id 로 합치고(중복 제거) status 가 deleted 인 것만 뺀다.
 */
export async function loadFeedEvents(db, company, cal, nowMs) {
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  const today = seoulDateStr(now);
  const cutoff = addDaysStr(today, -7);   // 지난 7일 이전 회차는 개인 캘린더에 안 보여줘도 됨
  const horizon = addDaysStr(today, 92);  // 앞으로 약 3개월치

  const col = db.collection(`companies/${company}/events`);
  const [rangeSnap, repeatSnap] = await Promise.all([
    col.where("calId", "==", cal).where("start", ">=", cutoff).where("start", "<=", horizon).get(),
    col.where("calId", "==", cal).where("repeat", "in", ["daily", "weekly", "monthly", "yearly"]).get(),
  ]);

  const byId = new Map();
  for (const snap of [rangeSnap, repeatSnap]) {
    snap.docs.forEach((d) => {
      if (!byId.has(d.id)) byId.set(d.id, { id: d.id, ...d.data() });
    });
  }
  const events = [...byId.values()].filter((e) => e.status !== "deleted");
  return { events, cutoff, horizon };
}
