package com.cleanmanager.app.widget;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Base64;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;

/** Native widget credentials. Private preferences are excluded from Android backup. */
public final class WidgetSessionStore {
    static final String PREFS = "clean_manager_widget_session";
    private static final Object LOCK = new Object();

    private WidgetSessionStore() {}

    private static SharedPreferences prefs(Context context) {
        Context app = context.getApplicationContext();
        return (app != null ? app : context).getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    public static String company(Context context) { return prefs(context).getString("company", ""); }
    public static String scope(Context context) {
        SharedPreferences p = prefs(context);
        String company = p.getString("company", "");
        String user = p.getString("user", "");
        String generation = p.getString("generation", "");
        return company.isEmpty() || user.isEmpty() ? "" : company + ":" + user + ":" + generation;
    }
    public static boolean isSignedIn(Context context) {
        return !scope(context).isEmpty() && !prefs(context).getString("refresh", "").isEmpty();
    }

    /** Validate the token's company binding; Firebase verifies its signature on every request. */
    public static void set(Context context, String token, String refresh, String company, String user) throws Exception {
        if (!company.matches("[A-Za-z0-9_-]+") || user.isEmpty() || refresh.isEmpty()) throw new IllegalArgumentException("Invalid widget session");
        JSONObject claims = claims(token);
        if (!company.equals(claims.optString("cmCompany")) || !user.equals(claims.optString("user_id"))) {
            throw new IllegalArgumentException("Widget session identity mismatch");
        }
        boolean changed;
        String previousCompany;
        synchronized (LOCK) {
            SharedPreferences p = prefs(context);
            previousCompany = p.getString("company", "");
            changed = !company.equals(previousCompany) || !user.equals(p.getString("user", ""))
                    || !claims.optString("cmv").equals(p.getString("version", ""));
            String generation = changed ? java.util.UUID.randomUUID().toString() : p.getString("generation", "");
            p.edit().putString("token", token).putString("refresh", refresh).putString("company", company)
                    .putString("user", user).putString("version", claims.optString("cmv"))
                    .putString("generation", generation).putLong("expires", claims.optLong("exp", 0) * 1000L).commit();
            if (changed) WidgetCache.clear(context);
        }
        if (changed) WidgetPushService.unsubscribeCompany(previousCompany);
        WidgetPushService.ensureSubscribed(context);
    }

    public static void clear(Context context) {
        String previous;
        synchronized (LOCK) {
            previous = company(context);
            prefs(context).edit().clear().commit();
            WidgetCache.clear(context);
        }
        WidgetPushService.unsubscribeCompany(previous);
    }

    static void clearIfScope(Context context, String scope) {
        synchronized (LOCK) {
            if (scope.equals(scope(context))) clear(context);
        }
    }

    static void runIfCurrent(Context context, String expectedScope, Runnable action) {
        synchronized (LOCK) {
            if (!expectedScope.isEmpty() && expectedScope.equals(scope(context))) action.run();
        }
    }

    /** Serialized refresh, including across simultaneous widget refreshes. No secrets are logged. */
    static String token(Context context, String expectedScope, boolean forceRefresh) throws IOException {
        synchronized (LOCK) {
            if (!expectedScope.equals(scope(context)) || !isSignedIn(context)) throw new IOException("Widget login required");
            SharedPreferences p = prefs(context);
            if (!forceRefresh && p.getLong("expires", 0) > System.currentTimeMillis() + 60000) return p.getString("token", "");
            HttpURLConnection conn = (HttpURLConnection) new URL("https://securetoken.googleapis.com/v1/token?key=" + WidgetConfig.FIRESTORE_API_KEY).openConnection();
            conn.setRequestMethod("POST");
            conn.setConnectTimeout(8000); conn.setReadTimeout(8000); conn.setDoOutput(true);
            conn.setRequestProperty("Content-Type", "application/x-www-form-urlencoded");
            String payload = "grant_type=refresh_token&refresh_token=" + URLEncoder.encode(p.getString("refresh", ""), "UTF-8");
            try {
                try (java.io.OutputStream out = conn.getOutputStream()) { out.write(payload.getBytes(StandardCharsets.UTF_8)); }
                int code = conn.getResponseCode();
                if (code == 400 || code == 401 || code == 403) {
                    clearIfScope(context, expectedScope);
                    throw new IOException("Widget login expired");
                }
                if (code < 200 || code >= 300) throw new IOException("Widget token refresh unavailable");
                try {
                    JSONObject result = new JSONObject(read(conn.getInputStream()));
                    String token = result.getString("id_token");
                    JSONObject claims = claims(token);
                    if (!company(context).equals(claims.optString("cmCompany"))
                            || !p.getString("user", "").equals(claims.optString("user_id"))) {
                        clearIfScope(context, expectedScope);
                        throw new IOException("Widget session changed");
                    }
                    if (!expectedScope.equals(scope(context))) throw new IOException("Widget session changed");
                    p.edit().putString("token", token).putString("refresh", result.getString("refresh_token"))
                            .putLong("expires", claims.getLong("exp") * 1000L).commit();
                    return token;
                } catch (org.json.JSONException | IllegalArgumentException e) { throw new IOException("Invalid widget token response"); }
            } finally { conn.disconnect(); }
        }
    }

    private static JSONObject claims(String token) throws org.json.JSONException {
        String[] parts = token.split("\\.");
        if (parts.length != 3) throw new IllegalArgumentException("Invalid ID token");
        return new JSONObject(new String(Base64.decode(parts[1], Base64.URL_SAFE | Base64.NO_WRAP), StandardCharsets.UTF_8));
    }
    static String read(InputStream in) throws IOException {
        if (in == null) return "";
        try (InputStream input = in; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[4096]; int n;
            while ((n = input.read(buffer)) != -1) output.write(buffer, 0, n);
            return output.toString("UTF-8");
        }
    }
}
