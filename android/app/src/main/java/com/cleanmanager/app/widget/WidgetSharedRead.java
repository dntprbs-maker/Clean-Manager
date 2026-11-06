package com.cleanmanager.app.widget;

import android.content.Context;
import android.graphics.Color;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import org.json.JSONArray;
import org.json.JSONObject;
import java.text.ParsePosition;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TimeZone;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;

/** Validated web-to-widget handoff. No credentials or unrestricted records are cached. */
public final class WidgetSharedRead {
    private static final SharedReadLease LEASE = new SharedReadLease();
    private static final Handler TIMER = new Handler(Looper.getMainLooper());
    private static final long DAY = 86_400_000L;
    private WidgetSharedRead() {}

    public static JSONObject begin(Context context, String company, String user, Object knownRevision) throws Exception {
        Long serverRevision = safeRevision(knownRevision);
        JSONObject unsupportedWork = new JSONObject().put("supported", true).put("ticket", "");
        if (!WidgetRefresher.hasAnyWidget(context)) return unsupportedWork;
        String[] range = WidgetRefresher.refreshRange(context);
        JSONObject result = beginForRange(context, company, user, range[0], range[1], System.currentTimeMillis(), SystemClock.elapsedRealtime(), serverRevision);
        String ticket = result.optString("ticket", "");
        if (!ticket.isEmpty()) {
            Context app = applicationContext(context);
            TIMER.postDelayed(() -> {
                if (LEASE.expire(ticket, SystemClock.elapsedRealtime())) WidgetRefresher.refreshAllAsync(app, false);
            }, SharedReadLease.LEASE_MS + 25L);
        }
        return result;
    }

    /** Package-only entry point allows isolated preference tests without widget/network activity. */
    static JSONObject beginForRange(Context context, String company, String user, String from, String to, long wall, long elapsed) throws Exception {
        return beginForRange(context, company, user, from, to, wall, elapsed, null);
    }

    static JSONObject beginForRange(Context context, String company, String user, String from, String to, long wall, long elapsed, Long knownRevision) throws Exception {
        JSONObject result = new JSONObject().put("supported", true).put("ticket", "");
        if (!validRange(from, to)) return result; // Wide native views keep the independent chunked fallback.
        String scope = WidgetSessionStore.scope(context);
        AtomicReference<SharedReadLease.Ticket> issued = new AtomicReference<>();
        WidgetSessionStore.runIfCurrent(context, scope, () -> {
            if (!WidgetSessionStore.isSignedIn(context) || !company.equals(WidgetSessionStore.company(context))
                    || !user.equals(WidgetSessionStore.user(context))) return;
            long revision = WidgetSessionStore.dataRevision(context);
            WidgetCache.Snapshot cached = WidgetCache.load(context);
            boolean covers = cached.rangeFrom != null && cached.rangeTo != null
                    && cached.rangeFrom.compareTo(from) <= 0 && cached.rangeTo.compareTo(to) >= 0;
            boolean serverChanged = knownRevision != null && knownRevision != cached.serverRevision;
            if (!serverChanged && !WidgetRefreshPolicy.needsFetch(false, covers, cached.eventsFetchedAt, wall, cached.dataRevision, revision)) return;
            issued.set(LEASE.begin(scope, revision, from, to, wall, elapsed));
        });
        SharedReadLease.Ticket ticket = issued.get();
        if (ticket != null) result.put("ticket", ticket.id).put("from", from).put("to", to);
        return result;
    }

    public static boolean commit(Context context, String ticket, JSONObject snapshot) {
        boolean accepted = commitAt(context, ticket, snapshot, System.currentTimeMillis(), SystemClock.elapsedRealtime());
        if (accepted) WidgetRefresher.redrawAll(context);
        return accepted;
    }

    static boolean commitAt(Context context, String ticket, JSONObject snapshot, long wall, long elapsed) {
        long parseStarted = SystemClock.elapsedRealtime();
        if (ticket == null || ticket.isEmpty() || snapshot == null) return false;
        String scope = WidgetSessionStore.scope(context);
        long revision = WidgetSessionStore.dataRevision(context);
        SharedReadLease.Ticket lease = LEASE.current(ticket, scope, revision, elapsed);
        if (lease == null) return false;
        final List<WidgetEvent> events = new ArrayList<>();
        final Map<String, Integer> calendars = new HashMap<>();
        final AtomicReference<Long> responseRevision = new AtomicReference<>(-1L);
        try {
            allowedKeys(snapshot, "events", "calendars", "from", "to", "companyId", "userId", "revision", "scopeKey", "serverAt", "widgetScopeKey");
            if (!lease.from.equals(text(snapshot, "from")) || !lease.to.equals(text(snapshot, "to"))
                    || !WidgetSessionStore.company(context).equals(text(snapshot, "companyId"))
                    || !WidgetSessionStore.user(context).equals(text(snapshot, "userId"))) return false;
            String scopeKey = text(snapshot, "scopeKey");
            if(snapshot.has("widgetScopeKey") && !text(snapshot,"widgetScopeKey").matches("v1:[0-9a-fA-F]{64}"))return false;
            if (!scopeKey.matches("v1:[0-9a-fA-F]{64}")) return false;
            Object serverRevision = snapshot.get("revision");
            Long validatedRevision = safeRevision(serverRevision);
            if (validatedRevision != null) responseRevision.set(validatedRevision);
            long serverAt = parseIso(text(snapshot, "serverAt"));
            // The lease/local revision are authoritative. Allow ordinary device clock skew.
            if (serverAt < lease.issuedWall - DAY || serverAt > wall + DAY) return false;
            JSONArray sourceEvents = snapshot.getJSONArray("events");
            JSONArray sourceCalendars = snapshot.getJSONArray("calendars");
            for (int i = 0; i < sourceEvents.length(); i++) {
                JSONObject e = sourceEvents.getJSONObject(i);
                allowedKeys(e, "id", "title", "start", "end", "startTime", "endTime", "allDay", "place", "calId");
                String id = text(e, "id"), title = text(e, "title"), start = text(e, "start"), end = optionalText(e, "end", start);
                String startTime = optionalText(e, "startTime", ""), endTime = optionalText(e, "endTime", ""), place = optionalText(e, "place", ""), calId = optionalText(e, "calId", "");
                Object allDay = e.has("allDay") ? e.get("allDay") : false;
                if (id.isEmpty() || !validDate(start) || !validDate(end) || end.compareTo(start) < 0
                        || start.compareTo(lease.to) > 0 || end.compareTo(lease.from) < 0
                        || !validTime(startTime) || !validTime(endTime) || !(allDay instanceof Boolean)) return false;
                events.add(new WidgetEvent(id, title, start, end, startTime, endTime, (Boolean) allDay, place, calId));
            }
            for (int i = 0; i < sourceCalendars.length(); i++) {
                JSONObject c = sourceCalendars.getJSONObject(i);
                exactKeys(c, "id", "color");
                String id = text(c, "id"), color = text(c, "color");
                if (id.isEmpty() || calendars.containsKey(id)) return false;
                calendars.put(id, Color.parseColor(color));
            }
        } catch (Exception invalid) { return false; }
        AtomicBoolean accepted = new AtomicBoolean(false);
        WidgetSessionStore.runIfCurrentRevision(context, scope, revision, () -> {
            if (LEASE.current(ticket, scope, revision, elapsed + SystemClock.elapsedRealtime() - parseStarted) == null) return;
            if (WidgetCache.saveVersioned(context, events, calendars, lease.from, lease.to, wall, revision, responseRevision.get(), snapshot.optString("widgetScopeKey", ""))) {
                LEASE.finish(ticket);
                accepted.set(true);
            }
        });
        return accepted.get();
    }

    public static void cancel(Context context, String ticket) {
        if (ticket != null && LEASE.finish(ticket)) WidgetRefresher.refreshAllAsync(context, false);
    }

    static boolean defer(String scope, long revision, String from, String to) {
        return LEASE.shouldDefer(scope, revision, from, to, SystemClock.elapsedRealtime());
    }
    static long nativeFence() { return LEASE.fence(); }
    static boolean nativeMayPublish(long fence) { return LEASE.mayPublish(fence); }
    static void invalidate() { LEASE.invalidate(); }

    /** Give the app read a short head start. A lease has its own independent 15s fallback. */
    public static void scheduleFallback(Context context) {
        Context app = applicationContext(context);
        TIMER.postDelayed(() -> WidgetRefresher.refreshAllAsync(app, false), 2_000L);
    }

    private static Context applicationContext(Context context) { Context app = context.getApplicationContext(); return app != null ? app : context; }
    private static String text(JSONObject object, String key) throws Exception {
        Object value = object.get(key);
        if (!(value instanceof String)) throw new IllegalArgumentException("Invalid shared snapshot");
        return (String) value;
    }
    private static String optionalText(JSONObject object, String key, String fallback) throws Exception {
        return object.has(key) ? text(object, key) : fallback;
    }
    private static Long safeRevision(Object value) {
        if (value == null || value == JSONObject.NULL) return null;
        if (!(value instanceof Number)) throw new IllegalArgumentException("Invalid revision");
        double number = ((Number) value).doubleValue();
        if (Double.isNaN(number) || Double.isInfinite(number) || number < 0 || number > 9_007_199_254_740_991d || number != Math.floor(number)) {
            throw new IllegalArgumentException("Invalid revision");
        }
        return ((Number) value).longValue();
    }
    private static void exactKeys(JSONObject object, String... names) throws Exception {
        Set<String> allowed = new HashSet<>(Arrays.asList(names));
        if (object.length() != allowed.size()) throw new IllegalArgumentException("Invalid shared fields");
        allowedKeys(object, names);
    }
    private static void allowedKeys(JSONObject object, String... names) throws Exception {
        Set<String> allowed = new HashSet<>(Arrays.asList(names));
        Iterator<String> keys = object.keys();
        while (keys.hasNext()) if (!allowed.contains(keys.next())) throw new IllegalArgumentException("Invalid shared fields");
    }
    private static boolean validTime(String value) { return value.isEmpty() || value.matches("(?:[01][0-9]|2[0-3]):[0-5][0-9]"); }
    private static boolean validDate(String value) {
        if (!value.matches("[0-9]{4}-[0-9]{2}-[0-9]{2}")) return false;
        try { return parse(value, "yyyy-MM-dd") >= 0; } catch (Exception invalid) { return false; }
    }
    private static boolean validRange(String from, String to) {
        if (!validDate(from) || !validDate(to)) return false;
        try { long days = (parse(to, "yyyy-MM-dd") - parse(from, "yyyy-MM-dd")) / DAY; return days >= 0 && days < 370; }
        catch (Exception invalid) { return false; }
    }
    private static long parseIso(String value) throws Exception {
        return parse(value, value.matches(".*\\.[0-9]{3}Z") ? "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'" : "yyyy-MM-dd'T'HH:mm:ss'Z'");
    }
    private static long parse(String value, String format) throws Exception {
        SimpleDateFormat parser = new SimpleDateFormat(format, Locale.US);
        parser.setLenient(false); parser.setTimeZone(TimeZone.getTimeZone("UTC"));
        ParsePosition pos = new ParsePosition(0); java.util.Date parsed = parser.parse(value, pos);
        if (parsed == null || pos.getIndex() != value.length()) throw new IllegalArgumentException("Invalid date");
        return parsed.getTime();
    }
}
