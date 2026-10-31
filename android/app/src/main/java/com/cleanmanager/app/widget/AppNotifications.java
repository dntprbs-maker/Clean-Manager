package com.cleanmanager.app.widget;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.util.Log;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

import com.cleanmanager.app.MainActivity;
import com.cleanmanager.app.R;
import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;
import java.util.Random;

/**
 * 서버가 보내는 일정/공지 알림(data-only 메시지)을 안드로이드 시스템 알림으로 직접 띄운다.
 *
 * 서버(functions/index.js의 dispatchPush)는 웹 쪾과 똑같이 notification 필드 없는
 * data-only 메시지만 보낸다(웹은 서비스워커가 알아서 띄움). 네이티브 앱은 그 서비스워커가
 * 없으므로, 여기서 데이터 필드(title/body)를 직접 읽어 알림을 만든다 — widget_changed
 * (위젯 갱신용, 사용자에게 보일 필요 없음)는 제외.
 */
final class AppNotifications {

    private static final String TAG = "CleanManagerPush";
    private static final String CHANNEL_ID = "cm_default";

    private AppNotifications() {}

    static void showIfNeeded(Context context, RemoteMessage message) {
        try {
            Map<String, String> data = message.getData();
            if (data == null || data.isEmpty()) return;

            String type = data.get("type");
            if ("widget_changed".equals(type)) return; // 위젯 갱신 전용, 사용자 알림 아님

            String title = data.get("title");
            String body = data.get("body");
            if (title == null && body == null) return;

            ensureChannel(context);

            Intent intent = new Intent(context, MainActivity.class);
            intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            int flags = PendingIntent.FLAG_UPDATE_CURRENT
                    | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ? PendingIntent.FLAG_IMMUTABLE : 0);
            PendingIntent pendingIntent = PendingIntent.getActivity(context, 0, intent, flags);

            NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
                    .setSmallIcon(R.mipmap.ic_launcher)
                    .setContentTitle(title != null ? title : "클린매니저")
                    .setContentText(body != null ? body : "")
                    .setStyle(new NotificationCompat.BigTextStyle().bigText(body != null ? body : ""))
                    .setAutoCancel(true)
                    .setPriority(NotificationCompat.PRIORITY_HIGH)
                    .setContentIntent(pendingIntent);

            int notifId = Math.abs(new Random().nextInt());
            NotificationManagerCompat.from(context).notify(notifId, builder.build());
        } catch (SecurityException e) {
            // POST_NOTIFICATIONS 권한이 아직 없을 때(Android 13+) — 조용히 무시
            Log.w(TAG, "알림 권한 없음, 표시 생략", e);
        } catch (Exception e) {
            Log.w(TAG, "알림 표시 실패", e);
        }
    }

    private static void ensureChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = context.getSystemService(NotificationManager.class);
        if (nm == null || nm.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID, "클린매니저 알림", NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription("일정/공지 알림");
        nm.createNotificationChannel(channel);
    }
}
