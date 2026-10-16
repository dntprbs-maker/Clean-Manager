package com.cleanmanager.app.widget;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.os.Bundle;
import android.widget.RemoteViews;

import com.cleanmanager.app.R;

import java.util.ArrayList;
import java.util.Calendar;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Map;

public class CleanManagerMonthlyWidgetProvider extends AppWidgetProvider {

    static final String ACTION_PREV_MONTH = "com.cleanmanager.app.widget.ACTION_PREV_MONTH";
    static final String ACTION_NEXT_MONTH = "com.cleanmanager.app.widget.ACTION_NEXT_MONTH";
    static final String ACTION_TODAY_MONTH = "com.cleanmanager.app.widget.ACTION_TODAY_MONTH";
    static final String ACTION_REFRESH_MONTH = "com.cleanmanager.app.widget.ACTION_REFRESH_MONTH";

    // 위젯 높이를 알 수 없을 때 쓰는 기존 상수값 (기존 동작 유지)
    private static final int FALLBACK_LINES_PER_CELL = 3;
    private static final int[] ROW_IDS = {
            R.id.month_row1, R.id.month_row2, R.id.month_row3,
            R.id.month_row4, R.id.month_row5, R.id.month_row6
    };
    private static final int[] CELL_LINE_IDS = {
            R.id.month_cell_line1, R.id.month_cell_line2, R.id.month_cell_line3,
            R.id.month_cell_line4, R.id.month_cell_line5, R.id.month_cell_line6,
            R.id.month_cell_line7, R.id.month_cell_line8
    };

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        // 캐시로 즉시 렌더링 (네트워크 대기 없음). 최신화는 onReceive의 goAsync 구간에서 한다.
        for (int id : appWidgetIds) {
            applyMonthViews(context, appWidgetManager, id);
        }
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        super.onReceive(context, intent);
        String action = intent.getAction();
        if (action == null) return;

        if (ACTION_PREV_MONTH.equals(action) || ACTION_NEXT_MONTH.equals(action) || ACTION_TODAY_MONTH.equals(action)) {
            int appWidgetId = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, -1);
            if (appWidgetId == -1) return;

            if (ACTION_PREV_MONTH.equals(action)) {
                WidgetCache.setMonthOffset(context, appWidgetId, WidgetCache.getMonthOffset(context, appWidgetId) - 1);
            } else if (ACTION_NEXT_MONTH.equals(action)) {
                WidgetCache.setMonthOffset(context, appWidgetId, WidgetCache.getMonthOffset(context, appWidgetId) + 1);
            } else {
                WidgetCache.setMonthOffset(context, appWidgetId, 0);
            }
            // 달 이동은 캐시만으로 즉시 반영 (네트워크 호출 없음 — 빠른 반응성 우선)
            applyMonthViews(context, AppWidgetManager.getInstance(context), appWidgetId);

        } else if (ACTION_REFRESH_MONTH.equals(action) || AppWidgetManager.ACTION_APPWIDGET_UPDATE.equals(action)) {
            int[] ids = intent.getIntArrayExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS);
            if (ids == null || ids.length == 0) return;
            refreshDataInBackground(context, ids);
        }
    }

    @Override
    public void onDeleted(Context context, int[] appWidgetIds) {
        for (int id : appWidgetIds) {
            WidgetCache.clearMonthOffset(context, id);
        }
    }

    @Override
    public void onAppWidgetOptionsChanged(Context context, AppWidgetManager appWidgetManager,
                                          int appWidgetId, Bundle newOptions) {
        super.onAppWidgetOptionsChanged(context, appWidgetManager, appWidgetId, newOptions);
        // 위젯 크기가 바뀌면 새 높이로 줄 수를 다시 계산해 캐시만으로 다시 그린다 (네트워크 호출 없음).
        applyMonthViews(context, appWidgetManager, appWidgetId);
    }

    /** 앱이 포그라운드/백그라운드를 오갈 때 호출해 위젯이 최신 일정을 다시 읽도록 한다. */
    public static void requestRefresh(Context context) {
        AppWidgetManager mgr = AppWidgetManager.getInstance(context);
        ComponentName provider = new ComponentName(context, CleanManagerMonthlyWidgetProvider.class);
        int[] ids = mgr.getAppWidgetIds(provider);
        if (ids == null || ids.length == 0) return;
        Intent intent = new Intent(context, CleanManagerMonthlyWidgetProvider.class);
        intent.setAction(ACTION_REFRESH_MONTH);
        intent.putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids);
        context.sendBroadcast(intent);
    }

    /** 네트워크 재요청 없이 캐시만으로 설치된 월간 위젯을 다시 그린다 (공용 캐시 갱신 후 호출용). */
    static void redrawAll(Context context) {
        AppWidgetManager mgr = AppWidgetManager.getInstance(context);
        ComponentName provider = new ComponentName(context, CleanManagerMonthlyWidgetProvider.class);
        int[] ids = mgr.getAppWidgetIds(provider);
        if (ids == null) return;
        for (int id : ids) {
            applyMonthViews(context, mgr, id);
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
                    applyMonthViews(appContext, mgr, id);
                }
                // 공용 캐시를 갱신했으니 주간 위젯도 캐시로 다시 그린다 (네트워크 재요청 없음).
                CleanManagerWeeklyWidgetProvider.redrawAll(appContext);
                CleanManagerTwoWeekWidgetProvider.redrawAll(appContext);
                CleanManagerTwoWeekGridWidgetProvider.redrawAll(appContext);
            } finally {
                pendingResult.finish();
            }
        }).start();
    }

    private static void applyMonthViews(Context context, AppWidgetManager appWidgetManager, int appWidgetId) {
        int monthOffset = WidgetCache.getMonthOffset(context, appWidgetId);
        WidgetCache.Snapshot snapshot = WidgetCache.load(context);
        RemoteViews views = buildMonthViews(context, appWidgetId, monthOffset, snapshot);
        appWidgetManager.updateAppWidget(appWidgetId, views);
    }

    private static RemoteViews buildMonthViews(Context context, int appWidgetId, int monthOffset, WidgetCache.Snapshot snapshot) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_month_grid);

        Calendar gridStart = startOfGrid(monthOffset);
        Calendar firstOfMonth = Calendar.getInstance();
        firstOfMonth.set(Calendar.DAY_OF_MONTH, 1);
        firstOfMonth.add(Calendar.MONTH, monthOffset);
        int dispYear = firstOfMonth.get(Calendar.YEAR);
        int dispMonth = firstOfMonth.get(Calendar.MONTH);

        views.setTextViewText(R.id.month_title, String.format(Locale.KOREA, "%d년 %d월", dispYear, dispMonth + 1));

        views.setOnClickPendingIntent(R.id.month_today_btn, navPendingIntent(context, ACTION_TODAY_MONTH, appWidgetId, 0));
        views.setOnClickPendingIntent(R.id.month_prev_btn, navPendingIntent(context, ACTION_PREV_MONTH, appWidgetId, 1));
        views.setOnClickPendingIntent(R.id.month_next_btn, navPendingIntent(context, ACTION_NEXT_MONTH, appWidgetId, 2));

        String todayIso = isoDate(Calendar.getInstance(), 0);

        // 칸 본문 높이·줄 높이는 위젯 렌더 시작 때 한 번만 계산해 모든 칸에 넘긴다.
        int availablePx = cellBodyHeightPx(context, appWidgetId);
        int linePx = WidgetSizing.textLinePx(context, 9f);
        int moreLinePx = WidgetSizing.textLinePx(context, 8f);

        for (int row = 0; row < ROW_IDS.length; row++) {
            int rowId = ROW_IDS[row];
            views.removeAllViews(rowId);
            for (int col = 0; col < 7; col++) {
                int cellIndex = row * 7 + col;
                Calendar day = (Calendar) gridStart.clone();
                day.add(Calendar.DAY_OF_MONTH, cellIndex);
                views.addView(rowId,
                        buildCell(context, appWidgetId, cellIndex, day, todayIso, dispYear, dispMonth, snapshot,
                                availablePx, linePx, moreLinePx));
            }
        }

        return views;
    }

    private static RemoteViews buildCell(Context context, int appWidgetId, int cellIndex, Calendar day,
                                         String todayIso, int dispYear, int dispMonth, WidgetCache.Snapshot snapshot,
                                         int availablePx, int linePx, int moreLinePx) {
        RemoteViews cell = new RemoteViews(context.getPackageName(), R.layout.widget_month_cell);

        String dayIso = isoDate(day, 0);
        int dayOfWeek = day.get(Calendar.DAY_OF_WEEK); // SUNDAY=1
        boolean inMonth = day.get(Calendar.YEAR) == dispYear && day.get(Calendar.MONTH) == dispMonth;
        boolean isToday = dayIso.equals(todayIso);

        cell.setTextViewText(R.id.month_cell_date, String.valueOf(day.get(Calendar.DAY_OF_MONTH)));

        int dateColor;
        if (!inMonth) {
            dateColor = res(context, R.color.widget_other_month_text);
        } else if (dayOfWeek == Calendar.SUNDAY) {
            dateColor = res(context, R.color.widget_sunday_text);
        } else if (dayOfWeek == Calendar.SATURDAY) {
            dateColor = res(context, R.color.widget_saturday_text);
        } else {
            dateColor = res(context, R.color.widget_weekday_text);
        }
        cell.setTextColor(R.id.month_cell_date, dateColor);

        if (isToday) {
            cell.setInt(R.id.month_cell_date, "setBackgroundResource", R.drawable.widget_bg_today_header);
            cell.setTextColor(R.id.month_cell_date, Color.WHITE);
        }

        List<WidgetEvent> dayEvents = new ArrayList<>();
        for (WidgetEvent e : snapshot.events) {
            if (dayIso.equals(e.start)) dayEvents.add(e);
        }
        Collections.sort(dayEvents, Comparator.comparing(e -> e.startTime == null ? "" : e.startTime));

        int eventCount = dayEvents.size();
        int maxSlots = CELL_LINE_IDS.length;
        int shown = availablePx < 0
                ? Math.min(eventCount, FALLBACK_LINES_PER_CELL)
                : WidgetSizing.fitLines(availablePx, linePx, moreLinePx, eventCount, maxSlots);

        for (int i = 0; i < CELL_LINE_IDS.length; i++) {
            if (i < shown) {
                WidgetEvent e = dayEvents.get(i);
                int color = snapshot.calendars.containsKey(e.calId)
                        ? snapshot.calendars.get(e.calId)
                        : Color.parseColor("#9CA3AF");
                cell.setTextViewText(CELL_LINE_IDS[i], e.title);
                cell.setTextColor(CELL_LINE_IDS[i], color);
                cell.setViewVisibility(CELL_LINE_IDS[i], android.view.View.VISIBLE);
            } else {
                cell.setViewVisibility(CELL_LINE_IDS[i], android.view.View.GONE);
            }
        }

        if (eventCount > shown) {
            cell.setTextViewText(R.id.month_cell_more, "+" + (eventCount - shown));
            cell.setViewVisibility(R.id.month_cell_more, android.view.View.VISIBLE);
        } else {
            cell.setViewVisibility(R.id.month_cell_more, android.view.View.GONE);
        }

        Intent openIntent = new Intent(context, com.cleanmanager.app.MainActivity.class);
        openIntent.setAction(Intent.ACTION_MAIN);
        openIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP
                | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        openIntent.putExtra("widgetDate", dayIso);
        PendingIntent openPending = PendingIntent.getActivity(
                context, appWidgetId * 1000 + 100 + cellIndex, openIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        cell.setOnClickPendingIntent(R.id.month_cell_root, openPending);

        return cell;
    }

    /**
     * 이 위젯 한 칸의 일정 줄 영역 높이(px). widget_month_grid.xml / widget_month_cell.xml 의
     * padding·margin·textSize 를 그대로 반영하고, 안전 여유 dp(4) 를 뺀다. 위젯 높이를 모르면 -1.
     */
    private static int cellBodyHeightPx(Context ctx, int appWidgetId) {
        int widgetH = WidgetSizing.widgetHeightPx(ctx, appWidgetId);
        if (widgetH < 0) return -1;

        // 카드 padding 8dp×2
        // 1행: 브랜드13 / 연월18 / 오늘버튼(12sp+6+6dp) 중 최대 + 행 paddingBottom 4dp
        int row1 = Math.max(Math.max(WidgetSizing.textLinePx(ctx, 13f), WidgetSizing.textLinePx(ctx, 18f)),
                WidgetSizing.textLinePx(ctx, 12f) + WidgetSizing.dp(ctx, 12));
        // 2행: 이동 버튼(12sp+6+6dp) + 행 paddingBottom 4dp
        int row2 = WidgetSizing.textLinePx(ctx, 12f) + WidgetSizing.dp(ctx, 12);
        // 3행: 요일 머리글 11sp + 행 paddingBottom 2dp
        int row3 = WidgetSizing.textLinePx(ctx, 11f);

        int remaining = widgetH
                - WidgetSizing.dp(ctx, 16)
                - row1 - WidgetSizing.dp(ctx, 4)
                - row2 - WidgetSizing.dp(ctx, 4)
                - row3 - WidgetSizing.dp(ctx, 2)
                - WidgetSizing.dp(ctx, 12); // 6행 × marginTop 2dp

        int cellH = remaining / 6;
        // 칸: margin 1dp×2, 날짜 숫자 줄(11sp + padding 1dp×2)
        int dateH = WidgetSizing.textLinePx(ctx, 11f) + WidgetSizing.dp(ctx, 2);
        return cellH - WidgetSizing.dp(ctx, 2) - dateH - WidgetSizing.dp(ctx, 4);
    }

    private static PendingIntent navPendingIntent(Context context, String action, int appWidgetId, int actionCode) {
        Intent intent = new Intent(context, CleanManagerMonthlyWidgetProvider.class);
        intent.setAction(action);
        intent.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId);
        // 위젯 인스턴스(appWidgetId) x 버튼 종류(actionCode) 조합으로 requestCode를 유일하게 만든다.
        int requestCode = appWidgetId * 1000 + actionCode;
        return PendingIntent.getBroadcast(context, requestCode, intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /** 표시 중인 달 1일이 속한 주의 일요일을 6주 그리드의 시작일로 삼는다. */
    private static Calendar startOfGrid(int monthOffset) {
        Calendar cal = Calendar.getInstance();
        cal.set(Calendar.HOUR_OF_DAY, 0);
        cal.set(Calendar.MINUTE, 0);
        cal.set(Calendar.SECOND, 0);
        cal.set(Calendar.MILLISECOND, 0);
        cal.set(Calendar.DAY_OF_MONTH, 1);
        cal.add(Calendar.MONTH, monthOffset);
        int dayOfWeek = cal.get(Calendar.DAY_OF_WEEK); // SUNDAY=1
        cal.add(Calendar.DAY_OF_MONTH, -(dayOfWeek - 1));
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
