// FCM 클라이언트 헬퍼 — 알림 권한 요청 + 토큰 발급 + Firestore 저장
import { getToken, onMessage } from "firebase/messaging";
import { doc, updateDoc, arrayUnion } from "firebase/firestore";
import { db, fcmVapidKey, getMessagingIfSupported } from "./firebase";

// 알림 권한 요청 → 토큰 발급 → 직원 문서에 토큰 저장
// 성공 시 { ok:true, token }, 실패 시 { ok:false, reason } 반환
export async function enablePush(user) {
  if (!user?.uid || !user?.companyId) return { ok:false, reason:"사용자 정보 없음" };
  if (!("Notification" in window))     return { ok:false, reason:"이 브라우저는 알림 미지원" };
  if (!fcmVapidKey)                     return { ok:false, reason:"VAPID 키 미설정" };
  if (!("serviceWorker" in navigator)) return { ok:false, reason:"서비스워커 미지원" };

  const messaging = await getMessagingIfSupported();
  if (!messaging) return { ok:false, reason:"FCM 미지원 환경(isSupported=false)" };

  const perm = Notification.permission === "granted"
    ? "granted"
    : await Notification.requestPermission();
  if (perm !== "granted") return { ok:false, reason:"권한 거부됨("+perm+")" };

  try {
    const swReg = await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}firebase-messaging-sw.js`);
    await navigator.serviceWorker.ready;
    const token = await getToken(messaging, { vapidKey: fcmVapidKey, serviceWorkerRegistration: swReg });
    if (!token) return { ok:false, reason:"토큰 빈 값" };

    await Promise.all([
      updateDoc(doc(db, "companies", user.companyId, "users", user.uid), { fcmTokens: arrayUnion(token) }).catch(()=>{}),
      updateDoc(doc(db, "staffs", user.uid), { fcmTokens: arrayUnion(token) }).catch(()=>{}),
    ]);
    return { ok:true, token };
  } catch (e) {
    console.error("[FCM] 토큰 발급 실패:", e);
    return { ok:false, reason: e?.message || String(e) };
  }
}

// 포그라운드(앱이 화면에 떠 있을 때) 메시지 수신 → 알림 표시
// 모바일 브라우저는 new Notification()을 지원하지 않으므로 서비스워커의 showNotification 사용
export async function listenForeground() {
  const messaging = await getMessagingIfSupported();
  if (!messaging) return;
  onMessage(messaging, async payload => {
    if (Notification.permission !== "granted") return;
    const d = payload.data || {};
    const title = d.title || payload.notification?.title || "클린메니져";
    const options = {
      body: d.body || payload.notification?.body || "",
      icon: `${import.meta.env.BASE_URL}favicon.svg`,
      tag: d.eventId || undefined,
      data: d,
    };
    try {
      const reg = await navigator.serviceWorker.getRegistration(`${import.meta.env.BASE_URL}firebase-messaging-sw.js`)
        || await navigator.serviceWorker.ready;
      if (reg?.showNotification) { reg.showNotification(title, options); return; }
    } catch { /* SW 없으면 아래로 */ }
    // 데스크톱 폴백
    try { new Notification(title, options); } catch { /* 미지원 무시 */ }
  });
}
