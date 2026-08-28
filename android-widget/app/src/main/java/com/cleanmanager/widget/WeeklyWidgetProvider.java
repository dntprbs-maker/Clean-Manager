package com.cleanmanager.widget;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.view.View;
import android.widget.RemoteViews;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.time.temporal.TemporalAdjusters;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

public class WeeklyWidgetProvider extends AppWidgetProvider {
    private static final String PREV = "cm.week.prev";
    private static final String NEXT = "cm.week.next";
    private static final String PREF = "cm_week_widget";
    private static final int[] COLORS = {
            Color.rgb(231,245,238), Color.rgb(232,240,254), Color.rgb(255,244,229),
            Color.rgb(243,234,252), Color.rgb(255,235,238)
    };

    @Override public void onUpdate(Context c, AppWidgetManager m, int[] ids) {
        for (int id : ids) renderAsync(c, m, id);
    }

    @Override public void onReceive(Context c, Intent i) {
        super.onReceive(c, i);
        String a = i.getAction();
        if (!PREV.equals(a) && !NEXT.equals(a)) return;
        int id = i.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, -1);
        if (id < 0) return;
        int offset = c.getSharedPreferences(PREF, Context.MODE_PRIVATE).getInt("offset_" + id, 0);
        offset += NEXT.equals(a) ? 1 : -1;
        c.getSharedPreferences(PREF, Context.MODE_PRIVATE).edit().putInt("offset_" + id, offset).apply();
        renderAsync(c, AppWidgetManager.getInstance(c), id);
    }

    private static void renderAsync(Context c, AppWidgetManager m, int id) {
        RemoteViews loading = base(c, id);
        loading.setViewVisibility(R.id.loading, View.VISIBLE);
        m.updateAppWidget(id, loading);

        new Thread(() -> {
            int offset = c.getSharedPreferences(PREF, Context.MODE_PRIVATE).getInt("offset_" + id, 0);
            LocalDate base = LocalDate.now()
                    .with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY))
                    .plusWeeks(offset);
            List<ScheduleRepository.Ev> evs = ScheduleRepository.load(c, base, base.plusDays(6));
            RemoteViews r = base(c, id);
            r.setViewVisibility(R.id.loading, View.GONE);
            r.setTextViewText(R.id.week_title,
                    base.format(DateTimeFormatter.ofPattern("M월 d일")) + " ~ " +
                    base.plusDays(6).format(DateTimeFormatter.ofPattern("M월 d일")));
            r.removeAllViews(R.id.week_row1);
            r.removeAllViews(R.id.week_row2);

            for (int k = 0; k < 8; k++) {
                RemoteViews cell = new RemoteViews(c.getPackageName(), R.layout.week_cell);
                if (k < 7) {
                    LocalDate d = base.plusDays(k);
                    String[] ko = {"월","화","수","목","금","토","일"};
                    cell.setTextViewText(R.id.cell_date, ko[k] + "  " + d.format(DateTimeFormatter.ofPattern("M/d")));
                    List<ScheduleRepository.Ev> day = day(evs, d);
                    for (int q = 0; q < day.size(); q++) {
                        RemoteViews chip = new RemoteViews(c.getPackageName(), R.layout.event_chip);
                        ScheduleRepository.Ev e = day.get(q);
                        String text = (e.time == null || e.time.isEmpty() ? "" : e.time + " ") + e.title;
                        chip.setTextViewText(R.id.chip, text);
                        chip.setInt(R.id.chip, "setBackgroundColor", COLORS[q % COLORS.length]);
                        chip.setOnClickPendingIntent(R.id.chip, openDate(c, id * 100 + k * 10 + q, d));
                        cell.addView(R.id.cell_events, chip);
                    }
                    if (day.isEmpty()) {
                        RemoteViews empty = new RemoteViews(c.getPackageName(), R.layout.event_chip);
                        empty.setTextViewText(R.id.chip, "일정 없음");
                        empty.setInt(R.id.chip, "setBackgroundColor", Color.TRANSPARENT);
                        cell.addView(R.id.cell_events, empty);
                    }
                    cell.setOnClickPendingIntent(R.id.cell, openDate(c, id * 10 + k, d));
                } else {
                    cell.setTextViewText(R.id.cell_date, "");
                    cell.setViewVisibility(R.id.cell_events, View.INVISIBLE);
                }
                r.addView(k < 4 ? R.id.week_row1 : R.id.week_row2, cell);
            }
            m.updateAppWidget(id, r);
        }).start();
    }

    private static RemoteViews base(Context c, int id) {
        RemoteViews r = new RemoteViews(c.getPackageName(), R.layout.widget_weekly);
        r.setOnClickPendingIntent(R.id.prev, nav(c, id, PREV, id + 20000));
        r.setOnClickPendingIntent(R.id.next, nav(c, id, NEXT, id + 30000));
        return r;
    }

    private static PendingIntent nav(Context c, int id, String action, int req) {
        Intent i = new Intent(c, WeeklyWidgetProvider.class);
        i.setAction(action);
        i.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id);
        return PendingIntent.getBroadcast(c, req, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static PendingIntent openDate(Context c, int req, LocalDate d) {
        Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(WidgetUtil.WEB + "?widgetDate=" + d));
        return PendingIntent.getActivity(c, req, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static List<ScheduleRepository.Ev> day(List<ScheduleRepository.Ev> evs, LocalDate d) {
        ArrayList<ScheduleRepository.Ev> out = new ArrayList<>();
        for (ScheduleRepository.Ev e : evs) if (d.toString().equals(e.date)) out.add(e);
        out.sort(Comparator.comparing(e -> e.time == null ? "" : e.time));
        return out;
    }
}
