package com.cleanmanager.app.widget;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/** 마지막으로 성공한 일정/캘린더 조회 결과를 기기에 저장해두고, 새로 뜰 때 즉시 보여주기 위한 캐시. */
final class WidgetCache {

    private static final String TAG = "CleanManagerWidget";

    static final class Snapshot {
        final List<WidgetEvent> events;
        final Map<String, Integer> calendars;
        final String rangeFrom;        // 조회한 기간 시작(YYYY-MM-DD), 없으면 null
        final String rangeTo;          // 조회한 기간 끝(YYYY-MM-DD), 없으면 null
        final long eventsFetchedAt;    // 일정 조회 시각(ms), 없으면 0
        final long calendarsFetchedAt; // 캘린더 조회 시각(ms), 없으면 0
        final long dataRevision;       // 조회 시작 시점의 웹 변경 revision
        final long serverRevision;     // 공유된 서버 변경번호, 독립 조회/구버전은 -1

        Snapshot(List<WidgetEvent> events, Map<String, Integer> calendars) {
            this(events, calendars, null, null, 0L, 0L);
        }

        Snapshot(List<WidgetEvent> events, Map<String, Integer> calendars,
                 String rangeFrom, String rangeTo, long eventsFetchedAt, long calendarsFetchedAt) {
            this(events, calendars, rangeFrom, rangeTo, eventsFetchedAt, calendarsFetchedAt, -1L);
        }

        Snapshot(List<WidgetEvent> events, Map<String, Integer> calendars,
                 String rangeFrom, String rangeTo, long eventsFetchedAt, long calendarsFetchedAt, long dataRevision) {
            this(events, calendars, rangeFrom, rangeTo, eventsFetchedAt, calendarsFetchedAt, dataRevision, -1L);
        }

        Snapshot(List<WidgetEvent> events, Map<String, Integer> calendars,
                 String rangeFrom, String rangeTo, long eventsFetchedAt, long calendarsFetchedAt, long dataRevision, long serverRevision) {
            this.events = events;
            this.calendars = calendars;
            this.rangeFrom = rangeFrom;
            this.rangeTo = rangeTo;
            this.eventsFetchedAt = eventsFetchedAt;
            this.calendarsFetchedAt = calendarsFetchedAt;
            this.dataRevision = dataRevision;
            this.serverRevision = serverRevision;
        }
    }

    private WidgetCache() {}

    static Snapshot load(Context context) {
        if (!WidgetSessionStore.isSignedIn(context)) return new Snapshot(new ArrayList<>(), new HashMap<>());
        SharedPreferences prefs = context.getSharedPreferences(WidgetConfig.PREFS_NAME, Context.MODE_PRIVATE);
        String blob = prefs.getString(WidgetConfig.PREF_KEY_CACHE_BLOB, null);
        if (blob == null) return new Snapshot(new ArrayList<>(), new HashMap<>());

        try {
            JSONObject root = new JSONObject(blob);
            if (!WidgetSessionStore.scope(context).equals(root.optString("sessionScope", ""))) {
                return new Snapshot(new ArrayList<>(), new HashMap<>());
            }

            List<WidgetEvent> events = new ArrayList<>();
            JSONArray evArr = root.optJSONArray("events");
            if (evArr != null) {
                for (int i = 0; i < evArr.length(); i++) {
                    JSONObject o = evArr.getJSONObject(i);
                    events.add(new WidgetEvent(
                            o.optString("id", ""),
                            o.optString("title", ""),
                            o.optString("start", ""),
                            o.optString("end", ""),
                            o.optString("startTime", ""),
                            o.optString("endTime", ""),
                            o.optBoolean("allDay", false),
                            o.optString("place", ""),
                            o.optString("calId", "")
                    ));
                }
            }

            Map<String, Integer> cals = new HashMap<>();
            JSONObject calObj = root.optJSONObject("calendars");
            if (calObj != null) {
                java.util.Iterator<String> keys = calObj.keys();
                while (keys.hasNext()) {
                    String k = keys.next();
                    cals.put(k, calObj.optInt(k));
                }
            }

            // 예전 캐시(이 값이 없던 시절)에는 범위·시각이 없으므로 null/0 으로 취급한다.
            String rangeFrom = root.isNull("rangeFrom") ? null : root.optString("rangeFrom", null);
            String rangeTo = root.isNull("rangeTo") ? null : root.optString("rangeTo", null);
            long eventsFetchedAt = root.optLong("eventsFetchedAt", 0L);
            long calendarsFetchedAt = root.optLong("calendarsFetchedAt", 0L);
            return new Snapshot(events, cals, rangeFrom, rangeTo, eventsFetchedAt, calendarsFetchedAt,
                    root.optLong("dataRevision", -1L), root.optLong("serverRevision", -1L));
        } catch (Exception e) {
            Log.w(TAG, "캐시 읽기 실패", e);
            return new Snapshot(new ArrayList<>(), new HashMap<>());
        }
    }

    static void save(Context context, List<WidgetEvent> events, Map<String, Integer> calendars) {
        // 범위 정보 없이 저장 요청이 오면 기존 범위·시각을 유지한다.
        Snapshot current = load(context);
        save(context, events, calendars, current.rangeFrom, current.rangeTo,
                current.eventsFetchedAt, current.calendarsFetchedAt, current.dataRevision);
    }

    static void saveScoped(Context context, String expectedScope, List<WidgetEvent> events, Map<String, Integer> calendars,
                           String from, String to, long eventsAt, long calendarsAt) {
        saveScoped(context, expectedScope, events, calendars, from, to, eventsAt, calendarsAt, WidgetSessionStore.dataRevision(context));
    }

    static void saveScoped(Context context, String expectedScope, List<WidgetEvent> events, Map<String, Integer> calendars,
                           String from, String to, long eventsAt, long calendarsAt, long dataRevision) {
        WidgetSessionStore.runIfCurrent(context, expectedScope,
                () -> save(context, events, calendars, from, to, eventsAt, calendarsAt, dataRevision));
    }

    static void save(Context context, List<WidgetEvent> events, Map<String, Integer> calendars,
                     String rangeFrom, String rangeTo, long eventsFetchedAt, long calendarsFetchedAt) {
        save(context, events, calendars, rangeFrom, rangeTo, eventsFetchedAt, calendarsFetchedAt, WidgetSessionStore.dataRevision(context));
    }

    static boolean saveShared(Context context, String scope, List<WidgetEvent> events, Map<String, Integer> calendars,
                              String from, String to, long fetchedAt, long revision, long serverRevision) {
        if (!scope.equals(WidgetSessionStore.scope(context))) return false;
        return save(context, events, calendars, from, to, fetchedAt, fetchedAt, revision, serverRevision);
    }

    private static boolean save(Context context, List<WidgetEvent> events, Map<String, Integer> calendars,
                     String rangeFrom, String rangeTo, long eventsFetchedAt, long calendarsFetchedAt, long dataRevision) {
        return save(context, events, calendars, rangeFrom, rangeTo, eventsFetchedAt, calendarsFetchedAt, dataRevision, -1L);
    }

    private static boolean save(Context context, List<WidgetEvent> events, Map<String, Integer> calendars,
                     String rangeFrom, String rangeTo, long eventsFetchedAt, long calendarsFetchedAt, long dataRevision, long serverRevision) {
        try {
            JSONArray evArr = new JSONArray();
            for (WidgetEvent e : events) {
                JSONObject o = new JSONObject();
                o.put("id", e.id);
                o.put("title", e.title);
                o.put("start", e.start);
                o.put("end", e.end);
                o.put("startTime", e.startTime);
                o.put("endTime", e.endTime);
                o.put("allDay", e.allDay);
                o.put("place", e.place);
                o.put("calId", e.calId);
                evArr.put(o);
            }

            JSONObject calObj = new JSONObject();
            for (Map.Entry<String, Integer> entry : calendars.entrySet()) {
                calObj.put(entry.getKey(), entry.getValue());
            }

            JSONObject root = new JSONObject();
            root.put("sessionScope", WidgetSessionStore.scope(context));
            root.put("events", evArr);
            root.put("calendars", calObj);
            root.put("fetchedAt", System.currentTimeMillis());
            root.put("rangeFrom", rangeFrom);
            root.put("rangeTo", rangeTo);
            root.put("eventsFetchedAt", eventsFetchedAt);
            root.put("calendarsFetchedAt", calendarsFetchedAt);
            root.put("dataRevision", dataRevision);
            root.put("serverRevision", serverRevision);

            SharedPreferences prefs = context.getSharedPreferences(WidgetConfig.PREFS_NAME, Context.MODE_PRIVATE);
            return prefs.edit().putString(WidgetConfig.PREF_KEY_CACHE_BLOB, root.toString()).commit();
        } catch (Exception e) {
            Log.w(TAG, "캐시 저장 실패", e);
            return false;
        }
    }

    static void clear(Context context) {
        context.getSharedPreferences(WidgetConfig.PREFS_NAME, Context.MODE_PRIVATE)
                .edit().remove(WidgetConfig.PREF_KEY_CACHE_BLOB).commit();
    }

    static int getWeekOffset(Context context, int appWidgetId) {
        SharedPreferences prefs = context.getSharedPreferences(WidgetConfig.PREFS_NAME, Context.MODE_PRIVATE);
        return prefs.getInt(WidgetConfig.PREF_KEY_WEEK_OFFSET_PREFIX + appWidgetId, 0);
    }

    static void setWeekOffset(Context context, int appWidgetId, int offset) {
        SharedPreferences prefs = context.getSharedPreferences(WidgetConfig.PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit().putInt(WidgetConfig.PREF_KEY_WEEK_OFFSET_PREFIX + appWidgetId, offset).apply();
    }

    static void clearWeekOffset(Context context, int appWidgetId) {
        SharedPreferences prefs = context.getSharedPreferences(WidgetConfig.PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit().remove(WidgetConfig.PREF_KEY_WEEK_OFFSET_PREFIX + appWidgetId).apply();
    }

    static int getMonthOffset(Context context, int appWidgetId) {
        SharedPreferences prefs = context.getSharedPreferences(WidgetConfig.PREFS_NAME, Context.MODE_PRIVATE);
        return prefs.getInt(WidgetConfig.PREF_KEY_MONTH_OFFSET_PREFIX + appWidgetId, 0);
    }

    static void setMonthOffset(Context context, int appWidgetId, int offset) {
        SharedPreferences prefs = context.getSharedPreferences(WidgetConfig.PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit().putInt(WidgetConfig.PREF_KEY_MONTH_OFFSET_PREFIX + appWidgetId, offset).apply();
    }

    static void clearMonthOffset(Context context, int appWidgetId) {
        SharedPreferences prefs = context.getSharedPreferences(WidgetConfig.PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit().remove(WidgetConfig.PREF_KEY_MONTH_OFFSET_PREFIX + appWidgetId).apply();
    }

    static int getTwoWeekOffset(Context context, int appWidgetId) {
        SharedPreferences prefs = context.getSharedPreferences(WidgetConfig.PREFS_NAME, Context.MODE_PRIVATE);
        return prefs.getInt(WidgetConfig.PREF_KEY_TWOWEEK_OFFSET_PREFIX + appWidgetId, 0);
    }

    static void setTwoWeekOffset(Context context, int appWidgetId, int offset) {
        SharedPreferences prefs = context.getSharedPreferences(WidgetConfig.PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit().putInt(WidgetConfig.PREF_KEY_TWOWEEK_OFFSET_PREFIX + appWidgetId, offset).apply();
    }

    static void clearTwoWeekOffset(Context context, int appWidgetId) {
        SharedPreferences prefs = context.getSharedPreferences(WidgetConfig.PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit().remove(WidgetConfig.PREF_KEY_TWOWEEK_OFFSET_PREFIX + appWidgetId).apply();
    }
}
