// Clean-Manager Cloud Functions — 일정 등록/수정/삭제 시 담당 팀원에게 푸시 알림
import { onDocumentCreated, onDocumentUpdated, onDocumentDeleted } from "firebase-functions/v2/firestore";
import { onCall, HttpsError, onRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { defineSecret } from "firebase-functions/params";
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import { getMemberships } from "./lib/membership.js";
import { fmtDate, addDays, expandRecurringForFeed } from "./lib/recurring.js";
import { parseIcs } from "./lib/ics.js";
export { mcp } from "./mcp/index.js";
// mcp/index.js가 (ESM import 순서상 이 줄보다 먼저 평가되며) lib/db.js를 통해
// initializeApp()을 이미 호출했을 수 있으므로 중복 호출 방지 체크.
if (getApps().length === 0) initializeApp();
const db = getFirestore();

const REGION = "asia-northeast3";
const DOC = "companies/{companyId}/events/{eventId}";
const OPENROUTER_API_KEY = defineSecret("OPENROUTER_API_KEY");
const AI_MODEL = "openai/gpt-4o";

// 시간 표시 도우미 (HH:MM → 오전/오후 h:mm)
function fmtTime(t) {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  const ap = h < 12 ? "오전" : "오후";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${ap} ${h12}:${String(m).padStart(2, "0")}`;
}

function isMemberOfTeam(u, team) {
  return getMemberships(u).some((m) => m.team === team);
}

// admins 컬렉션은 로그인 정보(아이디/비번)가 담겨있어 클라이언트 직접 쓰기가
// Firestore 규칙으로 막혀있다(그래서 클라이언트에서 바로 fcmTokens를 갱신하려던
// 시도가 매번 조용히 실패했음 — try/catch로 삼켜져서 앱에서는 "켜짐"으로만 보임).
// 서버(Admin SDK, 규칙 우회)를 거쳐서만 토큰을 등록/해제하도록 분리.
export const syncAdminPushToken = onCall({ region: REGION }, async (request) => {
  const { uid, token, action } = request.data || {};
  if (!uid || !token) throw new HttpsError("invalid-argument", "uid/token이 필요합니다.");

  if (action === "remove") {
    await db.doc(`admins/${uid}`).update({ fcmTokens: FieldValue.arrayRemove(token) }).catch(() => {});
    return { ok: true };
  }

  // 이 토큰이 다른 관리자 문서에 남아있으면 정리(한 기기 = 마지막 로그인한 사람만 알림)
  const dupSnap = await db.collection("admins").where("fcmTokens", "array-contains", token).get();
  await Promise.all(dupSnap.docs.map((d) =>
    d.id === uid ? null : d.ref.update({ fcmTokens: FieldValue.arrayRemove(token) }).catch(() => {})
  ));
  await db.doc(`admins/${uid}`).update({ fcmTokens: FieldValue.arrayUnion(token) }).catch(() => {});
  return { ok: true };
});

// 공통: 특정 일정(ev)에 대해 담당 팀원에게 알림 발송
// action: "created" | "updated" | "deleted"
async function notifyTeam(companyId, eventId, ev, action) {
  if (!ev) return;

  // 1) 담당 팀명 알아내기
  let teamName = ev.team || "";
  if (!teamName && ev.calId) {
    try {
      const calDoc = await db.doc(`companies/${companyId}/cals/${ev.calId}`).get();
      if (calDoc.exists) teamName = calDoc.data().name || calDoc.data().label || "";
    } catch (e) { /* 무시 */ }
  }

  // 2) 알림 받을 직원 추리기 (다대다 멤버십 기준)
  const usersSnap = await db.collection(`companies/${companyId}/users`).get();
  const targets = [];
  usersSnap.forEach((d) => {
    const u = d.data();
    if (u.status === "deleted") return;
    const isTeamMember = teamName && isMemberOfTeam(u, teamName);
    const isManager = !teamName && isMemberOfTeam(u, "관리팀");
    if (isTeamMember || isManager) {
      (u.fcmTokens || []).forEach((t) => targets.push({ token: t, userRef: d.ref }));
    }
  });

  // 최고관리자(사장)는 companies/{id}/users가 아니라 별도 admins 컬렉션에 저장돼 있어
  // 위 루프에서 안 잡힌다 — 담당팀 미배정 일정일 때만 별도로 추가.
  // (예전엔 이 부분이 없어서 사장 계정 토큰이 존재해도 알림 대상에서 항상 빠졌음)
  if (!teamName) {
    const adminsSnap = await db.collection("admins").where("companyId", "==", companyId).get();
    adminsSnap.forEach((d) => {
      const a = d.data();
      if (a.status === "deleted") return;
      (a.fcmTokens || []).forEach((t) => targets.push({ token: t, userRef: d.ref }));
    });
  }

  if (targets.length === 0) {
    console.log(`[알림:${action}] 대상 토큰 없음 (team=${teamName || "미지정"})`);
    return;
  }

  // 3) 알림 내용 구성 (동작별 제목)
  const label = action === "created" ? "새 일정" : action === "updated" ? "일정 변경" : "일정 취소";
  const prefix = teamName ? `[${teamName}] ` : "";
  const dateLine = ev.allDay ? `${ev.start} 종일` : `${ev.start} ${fmtTime(ev.startTime)}`;
  const title = `${prefix}${label}`;
  const body = `${ev.title || "제목 없음"}\n${dateLine}${ev.place ? " · " + ev.place : ""}`;

  // 4) 발송 — data-only 메시지 (notification 필드 넣으면 브라우저가 자동 표시 + SW 표시로 중복됨)
  //         표시는 클라이언트(SW onBackgroundMessage / 포그라운드 onMessage)에서 한 번만 처리
  const tokens = [...new Set(targets.map((t) => t.token))];
  const resp = await getMessaging().sendEachForMulticast({
    tokens,
    data: { title, body, companyId, eventId, type: `event_${action}` },
    webpush: { fcmOptions: { link: "/" } },
  });
  console.log(`[알림:${action}] 발송 ${resp.successCount}/${tokens.length} (team=${teamName || "미지정"})`);

  // 5) 무효 토큰 정리
  const invalid = [];
  resp.responses.forEach((r, i) => {
    if (!r.success) {
      const code = r.error?.code || "";
      if (code.includes("registration-token-not-registered") || code.includes("invalid-argument")) {
        invalid.push(tokens[i]);
      }
    }
  });
  if (invalid.length) {
    const cleanups = new Map();
    targets.forEach((t) => { if (invalid.includes(t.token)) cleanups.set(t.userRef.path, t.userRef); });
    await Promise.all([...cleanups.values()].map((ref) =>
      ref.update({ fcmTokens: FieldValue.arrayRemove(...invalid) }).catch(() => {})
    ));
  }
}

// 일정 등록
export const sendEventNotification = onDocumentCreated(
  { region: REGION, document: DOC },
  async (event) => {
    if (!event.data) return;
    await notifyTeam(event.params.companyId, event.params.eventId, event.data.data(), "created");
  }
);

// 일정 수정 — 알림에 영향 없는 사소한 변경은 건너뛰기
export const sendEventUpdateNotification = onDocumentUpdated(
  { region: REGION, document: DOC },
  async (event) => {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    if (!after) return;

    // 팀장 코멘트(leaderComment*)만 바뀐 경우는 "일정 수정"이 아니라 별도 메모 기능이라 제외.
    // 그 외에는 반복 설정 등 어떤 필드든 바뀌면 알림 (예전엔 특정 필드만 봐서 반복만 바꾼 수정이 누락됐음)
    const NOISE_KEYS = new Set(["leaderComment", "leaderCommentBy", "leaderCommentAt"]);
    const allKeys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
    const changed = [...allKeys].some((k) => !NOISE_KEYS.has(k) && JSON.stringify(before?.[k]) !== JSON.stringify(after?.[k]));
    if (!changed) return;

    await notifyTeam(event.params.companyId, event.params.eventId, after, "updated");
  }
);

// 일정 삭제
export const sendEventDeleteNotification = onDocumentDeleted(
  { region: REGION, document: DOC },
  async (event) => {
    if (!event.data) return;
    await notifyTeam(event.params.companyId, event.params.eventId, event.data.data(), "deleted");
  }
);

// KST(Asia/Seoul) 기준 오늘 날짜(YYYY-MM-DD). Cloud Functions 런타임은 로컬 타임존이
// UTC라 new Date().getDate()를 그냥 쓰면 새벽 시간대(KST 0~9시)에 날짜가 하루 밀린다.
// UTC 기준 getter만 써서(런타임 타임존 설정과 무관하게) KST로 보정해 계산한다.
function todayKST() {
  const kst = new Date(Date.now() + 9 * 3600 * 1000);
  return `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, "0")}-${String(kst.getUTCDate()).padStart(2, "0")}`;
}

// ── 매일 아침 "오늘 일정" 요약 알림 (시험 운영) ───────────────────────
// 지금은 회사별 최고관리자(사장)에게만 보내고, 그 날 일정이 하나도 없으면 안 보낸다.
// 팀 필터 없이 그 날의 전체 일정을 다 모아서 보낸다(사장은 전체를 봐야 하므로).
// 잘 되는지 보고 나중에 팀 전체 발송/시간대 등을 검토하기로 함.
async function runDailyDigest(dateStr, titlePrefix) {
  const companiesSnap = await db.collection("companies").get();
  const log = [];

  for (const companyDoc of companiesSnap.docs) {
    const companyId = companyDoc.id;
    if (companyDoc.data()?.status === "deleted") continue;

    try {
      const [eventsSnap, calsSnap] = await Promise.all([
        db.collection(`companies/${companyId}/events`).get(),
        db.collection(`companies/${companyId}/cals`).get(),
      ]);
      // 직원 개인 캘린더(personal: true)는 회사 업무 요약에 안 어울려서 제외한다.
      const personalCalIds = new Set(calsSnap.docs.filter((d) => d.data().personal).map((d) => d.id));
      const events = eventsSnap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((e) => e.status !== "deleted" && !personalCalIds.has(e.calId));
      const todays = expandRecurringForFeed(events).filter(
        (e) => e.start <= dateStr && (e.end || e.start) >= dateStr
      );
      if (todays.length === 0) { log.push(`${companyId}: 그 날 일정 없음 — 안 보냄`); continue; }

      // 최고관리자(사장)는 companies/{id}/users가 아니라 별도 admins 컬렉션에 저장돼 있다.
      const adminsSnap = await db.collection("admins").where("companyId", "==", companyId).get();
      const tokens = [];
      adminsSnap.forEach((d) => {
        const a = d.data();
        if (a.status === "deleted") return; // 시험 운영: 사장만
        (a.fcmTokens || []).forEach((t) => tokens.push(t));
      });
      if (tokens.length === 0) { log.push(`${companyId}: 사장 토큰 없음(일정 ${todays.length}건인데 못 보냄)`); continue; }

      const sorted = [...todays].sort((a, b) => (a.startTime || "").localeCompare(b.startTime || ""));
      const lines = sorted.map((e) => {
        const time = e.allDay ? "종일" : e.startTime ? fmtTime(e.startTime) : "";
        const team = e.team ? `[${e.team}] ` : "";
        return `${time ? time + " " : ""}${team}${e.title || "제목 없음"}`;
      });

      const uniqueTokens = [...new Set(tokens)];
      const resp = await getMessaging().sendEachForMulticast({
        tokens: uniqueTokens,
        data: { title: `${titlePrefix} 일정 ${todays.length}건`, body: lines.join("\n"), companyId, type: "daily_digest" },
        webpush: { fcmOptions: { link: "/" } },
      });
      log.push(`${companyId}: 발송 ${resp.successCount}/${uniqueTokens.length} (일정 ${todays.length}건)`);
    } catch (e) {
      log.push(`${companyId}: 오류 ${e?.message || e}`);
    }
  }
  return log;
}

export const dailyScheduleDigest = onSchedule(
  { region: REGION, schedule: "0 8 * * *", timeZone: "Asia/Seoul" },
  async () => {
    const log = await runDailyDigest(todayKST(), "오늘");
    console.log(`[dailyScheduleDigest] ${log.join(" | ")}`);
  }
);

// ── AI 일정 추출 (Gemini) ────────────────────────────────────────
// 카카오톡 상담 대화 / 메모지 사진에서 일정 정보(제목·날짜·시간·장소·연락처)를 추출
const TODAY_HINT = () => new Date().toISOString().slice(0, 10);

const EXTRACT_PROMPT = (context) => `너는 청소업체 일정 관리 앱의 비서야. 아래 ${context}에서 청소/방문 일정 정보를 뽑아 JSON으로만 답해.
사진/대화 안에는 실제 청소 일정과 무관한 내용(다른 잡담, 앱 사용법 문의, 링크 미리보기 카드, 웹사이트 이름/URL 등)이 섞여 있을 수 있어.
그런 것들은 절대 제목이나 내용으로 쓰지 말고, 반드시 "주소/평수/날짜/연락처 등이 포함된 실제 청소·방문 일정 내용"만 찾아서 추출해.
오늘 날짜는 ${TODAY_HINT()}이야. 연도가 명시되지 않은 날짜는 오늘 기준 가까운 미래로 추정해.
시간이 "오전"/"오후"처럼 대략적으로만 언급되고 정확한 시각이 없으면: "오전"은 09:00, "오후"는 14:00을 시작 시각으로 기본 사용해.
반드시 아래 스키마의 JSON 객체 하나만 출력하고, 정보가 없는 필드는 빈 문자열("")로 남겨.
{
  "title": "일정 제목 (예: 역촌동 입주청소 25평)",
  "start": "YYYY-MM-DD",
  "end": "YYYY-MM-DD (모르면 start와 동일)",
  "startTime": "HH:MM (24시간제, 정확한 시각이 없고 오전/오후만 언급되면 위 기본값 규칙 적용, 그마저 없으면 빈 문자열)",
  "endTime": "HH:MM (24시간제, startTime+1시간 기본)",
  "place": "주소 또는 장소",
  "contact": "전화번호 (숫자와 하이픈만)",
  "description": "고객 이름, 현관/도어락 비밀번호, 주차 안내, 반려동물, 요청사항 등 title/start/end/place/contact에 안 들어간 내용을 전부 빠짐없이 항목별로 줄바꿈해서 적어. 절대 요약하거나 생략하지 말고, 대화/메모에 나온 구체적인 표현을 최대한 그대로 살려서 적어."
}`;

function parseJsonFromModel(text) {
  const cleaned = text.replace(/```json|```/g, "").trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("모델 응답에서 JSON을 찾지 못했습니다.");
  return JSON.parse(match[0]);
}

// OpenRouter chat completions 호출 공통 헬퍼
async function callOpenRouter(apiKey, content) {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: AI_MODEL,
      messages: [{ role: "user", content }],
    }),
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(json?.error?.message || `OpenRouter 요청 실패 (HTTP ${res.status})`);
  }
  return json.choices?.[0]?.message?.content || "";
}

// 대화(카카오톡 상담) 텍스트 → 일정 정보 추출
// aiTextExtraction 플래그가 명시적으로 false인 회사만 차단 (기본값은 허용 — 기존 사용자 영향 없도록)
export const analyzeConsultation = onCall(
  { region: REGION, secrets: [OPENROUTER_API_KEY] },
  async (request) => {
    const text = (request.data?.text || "").trim();
    const companyId = request.data?.companyId;
    if (!text) throw new HttpsError("invalid-argument", "분석할 텍스트가 없습니다.");

    if (companyId) {
      const companySnap = await db.doc(`companies/${companyId}`).get();
      if (companySnap.exists && companySnap.data()?.aiTextExtraction === false) {
        throw new HttpsError("permission-denied", "이 기능은 현재 요금제에서 사용할 수 없습니다.");
      }
    }

    try {
      const raw = await callOpenRouter(
        OPENROUTER_API_KEY.value(),
        EXTRACT_PROMPT("고객 상담 대화") + `\n\n---\n${text}\n---`
      );
      return parseJsonFromModel(raw);
    } catch (e) {
      console.error("[analyzeConsultation] 오류:", e);
      throw new HttpsError("internal", e?.message || "분석 중 오류가 발생했습니다.");
    }
  }
);

// 사진(메모지 촬영본 등) → 일정 정보 추출 (base64 이미지)
// 요금제에 aiImageExtraction 플래그가 켜진 회사만 사용 가능 (서버단에서 재검증)
export const extractFromImage = onCall(
  { region: REGION, secrets: [OPENROUTER_API_KEY] },
  async (request) => {
    const image = request.data?.image;
    const companyId = request.data?.companyId;
    if (!image) throw new HttpsError("invalid-argument", "이미지가 없습니다.");
    if (!companyId) throw new HttpsError("invalid-argument", "companyId가 필요합니다.");

    const companySnap = await db.doc(`companies/${companyId}`).get();
    if (!companySnap.exists || !companySnap.data()?.aiImageExtraction) {
      throw new HttpsError("permission-denied", "이 기능은 현재 요금제에서 사용할 수 없습니다.");
    }

    try {
      const raw = await callOpenRouter(OPENROUTER_API_KEY.value(), [
        { type: "text", text: EXTRACT_PROMPT("사진 속 텍스트(메모/캡처 이미지)") },
        { type: "image_url", image_url: { url: `data:image/jpeg;base64,${image}` } },
      ]);
      return parseJsonFromModel(raw);
    } catch (e) {
      console.error("[extractFromImage] 오류:", e);
      throw new HttpsError("internal", e?.message || "분석 중 오류가 발생했습니다.");
    }
  }
);

// ── 팀 캘린더 구독 피드 (.ics) — 네이버/구글 캘린더 "URL로 구독"용 ──────────
// 네이버는 자동 동기화용 구독 링크를 만들 수 있는 공개 쓰기 API가 없어서
// 반대 방향(클린메니져 → 네이버)으로 표준 iCalendar 피드를 발행해 구독하게 함.
function icsEscape(str) {
  return String(str || "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

// KST(Asia/Seoul, UTC+9) 날짜+시간 → UTC ICS 포맷(YYYYMMDDTHHMMSSZ)
function toIcsUtc(dateStr, timeStr) {
  const [y,m,d] = dateStr.split("-").map(Number);
  const [h,mi]  = (timeStr || "00:00").split(":").map(Number);
  const dt = new Date(Date.UTC(y, m-1, d, h - 9, mi));
  return `${dt.getUTCFullYear()}${String(dt.getUTCMonth()+1).padStart(2,"0")}${String(dt.getUTCDate()).padStart(2,"0")}T${String(dt.getUTCHours()).padStart(2,"0")}${String(dt.getUTCMinutes()).padStart(2,"0")}00Z`;
}
const toIcsDate = dateStr => dateStr.replace(/-/g, "");

export const calendarFeed = onRequest({ region: REGION, cors: true }, async (req, res) => {
  // 네이버 등 일부 캘린더 앱은 URL이 .ics 로 끝나야 구독 대상으로 인식하므로
  // 경로 방식(/calendarFeed/{company}/{cal}/{token}.ics)을 우선 지원하고,
  // 기존 쿼리 파라미터 방식(?company=...&cal=...&token=...)도 하위 호환으로 유지
  const pathParts = req.path.split("/").filter(Boolean);
  let company, cal, token;
  if (pathParts.length >= 3) {
    company = pathParts[0];
    cal = pathParts[1];
    token = pathParts[2].replace(/\.ics$/i, "");
  } else {
    ({ company, cal, token } = req.query);
  }
  if (!company || !cal || !token) {
    res.status(400).send("잘못된 요청입니다.");
    return;
  }
  try {
    const calSnap = await db.doc(`companies/${company}/cals/${cal}`).get();
    const calData = calSnap.data();
    if (!calSnap.exists || !calData?.feedToken || calData.feedToken !== token) {
      res.status(403).send("접근 권한이 없습니다.");
      return;
    }
    const evSnap = await db.collection(`companies/${company}/events`).where("calId", "==", cal).get();
    const events = evSnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(e => e.status !== "deleted");
    const expanded = expandRecurringForFeed(events);

    // 지난 7일 이전 회차는 굳이 개인 캘린더에 안 보여줘도 됨 (앞으로의 일정 위주)
    const cutoff = fmtDate(new Date(Date.now() - 7*864e5));
    const visible = expanded.filter(ev => ev.start >= cutoff);

    const now = new Date();
    const dtstamp = `${now.getUTCFullYear()}${String(now.getUTCMonth()+1).padStart(2,"0")}${String(now.getUTCDate()).padStart(2,"0")}T${String(now.getUTCHours()).padStart(2,"0")}${String(now.getUTCMinutes()).padStart(2,"0")}${String(now.getUTCSeconds()).padStart(2,"0")}Z`;

    const lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Clean-Manager//Calendar Feed//KO",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      `X-WR-CALNAME:${icsEscape((calData.label || calData.name || "팀") + " - 클린메니져")}`,
    ];
    visible.forEach(ev => {
      const uid = `${ev.id}-${ev._origDate || ev.start}@cleanmanager.app`;
      lines.push("BEGIN:VEVENT");
      lines.push(`UID:${uid}`);
      lines.push(`DTSTAMP:${dtstamp}`);
      if (ev.allDay) {
        lines.push(`DTSTART;VALUE=DATE:${toIcsDate(ev.start)}`);
        lines.push(`DTEND;VALUE=DATE:${toIcsDate(addDays(ev.end || ev.start, 1))}`);
      } else {
        lines.push(`DTSTART:${toIcsUtc(ev.start, ev.startTime || "09:00")}`);
        lines.push(`DTEND:${toIcsUtc(ev.end || ev.start, ev.endTime || "10:00")}`);
      }
      lines.push(`SUMMARY:${icsEscape(ev.title || "제목 없음")}`);
      if (ev.place) lines.push(`LOCATION:${icsEscape(ev.place)}`);
      if (ev.description) lines.push(`DESCRIPTION:${icsEscape(ev.description)}`);
      lines.push("END:VEVENT");
    });
    lines.push("END:VCALENDAR");

    res.set("Content-Type", "text/calendar; charset=utf-8");
    res.set("Cache-Control", "no-store");
    res.status(200).send(lines.join("\r\n"));
  } catch (e) {
    console.error("[calendarFeed] 오류:", e);
    res.status(500).send("서버 오류가 발생했습니다.");
  }
});

// ── 외부 캘린더 구독 자동 동기화 (반대 방향: 구글/네이버 → 클린메니져) ──────
// calendarFeed()가 "클린메니져 → 외부"로 내보내는 피드라면, 이건 "외부 → 클린메니져"로
// 끌어오는 쪽. 구글 캘린더는 "비공개 주소(iCal 형식)"로 구독용 .ics URL을 주는데, 그 주소는
// 항상 최신 상태를 반환하는 정적 파일이라 서버가 주기적으로 다시 받아오기만 하면 자동 동기화가 된다.
// (네이버는 이런 구독용 URL 자체가 없어 이 방식이 안 통함 — 그래서 여전히 파일 재업로드 방식만 지원)
//
// 팀(cal) 문서의 icsSubscriptionUrl 필드에 구독 URL을 저장해두면:
//   1) syncIcsSubscriptionNow — 저장 직후 즉시 1회 동기화(onCall, 클라이언트에서 호출)
//   2) icsSubscriptionAutoSync — 6시간마다 전체 회사·전체 팀을 돌며 자동 재동기화(onSchedule)
// 두 경로 모두 같은 syncIcsForCal()을 호출해 로직이 한 곳에만 있다.

// webcal:// 은 브라우저/캘린더 앱이 구독 앱을 실행하라는 신호일 뿐 실제 통신은 https와 동일 —
// 서버에서 fetch할 땐 https로 바꿔야 함.
function toFetchableUrl(raw) {
  return String(raw || "").trim().replace(/^webcal:\/\//i, "https://");
}

// 아주 기초적인 SSRF 방지 — 회사 관리자가 입력한 URL을 서버가 대신 요청하는 구조라
// 사내망(로컬호스트/사설대역)을 찌르는 값을 넣는 걸 최소한으로 막는다. 완벽한 차단은 아니고
// (DNS 리바인딩 등은 못 막음) 실수/오남용 방지 수준.
function isBlockedHost(hostname) {
  const h = hostname.toLowerCase();
  return h === "localhost" || h === "127.0.0.1" || h === "::1" ||
    /^10\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(h);
}

// 한 팀 캘린더의 구독 URL을 받아와 파싱하고, 같은 방식(source: "ics_import")으로 이미
// 가져온 이 팀의 기존 일정과 비교해 upsert + 소프트 삭제한다.
// 클라이언트의 ImportCalendarScreen.handleImport()와 같은 알고리즘(UID로 갱신,
// 구독 쪽에서 사라진 건 소프트 삭제)이되, calId로 범위를 좁혀서 다른 팀이 수동으로
// 올린 파일이나 다른 구독의 일정까지 건드리지 않도록 한 점만 다르다.
async function syncIcsForCal(companyId, calId, rawUrl) {
  const url = toFetchableUrl(rawUrl);
  let hostname;
  try { hostname = new URL(url).hostname; } catch { throw new Error("구독 URL 형식이 올바르지 않습니다."); }
  if (!/^https?:$/.test(new URL(url).protocol)) throw new Error("http(s) 또는 webcal 주소만 지원합니다.");
  if (isBlockedHost(hostname)) throw new Error("허용되지 않는 주소입니다.");

  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`구독 URL 응답 실패 (HTTP ${res.status})`);
  const text = await res.text();
  const parsed = parseIcs(text).filter(ev => ev.icsUid); // UID 없는 항목은 재동기화 추적이 안 돼 건너뜀

  const eventsRef = db.collection(`companies/${companyId}/events`);
  const newUidSet = new Set(parsed.map(ev => ev.icsUid));
  const prevSnap = await eventsRef
    .where("source", "==", "ics_import")
    .where("calId", "==", calId)
    .get();
  const staleDocs = prevSnap.docs.filter(d => d.data().status !== "deleted" && !newUidSet.has(d.id));
  const deletedAt = new Date().toISOString();
  await Promise.all(staleDocs.map(d =>
    d.ref.update({ status: "deleted", deletedAt, deletedBy: "ics_subscription" })
  ));

  await Promise.all(parsed.map(ev => {
    const { icsUid, ...rest } = ev;
    const docId = icsUid;
    return eventsRef.doc(docId).set({
      ...rest,
      id: docId,
      calId,
      end: ev.end || ev.start,
      startTime: ev.startTime || "09:00",
      endTime: ev.endTime || "10:00",
      allDay: ev.allDay || false,
      place: ev.place || "",
      description: ev.description || "",
      source: "ics_import",
    }, { merge: true });
  }));

  return { imported: parsed.length, removed: staleDocs.length };
}

// 저장 직후 "지금 바로 동기화" 버튼용 — 결과를 그 자리에서 화면에 보여줄 수 있도록 동기 호출
export const syncIcsSubscriptionNow = onCall({ region: REGION }, async (request) => {
  const { companyId, calId } = request.data || {};
  if (!companyId || !calId) throw new HttpsError("invalid-argument", "companyId/calId가 필요합니다.");

  const calRef = db.doc(`companies/${companyId}/cals/${calId}`);
  const calSnap = await calRef.get();
  if (!calSnap.exists) throw new HttpsError("not-found", "캘린더를 찾을 수 없습니다.");
  const url = calSnap.data()?.icsSubscriptionUrl;
  if (!url) throw new HttpsError("failed-precondition", "구독 URL이 설정되어 있지 않습니다.");

  try {
    const result = await syncIcsForCal(companyId, calId, url);
    await calRef.update({ icsSubscriptionLastSyncAt: new Date().toISOString(), icsSubscriptionLastError: null });
    return { ok: true, ...result };
  } catch (e) {
    await calRef.update({ icsSubscriptionLastError: e?.message || String(e) }).catch(() => {});
    throw new HttpsError("internal", e?.message || "동기화 중 오류가 발생했습니다.");
  }
});

// 6시간마다 전체 회사·전체 팀을 돌며 구독 URL이 설정된 캘린더를 재동기화.
// 회사/팀 수가 많지 않은 서비스 규모라 전수 스캔으로 충분 — 늘어나면 그때 인덱싱 검토.
export const icsSubscriptionAutoSync = onSchedule(
  { region: REGION, schedule: "0 */6 * * *", timeZone: "Asia/Seoul" },
  async () => {
    const companiesSnap = await db.collection("companies").get();
    const log = [];
    for (const companyDoc of companiesSnap.docs) {
      if (companyDoc.data()?.status === "deleted") continue;
      const calsSnap = await db.collection(`companies/${companyDoc.id}/cals`).get();
      for (const calDoc of calsSnap.docs) {
        const url = calDoc.data()?.icsSubscriptionUrl;
        if (!url) continue;
        try {
          const result = await syncIcsForCal(companyDoc.id, calDoc.id, url);
          await calDoc.ref.update({ icsSubscriptionLastSyncAt: new Date().toISOString(), icsSubscriptionLastError: null });
          log.push(`${companyDoc.id}/${calDoc.id}: 가져옴 ${result.imported} 삭제 ${result.removed}`);
        } catch (e) {
          await calDoc.ref.update({ icsSubscriptionLastError: e?.message || String(e) }).catch(() => {});
          log.push(`${companyDoc.id}/${calDoc.id}: 오류 ${e?.message || e}`);
        }
      }
    }
    console.log(`[icsSubscriptionAutoSync] ${log.join(" | ")}`);
  }
);
