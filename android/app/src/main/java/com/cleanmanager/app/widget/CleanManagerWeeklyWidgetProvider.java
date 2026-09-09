package com.cleanmanager.app.widget;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.widget.RemoteViews;

import com.cleanmanager.app.R;

public class CleanManagerWeeklyWidgetProvider extends AppWidgetProvider {

    static final String ACTION_REFRESH = "com.cleanmanager.app.widget.ACTION_REFRESH";

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        for (int appWidgetId : appWidgetIds) {
            updateWidget(context, appWidgetManager, appWidgetId);
        }
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        super.onReceive(context, intent);
        if (ACTION_REFRESH.equals(intent.getAction())) {
            AppWidgetManager mgr = AppWidgetManager.getInstance(context);
            int[] ids = mgr.getAppWidgetIds(
                    new android.content.ComponentName(context, CleanManagerWeeklyWidgetProvider.class));
            mgr.notifyAppWidgetViewDataChanged(ids, R.id.widget_list);
        }
    }

    private void updateWidget(Context context, AppWidgetManager appWidgetManager, int appWidgetId) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_weekly);

        Intent svcIntent = new Intent(context, WidgetRemoteViewsService.class);
        svcIntent.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId);
        svcIntent.setData(Uri.parse(svcIntent.toUri(Intent.URI_INTENT_SCHEME)));
        views.setRemoteAdapter(R.id.widget_list, svcIntent);
        views.setEmptyView(R.id.widget_list, R.id.widget_empty);

        // 위젯 리스트 아이템 클릭 -> 클린매니저 웹앱을 브라우저로 바로 열기
        Intent clickTemplate = new Intent(Intent.ACTION_VIEW);
        PendingIntent clickTemplatePendingIntent = PendingIntent.getActivity(
                context, 0, clickTemplate,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_MUTABLE);
        views.setPendingIntentTemplate(R.id.widget_list, clickTemplatePendingIntent);

        // 헤더(제목) 클릭 -> 동일하게 웹앱 열기
        Intent openAppIntent = new Intent(Intent.ACTION_VIEW, Uri.parse(WidgetConfig.WEB_APP_URL));
        PendingIntent openAppPendingIntent = PendingIntent.getActivity(
                context, 1, openAppIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        views.setOnClickPendingIntent(R.id.widget_header, openAppPendingIntent);

        // 새로고침 버튼 -> 목록 다시 조회
        Intent refreshIntent = new Intent(context, CleanManagerWeeklyWidgetProvider.class);
        refreshIntent.setAction(ACTION_REFRESH);
        PendingIntent refreshPendingIntent = PendingIntent.getBroadcast(
                context, appWidgetId, refreshIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        views.setOnClickPendingIntent(R.id.widget_refresh, refreshPendingIntent);

        appWidgetManager.updateAppWidget(appWidgetId, views);
        appWidgetManager.notifyAppWidgetViewDataChanged(appWidgetId, R.id.widget_list);
    }
}
