package com.cleanmanager.app.widget;

import org.junit.Test;
import static org.junit.Assert.*;

public class WidgetRefreshPolicyTest {
    @Test public void ordinaryPauseAndTokenRefreshReuseFreshCache() {
        assertFalse(WidgetRefreshPolicy.needsFetch(false, true, 1_000_000L, 1_000_001L, 7L, 7L));
    }
    @Test public void acknowledgedMutationOverridesFreshCache() {
        assertTrue(WidgetRefreshPolicy.needsFetch(false, true, 1_000_000L, 1_000_001L, 7L, 8L));
    }
    @Test public void failedFetchCannotAcknowledgeMutation() {
        // A failed fetch leaves the cache's older revision unchanged. A later pause must retry.
        assertTrue(WidgetRefreshPolicy.needsFetch(false, true, 1_000_000L, 1_000_010L, 7L, 8L));
        assertTrue(WidgetRefreshPolicy.needsFetch(false, true, 1_000_000L, 1_000_020L, 7L, 8L));
    }
    @Test public void explicitRefreshAndPushBypassFreshCache() {
        assertTrue(WidgetRefreshPolicy.needsFetch(true, true, 1_000_000L, 1_000_001L, 7L, 7L));
    }
    @Test public void missingRangeExpiryAndClockRollbackNeedFetch() {
        assertTrue(WidgetRefreshPolicy.needsFetch(false, false, 1_000_000L, 1_000_001L, 7L, 7L));
        assertTrue(WidgetRefreshPolicy.needsFetch(false, true, 1_000_000L, 1_300_001L, 7L, 7L));
        assertTrue(WidgetRefreshPolicy.needsFetch(false, true, 1_000_000L, 999_999L, 7L, 7L));
        assertTrue(WidgetRefreshPolicy.needsFetch(false, true, 0L, 1L, 0L, 0L));
    }
    @Test public void legacyCacheWithoutRevisionMustRevalidateOnce() {
        assertTrue(WidgetRefreshPolicy.needsFetch(false, true, 1_000_000L, 1_000_001L, -1L, 0L));
    }
}
