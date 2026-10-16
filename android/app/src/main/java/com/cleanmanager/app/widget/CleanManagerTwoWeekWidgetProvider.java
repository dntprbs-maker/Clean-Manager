package com.cleanmanager.app.widget;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.text.SpannableString;
import android.text.Spanned;
import android.text.style.ForegroundColorSpan;
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

public class CleanManagerTwoWeekWidgetProvider extends AppWidgetProvider {

    static final String ACTION_PREV_TWOWEEK = "com.cleanmanager.app.widget.ACTION_PREV_TWOWEEK";
    static final String ACTION_NEXT_TWOWEEK = "com.cleanmanager.app.widget.ACTION_NEXT_TWOWEEK";
    static final String ACTION_TODAY_TWOWEEK = "com.cleanmanager.app.widget.ACTION_TODAY_TWOWEEK";
    static final String ACTION_REFRESH_TWOWEEK = "com.cleanmanager.app.widget.ACTION_REFRESH_TWOWEEK";

    private static final String[] WEEKDAY_KO = {"일", "월", "화", "수", "목", "금", "토"};
    private static final int MAX_LINES_PER_CELL = 6;
    private static final int[] ROW_IDS = { R.id.twoweek_row_top, R.id.twoweek_row_bottom };
    private static final int[] LABEL_IDS = { R.id.twoweek_label_top, R.id.twoweek_label_bottom };
    private static final int[] CELL_LINE_IDS = {
            R.id.tw_cell_line1, R.id.tw_cell_line2, R.id.tw_cell_line3,
            R.id.tw_cell_line4, R.id.tw_cell_line5, R.id.tw_cell_line6
    };

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        // 캐시로 즉시 렌더링 (네트워크 대기 없음). 최신화는 onReceive의 goAsync 구간에서 한다.
        for (int id : appWidgetIds) {
            applyTwoWeekViews(context, appWidgetManager, id);
        }
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        super.onReceive(context, intent);
        String action = intent.getAction();
        if (action == null) return;

        if (ACTION_PREV_TWOWEEK.equals(action) || ACTION_NEXT_TWOWEEK.equals(action) || ACTION_TODAY_TWOWEEK.equals(action)) {
            int appWidgetId = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, -1);
            if (appWidgetId == -1) return;

            if (ACTION_PREV_TWOWEEK.equals(action)) {
                WidgetCache.setTwoWeekOffset(context, appWidgetId, WidgetCache.getTwoWeekOffset(context, appWidgetId) - 1);
            } else if (ACTION_NEXT_TWOWEEK.equals(action)) {
                WidgetCache.setTwoWeekOffset(context, appWidgetId, WidgetCache.getTwoWeekOffset(context, appWidgetId) + 1);
            } else {
                WidgetCache.setTwoWeekOffset(context, appWidgetId, 0);
            }
            // 주 이동은 캐시만으로 즉시 반영 (네트워크 호출 없음 — 빠른 반응성 우선)
            applyTwoWeekViews(context, AppWidgetManager.getInstance(context), appWidgetId);

        } else if (ACTION_REFRESH_TWOWEEK.equals(action) || AppWidgetManager.ACTION_APPWIDGET_UPDATE.equals(action)) {
            int[] ids = intent.getIntArrayExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS);
            if (ids == null || ids.length == 0) return;
            refreshDataInBackground(context, ids);
        }
    }

    @Override
    public void onDeleted(Context context, int[] appWidgetIds) {
        for (int id : appWidgetIds) {
            WidgetCache.clearTwoWeekOffset(context, id);
        }
    }

    /** 앱이 포그라운드/백그라운드를 오갈 때 호출해 위젯이 최신 일정을 다시 읽도록 한다. */
    public static void requestRefresh(Context context) {
        AppWidgetManager mgr = AppWidgetManager.getInstance(context);
        ComponentName provider = new ComponentName(context, CleanManagerTwoWeekWidgetProvider.class);
        int[] ids = mgr.getAppWidgetIds(provider);
        if (ids == null || ids.length == 0) return;
        Intent intent = new Intent(context, CleanManagerTwoWeekWidgetProvider.class);
        intent.setAction(ACTION_REFRESH_TWOWEEK);
        intent.putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids);
        context.sendBroadcast(intent);
    }

    /** 네트워크 재요청 없이 캐시만으로 설치된 2주 위젯을 다시 그린다 (공용 캐시 갱신 후 호출용). */
    static void redrawAll(Context context) {
        AppWidgetManager mgr = AppWidgetManager.getInstance(context);
        ComponentName provider = new ComponentName(context, CleanManagerTwoWeekWidgetProvider.class);
        int[] ids = mgr.getAppWidgetIds(provider);
        if (ids == null) return;
        for (int id : ids) {
            applyTwoWeekViews(context, mgr, id);
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
                    applyTwoWeekViews(appContext, mgr, id);
                }
                // 공용 캐시를 갱신했으니 주간·월간 위젯도 캐시로 다시 그린다 (네트워크 재요청 없음).
                CleanManagerWeeklyWidgetProvider.redrawAll(appContext);
                CleanManagerMonthlyWidgetProvider.redrawAll(appContext);
                CleanManagerTwoWeekGridWidgetProvider.redrawAll(appContext);
            } finally {
                pendingResult.finish();
            }
        }).start();
    }

    private static void applyTwoWeekViews(Context context, AppWidgetManager appWidgetManager, int appWidgetId) {
        int twoWeekOffset = WidgetCache.getTwoWeekOffset(context, appWidgetId);
        WidgetCache.Snapshot snapshot = WidgetCache.load(context);
        RemoteViews views = buildTwoWeekViews(context, appWidgetId, twoWeekOffset, snapshot);
        appWidgetManager.updateAppWidget(appWidgetId, views);
    }

    private static RemoteViews buildTwoWeekViews(Context context, int appWidgetId, int twoWeekOffset,
                                                 WidgetCache.Snapshot snapshot) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_twoweek_grid);

        String todayIso = isoDate(Calendar.getInstance(), 0);

        views.setOnClickPendingIntent(R.id.twoweek_today_btn, navPendingIntent(context, ACTION_TODAY_TWOWEEK, appWidgetId, 0));
        views.setOnClickPendingIntent(R.id.twoweek_prev_btn, navPendingIntent(context, ACTION_PREV_TWOWEEK, appWidgetId, 1));
        views.setOnClickPendingIntent(R.id.twoweek_next_btn, navPendingIntent(context, ACTION_NEXT_TWOWEEK, appWidgetId, 2));

        for (int block = 0; block < ROW_IDS.length; block++) {
            int weekOffset = twoWeekOffset + block;
            Calendar sunday = startOfWeek(weekOffset);
            Calendar saturday = (Calendar) sunday.clone();
            saturday.add(Calendar.DAY_OF_MONTH, 6);

            if (block == 0) {
                views.setTextViewText(R.id.twoweek_title, String.format(Locale.KOREA, "%d년 %d월",
                        sunday.get(Calendar.YEAR), sunday.get(Calendar.MONTH) + 1));
            }

            String range = String.format(Locale.KOREA, "%d/%d ~ %d/%d",
                    sunday.get(Calendar.MONTH) + 1, sunday.get(Calendar.DAY_OF_MONTH),
                    saturday.get(Calendar.MONTH) + 1, saturday.get(Calendar.DAY_OF_MONTH));
            String label = twoWeekOffset == 0
                    ? (block == 0 ? "이번 주 · " : "다음 주 · ") + range
                    : range;
            views.setTextViewText(LABEL_IDS[block], label);

            int rowId = ROW_IDS[block];
            views.removeAllViews(rowId);
            for (int col = 0; col < 7; col++) {
                Calendar day = (Calendar) sunday.clone();
                day.add(Calendar.DAY_OF_MONTH, col);
                int cellIndex = block * 7 + col;
                views.addView(rowId, buildCell(context, appWidgetId, cellIndex, day, todayIso, snapshot));
            }
        }

        return views;
    }

    private static RemoteViews buildCell(Context context, int appWidgetId, int cellIndex, Calendar day,
                                         String todayIso, WidgetCache.Snapshot snapshot) {
        RemoteViews cell = new RemoteViews(context.getPackageName(), R.layout.widget_twoweek_cell);

        String dayIso = isoDate(day, 0);
        int dayOfWeek = day.get(Calendar.DAY_OF_WEEK); // SUNDAY=1
        boolean isToday = dayIso.equals(todayIso);

        cell.setTextViewText(R.id.tw_cell_header, String.format(Locale.KOREA, "%d(%s)",
                day.get(Calendar.DAY_OF_MONTH), WEEKDAY_KO[dayOfWeek - 1]));

        if (isToday) {
            cell.setInt(R.id.tw_cell_header, "setBackgroundResource", R.drawable.widget_bg_today_header);
            cell.setTextColor(R.id.tw_cell_header, Color.WHITE);
        } else {
            cell.setInt(R.id.tw_cell_header, "setBackgroundResource", android.R.color.transparent);
            int color;
            if (dayOfWeek == Calendar.SUNDAY) {
                color = res(context, R.color.widget_sunday_text);
            } else if (dayOfWeek == Calendar.SATURDAY) {
                color = res(context, R.color.widget_saturday_text);
            } else {
                color = res(context, R.color.widget_weekday_text);
            }
            cell.setTextColor(R.id.tw_cell_header, color);
        }

        List<WidgetEvent> dayEvents = new ArrayList<>();
        for (WidgetEvent e : snapshot.events) {
            if (dayIso.equals(e.start)) dayEvents.add(e);
        }
        Collections.sort(dayEvents, Comparator.comparing(e -> e.startTime == null ? "" : e.startTime));

        for (int i = 0; i < CELL_LINE_IDS.length; i++) {
            if (i < dayEvents.size()) {
                WidgetEvent e = dayEvents.get(i);
                int color = snapshot.calendars.containsKey(e.calId)
                        ? snapshot.calendars.get(e.calId)
                        : Color.parseColor("#9CA3AF");
                cell.setTextViewText(CELL_LINE_IDS[i], buildEventLine(e, color));
                cell.setViewVisibility(CELL_LINE_IDS[i], android.view.View.VISIBLE);
            } else {
                cell.setViewVisibility(CELL_LINE_IDS[i], android.view.View.GONE);
            }
        }

        if (dayEvents.size() > MAX_LINES_PER_CELL) {
            cell.setTextViewText(R.id.tw_cell_more, "+" + (dayEvents.size() - MAX_LINES_PER_CELL));
            cell.setViewVisibility(R.id.tw_cell_more, android.view.View.VISIBLE);
        } else {
            cell.setViewVisibility(R.id.tw_cell_more, android.view.View.GONE);
        }

        Intent openIntent = new Intent(context, com.cleanmanager.app.MainActivity.class);
        openIntent.setAction(Intent.ACTION_MAIN);
        openIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP
                | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        openIntent.putExtra("widgetDate", dayIso);
        PendingIntent openPending = PendingIntent.getActivity(
                context, appWidgetId * 1000 + 100 + cellIndex, openIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        cell.setOnClickPendingIntent(R.id.tw_cell_root, openPending);

        return cell;
    }

    private static CharSequence buildEventLine(WidgetEvent e, int color) {
        String time = (e.allDay ? "종일" : (e.startTime == null ? "" : e.startTime));
        String text = time.isEmpty() ? e.title : time + " " + e.title;
        SpannableString spannable = new SpannableString(text);
        spannable.setSpan(new ForegroundColorSpan(color), 0, text.length(),
                Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        if (!time.isEmpty()) {
            spannable.setSpan(new StyleSpan(android.graphics.Typeface.BOLD), 0, time.length(),
                    Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        }
        return spannable;
    }

    private static PendingIntent navPendingIntent(Context context, String action, int appWidgetId, int actionCode) {
        Intent intent = new Intent(context, CleanManagerTwoWeekWidgetProvider.class);
        intent.setAction(action);
        intent.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId);
        // 위젯 인스턴스(appWidgetId) x 버튼 종류(actionCode) 조합으로 requestCode를 유일하게 만든다.
        int requestCode = appWidgetId * 1000 + actionCode;
        return PendingIntent.getBroadcast(context, requestCode, intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static Calendar startOfWeek(int weekOffset) {
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

    private static String isoDate(Calendar base, int dayOffset) {
        Calendar cal = (Calendar) base.clone();
        cal.add(Calendar.DAY_OF_MONTH, dayOffset);
        return String.format(Locale.US, "%04d-%02d-%02d",
                cal.get(Calendar.YEAR), cal.get(Calendar.MONTH) + 1, cal.get(Calendar.DAY_OF_MONTH));
    }

    private static int res(Context context, int colorResId) {
        return context.getResources().getColor(colorResId, context.getTheme());
    }
}
