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
import java.time.YearMonth;
import java.time.format.DateTimeFormatter;
import java.time.temporal.TemporalAdjusters;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

public class WeeklyWidgetProvider extends AppWidgetProvider {
    private static final String PREV = "cm.week.prev";
    private static final String NEXT = "cm.week.next";
    private static final String PREF = "cm_week_widget";

    @Override public void onUpdate(Context c, AppWidgetManager m, int[] ids) {
        for (int id : ids) renderAsync(c, m, id);
    }

    @Override public void onReceive(Context c, Intent i) {
        super.onReceive(c, i);
        String action = i.getAction();
        if (!PREV.equals(action) && !NEXT.equals(action)) return;
        int id = i.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, -1);
        if (id < 0) return;
        int offset = c.getSharedPreferences(PREF, Context.MODE_PRIVATE).getInt("offset_" + id, 0);
        offset += NEXT.equals(action) ? 1 : -1;
        c.getSharedPreferences(PREF, Context.MODE_PRIVATE).edit().putInt("offset_" + id, offset).apply();
        renderAsync(c, AppWidgetManager.getInstance(c), id);
    }

    private static void renderAsync(Context c, AppWidgetManager m, int id) {
        RemoteViews loading = base(c, id);
        loading.setViewVisibility(R.id.loading, View.VISIBLE);
        m.updateAppWidget(id, loading);

        new Thread(() -> {
            int offset = c.getSharedPreferences(PREF, Context.MODE_PRIVATE).getInt("offset_" + id, 0);
            LocalDate weekStart = LocalDate.now()
                    .with(TemporalAdjusters.previousOrSame(DayOfWeek.SUNDAY))
                    .plusWeeks(offset);
            LocalDate weekEnd = weekStart.plusDays(6);
            List<ScheduleRepository.Ev> events = ScheduleRepository.load(c, weekStart, weekEnd);

            RemoteViews root = base(c, id);
            root.setViewVisibility(R.id.loading, View.GONE);
            root.setTextViewText(R.id.year_title, weekStart.plusDays(3).getYear() + "년");
            root.setTextViewText(R.id.week_title,
                    weekStart.format(DateTimeFormatter.ofPattern("M월 d일 (일)")) + " ~ " +
                    weekEnd.format(DateTimeFormatter.ofPattern("M월 d일 (토)")));
            root.removeAllViews(R.id.week_row1);
            root.removeAllViews(R.id.week_row2);

            String[] names = {"일", "월", "화", "수", "목", "금", "토"};
            for (int k = 0; k < 4; k++) {
                root.addView(R.id.week_row1, dayCell(c, weekStart.plusDays(k), names[k], events));
            }

            root.addView(R.id.week_row2, miniCalendar(c, weekStart));
            for (int k = 4; k < 7; k++) {
                root.addView(R.id.week_row2, dayCell(c, weekStart.plusDays(k), names[k], events));
            }

            m.updateAppWidget(id, root);
        }).start();
    }

    private static RemoteViews dayCell(Context c, LocalDate date, String dayName, List<ScheduleRepository.Ev> events) {
        RemoteViews cell = new RemoteViews(c.getPackageName(), R.layout.week_cell);
        cell.setTextViewText(R.id.cell_date, dayName + "  " + date.format(DateTimeFormatter.ofPattern("M/d")));
        if (date.getDayOfWeek() == DayOfWeek.SUNDAY) {
            cell.setTextColor(R.id.cell_date, Color.rgb(220, 38, 38));
        } else if (date.getDayOfWeek() == DayOfWeek.SATURDAY) {
            cell.setTextColor(R.id.cell_date, Color.rgb(37, 99, 235));
        }

        List<ScheduleRepository.Ev> dayEvents = day(events, date);
        for (ScheduleRepository.Ev e : dayEvents) {
            RemoteViews chip = new RemoteViews(c.getPackageName(), R.layout.event_chip);
            String text = (e.time == null || e.time.isEmpty() ? "" : e.time + " ") + e.title;
            chip.setTextViewText(R.id.chip, text);
            int color = parseColor(e.color, Color.rgb(107, 114, 128));
            chip.setTextColor(R.id.chip, color);
            chip.setInt(R.id.chip, "setBackgroundColor", tint(color));
            cell.addView(R.id.cell_events, chip);
        }

        if (dayEvents.isEmpty()) {
            RemoteViews empty = new RemoteViews(c.getPackageName(), R.layout.event_chip);
            empty.setTextViewText(R.id.chip, "일정 없음");
            empty.setTextColor(R.id.chip, Color.rgb(148, 163, 184));
            empty.setInt(R.id.chip, "setBackgroundColor", Color.TRANSPARENT);
            cell.addView(R.id.cell_events, empty);
        }
        return cell;
    }

    private static RemoteViews miniCalendar(Context c, LocalDate selectedWeekStart) {
        RemoteViews mini = new RemoteViews(c.getPackageName(), R.layout.week_mini_calendar);
        YearMonth month = YearMonth.from(selectedWeekStart.plusDays(3));
        mini.setTextViewText(R.id.mini_month, month.getMonthValue() + "월");

        LocalDate first = month.atDay(1);
        LocalDate gridStart = first.minusDays(first.getDayOfWeek().getValue() % 7);
        int selectedRow = (int) (ChronoUnit.DAYS.between(gridStart, selectedWeekStart) / 7);
        int[] rowIds = {R.id.mini_row1, R.id.mini_row2, R.id.mini_row3, R.id.mini_row4, R.id.mini_row5, R.id.mini_row6};

        for (int row = 0; row < 6; row++) {
            StringBuilder text = new StringBuilder();
            boolean hasCurrentMonth = false;
            for (int col = 0; col < 7; col++) {
                LocalDate d = gridStart.plusDays(row * 7L + col);
                if (d.getMonthValue() == month.getMonthValue()) hasCurrentMonth = true;
                if (col > 0) text.append(' ');
                if (d.getDayOfMonth() < 10) text.append(' ');
                text.append(d.getDayOfMonth());
            }
            mini.setTextViewText(rowIds[row], text.toString());
            mini.setTextColor(rowIds[row], hasCurrentMonth ? Color.rgb(55, 65, 81) : Color.rgb(156, 163, 175));
            mini.setInt(rowIds[row], "setBackgroundResource", row == selectedRow ? R.drawable.mini_week_selected : 0);
        }
        return mini;
    }

    private static RemoteViews base(Context c, int id) {
        RemoteViews root = new RemoteViews(c.getPackageName(), R.layout.widget_weekly);
        root.setOnClickPendingIntent(R.id.prev, nav(c, id, PREV, id + 20000));
        root.setOnClickPendingIntent(R.id.next, nav(c, id, NEXT, id + 30000));
        Intent app = new Intent(Intent.ACTION_VIEW, Uri.parse(WidgetUtil.WEB));
        root.setOnClickPendingIntent(R.id.brand,
                PendingIntent.getActivity(c, id + 40000, app,
                        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
        return root;
    }

    private static PendingIntent nav(Context c, int id, String action, int requestCode) {
        Intent i = new Intent(c, WeeklyWidgetProvider.class);
        i.setAction(action);
        i.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id);
        return PendingIntent.getBroadcast(c, requestCode, i,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static int parseColor(String value, int fallback) {
        try { return Color.parseColor(value); } catch (Exception e) { return fallback; }
    }

    private static int tint(int color) {
        int r = Color.red(color), g = Color.green(color), b = Color.blue(color);
        return Color.rgb((r + 255 * 5) / 6, (g + 255 * 5) / 6, (b + 255 * 5) / 6);
    }

    private static List<ScheduleRepository.Ev> day(List<ScheduleRepository.Ev> events, LocalDate date) {
        ArrayList<ScheduleRepository.Ev> out = new ArrayList<>();
        for (ScheduleRepository.Ev e : events) {
            if (date.toString().equals(e.date)) out.add(e);
        }
        out.sort(Comparator.comparing(e -> e.time == null ? "" : e.time));
        return out;
    }
}
