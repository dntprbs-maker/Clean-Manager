package com.cleanmanager.app;

import android.content.Intent;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        applyWidgetDate(getIntent());
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

        getBridge().getWebView().post(() ->
                getBridge().getWebView().loadUrl("https://localhost/index.html?widgetDate=" + widgetDate));
    }
}
