package com.cleanmanager.app.widget;

import android.graphics.Color;
import android.content.Context;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.IOException;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/** Authenticated Firebase REST requests, scoped to the native session's company. */
final class FirestoreEventFetcher {

    private static final String TAG = "CleanManagerWidget";

    private FirestoreEventFetcher() {}

    private static String pendingScope = "";
    private static Map<String, Integer> pendingCalendars;

    /** The server expands recurrence and applies current company/team/private-calendar permissions. */
    static List<WidgetEvent> fetchRange(Context context, String fromIso, String toIso) {
        String scope = WidgetSessionStore.scope(context);
        try {
            java.text.SimpleDateFormat format = new java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US);
            format.setTimeZone(java.util.TimeZone.getTimeZone("Asia/Seoul"));
            format.setLenient(false);
            java.util.Calendar cursor = java.util.Calendar.getInstance(java.util.TimeZone.getTimeZone("Asia/Seoul"));
            cursor.setTime(format.parse(fromIso));
            java.util.LinkedHashMap<String, WidgetEvent> unique = new java.util.LinkedHashMap<>();
            Map<String, Integer> calendars = new HashMap<>();
            while (format.format(cursor.getTime()).compareTo(toIso) <= 0) {
                String from = format.format(cursor.getTime());
                java.util.Calendar end = (java.util.Calendar) cursor.clone();
                end.add(java.util.Calendar.DAY_OF_MONTH, 369);
                String to = format.format(end.getTime());
                if (to.compareTo(toIso) > 0) to = toIso;
                JSONObject root = request(context, new JSONObject().put("from", from).put("to", to));
                if (root == null || !scope.equals(WidgetSessionStore.scope(context))) return null;
                JSONArray array = root.getJSONArray("events");
                for (int i = 0; i < array.length(); i++) {
                    WidgetEvent event = event(array.getJSONObject(i));
                    unique.put(event.id + ":" + event.start + ":" + event.end, event);
                }
                calendars.putAll(calendars(root.getJSONArray("calendars")));
                cursor.setTime(format.parse(to));
                cursor.add(java.util.Calendar.DAY_OF_MONTH, 1);
            }
            List<WidgetEvent> events = new ArrayList<>(unique.values());
            synchronized (FirestoreEventFetcher.class) {
                pendingScope = scope;
                pendingCalendars = calendars;
            }
            return events;
        } catch (Exception e) { Log.w(TAG, "일정 조회 실패"); return null; }
    }

    static final class FetchOne {
        final boolean deleted;
        final WidgetEvent event;
        FetchOne(boolean deleted, WidgetEvent event) { this.deleted = deleted; this.event = event; }
    }

    static FetchOne fetchById(Context context, String id) {
        try {
            JSONObject root = request(context, new JSONObject().put("eventId", id));
            if (root == null) return null;
            if (root.optBoolean("refreshRequired", false)) return null;
            return root.optBoolean("deleted", false) ? new FetchOne(true, null) : new FetchOne(false, event(root.getJSONObject("event")));
        } catch (Exception e) { Log.w(TAG, "일정 단건 조회 실패"); return null; }
    }

    static Map<String, Integer> fetchCalendars(Context context) {
        synchronized (FirestoreEventFetcher.class) {
            if (WidgetSessionStore.scope(context).equals(pendingScope) && pendingCalendars != null) {
                Map<String, Integer> result = pendingCalendars;
                pendingCalendars = null;
                return result;
            }
        }
        try {
            String[] range = WidgetRefresher.refreshRange(context);
            JSONObject root = request(context, new JSONObject().put("from", range[0]).put("to", range[1]));
            return root == null ? null : calendars(root.getJSONArray("calendars"));
        } catch (Exception e) { Log.w(TAG, "캘린더 색상 조회 실패"); return null; }
    }

    private static WidgetEvent event(JSONObject source) throws Exception {
        return new WidgetEvent(source.getString("id"), source.optString("title", "(제목 없음)"),
                source.getString("start"), source.optString("end", source.getString("start")),
                source.optString("startTime", ""), source.optString("endTime", ""),
                source.optBoolean("allDay", false), source.optString("place", ""), source.optString("calId", ""));
    }

    private static Map<String, Integer> calendars(JSONArray array) throws Exception {
        Map<String, Integer> result = new HashMap<>();
        for (int i = 0; i < array.length(); i++) {
            JSONObject item = array.getJSONObject(i);
            int color;
            try { color = Color.parseColor(item.optString("color", "#9CA3AF")); }
            catch (IllegalArgumentException ignored) { color = Color.parseColor("#9CA3AF"); }
            result.put(item.getString("id"), color);
        }
        return result;
    }

    private static JSONObject request(Context context, JSONObject body) throws Exception {
        String response = postJson(context, WidgetConfig.DATA_URL, body);
        return response == null ? null : new JSONObject(response);
    }

    private static String requireCompany(Context context) throws IOException {
        if (!WidgetSessionStore.isSignedIn(context)) throw new IOException("Widget login required");
        return WidgetSessionStore.company(context);
    }

    private static String postJson(Context context, String urlStr, JSONObject body) throws IOException {
        HttpResult result = authenticatedRequest(context, urlStr, body);
        return result.code >= 200 && result.code < 300 ? result.body : null;
    }

    private static final class HttpResult {
        final int code;
        final String body;
        HttpResult(int code, String body) { this.code = code; this.body = body; }
    }

    private static HttpResult authenticatedRequest(Context context, String urlStr, JSONObject body) throws IOException {
        String scope = WidgetSessionStore.scope(context);
        requireCompany(context);
        if (!WidgetConfig.DATA_URL.equals(urlStr)) throw new IOException("Widget endpoint mismatch");
        for (int attempt = 0; attempt < 2; attempt++) {
            String token = WidgetSessionStore.token(context, scope, attempt > 0);
            HttpURLConnection conn = (HttpURLConnection) new URL(urlStr).openConnection();
            conn.setRequestMethod(body == null ? "GET" : "POST");
            conn.setConnectTimeout(8000); conn.setReadTimeout(8000);
            conn.setRequestProperty("Authorization", "Bearer " + token);
            if (body != null) {
                conn.setDoOutput(true);
                conn.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            }
            try {
                if (body != null) try (OutputStream out = conn.getOutputStream()) { out.write(body.toString().getBytes(StandardCharsets.UTF_8)); }
                int code = conn.getResponseCode();
                String response = WidgetSessionStore.read(code >= 200 && code < 300 ? conn.getInputStream() : conn.getErrorStream());
                if (!scope.equals(WidgetSessionStore.scope(context))) throw new IOException("Widget session changed");
                if (code == 401 && attempt == 0) continue;
                if (code == 401 || code == 403) {
                    WidgetSessionStore.clearIfScope(context, scope);
                    WidgetRefresher.redrawAll(context);
                }
                // Error bodies may contain private document names: log only the status.
                if (code < 200 || code >= 300) Log.w(TAG, "Widget request failed: " + code);
                return new HttpResult(code, response);
            } finally { conn.disconnect(); }
        }
        throw new IOException("Widget authentication failed");
    }

}
