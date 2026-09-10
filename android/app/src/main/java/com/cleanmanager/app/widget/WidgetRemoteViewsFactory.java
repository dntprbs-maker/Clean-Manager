package com.cleanmanager.app.widget;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.widget.RemoteViews;
import android.widget.RemoteViewsService;

import com.cleanmanager.app.R;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

class WidgetRemoteViewsFactory implements RemoteViewsService.RemoteViewsFactory {

    private final Context context;
    private final List<WidgetEvent> events = new ArrayList<>();
    private volatile boolean lastFetchFailed = false;

    WidgetRemoteViewsFactory(Context context) {
        this.context = context;
    }

    @Override
    public void onCreate() {
    }

    @Override
    public void onDataSetChanged() {
        // 위젯 호스트가 이 메서드를 백그라운드 스레드에서 호출하므로 동기(blocking) 네트워크 호출이 안전하다.
        List<WidgetEvent> fetched = FirestoreEventFetcher.fetchUpcoming();
        events.clear();
        if (fetched == null) {
            lastFetchFailed = true;
        } else {
            lastFetchFailed = false;
            events.addAll(fetched);
        }
    }

    @Override
    public void onDestroy() {
        events.clear();
    }

    @Override
    public int getCount() {
        if (lastFetchFailed) return 1;
        return events.size();
    }

    @Override
    public RemoteViews getViewAt(int position) {
        RemoteViews rv = new RemoteViews(context.getPackageName(), R.layout.widget_weekly_item);

        if (lastFetchFailed) {
            rv.setTextViewText(R.id.item_date, "");
            rv.setTextViewText(R.id.item_title, "일정을 불러오지 못했습니다 — 헤더를 눌러 새로고침하세요");
            rv.setViewVisibility(R.id.item_place, android.view.View.GONE);
            rv.setOnClickFillInIntent(R.id.item_root, new Intent());
            return rv;
        }

        WidgetEvent e = events.get(position);

        String dateLabel = formatDateLabel(e);
        rv.setTextViewText(R.id.item_date, dateLabel);
        rv.setTextViewText(R.id.item_title, e.title);

        if (e.place != null && !e.place.isEmpty()) {
            rv.setTextViewText(R.id.item_place, e.place);
            rv.setViewVisibility(R.id.item_place, android.view.View.VISIBLE);
        } else {
            rv.setViewVisibility(R.id.item_place, android.view.View.GONE);
        }

        Intent fillInIntent = new Intent();
        fillInIntent.setData(Uri.parse(WidgetConfig.WEB_APP_URL + "?widgetDate=" + e.start));
        rv.setOnClickFillInIntent(R.id.item_root, fillInIntent);

        return rv;
    }

    private String formatDateLabel(WidgetEvent e) {
        String md = shortDate(e.start);
        if (e.allDay) {
            return md + " 종일";
        }
        if (e.startTime == null || e.startTime.isEmpty()) {
            return md;
        }
        return md + " " + e.startTime;
    }

    private String shortDate(String isoDate) {
        // "YYYY-MM-DD" -> "MM/DD"
        if (isoDate == null || isoDate.length() < 10) return isoDate == null ? "" : isoDate;
        String month = isoDate.substring(5, 7);
        String day = isoDate.substring(8, 10);
        return String.format(Locale.US, "%s/%s",
                month.startsWith("0") ? month.substring(1) : month,
                day.startsWith("0") ? day.substring(1) : day);
    }

    @Override
    public RemoteViews getLoadingView() {
        return null;
    }

    @Override
    public int getViewTypeCount() {
        return 1;
    }

    @Override
    public long getItemId(int position) {
        return position;
    }

    @Override
    public boolean hasStableIds() {
        return true;
    }
}
