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

        Snapshot(List<WidgetEvent> events, Map<String, Integer> calendars) {
            this.events = events;
            this.calendars = calendars;
        }
    }

    private WidgetCache() {}

    static Snapshot load(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(WidgetConfig.PREFS_NAME, Context.MODE_PRIVATE);
        String blob = prefs.getString(WidgetConfig.PREF_KEY_CACHE_BLOB, null);
        if (blob == null) return new Snapshot(new ArrayList<>(), new HashMap<>());

        try {
            JSONObject root = new JSONObject(blob);

            List<WidgetEvent> events = new ArrayList<>();
            JSONArray evArr = root.optJSONArray("events");
            if (evArr != null) {
                for (int i = 0; i < evArr.length(); i++) {
                    JSONObject o = evArr.getJSONObject(i);
                    events.add(new WidgetEvent(
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
            return new Snapshot(events, cals);
        } catch (Exception e) {
            Log.w(TAG, "캐시 읽기 실패", e);
            return new Snapshot(new ArrayList<>(), new HashMap<>());
        }
    }

    static void save(Context context, List<WidgetEvent> events, Map<String, Integer> calendars) {
        try {
            JSONArray evArr = new JSONArray();
            for (WidgetEvent e : events) {
                JSONObject o = new JSONObject();
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
            root.put("events", evArr);
            root.put("calendars", calObj);
            root.put("fetchedAt", System.currentTimeMillis());

            SharedPreferences prefs = context.getSharedPreferences(WidgetConfig.PREFS_NAME, Context.MODE_PRIVATE);
            prefs.edit().putString(WidgetConfig.PREF_KEY_CACHE_BLOB, root.toString()).apply();
        } catch (Exception e) {
            Log.w(TAG, "캐시 저장 실패", e);
        }
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
}
