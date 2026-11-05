package com.cleanmanager.app.widget;

/** Shared cache decision, independent of Android and transport. */
final class WidgetRefreshPolicy {
    private static final long REUSE_WINDOW_MS = 5 * 60 * 1000L;

    private WidgetRefreshPolicy() {}

    static boolean needsFetch(boolean force, boolean covers, long fetchedAt, long now,
                              long cachedRevision, long currentRevision) {
        return force || !covers || fetchedAt <= 0 || now < fetchedAt
                || now - fetchedAt > REUSE_WINDOW_MS || cachedRevision != currentRevision;
    }
}
