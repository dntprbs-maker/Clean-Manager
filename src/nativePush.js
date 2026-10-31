// 네이티브 앱(안드로이드 Capacitor 껍데기)에서만 쓰는 푸시 등록.
// 웹(브라우저)은 fcm.js의 enablePush()가 담당 — 이 파일은 그쪽을 건드리지 않는다.
// 실제 알림 "표시"는 안드로이드 네이티브 쪽(CleanManagerMessagingService)이 데이터
// 메시지를 직접 받아서 띄운다 — 여기서는 권한 요청 + 토큰 발급 + Firestore 등록만 한다.
import { Capacitor } from "@capacitor/core";
import { claimToken } from "./fcm";

let started = false;

export async function setupNativePush(user) {
  if (!Capacitor.isNativePlatform()) return;
  if (!user?.uid || !user?.companyId) return;
  if (started) return;
  started = true;

  try {
    const { PushNotifications } = await import("@capacitor/push-notifications");

    let perm = await PushNotifications.checkPermissions();
    if (perm.receive === "prompt" || perm.receive === "prompt-with-rationale") {
      perm = await PushNotifications.requestPermissions();
    }
    if (perm.receive !== "granted") {
      console.warn("[nativePush] 알림 권한 거부됨:", perm.receive);
      started = false;
      return;
    }

    await PushNotifications.addListener("registration", (token) => {
      claimToken(user, token.value).catch((e) =>
        console.warn("[nativePush] 토큰 등록 실패:", e)
      );
    });
    await PushNotifications.addListener("registrationError", (err) => {
      console.warn("[nativePush] 등록 실패:", err);
    });

    await PushNotifications.register();
  } catch (e) {
    console.warn("[nativePush] 설정 실패:", e);
    started = false;
  }
}
