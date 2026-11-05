package com.cleanmanager.app.widget;

import android.content.Context;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.List;
import java.util.HashMap;
import android.content.ContextWrapper;
import android.content.res.Resources;
import android.view.View;
import android.view.ViewGroup;
import android.widget.TextView;
import android.widget.RemoteViews;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import java.io.FileOutputStream;
import static org.junit.Assert.*;
import static org.junit.Assume.assumeTrue;

/** Optional operator-provided test-session fixture; no credentials ship in the APK. */
@RunWith(AndroidJUnit4.class)
public class WidgetProductionInstrumentedTest {
    @Test public void authenticatedRangeRefreshAndLogout() throws Exception {
        Context targetContext = InstrumentationRegistry.getInstrumentation().getTargetContext();
        Context context = new ContextWrapper(targetContext) {
            @Override public android.content.SharedPreferences getSharedPreferences(String name, int mode) { return targetContext.getSharedPreferences("qa_isolated_" + name, mode); }
            @Override public Context getApplicationContext() { return this; }
        };
        File fixture = new File(context.getFilesDir(), "production-qa-session.json");
        if ("true".equals(InstrumentationRegistry.getArguments().getString("productionQa"))) assertTrue("Required QA session fixture: " + fixture.getAbsolutePath(), fixture.exists());
        else assumeTrue("Requires explicit private QA session fixture", fixture.exists());
        JSONObject session = new JSONObject(new String(Files.readAllBytes(fixture.toPath()), StandardCharsets.UTF_8));
        try {
            WidgetSessionStore.set(context, session.getString("idToken"), session.getString("refreshToken"), session.getString("companyId"), session.getString("userId"));
            String scope = WidgetSessionStore.scope(context);
            List<WidgetEvent> events = FirestoreEventFetcher.fetchRange(context, "2026-11-01", "2026-11-30");
            assertNotNull("Authenticated production range", events);
            assertTrue("25 events plus expanded historical daily series", events.size() >= 55);
            for (WidgetEvent event : events) assertFalse("Private calendar is hidden", event.title.contains("보호개인일정"));
            assertNotNull("Real refresh token exchange", WidgetSessionStore.token(context, scope, true));
            assertNotNull("Range after refresh", FirestoreEventFetcher.fetchRange(context, "2026-11-01", "2026-11-30"));
            Context target = InstrumentationRegistry.getInstrumentation().getTargetContext();
            Context renderContext = new ContextWrapper(context) {
                @Override public String getPackageName() { return target.getPackageName(); }
                @Override public Resources getResources() { return target.getResources(); }
                @Override public Context getApplicationContext() { return this; }
            };
            java.lang.reflect.Method build = CleanManagerWeeklyWidgetProvider.class.getDeclaredMethod("buildViews", Context.class, int.class, int.class, WidgetCache.Snapshot.class);
            build.setAccessible(true);
            WidgetCache.Snapshot snapshot = new WidgetCache.Snapshot(events, new HashMap<>());
            RemoteViews views = (RemoteViews) build.invoke(null, renderContext, 0, 0, snapshot);
            InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
                View view = views.apply(target, null);
                assertTrue("Actual widget layout contains current QA event", texts(view).contains("[시험]"));
                view.measure(View.MeasureSpec.makeMeasureSpec(1080, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(600, View.MeasureSpec.EXACTLY));
                view.layout(0, 0, 1080, 600);
                Bitmap bitmap = Bitmap.createBitmap(1080, 600, Bitmap.Config.ARGB_8888);
                view.draw(new Canvas(bitmap));
                try (FileOutputStream image = new FileOutputStream(new File(context.getFilesDir(), "production-widget.png"))) { bitmap.compress(Bitmap.CompressFormat.PNG, 100, image); }
                catch (Exception error) { throw new RuntimeException(error); }
            });
            WidgetSessionStore.clear(context);
            assertFalse(WidgetSessionStore.isSignedIn(context));
            assertTrue(WidgetCache.load(context).events.isEmpty());
            System.out.println("PRODUCTION_WIDGET_NETWORK_RENDER_REFRESH_LOGOUT_PASS");
        } finally {
            WidgetSessionStore.clear(context);
            assertTrue("Remove only temporary test-session secret", fixture.delete());
        }
    }
    private static String texts(View view) {
        String text = view instanceof TextView ? ((TextView) view).getText().toString() : "";
        if (view instanceof ViewGroup) for (int i = 0; i < ((ViewGroup) view).getChildCount(); i++) text += texts(((ViewGroup) view).getChildAt(i));
        return text;
    }
}
