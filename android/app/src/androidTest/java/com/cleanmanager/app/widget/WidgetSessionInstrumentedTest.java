package com.cleanmanager.app.widget;

import android.content.Context;
import android.content.ContextWrapper;
import android.util.Base64;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.json.JSONObject;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.concurrent.atomic.AtomicBoolean;
import static org.junit.Assert.*;

/** Uses the test APK's isolated preferences, never the installed user's session/cache. */
@RunWith(AndroidJUnit4.class)
public class WidgetSessionInstrumentedTest {
    private Context context;
    @Before public void before() {
        Context target = InstrumentationRegistry.getInstrumentation().getTargetContext();
        context = new ContextWrapper(target) {
            @Override public android.content.SharedPreferences getSharedPreferences(String name, int mode) { return target.getSharedPreferences("qa_unit_" + name, mode); }
            @Override public Context getApplicationContext() { return this; }
        };
        WidgetSessionStore.clear(context);
    }
    @After public void after() { WidgetSessionStore.clear(context); }

    private String token(String company, String user, String version) throws Exception {
        JSONObject claims = new JSONObject().put("cmCompany", company).put("user_id", user).put("cmv", version)
                .put("exp", System.currentTimeMillis() / 1000 + 3600);
        return "header." + Base64.encodeToString(claims.toString().getBytes(StandardCharsets.UTF_8), Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING) + ".signature";
    }
    @Test public void companySwitchAndLogoutHidePreviousCache() throws Exception {
        WidgetSessionStore.set(context, token("companyA", "userA", "v1"), "testRefresh", "companyA", "userA");
        String previousScope = WidgetSessionStore.scope(context);
        ArrayList<WidgetEvent> events = new ArrayList<>();
        events.add(new WidgetEvent("one", "isolated test", "2026-11-05", "2026-11-05", "09:00", "10:00", false, "", "cal"));
        WidgetCache.saveScoped(context, previousScope, events, new HashMap<>(), "2026-11-01", "2026-11-30", 1L, 1L);
        assertEquals(1, WidgetCache.load(context).events.size());
        WidgetSessionStore.set(context, token("companyB", "userB", "v1"), "testRefresh", "companyB", "userB");
        assertTrue(WidgetCache.load(context).events.isEmpty());
        WidgetCache.saveScoped(context, previousScope, events, new HashMap<>(), "2026-11-01", "2026-11-30", 1L, 1L);
        assertTrue(WidgetCache.load(context).events.isEmpty());
        WidgetSessionStore.clear(context);
        assertFalse(WidgetSessionStore.isSignedIn(context));
        assertTrue(WidgetCache.load(context).events.isEmpty());
    }
    @Test public void rejectedIdentityDoesNotReplaceSession() throws Exception {
        WidgetSessionStore.set(context, token("companyA", "userA", "v1"), "testRefresh", "companyA", "userA");
        String scope = WidgetSessionStore.scope(context);
        try {
            WidgetSessionStore.set(context, token("companyA", "userA", "v1"), "testRefresh", "companyB", "userA");
            fail("wrong company accepted");
        } catch (IllegalArgumentException expected) { }
        assertEquals(scope, WidgetSessionStore.scope(context));
    }
    @Test public void permissionVersionInvalidatesInFlightWork() throws Exception {
        WidgetSessionStore.set(context, token("companyA", "userA", "v1"), "testRefresh", "companyA", "userA");
        String oldScope = WidgetSessionStore.scope(context);
        WidgetSessionStore.set(context, token("companyA", "userA", "v2"), "testRefresh", "companyA", "userA");
        AtomicBoolean ran = new AtomicBoolean(false);
        WidgetSessionStore.runIfCurrent(context, oldScope, () -> ran.set(true));
        assertFalse(ran.get());
    }
}
