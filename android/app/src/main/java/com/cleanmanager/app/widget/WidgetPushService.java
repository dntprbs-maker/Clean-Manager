package com.cleanmanager.app.widget;

import android.content.Context;
import android.util.Log;

import com.google.firebase.messaging.FirebaseMessaging;
import com.google.firebase.messaging.RemoteMessage;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * 서버가 "일정이 바뀌었다"고 알려 주면 바뀐 일정만 다시 읽어 위젯을 갱신한다.
 * 회사별 토픽(widget_{companyId})으로 보내므로 같은 회사 휴대폰만 이 알림을 받는다.
 * 위젯이 하나도 없으면 읽지 않고 토픽 구독만 해제한다.
 *
 * (2026-11-01) 전에는 이 클래스가 직접 FirebaseMessagingService였는데, 네이티브 푸시
 * 알림(@capacitor/push-notifications) 도입으로 그 플러그인도 자기 MessagingService를
 * 매니페스트에 선언한다 — 한 앱에 FCM 수신 서비스가 둘이면 어느 쪽이 실제로 호출될지
 * 보장이 안 된다(Android/Firebase 공식 제약). 그래서 이 클래스는 정적 메서드만 남기고,
 * 실제 서비스는 CleanManagerMessagingService 하나로 합쳐서 여기 handleMessage()를 불러준다.
 */
public final class WidgetPushService {

    private static final String TAG = "CleanManagerWidget";

    static final String TOPIC = "widget_" + WidgetConfig.COMPANY_ID;

    private WidgetPushService() {}

    /** widget_changed 데이터 메시지만 처리한다. 다른 타입(공지/일정 알림 등)은 호출하는 쪽에서 별도 처리. */
    public static void handleMessage(Context context, RemoteMessage message) {
        try {
            Map<String, String> data = message.getData();
            if (!"widget_changed".equals(data.get("type"))) return;
            if (!WidgetConfig.COMPANY_ID.equals(data.get("company"))) return;

            Context ctx = context.getApplicationContext();

            // 설치된 위젯이 없으면 읽을 것도 없으니 구독만 정리하고 끝낸다(읽기 0회).
            if (!WidgetRefresher.hasAnyWidget(ctx)) {
                unsubscribe(ctx);
                return;
            }

            String ids = data.get("ids");
            boolean calsChanged = "1".equals(data.get("cals"));
            if (ids == null || ids.isEmpty() || "ALL".equals(ids)) {
                // 어떤 게 바뀌었는지 알 수 없거나 너무 많음 → 현재 화면 기간 전체를 한 번만 다시 읽는다.
                String[] range = WidgetRefresher.refreshRange(ctx);
                WidgetRefresher.ensureRange(ctx, range[0], range[1], true);
            } else {
                List<String> list = new ArrayList<>();
                for (String part : ids.split(",")) {
                    String trimmed = part.trim();
                    if (!trimmed.isEmpty()) list.add(trimmed);
                }
                WidgetRefresher.applyChangedIds(ctx, list, calsChanged);
            }

            CleanManagerWeeklyWidgetProvider.redrawAll(ctx);
            CleanManagerMonthlyWidgetProvider.redrawAll(ctx);
            CleanManagerTwoWeekWidgetProvider.redrawAll(ctx);
            CleanManagerTwoWeekGridWidgetProvider.redrawAll(ctx);
        } catch (Exception e) {
            Log.w(TAG, "푸시 처리 실패", e);
        }
    }

    /** 위젯이 설치돼 있을 때 이 회사 토픽을 구독한다(재설치·토큰 회전 대비 반복 호출 안전). */
    public static void ensureSubscribed(Context ctx) {
        try {
            FirebaseMessaging.getInstance().subscribeToTopic(TOPIC);
        } catch (Exception e) {
            Log.w(TAG, "토픽 구독 실패", e);
        }
    }

    /** 위젯이 없을 때 토픽 구독을 해제해 불필요한 알림을 막는다. */
    static void unsubscribe(Context ctx) {
        try {
            FirebaseMessaging.getInstance().unsubscribeFromTopic(TOPIC);
        } catch (Exception e) {
            Log.w(TAG, "토픽 구독 해제 실패", e);
        }
    }
}
