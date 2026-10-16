package com.cleanmanager.app.widget;

final class WidgetConfig {
    static final String FIRESTORE_PROJECT_ID = "clean-manager-60bc9";
    static final String FIRESTORE_API_KEY = "AIzaSyAz-Gt2CC0_6nOMA2UhRZBsqbHKobVLDzc";
    static final String COMPANY_ID = "c_gctgx9b";
    static final String WEB_APP_URL = "https://www.clean-manager.com/";

    // 캐시에 담아둘 조회 범위 — 주간·월간 위젯이 함께 쓰며, 월간 달력 앞부분까지 채우도록 넉넉히 잡는다.
    static final int FETCH_DAYS_BEFORE = 45;
    static final int FETCH_DAYS_AFTER = 75;

    static final int MAX_EVENTS_PER_CELL = 10;

    static final String PREFS_NAME = "clean_manager_widget_prefs";
    static final String PREF_KEY_CACHE_BLOB = "cache_blob";
    static final String PREF_KEY_WEEK_OFFSET_PREFIX = "week_offset_";
    static final String PREF_KEY_MONTH_OFFSET_PREFIX = "month_offset_";
    static final String PREF_KEY_TWOWEEK_OFFSET_PREFIX = "twoweek_offset_";

    private WidgetConfig() {}
}
