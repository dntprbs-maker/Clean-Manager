package com.cleanmanager.app.widget;

import android.content.Context;
import android.util.Log;

import com.google.firebase.messaging.FirebaseMessaging;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * 서버가 "일정이 바뀌었다"고 알려 주면 바뀐 일정만 다시 읽어 위젯을 갱신한다.
 * 회사별 토픽(widget_{companyId})으로 보내므로 같은 회사 휴대폰만 이 알림을 받는다.
 * 위젯이 하나도 없으면 읽지 않고 토픽 구독만 해제한다.
 */
public class WidgetPushService extends FirebaseMessagingService {

    private static final String TAG = "CleanManagerWidget";

    static final String TOPIC = "widget_" + WidgetConfig.COMPANY_ID;

    @Override
    public void onMessageReceived(RemoteMessage message) {
        try {
            Map<String, String> data = message.getData();
            if (!"widget_changed".equals(data.get("type"))) return;
            if (!WidgetConfig.COMPANY_ID.equals(data.get("company"))) return;

            Context ctx = getApplicationContext();

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

    @Override
    public void onNewToken(String token) {
        // 토픽 방식이라 토큰을 서버에 올릴 필요가 없다.
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
