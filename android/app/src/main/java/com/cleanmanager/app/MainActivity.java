package com.cleanmanager.app;

import android.content.Intent;
import android.os.Bundle;

import com.cleanmanager.app.widget.WidgetPushService;
import com.cleanmanager.app.widget.WidgetRefresher;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
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
        // 앱에서 일정을 고치고 나가면 위젯에 바로 반영되도록 한 번만 강제 조회한다.
        // (위젯 4종이 각자 조회하던 것을 한 곳으로 모아 중복 조회를 없앤다.)
        WidgetRefresher.refreshAllAsync(this, true);
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
