// Clean-Manager Cloud Functions — 일정 등록/수정/삭제 시 담당 팀원에게 푸시 알림
import { onDocumentCreated, onDocumentUpdated, onDocumentDeleted } from "firebase-functions/v2/firestore";
import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";

initializeApp();
const db = getFirestore();

const REGION = "asia-northeast3";
const DOC = "companies/{companyId}/events/{eventId}";

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
