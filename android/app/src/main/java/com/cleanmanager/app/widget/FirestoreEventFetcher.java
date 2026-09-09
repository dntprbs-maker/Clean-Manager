package com.cleanmanager.app.widget;

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
import java.util.Calendar;
import java.util.List;
import java.util.Locale;

/**
 * 인증 없이 Firestore REST runQuery를 호출한다.
 * companies/{companyId}/events 컬렉션은 현재 Firestore 보안 규칙상 공개 읽기가
 * 열려있는 상태라 기존(구) 위젯도 이 방식으로 동작했다 — 신규로 여는 구멍이 아님.
 * description 필드(개인정보 포함 가능)는 절대 가져오지 않고 title/날짜/시간/장소만 사용한다.
 */
final class FirestoreEventFetcher {

    private static final String TAG = "CleanManagerWidget";

    private FirestoreEventFetcher() {}

    static List<WidgetEvent> fetchUpcoming() {
        List<WidgetEvent> result = new ArrayList<>();
        try {
            String today = isoDate(0);
            String until = isoDate(WidgetConfig.DAYS_AHEAD);

            String urlStr = "https://firestore.googleapis.com/v1/projects/"
                    + WidgetConfig.FIRESTORE_PROJECT_ID
                    + "/databases/(default)/documents/companies/"
                    + WidgetConfig.COMPANY_ID
                    + "/events:runQuery?key=" + WidgetConfig.FIRESTORE_API_KEY;

            JSONObject body = buildQuery(today, until);

            URL url = new URL(urlStr);
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setDoOutput(true);
            conn.setConnectTimeout(10000);
            conn.setReadTimeout(10000);
            conn.setRequestProperty("Content-Type", "application/json; charset=utf-8");

            try (OutputStream os = conn.getOutputStream()) {
                os.write(body.toString().getBytes(StandardCharsets.UTF_8));
            }

            int code = conn.getResponseCode();
            InputStream is = code >= 200 && code < 300 ? conn.getInputStream() : conn.getErrorStream();
            String response = readAll(is);
            conn.disconnect();

            if (code < 200 || code >= 300) {
                Log.w(TAG, "runQuery failed: " + code + " " + response);
                return result;
            }

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
                boolean allDay = getBool(fields, "allDay", false);

                if (start.isEmpty()) continue;
                result.add(new WidgetEvent(title, start, end, startTime, endTime, allDay, place));
            }
        } catch (Exception e) {
            Log.w(TAG, "일정 조회 실패", e);
        }
        return result;
    }

    private static JSONObject buildQuery(String from, String to) throws Exception {
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

        JSONObject structuredQuery = new JSONObject()
                .put("where", where)
                .put("orderBy", new JSONArray().put(orderBy))
                .put("limit", 100);

        return new JSONObject().put("structuredQuery", structuredQuery);
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

    private static String isoDate(int daysFromToday) {
        Calendar cal = Calendar.getInstance();
        cal.add(Calendar.DAY_OF_MONTH, daysFromToday);
        return String.format(Locale.US, "%04d-%02d-%02d",
                cal.get(Calendar.YEAR), cal.get(Calendar.MONTH) + 1, cal.get(Calendar.DAY_OF_MONTH));
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
