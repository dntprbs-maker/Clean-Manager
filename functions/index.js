// Clean-Manager Cloud Functions — 일정 등록/수정/삭제 시 담당 팀원에게 푸시 알림
import { onDocumentCreated, onDocumentUpdated, onDocumentDeleted } from "firebase-functions/v2/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import { GoogleGenerativeAI } from "@google/generative-ai";

initializeApp();
const db = getFirestore();

const REGION = "asia-northeast3";
const DOC = "companies/{companyId}/events/{eventId}";
const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");

// 시간 표시 도우미 (HH:MM → 오전/오후 h:mm)
function fmtTime(t) {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  const ap = h < 12 ? "오전" : "오후";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${ap} ${h12}:${String(m).padStart(2, "0")}`;
}

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

  // 2) 알림 받을 직원 추리기
  const usersSnap = await db.collection(`companies/${companyId}/users`).get();
  const targets = [];
  usersSnap.forEach((d) => {
    const u = d.data();
    if (u.status === "deleted") return;
    const isTeamMember = teamName && u.team === teamName;
    const isManager = !teamName && (u.role === "최고관리자" || u.team === "관리팀" || u.team === "사장");
    if (isTeamMember || isManager) {
      (u.fcmTokens || []).forEach((t) => targets.push({ token: t, userRef: d.ref }));
    }
  });

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

    // 핵심 필드가 바뀐 경우에만 알림 (완료토글 등 잡음 방지)
    const keys = ["title", "start", "end", "startTime", "endTime", "allDay", "place", "calId", "team", "description"];
    const changed = keys.some((k) => JSON.stringify(before?.[k]) !== JSON.stringify(after?.[k]));
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

// ── AI 일정 추출 (Gemini) ────────────────────────────────────────
// 카카오톡 상담 대화 / 메모지 사진에서 일정 정보(제목·날짜·시간·장소·연락처)를 추출
const TODAY_HINT = () => new Date().toISOString().slice(0, 10);

const EXTRACT_PROMPT = (context) => `너는 청소업체 일정 관리 앱의 비서야. 아래 ${context}에서 청소/방문 일정 정보를 뽑아 JSON으로만 답해.
오늘 날짜는 ${TODAY_HINT()}이야. 연도가 명시되지 않은 날짜는 오늘 기준 가까운 미래로 추정해.
반드시 아래 스키마의 JSON 객체 하나만 출력하고, 정보가 없는 필드는 빈 문자열("")로 남겨.
{
  "title": "일정 제목 (예: 역촌동 입주청소 25평)",
  "start": "YYYY-MM-DD",
  "end": "YYYY-MM-DD (모르면 start와 동일)",
  "startTime": "HH:MM (24시간제, 모르면 빈 문자열)",
  "endTime": "HH:MM (24시간제, startTime+1시간 기본)",
  "place": "주소 또는 장소",
  "contact": "전화번호 (숫자와 하이픈만)",
  "description": "비밀번호, 특이사항 등 나머지 메모"
}`;

function parseJsonFromModel(text) {
  const cleaned = text.replace(/```json|```/g, "").trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("모델 응답에서 JSON을 찾지 못했습니다.");
  return JSON.parse(match[0]);
}

// 대화(카카오톡 상담) 텍스트 → 일정 정보 추출
export const analyzeConsultation = onCall(
  { region: REGION, secrets: [GEMINI_API_KEY] },
  async (request) => {
    const text = (request.data?.text || "").trim();
    if (!text) throw new HttpsError("invalid-argument", "분석할 텍스트가 없습니다.");
    try {
      const genAI = new GoogleGenerativeAI(GEMINI_API_KEY.value());
      const model = genAI.getGenerativeModel({
        model: "gemini-2.5-flash",
        generationConfig: { responseMimeType: "application/json" },
      });
      const result = await model.generateContent(EXTRACT_PROMPT("고객 상담 대화") + `\n\n---\n${text}\n---`);
      return parseJsonFromModel(result.response.text());
    } catch (e) {
      console.error("[analyzeConsultation] 오류:", e);
      throw new HttpsError("internal", e?.message || "분석 중 오류가 발생했습니다.");
    }
  }
);

// 사진(메모지 촬영본 등) → 일정 정보 추출 (base64 이미지)
export const extractFromImage = onCall(
  { region: REGION, secrets: [GEMINI_API_KEY] },
  async (request) => {
    const image = request.data?.image;
    if (!image) throw new HttpsError("invalid-argument", "이미지가 없습니다.");
    try {
      const genAI = new GoogleGenerativeAI(GEMINI_API_KEY.value());
      const model = genAI.getGenerativeModel({
        model: "gemini-2.5-flash",
        generationConfig: { responseMimeType: "application/json" },
      });
      const result = await model.generateContent([
        EXTRACT_PROMPT("사진 속 텍스트(메모/캡처 이미지)"),
        { inlineData: { mimeType: "image/jpeg", data: image } },
      ]);
      return parseJsonFromModel(result.response.text());
    } catch (e) {
      console.error("[extractFromImage] 오류:", e);
      throw new HttpsError("internal", e?.message || "분석 중 오류가 발생했습니다.");
    }
  }
);
