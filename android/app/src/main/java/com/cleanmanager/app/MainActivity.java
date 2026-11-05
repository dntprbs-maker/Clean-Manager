package com.cleanmanager.app;

import android.content.Intent;
import android.os.Bundle;

import com.cleanmanager.app.widget.WidgetPushService;
import com.cleanmanager.app.widget.WidgetRefresher;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(WidgetSessionPlugin.class);
        super.onCreate(savedInstanceState);
        applyWidgetDate(getIntent());
        // 위젯이 설치돼 있으면 일정 변경 푸시(widget_{companyId} 토픽) 구독을 보장한다.
        if (WidgetRefresher.hasAnyWidget(this)) {
            WidgetPushService.ensureSubscribed(this);
        }
    }

    @Override
    public void onPause() {
        super.onPause();
        // 단순 앱 이탈은 캐시를 재사용한다. 실제 저장은 invalidateData bridge가
        // 별도 revision을 올려 즉시 갱신하며, 푸시·수동 새로고침은 강제 조회를 유지한다.
        WidgetRefresher.refreshAllAsync(this, false);
    }

    @Override
    public void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        applyWidgetDate(intent);
    }

    /** 위젯에서 날짜 칸을 눌러 들어왔을 때, 그 날짜를 웹앱에 쿼리 파라미터로 전달한다. */
    private void applyWidgetDate(Intent intent) {
        if (intent == null) return;
        String widgetDate = intent.getStringExtra("widgetDate");
        if (widgetDate == null || widgetDate.isEmpty()) return;

        String base = getBridge().getAppUrl().replaceAll("/+$", "");
        getBridge().getWebView().post(() ->
                getBridge().getWebView().loadUrl(base + "/?widgetDate=" + widgetDate));
    }
}
