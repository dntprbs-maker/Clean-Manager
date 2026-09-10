package com.cleanmanager.app.widget;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.text.SpannableString;
import android.text.Spanned;
import android.text.style.StyleSpan;
import android.widget.RemoteViews;

import com.cleanmanager.app.R;

import java.util.ArrayList;
import java.util.Calendar;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Map;

public class CleanManagerWeeklyWidgetProvider extends AppWidgetProvider {

    static final String ACTION_PREV_WEEK = "com.cleanmanager.app.widget.ACTION_PREV_WEEK";
    static final String ACTION_NEXT_WEEK = "com.cleanmanager.app.widget.ACTION_NEXT_WEEK";
    static final String ACTION_TODAY = "com.cleanmanager.app.widget.ACTION_TODAY";

    private static final String[] WEEKDAY_KO = {"일", "월", "화", "수", "목", "금", "토"};
    // 그리드 순서(월요일 자리에 보조칸이 아니라 일요일부터): sun, mon, tue, wed / aux, thu, fri, sat
    private static final int[] HEADER_IDS = {
            R.id.cell_sun_header, R.id.cell_mon_header, R.id.cell_tue_header, R.id.cell_wed_header,
            R.id.cell_thu_header, R.id.cell_fri_header, R.id.cell_sat_header
    };
    private static final int[] ROOT_IDS = {
            R.id.cell_sun_root, R.id.cell_mon_root, R.id.cell_tue_root, R.id.cell_wed_root,
            R.id.cell_thu_root, R.id.cell_fri_root, R.id.cell_sat_root
    };
    private static final int[][] LINE_IDS = {
            {R.id.cell_sun_line1, R.id.cell_sun_line2, R.id.cell_sun_line3, R.id.cell_sun_line4},
            {R.id.cell_mon_line1, R.id.cell_mon_line2, R.id.cell_mon_line3, R.id.cell_mon_line4},
            {R.id.cell_tue_line1, R.id.cell_tue_line2, R.id.cell_tue_line3, R.id.cell_tue_line4},
            {R.id.cell_wed_line1, R.id.cell_wed_line2, R.id.cell_wed_line3, R.id.cell_wed_line4},
            {R.id.cell_thu_line1, R.id.cell_thu_line2, R.id.cell_thu_line3, R.id.cell_thu_line4},
            {R.id.cell_fri_line1, R.id.cell_fri_line2, R.id.cell_fri_line3, R.id.cell_fri_line4},
            {R.id.cell_sat_line1, R.id.cell_sat_line2, R.id.cell_sat_line3, R.id.cell_sat_line4},
    };

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        // 캐시로 즉시 렌더링 (네트워크 대기 없음). 최신화는 onReceive의 goAsync 구간에서 한다.
        for (int id : appWidgetIds) {
            applyWeekViews(context, appWidgetManager, id);
        }
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        super.onReceive(context, intent);
        String action = intent.getAction();
        if (action == null) return;

        if (ACTION_PREV_WEEK.equals(action) || ACTION_NEXT_WEEK.equals(action) || ACTION_TODAY.equals(action)) {
            int appWidgetId = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, -1);
            if (appWidgetId == -1) return;

            if (ACTION_PREV_WEEK.equals(action)) {
                WidgetCache.setWeekOffset(context, appWidgetId, WidgetCache.getWeekOffset(context, appWidgetId) - 1);
            } else if (ACTION_NEXT_WEEK.equals(action)) {
                WidgetCache.setWeekOffset(context, appWidgetId, WidgetCache.getWeekOffset(context, appWidgetId) + 1);
            } else {
                WidgetCache.setWeekOffset(context, appWidgetId, 0);
            }
            // 주 이동은 캐시만으로 즉시 반영 (네트워크 호출 없음 — 빠른 반응성 우선)
            applyWeekViews(context, AppWidgetManager.getInstance(context), appWidgetId);

        } else if (AppWidgetManager.ACTION_APPWIDGET_UPDATE.equals(action)) {
            int[] ids = intent.getIntArrayExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS);
            if (ids == null || ids.length == 0) return;
            refreshDataInBackground(context, ids);
        }
    }

    @Override
    public void onDeleted(Context context, int[] appWidgetIds) {
        for (int id : appWidgetIds) {
            WidgetCache.clearWeekOffset(context, id);
        }
    }

    /** goAsync()로 브로드캐스트 우선순위를 유지한 채 백그라운드에서 최신 데이터를 받아온다. */
    private void refreshDataInBackground(Context context, int[] appWidgetIds) {
        Context appContext = context.getApplicationContext();
        PendingResult pendingResult = goAsync();
        new Thread(() -> {
            try {
                Calendar today = Calendar.getInstance();
                String from = isoDate(today, -WidgetConfig.FETCH_DAYS_BEFORE);
                String to = isoDate(today, WidgetConfig.FETCH_DAYS_AFTER);

                List<WidgetEvent> events = FirestoreEventFetcher.fetchRange(from, to);
                Map<String, Integer> cals = FirestoreEventFetcher.fetchCalendars();

                if (events != null) {
                    WidgetCache.save(appContext, events, cals != null ? cals : WidgetCache.load(appContext).calendars);
                }

                AppWidgetManager mgr = AppWidgetManager.getInstance(appContext);
                for (int id : appWidgetIds) {
                    applyWeekViews(appContext, mgr, id);
                }
            } finally {
                pendingResult.finish();
            }
        }).start();
    }

    private void applyWeekViews(Context context, AppWidgetManager appWidgetManager, int appWidgetId) {
        int weekOffset = WidgetCache.getWeekOffset(context, appWidgetId);
        WidgetCache.Snapshot snapshot = WidgetCache.load(context);
        RemoteViews views = buildViews(context, appWidgetId, weekOffset, snapshot);
        appWidgetManager.updateAppWidget(appWidgetId, views);
    }

    private RemoteViews buildViews(Context context, int appWidgetId, int weekOffset, WidgetCache.Snapshot snapshot) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_week_grid);

        Calendar sunday = startOfWeek(weekOffset);
        Calendar todayCal = Calendar.getInstance();
        String todayIso = isoDate(todayCal, 0);

        views.setTextViewText(R.id.widget_year, sunday.get(Calendar.YEAR) + "년");

        Calendar saturday = (Calendar) sunday.clone();
        saturday.add(Calendar.DAY_OF_MONTH, 6);
        views.setTextViewText(R.id.widget_date_range, String.format(Locale.KOREA,
                "%d월 %d일 (%s) ~ %d월 %d일 (%s)",
                sunday.get(Calendar.MONTH) + 1, sunday.get(Calendar.DAY_OF_MONTH), WEEKDAY_KO[0],
                saturday.get(Calendar.MONTH) + 1, saturday.get(Calendar.DAY_OF_MONTH), WEEKDAY_KO[6]));

        views.setOnClickPendingIntent(R.id.widget_today_btn, navPendingIntent(context, ACTION_TODAY, appWidgetId, 0));
        views.setOnClickPendingIntent(R.id.widget_prev_btn, navPendingIntent(context, ACTION_PREV_WEEK, appWidgetId, 1));
        views.setOnClickPendingIntent(R.id.widget_next_btn, navPendingIntent(context, ACTION_NEXT_WEEK, appWidgetId, 2));

        for (int dayIdx = 0; dayIdx < 7; dayIdx++) {
            Calendar day = (Calendar) sunday.clone();
            day.add(Calendar.DAY_OF_MONTH, dayIdx);
            String dayIso = isoDate(day, 0);
            boolean isToday = dayIso.equals(todayIso);

            String headerText = String.format(Locale.KOREA, "%d/%d(%s)",
                    day.get(Calendar.MONTH) + 1, day.get(Calendar.DAY_OF_MONTH), WEEKDAY_KO[dayIdx]);
            views.setTextViewText(HEADER_IDS[dayIdx], headerText);

            if (isToday) {
                views.setInt(HEADER_IDS[dayIdx], "setBackgroundResource", R.drawable.widget_bg_today_header);
                views.setTextColor(HEADER_IDS[dayIdx], Color.WHITE);
            } else {
                views.setInt(HEADER_IDS[dayIdx], "setBackgroundResource", android.R.color.transparent);
                int color;
                if (dayIdx == 0) color = res(context, R.color.widget_sunday_text);
                else if (dayIdx == 6) color = res(context, R.color.widget_saturday_text);
                else color = res(context, R.color.widget_weekday_text);
                views.setTextColor(HEADER_IDS[dayIdx], color);
            }

            List<WidgetEvent> dayEvents = new ArrayList<>();
            for (WidgetEvent e : snapshot.events) {
                if (dayIso.equals(e.start)) dayEvents.add(e);
            }
            Collections.sort(dayEvents, Comparator.comparing(e -> e.startTime == null ? "" : e.startTime));

            int[] lineIds = LINE_IDS[dayIdx];
            for (int lineIdx = 0; lineIdx < lineIds.length; lineIdx++) {
                if (lineIdx < dayEvents.size()) {
                    WidgetEvent e = dayEvents.get(lineIdx);
                    int color = snapshot.calendars.containsKey(e.calId)
                            ? snapshot.calendars.get(e.calId)
                            : Color.parseColor("#9CA3AF");
                    views.setTextViewText(lineIds[lineIdx], buildEventLine(e, color));
                    views.setViewVisibility(lineIds[lineIdx], android.view.View.VISIBLE);
                } else {
                    views.setViewVisibility(lineIds[lineIdx], android.view.View.GONE);
                }
            }

            Intent openIntent = new Intent(context, com.cleanmanager.app.MainActivity.class);
            openIntent.setAction(Intent.ACTION_MAIN);
            openIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP
                    | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            openIntent.putExtra("widgetDate", dayIso);
            PendingIntent openPending = PendingIntent.getActivity(
                    context, appWidgetId * 100 + 10 + dayIdx, openIntent,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            views.setOnClickPendingIntent(ROOT_IDS[dayIdx], openPending);
        }

        return views;
    }

    private CharSequence buildEventLine(WidgetEvent e, int color) {
        String time = (e.allDay ? "종일" : (e.startTime == null ? "" : e.startTime));
        String text = time.isEmpty() ? e.title : time + " " + e.title;
        SpannableString spannable = new SpannableString(text);
        spannable.setSpan(new android.text.style.ForegroundColorSpan(color), 0, text.length(),
                Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        if (!time.isEmpty()) {
            spannable.setSpan(new StyleSpan(android.graphics.Typeface.BOLD), 0, time.length(),
                    Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        }
        return spannable;
    }

    private PendingIntent navPendingIntent(Context context, String action, int appWidgetId, int actionCode) {
        Intent intent = new Intent(context, CleanManagerWeeklyWidgetProvider.class);
        intent.setAction(action);
        intent.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId);
        // 위젯 인스턴스(appWidgetId) x 버튼 종류(actionCode) 조합으로 requestCode를 유일하게 만든다.
        int requestCode = appWidgetId * 10 + actionCode;
        return PendingIntent.getBroadcast(context, requestCode, intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private Calendar startOfWeek(int weekOffset) {
        Calendar cal = Calendar.getInstance();
        cal.set(Calendar.HOUR_OF_DAY, 0);
        cal.set(Calendar.MINUTE, 0);
        cal.set(Calendar.SECOND, 0);
        cal.set(Calendar.MILLISECOND, 0);
        int dayOfWeek = cal.get(Calendar.DAY_OF_WEEK); // SUNDAY=1
        cal.add(Calendar.DAY_OF_MONTH, -(dayOfWeek - 1));
        cal.add(Calendar.DAY_OF_MONTH, weekOffset * 7);
        return cal;
    }

    private String isoDate(Calendar base, int dayOffset) {
        Calendar cal = (Calendar) base.clone();
        cal.add(Calendar.DAY_OF_MONTH, dayOffset);
        return String.format(Locale.US, "%04d-%02d-%02d",
                cal.get(Calendar.YEAR), cal.get(Calendar.MONTH) + 1, cal.get(Calendar.DAY_OF_MONTH));
    }

    private int res(Context context, int colorResId) {
        return context.getResources().getColor(colorResId, context.getTheme());
    }
}
