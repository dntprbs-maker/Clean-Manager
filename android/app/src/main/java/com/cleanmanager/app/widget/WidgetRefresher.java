package com.cleanmanager.app.widget;

import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;

import java.util.ArrayList;
import java.util.Calendar;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * 위젯 4종이 각자 하던 Firestore 조회를 한 곳으로 모은다.
 * 앱을 열고 닫거나 30분 주기 갱신이 겹쳐도, 같은 기간을 5분 안에 두 번 읽지 않도록
 * 캐시의 조회 범위·시각을 확인해서 실제 조회를 한 번으로 줄인다.
 */
public final class WidgetRefresher {

    private static final long REUSE_WINDOW_MS = 5 * 60 * 1000L;       // 일정 조회 결과 재사용 시간
    private static final long CALENDAR_TTL_MS = 6 * 60 * 60 * 1000L;  // 캘린더 색상 재조회 간격
    private static final Object LOCK = new Object();

    private WidgetRefresher() {}

    /** [from,to] 를 포함하도록 캐시를 보장한다. 실제 네트워크 조회를 했으면 true. */
    static boolean ensureRange(Context context, String from, String to, boolean force) {
        Context appContext = context.getApplicationContext();
        synchronized (LOCK) {
            // 락을 잡은 뒤 다시 확인한다 — 다른 위젯이 그새 채워 놨을 수 있다.
            WidgetCache.Snapshot cached = WidgetCache.load(appContext);
            long now = System.currentTimeMillis();
            boolean covers = cached.rangeFrom != null && cached.rangeTo != null
                    && cached.rangeFrom.compareTo(from) <= 0 && cached.rangeTo.compareTo(to) >= 0;
            boolean fresh = cached.eventsFetchedAt > 0 && now - cached.eventsFetchedAt <= REUSE_WINDOW_MS;
            if (!force && covers && fresh) return false;

            List<WidgetEvent> events = FirestoreEventFetcher.fetchRange(from, to);
            if (events == null) return false; // 실패하면 기존 캐시를 그대로 둔다

            boolean needCals = force
                    || cached.calendars.isEmpty()
                    || cached.calendarsFetchedAt <= 0
                    || now - cached.calendarsFetchedAt > CALENDAR_TTL_MS;
            Map<String, Integer> cals = cached.calendars;
            long calsAt = cached.calendarsFetchedAt;
            if (needCals) {
                Map<String, Integer> fetched = FirestoreEventFetcher.fetchCalendars();
                if (fetched != null) {
                    cals = fetched;
                    calsAt = now;
                }
            }

            WidgetCache.save(appContext, events, cals, from, to, now, calsAt);
            return true;
        }
    }

    /** 이번 달 1일 - 7일 ~ 이번 달 말일 + 14일. 주간·2주·월간 현재 화면을 모두 덮는 범위. */
    static String[] baseRange() {
        Calendar cal = Calendar.getInstance();
        cal.set(Calendar.DAY_OF_MONTH, 1);
        String from = isoDate(cal, -7);
        cal.set(Calendar.DAY_OF_MONTH, cal.getActualMaximum(Calendar.DAY_OF_MONTH));
        String to = isoDate(cal, 14);
        return new String[]{ from, to };
    }

    /** 설치된 4종 위젯이 지금 화면에 보이는 기간 전체와 baseRange 를 합친 [min,max]. */
    static String[] refreshRange(Context context) {
        AppWidgetManager mgr = AppWidgetManager.getInstance(context);
        String min = null;
        String max = null;

        for (int id : idsOf(mgr, context, CleanManagerWeeklyWidgetProvider.class)) {
            String[] r = weeklyRange(context, id);
            min = minDate(min, r[0]);
            max = maxDate(max, r[1]);
        }
        for (int id : idsOf(mgr, context, CleanManagerTwoWeekWidgetProvider.class)) {
            String[] r = twoWeekRange(context, id);
            min = minDate(min, r[0]);
            max = maxDate(max, r[1]);
        }
        for (int id : idsOf(mgr, context, CleanManagerTwoWeekGridWidgetProvider.class)) {
            String[] r = twoWeekRange(context, id);
            min = minDate(min, r[0]);
            max = maxDate(max, r[1]);
        }
        for (int id : idsOf(mgr, context, CleanManagerMonthlyWidgetProvider.class)) {
            String[] r = monthRange(context, id);
            min = minDate(min, r[0]);
            max = maxDate(max, r[1]);
        }

        String[] base = baseRange();
        min = minDate(min, base[0]);
        max = maxDate(max, base[1]);
        return new String[]{ min, max };
    }

    /** 설치된 상태 그대로의 주간 위젯 화면(일~토) 기간. */
    static String[] weeklyRange(Context context, int appWidgetId) {
        Calendar s = startOfWeek(WidgetCache.getWeekOffset(context, appWidgetId));
        return new String[]{ isoDate(s, 0), isoDate(s, 6) };
    }

    /** 2주 위젯 화면(2주) 기간. 2주·2주그리드 위젯이 같은 offset 을 쓴다. */
    static String[] twoWeekRange(Context context, int appWidgetId) {
        Calendar s = startOfWeek(WidgetCache.getTwoWeekOffset(context, appWidgetId));
        return new String[]{ isoDate(s, 0), isoDate(s, 13) };
    }

    /** 월간 위젯의 6주 그리드 기간. */
    static String[] monthRange(Context context, int appWidgetId) {
        Calendar s = startOfGrid(WidgetCache.getMonthOffset(context, appWidgetId));
        return new String[]{ isoDate(s, 0), isoDate(s, 41) };
    }

    /** 캐시가 [from,to] 를 이미 포함하고 있는지. */
    static boolean isRangeCovered(Context context, String from, String to) {
        WidgetCache.Snapshot cached = WidgetCache.load(context);
        return cached.rangeFrom != null && cached.rangeTo != null
                && cached.rangeFrom.compareTo(from) <= 0 && cached.rangeTo.compareTo(to) >= 0;
    }

    /** 백그라운드에서 필요한 기간을 확보한 뒤 4종 위젯을 모두 캐시로 다시 그린다. */
    public static void refreshAllAsync(Context context, boolean force) {
        Context appContext = context.getApplicationContext();
        // 설치된 위젯이 하나도 없으면 읽을 이유가 없다 (홈에 위젯이 없는데 매번 Firestore 를 읽던 것 방지).
        if (!hasAnyWidget(appContext)) return;
        // 위젯이 있으면 푸시 토픽 구독을 보장한다(재설치·토큰 회전 대비).
        WidgetPushService.ensureSubscribed(appContext);
        new Thread(() -> {
            try {
                String[] range = refreshRange(appContext);
                ensureRange(appContext, range[0], range[1], force);
            } finally {
                CleanManagerWeeklyWidgetProvider.redrawAll(appContext);
                CleanManagerMonthlyWidgetProvider.redrawAll(appContext);
                CleanManagerTwoWeekWidgetProvider.redrawAll(appContext);
                CleanManagerTwoWeekGridWidgetProvider.redrawAll(appContext);
            }
        }).start();
    }

    /** 4종 위젯 중 하나라도 홈 화면에 설치돼 있으면 true. */
    public static boolean hasAnyWidget(Context context) {
        AppWidgetManager mgr = AppWidgetManager.getInstance(context);
        return idsOf(mgr, context, CleanManagerWeeklyWidgetProvider.class).length
                + idsOf(mgr, context, CleanManagerMonthlyWidgetProvider.class).length
                + idsOf(mgr, context, CleanManagerTwoWeekWidgetProvider.class).length
                + idsOf(mgr, context, CleanManagerTwoWeekGridWidgetProvider.class).length > 0;
    }

    /**
     * 푸시로 알려온 일정 id 만 골라 캐시를 부분 갱신한다(전체 재조회 없음).
     * 하나라도 조회에 실패하면 반복을 멈추고 전체 재조회로 대체한다.
     */
    static void applyChangedIds(Context context, List<String> ids, boolean calsChanged) {
        Context appContext = context.getApplicationContext();
        boolean needFullReload = false;

        synchronized (LOCK) {
            WidgetCache.Snapshot cached = WidgetCache.load(appContext);
            List<WidgetEvent> events = new ArrayList<>(cached.events);
            Map<String, Integer> cals = cached.calendars;
            long calsAt = cached.calendarsFetchedAt;
            long now = System.currentTimeMillis();

            // 업데이트 전 캐시(id 없음)는 항목을 찾아 교체할 수 없어 중복이 생긴다 → 한 번 전체 재조회.
            for (WidgetEvent e : events) {
                if (e.id == null || e.id.isEmpty()) { needFullReload = true; break; }
            }

            for (String id : needFullReload ? new ArrayList<String>() : ids) {
                if (id == null || id.isEmpty()) continue;
                FirestoreEventFetcher.FetchOne one = FirestoreEventFetcher.fetchById(id);
                if (one == null) { needFullReload = true; break; } // 오류 → 전체 재조회로 대체

                int index = -1;
                for (int i = 0; i < events.size(); i++) {
                    if (id.equals(events.get(i).id)) { index = i; break; }
                }
                if (one.deleted) {
                    if (index >= 0) events.remove(index);
                } else if (one.event != null) {
                    if (index >= 0) events.set(index, one.event); // 기존 항목 교체
                    else events.add(one.event);                   // 없던 항목 추가
                }
            }

            if (!needFullReload) {
                if (calsChanged) {
                    Map<String, Integer> fetched = FirestoreEventFetcher.fetchCalendars();
                    if (fetched != null) { cals = fetched; calsAt = now; } // 실패하면 기존 색상 유지
                }
                // 부분 갱신이므로 조회 범위·일정 시각은 유지하고 캘린더 색상 시각만 조건부 갱신.
                WidgetCache.save(appContext, events, cals,
                        cached.rangeFrom, cached.rangeTo, cached.eventsFetchedAt, calsAt);
            }
        }

        if (needFullReload) {
            // LOCK 밖에서 대체 조회 — ensureRange 가 내부에서 LOCK 을 다시 잡기 때문(의도를 분명히).
            String[] range = refreshRange(appContext);
            ensureRange(appContext, range[0], range[1], true);
        }
    }

    private static int[] idsOf(AppWidgetManager mgr, Context context, Class<?> provider) {
        int[] ids = mgr.getAppWidgetIds(new ComponentName(context, provider));
        return ids != null ? ids : new int[0];
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

    private static String minDate(String a, String b) {
        if (a == null) return b;
        if (b == null) return a;
        return a.compareTo(b) <= 0 ? a : b;
    }

    private static String maxDate(String a, String b) {
        if (a == null) return b;
        if (b == null) return a;
        return a.compareTo(b) >= 0 ? a : b;
    }
}
