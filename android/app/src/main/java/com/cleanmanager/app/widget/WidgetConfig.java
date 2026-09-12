package com.cleanmanager.app.widget;

final class WidgetConfig {
    static final String FIRESTORE_PROJECT_ID = "clean-manager-60bc9";
    static final String FIRESTORE_API_KEY = "AIzaSyAz-Gt2CC0_6nOMA2UhRZBsqbHKobVLDzc";
    static final String COMPANY_ID = "c_gctgx9b";
    static final String WEB_APP_URL = "https://clean-manager-60bc9.web.app/";

    // 캐시에 담아둘 조회 범위 — 오늘 기준 앞뒤로 이 정도면 평소 주간 이동 범위를 대부분 커버한다.
    static final int FETCH_DAYS_BEFORE = 7;
    static final int FETCH_DAYS_AFTER = 28;

    static final int MAX_EVENTS_PER_CELL = 10;

    static final String PREFS_NAME = "clean_manager_widget_prefs";
    static final String PREF_KEY_CACHE_BLOB = "cache_blob";
    static final String PREF_KEY_WEEK_OFFSET_PREFIX = "week_offset_";

    private WidgetConfig() {}
}
