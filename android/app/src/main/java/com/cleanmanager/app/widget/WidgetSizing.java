package com.cleanmanager.app.widget;

import android.appwidget.AppWidgetManager;
import android.content.Context;
import android.content.res.Configuration;
import android.graphics.Paint;
import android.os.Bundle;
import android.text.TextPaint;
import android.util.TypedValue;

/**
 * 위젯이 홈 화면에서 실제로 차지하는 높이를 px 로 구해, 칸 하나에 들어가는 일정 줄 수를 계산한다.
 * 레이아웃 XML 의 padding/margin/textSize 값을 각 provider 가 그대로 반영해 "칸 본문 높이"를 넘겨준다.
 */
final class WidgetSizing {

    private WidgetSizing() {
    }

    /** 위젯의 실제 높이(px). 세로 화면이면 MAX_HEIGHT, 가로 화면이면 MIN_HEIGHT(dp) 기준. 모르면 -1. */
    static int widgetHeightPx(Context ctx, int appWidgetId) {
        AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
        Bundle options = mgr.getAppWidgetOptions(appWidgetId);
        if (options == null) return -1;
        boolean portrait = ctx.getResources().getConfiguration().orientation
                == Configuration.ORIENTATION_PORTRAIT;
        int dp = portrait
                ? options.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 0)
                : options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 0);
        if (dp <= 0) return -1;
        return dp(ctx, dp);
    }

    /** dp → px. */
    static int dp(Context ctx, float dp) {
        return Math.round(dp * ctx.getResources().getDisplayMetrics().density);
    }

    /** TextView(includeFontPadding 기본 true) 한 줄 높이(px). sp 를 쓰므로 사용자 글꼴 크기가 반영된다. */
    static int textLinePx(Context ctx, float sp) {
        TextPaint p = new TextPaint();
        p.setTextSize(TypedValue.applyDimension(
                TypedValue.COMPLEX_UNIT_SP, sp, ctx.getResources().getDisplayMetrics()));
        Paint.FontMetricsInt fm = p.getFontMetricsInt();
        return fm.bottom - fm.top;
    }

    /**
     * "칸 본문 높이"에 들어가는 일정 줄 수.
     * 전부 들어가면 eventCount, 아니면 "+N" 한 줄 자리를 뺀 만큼(≤ maxSlots, ≥ 0) 반환한다.
     */
    static int fitLines(int availablePx, int linePx, int moreLinePx, int eventCount, int maxSlots) {
        if (linePx <= 0) return Math.min(eventCount, maxSlots);
        int all = availablePx / linePx;
        if (eventCount <= Math.min(all, maxSlots)) return eventCount;
        int lines = (availablePx - moreLinePx) / linePx;
        if (lines > maxSlots) lines = maxSlots;
        if (lines < 0) lines = 0;
        return lines;
    }
}
