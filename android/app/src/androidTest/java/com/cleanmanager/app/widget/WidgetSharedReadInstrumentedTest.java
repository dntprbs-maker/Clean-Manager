package com.cleanmanager.app.widget;

import android.content.Context;
import android.content.ContextWrapper;
import android.os.SystemClock;
import android.util.Base64;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Locale;
import java.util.TimeZone;
import static org.junit.Assert.*;

/** Only qa_shared_ preferences. No UI, HTTP, widgets, production session, or lease timers. */
@RunWith(AndroidJUnit4.class)
public class WidgetSharedReadInstrumentedTest {
    private Context context;
    private long wall, elapsed;
    @Before public void before() throws Exception {
        Context target = InstrumentationRegistry.getInstrumentation().getTargetContext();
        context = new ContextWrapper(target) {
            @Override public android.content.SharedPreferences getSharedPreferences(String name, int mode) { return target.getSharedPreferences("qa_shared_" + name, mode); }
            @Override public Context getApplicationContext() { return this; }
        };
        WidgetSessionStore.clear(context);
        wall = System.currentTimeMillis(); elapsed = SystemClock.elapsedRealtime();
        setSession("companyA", "userA", "v1");
    }
    @After public void after() { WidgetSessionStore.clear(context); }
    private void setSession(String company, String user, String version) throws Exception {
        JSONObject claims = new JSONObject().put("cmCompany", company).put("user_id", user).put("cmv", version).put("exp", wall / 1000 + 3600);
        String token = "header." + Base64.encodeToString(claims.toString().getBytes(StandardCharsets.UTF_8), Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING) + ".signature";
        WidgetSessionStore.set(context, token, "testRefresh", company, user);
    }
    private String begin() throws Exception {
        return WidgetSharedRead.beginForRange(context, "companyA", "userA", "2026-11-01", "2026-11-30", wall, elapsed).getString("ticket");
    }
    private JSONObject snapshot() throws Exception {
        SimpleDateFormat iso = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US); iso.setTimeZone(TimeZone.getTimeZone("UTC"));
        return new JSONObject().put("companyId", "companyA").put("userId", "userA").put("from", "2026-11-01").put("to", "2026-11-30")
                .put("revision", JSONObject.NULL).put("scopeKey", "v1:" + new String(new char[64]).replace('\0', 'a')).put("serverAt", iso.format(new java.util.Date(wall)))
                .put("events", new JSONArray()).put("calendars", new JSONArray());
    }
    @Test public void emptyAuthoritativeResultIsAcceptedAndFreshCacheDoesNotRequestExpansion() throws Exception {
        String ticket = begin(); assertFalse(ticket.isEmpty());
        assertTrue(WidgetSharedRead.commitAt(context, ticket, snapshot(), wall, elapsed + 1));
        assertTrue(WidgetCache.load(context).events.isEmpty());
        assertEquals(wall, WidgetCache.load(context).eventsFetchedAt);
        assertTrue(begin().isEmpty());
        assertFalse(WidgetSharedRead.commitAt(context, ticket, snapshot(), wall, elapsed + 2));
    }
    @Test public void mutationAndLogoutRejectLateResponses() throws Exception {
        String ticket = begin(); WidgetSessionStore.invalidateData(context);
        assertFalse(WidgetSharedRead.commitAt(context, ticket, snapshot(), wall, elapsed + 1));
        ticket = begin(); WidgetSessionStore.clear(context);
        assertFalse(WidgetSharedRead.commitAt(context, ticket, snapshot(), wall, elapsed + 2));
        assertEquals(0, WidgetCache.load(context).eventsFetchedAt);
    }
    @Test public void concurrentRequestsAcceptOnlyLatestTicketAndExpiryRejectsResponse() throws Exception {
        String old = begin(), latest = begin();
        assertFalse(WidgetSharedRead.commitAt(context, old, snapshot(), wall, elapsed + 1));
        assertFalse(WidgetSharedRead.commitAt(context, latest, snapshot(), wall, elapsed + SharedReadLease.LEASE_MS));
        latest = begin();
        assertTrue(WidgetSharedRead.commitAt(context, latest, snapshot(), wall, elapsed + 2));
    }
    @Test public void identityRangeAndPrivateFieldsAreRejectedWithoutChangingCache() throws Exception {
        String ticket = begin(); JSONObject value = snapshot().put("companyId", "companyB");
        assertFalse(WidgetSharedRead.commitAt(context, ticket, value, wall, elapsed + 1));
        value = snapshot().put("to", "2026-12-01");
        assertFalse(WidgetSharedRead.commitAt(context, ticket, value, wall, elapsed + 1));
        value = snapshot().put("events", new JSONArray().put(new JSONObject().put("id", "e").put("title", "test").put("start", "2026-11-05").put("finance", 1)));
        assertFalse(WidgetSharedRead.commitAt(context, ticket, value, wall, elapsed + 1));
        assertEquals(0, WidgetCache.load(context).eventsFetchedAt);
    }
    @Test public void minimumProjectionIsNormalizedAndPermissionVersionInvalidatesTicket() throws Exception {
        String ticket = begin(); setSession("companyA", "userA", "v2");
        assertFalse(WidgetSharedRead.commitAt(context, ticket, snapshot(), wall, elapsed + 1));
        ticket = begin();
        JSONObject value = snapshot().put("events", new JSONArray().put(new JSONObject().put("id", "e").put("title", "test").put("start", "2026-11-05")));
        assertTrue(WidgetSharedRead.commitAt(context, ticket, value, wall, elapsed + 2));
        WidgetEvent event = WidgetCache.load(context).events.get(0);
        assertEquals("2026-11-05", event.end); assertEquals("", event.place); assertFalse(event.allDay);
    }
    @Test public void wideOrInvalidDateRangeReturnsNoTicket() throws Exception {
        assertTrue(WidgetSharedRead.beginForRange(context, "companyA", "userA", "2025-01-01", "2026-11-30", wall, elapsed).getString("ticket").isEmpty());
        assertTrue(WidgetSharedRead.beginForRange(context, "companyA", "userA", "2026-02-30", "2026-03-01", wall, elapsed).getString("ticket").isEmpty());
    }
    @Test public void freshCacheSkipsSameServerRevisionButReadsDifferentRevision() throws Exception {
        String ticket = begin();
        assertTrue(WidgetSharedRead.commitAt(context, ticket, snapshot().put("revision", 41L), wall, elapsed + 1));
        assertEquals(41L, WidgetCache.load(context).serverRevision);
        assertTrue(WidgetSharedRead.beginForRange(context, "companyA", "userA", "2026-11-01", "2026-11-30", wall, elapsed + 2, 41L).getString("ticket").isEmpty());
        assertFalse(WidgetSharedRead.beginForRange(context, "companyA", "userA", "2026-11-01", "2026-11-30", wall, elapsed + 3, 42L).getString("ticket").isEmpty());
    }
    @Test public void independentNativeCacheHasUnknownServerRevisionAndKnownHeadRequiresSharing() throws Exception {
        WidgetCache.saveScoped(context, WidgetSessionStore.scope(context), new java.util.ArrayList<>(), new java.util.HashMap<>(),
                "2026-11-01", "2026-11-30", wall, wall, WidgetSessionStore.dataRevision(context));
        assertEquals(-1L, WidgetCache.load(context).serverRevision);
        assertTrue(begin().isEmpty()); // Without a known server head, ordinary TTL reuse is preserved.
        assertFalse(WidgetSharedRead.beginForRange(context, "companyA", "userA", "2026-11-01", "2026-11-30", wall, elapsed + 1, 0L).getString("ticket").isEmpty());
    }
    @Test public void nullServerRevisionStaysUnknownForEmptySharedResult() throws Exception {
        assertTrue(WidgetSharedRead.commitAt(context, begin(), snapshot(), wall, elapsed + 1));
        assertTrue(WidgetCache.load(context).events.isEmpty());
        assertEquals(-1L, WidgetCache.load(context).serverRevision);
        assertFalse(WidgetSharedRead.beginForRange(context, "companyA", "userA", "2026-11-01", "2026-11-30", wall, elapsed + 2, 1L).getString("ticket").isEmpty());
    }
}
