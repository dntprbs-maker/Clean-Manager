package com.cleanmanager.app.widget;

import android.graphics.Color;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 인증 없이 Firestore REST를 호출한다.
 * companies/{companyId}/events, /cals 컬렉션은 현재 Firestore 보안 규칙상 공개 읽기가
 * 열려있는 상태라 기존(구) 위젯도 이 방식으로 동작했다 — 신규로 여는 구멍이 아님.
 * description 필드(개인정보 포함 가능)는 절대 가져오지 않고 title/날짜/시간/장소/calId만 사용한다.
 */
final class FirestoreEventFetcher {

    private static final String TAG = "CleanManagerWidget";

    private FirestoreEventFetcher() {}

    /** 성공(빈 목록 포함)이면 리스트를, 오류가 나면 null을 반환한다. */
    static List<WidgetEvent> fetchRange(String fromIso, String toIso) {
        try {
            String urlStr = "https://firestore.googleapis.com/v1/projects/"
                    + WidgetConfig.FIRESTORE_PROJECT_ID
                    + "/databases/(default)/documents/companies/"
                    + WidgetConfig.COMPANY_ID
                    + ":runQuery?key=" + WidgetConfig.FIRESTORE_API_KEY;

            JSONObject body = buildEventsQuery(fromIso, toIso);
            String response = postJson(urlStr, body);
            if (response == null) return null;

            List<WidgetEvent> result = new ArrayList<>();
            JSONArray arr = new JSONArray(response);
            for (int i = 0; i < arr.length(); i++) {
                JSONObject entry = arr.getJSONObject(i);
                if (!entry.has("document")) continue;
                JSONObject fields = entry.getJSONObject("document").optJSONObject("fields");
                if (fields == null) continue;

                String title = getString(fields, "title", "(제목 없음)");
                String start = getString(fields, "start", "");
                String end = getString(fields, "end", start);
                String startTime = getString(fields, "startTime", "");
                String endTime = getString(fields, "endTime", "");
                String place = getString(fields, "place", "");
                String calId = getString(fields, "calId", "");
                boolean allDay = getBool(fields, "allDay", false);

                if (start.isEmpty()) continue;
                result.add(new WidgetEvent(title, start, end, startTime, endTime, allDay, place, calId));
            }
            return result;
        } catch (Exception e) {
            Log.w(TAG, "일정 조회 실패", e);
            return null;
        }
    }

    /** calId -> ARGB 색상(int) 맵. 실패 시 null. */
    static Map<String, Integer> fetchCalendars() {
        try {
            String urlStr = "https://firestore.googleapis.com/v1/projects/"
                    + WidgetConfig.FIRESTORE_PROJECT_ID
                    + "/databases/(default)/documents/companies/"
                    + WidgetConfig.COMPANY_ID
                    + "/cals?key=" + WidgetConfig.FIRESTORE_API_KEY + "&pageSize=200";

            String response = getJson(urlStr);
            if (response == null) return null;

            Map<String, Integer> map = new HashMap<>();
            JSONObject root = new JSONObject(response);
            JSONArray docs = root.optJSONArray("documents");
            if (docs == null) return map;

            for (int i = 0; i < docs.length(); i++) {
                JSONObject doc = docs.getJSONObject(i);
                JSONObject fields = doc.optJSONObject("fields");
                if (fields == null) continue;
                String name = doc.optString("name", "");
                String id = name.substring(name.lastIndexOf('/') + 1);
                String colorHex = getString(fields, "color", "#9CA3AF");
                try {
                    map.put(id, Color.parseColor(colorHex));
                } catch (IllegalArgumentException ignore) {
                    map.put(id, Color.parseColor("#9CA3AF"));
                }
            }
            return map;
        } catch (Exception e) {
            Log.w(TAG, "캘린더 색상 조회 실패", e);
            return null;
        }
    }

    private static JSONObject buildEventsQuery(String from, String to) throws Exception {
        JSONObject fromCond = new JSONObject();
        fromCond.put("fieldFilter", new JSONObject()
                .put("field", new JSONObject().put("fieldPath", "start"))
                .put("op", "GREATER_THAN_OR_EQUAL")
                .put("value", new JSONObject().put("stringValue", from)));

        JSONObject toCond = new JSONObject();
        toCond.put("fieldFilter", new JSONObject()
                .put("field", new JSONObject().put("fieldPath", "start"))
                .put("op", "LESS_THAN_OR_EQUAL")
                .put("value", new JSONObject().put("stringValue", to)));

        JSONArray filters = new JSONArray().put(fromCond).put(toCond);

        JSONObject where = new JSONObject().put("compositeFilter",
                new JSONObject().put("op", "AND").put("filters", filters));

        JSONObject orderBy = new JSONObject()
                .put("field", new JSONObject().put("fieldPath", "start"))
                .put("direction", "ASCENDING");

        JSONObject fromClause = new JSONObject().put("collectionId", "events");

        JSONObject structuredQuery = new JSONObject()
                .put("from", new JSONArray().put(fromClause))
                .put("where", where)
                .put("orderBy", new JSONArray().put(orderBy))
                .put("limit", 300);

        return new JSONObject().put("structuredQuery", structuredQuery);
    }

    private static String postJson(String urlStr, JSONObject body) throws IOException {
        URL url = new URL(urlStr);
        HttpURLConnection conn = (HttpURLConnection) url.openConnection();
        conn.setRequestMethod("POST");
        conn.setDoOutput(true);
        conn.setConnectTimeout(8000);
        conn.setReadTimeout(8000);
        conn.setRequestProperty("Content-Type", "application/json; charset=utf-8");

        try (OutputStream os = conn.getOutputStream()) {
            os.write(body.toString().getBytes(StandardCharsets.UTF_8));
        }

        int code = conn.getResponseCode();
        InputStream is = code >= 200 && code < 300 ? conn.getInputStream() : conn.getErrorStream();
        String response = readAll(is);
        conn.disconnect();

        if (code < 200 || code >= 300) {
            Log.w(TAG, "요청 실패: " + code + " " + response);
            return null;
        }
        return response;
    }

    private static String getJson(String urlStr) throws IOException {
        URL url = new URL(urlStr);
        HttpURLConnection conn = (HttpURLConnection) url.openConnection();
        conn.setRequestMethod("GET");
        conn.setConnectTimeout(8000);
        conn.setReadTimeout(8000);

        int code = conn.getResponseCode();
        InputStream is = code >= 200 && code < 300 ? conn.getInputStream() : conn.getErrorStream();
        String response = readAll(is);
        conn.disconnect();

        if (code < 200 || code >= 300) {
            Log.w(TAG, "요청 실패: " + code + " " + response);
            return null;
        }
        return response;
    }

    private static String getString(JSONObject fields, String key, String fallback) {
        JSONObject f = fields.optJSONObject(key);
        if (f == null) return fallback;
        return f.optString("stringValue", fallback);
    }

    private static boolean getBool(JSONObject fields, String key, boolean fallback) {
        JSONObject f = fields.optJSONObject(key);
        if (f == null) return fallback;
        return f.optBoolean("booleanValue", fallback);
    }

    private static String readAll(InputStream is) throws IOException {
        if (is == null) return "";
        StringBuilder sb = new StringBuilder();
        try (BufferedReader br = new BufferedReader(new InputStreamReader(is, StandardCharsets.UTF_8))) {
            String line;
            while ((line = br.readLine()) != null) sb.append(line);
        }
        return sb.toString();
    }
}
