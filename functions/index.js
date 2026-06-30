// Clean-Manager Cloud Functions — 일정 등록 시 담당 팀원에게 푸시 알림
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";

initializeApp();
const db = getFirestore();

// 시간 표시 도우미 (HH:MM → 오전/오후 h:mm)
function fmtTime(t) {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  const ap = h < 12 ? "오전" : "오후";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${ap} ${h12}:${String(m).padStart(2, "0")}`;
}

export const sendEventNotification = onDocumentCreated(
  { region: "asia-northeast3", document: "companies/{companyId}/events/{eventId}" },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const ev = snap.data();
    const { companyId } = event.params;

    // 1) 담당 팀명 알아내기: event.team 우선, 없으면 calId → cals 문서의 name
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
      // 팀 미지정 일정은 사장/관리팀에게 알림 (배정 필요)
      const isManager = !teamName && (u.role === "최고관리자" || u.team === "관리팀" || u.team === "사장");
      if (isTeamMember || isManager) {
        (u.fcmTokens || []).forEach((t) => targets.push({ token: t, userRef: d.ref }));
      }
    });

    if (targets.length === 0) {
      console.log(`[알림] 대상 토큰 없음 (team=${teamName || "미지정"})`);
      return;
    }

    // 3) 알림 내용 구성
    const dateLine = ev.allDay ? `${ev.start} 종일` : `${ev.start} ${fmtTime(ev.startTime)}`;
    const title = teamName ? `[${teamName}] 새 일정` : "새 일정 (미배정)";
    const body = `${ev.title || "제목 없음"}\n${dateLine}${ev.place ? " · " + ev.place : ""}`;

    // 4) 발송 (토큰 중복 제거)
    const tokens = [...new Set(targets.map((t) => t.token))];
    const resp = await getMessaging().sendEachForMulticast({
      tokens,
      notification: { title, body },
      data: { companyId, eventId: event.params.eventId, type: "event_created" },
      webpush: {
        notification: { icon: "/favicon.svg" },
        fcmOptions: { link: "/" },
      },
    });

    console.log(`[알림] 발송 ${resp.successCount}/${tokens.length} 성공 (team=${teamName || "미지정"})`);

    // 5) 무효 토큰 정리 — 직원 문서에서 제거
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
      targets.forEach((t) => {
        if (invalid.includes(t.token)) cleanups.set(t.userRef.path, t.userRef);
      });
      await Promise.all(
        [...cleanups.values()].map((ref) =>
          ref.update({ fcmTokens: FieldValue.arrayRemove(...invalid) }).catch(() => {})
        )
      );
      console.log(`[알림] 무효 토큰 ${invalid.length}개 정리`);
    }
  }
);
