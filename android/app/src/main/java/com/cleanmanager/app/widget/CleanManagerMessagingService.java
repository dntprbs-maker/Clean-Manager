package com.cleanmanager.app.widget;

import androidx.annotation.NonNull;

import com.capacitorjs.plugins.pushnotifications.MessagingService;
import com.google.firebase.messaging.RemoteMessage;

/**
 * 이 앱의 유일한 FCM 수신 서비스.
 *
 * @capacitor/push-notifications 플러그인은 자기 자신의 MessagingService를 매니페스트에
 * 선언하는데, 우리 앱도 위젯 갱신용으로 또 하나를 선언하면 한 앱에 FCM 서비스가 둘이 돼서
 * 둘 중 하나만(또는 둘 다 불안정하게) 호출된다 — Android/Firebase가 공식적으로 지원하지
 * 않는 구성이다. 그래서 플러그인의 MessagingService를 상속해서 하나로 합친다:
 * super 호출로 플러그인 쪽 동작(포그라운드일 때 JS로 pushNotificationReceived 전달,
 * 토큰 발급 시 registration 이벤트 전달)을 그대로 유지하면서, 위젯 갱신과 시스템 알림
 * 표시를 추가한다. AndroidManifest.xml에서 이 클래스만 MESSAGING_EVENT로 선언하고,
 * 플러그인이 자동으로 넣는 기본 선언은 tools:node="remove"로 제외한다.
 */
public class CleanManagerMessagingService extends MessagingService {

    @Override
    public void onMessageReceived(@NonNull RemoteMessage remoteMessage) {
        super.onMessageReceived(remoteMessage);
        WidgetPushService.handleMessage(getApplicationContext(), remoteMessage);
        AppNotifications.showIfNeeded(getApplicationContext(), remoteMessage);
    }

    @Override
    public void onNewToken(@NonNull String token) {
        super.onNewToken(token);
    }
}
