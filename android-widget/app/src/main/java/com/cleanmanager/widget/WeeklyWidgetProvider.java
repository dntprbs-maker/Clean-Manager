package com.cleanmanager.widget;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.RectF;
import android.graphics.Typeface;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.YearMonth;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.time.temporal.TemporalAdjusters;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

public class WeeklyWidgetProvider extends AppWidgetProvider {
    private static final String PREV = "cm.week.prev";
    private static final String NEXT = "cm.week.next";
    private static final String TODAY = "cm.week.today";
    private static final String PREF = "cm_week_widget";
    private static final String CACHE = "cm_week_widget_cache";

    @Override public void onUpdate(Context c, AppWidgetManager m, int[] ids) {
        for (int id : ids) renderAsync(c, m, id);
    }

    @Override public void onReceive(Context c, Intent i) {
        super.onReceive(c, i);
        String action = i.getAction();
        if (!PREV.equals(action) && !NEXT.equals(action) && !TODAY.equals(action)) return;

        int id = i.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, -1);
        if (id < 0) return;

        SharedPreferences prefs = c.getSharedPreferences(PREF, Context.MODE_PRIVATE);
        int offset = prefs.getInt("offset_" + id, 0);
        if (TODAY.equals(action)) offset = 0;
        else offset += NEXT.equals(action) ? 1 : -1;
        prefs.edit().putInt("offset_" + id, offset).apply();

        renderAsync(c, AppWidgetManager.getInstance(c), id);
    }

    private static void renderAsync(Context c, AppWidgetManager m, int id) {
        int offset = c.getSharedPreferences(PREF, Context.MODE_PRIVATE).getInt("offset_" + id, 0);
        LocalDate start = LocalDate.now().with(TemporalAdjusters.previousOrSame(DayOfWeek.SUNDAY)).plusWeeks(offset);
        LocalDate end = start.plusDays(6);

        List<ScheduleRepository.Ev> cached = loadCache(c, id, start);
        if (cached != null) {
            m.updateAppWidget(id, buildWidget(c, id, start, cached, false));
        } else {
            m.updateAppWidget(id, buildWidget(c, id, start, new ArrayList<>(), true));
        }

        new Thread(() -> {
            List<ScheduleRepository.Ev> fresh = ScheduleRepository.load(c, start, end);

            List<ScheduleRepository.Ev> shown = fresh;
            if (cached != null && fresh.isEmpty() && !cached.isEmpty()) {
                shown = cached;
            } else {
                saveCache(c, id, start, fresh);
            }

            m.updateAppWidget(id, buildWidget(c, id, start, shown, false));
        }).start();
    }

    private static RemoteViews buildWidget(Context c, int id, LocalDate start, List<ScheduleRepository.Ev> events, boolean loading) {
        LocalDate end = start.plusDays(6);
        RemoteViews root = base(c, id);
        root.setViewVisibility(R.id.loading, loading ? View.VISIBLE : View.GONE);
        root.setTextViewText(R.id.year_title, start.plusDays(3).getYear() + "년");
        root.setTextViewText(R.id.week_title,
                start.format(DateTimeFormatter.ofPattern("M월 d일 (일)")) + " ~ " +
                end.format(DateTimeFormatter.ofPattern("M월 d일 (토)")));
        root.removeAllViews(R.id.week_row1);
        root.removeAllViews(R.id.week_row2);

        if (loading) return root;

        String[] names = {"일", "월", "화", "수", "목", "금", "토"};
        for (int k = 0; k < 4; k++) {
            root.addView(R.id.week_row1, dayCell(c, id, start.plusDays(k), names[k], events));
        }

        root.addView(R.id.week_row2, miniMonthCell(c, start));
        for (int k = 4; k < 7; k++) {
            root.addView(R.id.week_row2, dayCell(c, id, start.plusDays(k), names[k], events));
        }
        return root;
    }

    private static RemoteViews dayCell(Context c, int widgetId, LocalDate date, String dayName, List<ScheduleRepository.Ev> events) {
        RemoteViews cell = new RemoteViews(c.getPackageName(), R.layout.week_cell);
        cell.setTextViewText(R.id.cell_date,
                date.format(DateTimeFormatter.ofPattern("M/d")) + "(" + dayName + ")");

        boolean isToday = date.equals(LocalDate.now());
        if (isToday) {
            cell.setInt(R.id.cell_date, "setBackgroundColor", Color.rgb(22, 101, 52));
            cell.setTextColor(R.id.cell_date, Color.WHITE);
        } else if (date.getDayOfWeek() == DayOfWeek.SUNDAY) {
            cell.setTextColor(R.id.cell_date, Color.rgb(220, 38, 38));
        } else if (date.getDayOfWeek() == DayOfWeek.SATURDAY) {
            cell.setTextColor(R.id.cell_date, Color.rgb(37, 99, 235));
        }

        PendingIntent open = openDate(c, widgetId, date);
        cell.setOnClickPendingIntent(R.id.cell_date, open);
        cell.setOnClickPendingIntent(R.id.cell, open);

        List<ScheduleRepository.Ev> dayEvents = day(events, date);
        for (ScheduleRepository.Ev e : dayEvents) {
            RemoteViews chip = new RemoteViews(c.getPackageName(), R.layout.event_chip);
            chip.setTextViewText(R.id.chip, (e.time == null || e.time.isEmpty() ? "" : e.time + " ") + e.title);
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

    private static RemoteViews miniMonthCell(Context c, LocalDate selectedWeekStart) {
        RemoteViews cell = new RemoteViews(c.getPackageName(), R.layout.week_cell);
        YearMonth month = YearMonth.from(selectedWeekStart.plusDays(3));

        // 미니달력은 다른 날짜 머리글 흐름에 끼지 않게 전용 머리글을 숨기고,
        // '8월' 같은 월 제목을 달력 이미지 안쪽 바로 위에 그린다.
        cell.setViewVisibility(R.id.cell_date, View.GONE);
        cell.setViewVisibility(R.id.cell_separator, View.GONE);
        cell.setViewVisibility(R.id.cell_events, View.GONE);
        cell.setViewVisibility(R.id.cell_image, View.VISIBLE);
        cell.setImageViewBitmap(R.id.cell_image, drawMiniMonth(month, selectedWeekStart));
        return cell;
    }

    private static Bitmap drawMiniMonth(YearMonth month, LocalDate selectedWeekStart) {
        final int width = 320;
        final int height = 250;
        Bitmap bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(bitmap);
        canvas.drawColor(Color.WHITE);

        Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        paint.setTextAlign(Paint.Align.CENTER);

        // 월 제목을 미니달력 바로 위에 배치한다.
        paint.setTypeface(Typeface.create(Typeface.DEFAULT, Typeface.BOLD));
        paint.setTextSize(30f);
        paint.setColor(Color.rgb(22, 101, 52));
        canvas.drawText(month.getMonthValue() + "월", width / 2f, 34f, paint);

        paint.setTextSize(21f);
        float colW = width / 7f;
        float headerY = 67f;
        String[] week = {"일", "월", "화", "수", "목", "금", "토"};
        for (int col = 0; col < 7; col++) {
            paint.setColor(col == 0 ? Color.rgb(220, 38, 38) : col == 6 ? Color.rgb(37, 99, 235) : Color.rgb(75, 85, 99));
            canvas.drawText(week[col], colW * (col + 0.5f), headerY, paint);
        }

        LocalDate first = month.atDay(1);
        LocalDate gridStart = first.minusDays(first.getDayOfWeek().getValue() % 7);
        int selectedRow = (int) (ChronoUnit.DAYS.between(gridStart, selectedWeekStart) / 7);
        float gridTop = 80f;
        float rowH = (height - gridTop - 6f) / 6f;

        if (selectedRow >= 0 && selectedRow < 6) {
            paint.setColor(Color.rgb(220, 237, 216));
            float top = gridTop + selectedRow * rowH + 2f;
            canvas.drawRoundRect(new RectF(4f, top, width - 4f, top + rowH - 4f), 12f, 12f, paint);
        }

        paint.setTypeface(Typeface.create(Typeface.DEFAULT, Typeface.NORMAL));
        paint.setTextSize(21f);
        for (int row = 0; row < 6; row++) {
            float centerY = gridTop + row * rowH + rowH * 0.67f;
            for (int col = 0; col < 7; col++) {
                LocalDate date = gridStart.plusDays(row * 7L + col);
                boolean currentMonth = date.getMonthValue() == month.getMonthValue();
                if (!currentMonth) {
                    paint.setColor(Color.rgb(156, 163, 175));
                } else if (col == 0) {
                    paint.setColor(Color.rgb(220, 38, 38));
                } else if (col == 6) {
                    paint.setColor(Color.rgb(37, 99, 235));
                } else {
                    paint.setColor(Color.rgb(55, 65, 81));
                }
                canvas.drawText(String.valueOf(date.getDayOfMonth()), colW * (col + 0.5f), centerY, paint);
            }
        }
        return bitmap;
    }

    private static PendingIntent openDate(Context c, int widgetId, LocalDate date) {
        Intent i = new Intent(c, MainActivity.class);
        i.setAction("cm.open.date." + date);
        i.putExtra("widgetDate", date.toString());
        i.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        int req = ((widgetId * 997) ^ date.toString().hashCode()) & 0x7fffffff;
        return PendingIntent.getActivity(c, req, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static RemoteViews base(Context c, int id) {
        RemoteViews root = new RemoteViews(c.getPackageName(), R.layout.widget_weekly);
        root.setOnClickPendingIntent(R.id.prev, nav(c, id, PREV, id + 20000));
        root.setOnClickPendingIntent(R.id.next, nav(c, id, NEXT, id + 30000));
        root.setOnClickPendingIntent(R.id.today, nav(c, id, TODAY, id + 40000));
        return root;
    }

    private static PendingIntent nav(Context c, int id, String action, int req) {
        Intent i = new Intent(c, WeeklyWidgetProvider.class);
        i.setAction(action);
        i.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id);
        return PendingIntent.getBroadcast(c, req, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static void saveCache(Context c, int widgetId, LocalDate start, List<ScheduleRepository.Ev> events) {
        try {
            JSONArray arr = new JSONArray();
            for (ScheduleRepository.Ev e : events) {
                JSONObject o = new JSONObject();
                o.put("id", safe(e.id));
                o.put("title", safe(e.title));
                o.put("date", safe(e.date));
                o.put("time", safe(e.time));
                o.put("calId", safe(e.calId));
                o.put("color", safe(e.color));
                arr.put(o);
            }
            c.getSharedPreferences(CACHE, Context.MODE_PRIVATE).edit()
                    .putString("start_" + widgetId, start.toString())
                    .putString("events_" + widgetId, arr.toString())
                    .apply();
        } catch (Exception ignored) {}
    }

    private static List<ScheduleRepository.Ev> loadCache(Context c, int widgetId, LocalDate start) {
        try {
            SharedPreferences p = c.getSharedPreferences(CACHE, Context.MODE_PRIVATE);
            String savedStart = p.getString("start_" + widgetId, "");
            if (!start.toString().equals(savedStart)) return null;
            String raw = p.getString("events_" + widgetId, null);
            if (raw == null) return null;

            JSONArray arr = new JSONArray(raw);
            ArrayList<ScheduleRepository.Ev> out = new ArrayList<>();
            for (int n = 0; n < arr.length(); n++) {
                JSONObject o = arr.getJSONObject(n);
                out.add(new ScheduleRepository.Ev(
                        o.optString("id", ""),
                        o.optString("title", "일정"),
                        o.optString("date", ""),
                        o.optString("time", ""),
                        o.optString("calId", "unassigned"),
                        o.optString("color", "#9ca3af")
                ));
            }
            return out;
        } catch (Exception e) {
            return null;
        }
    }

    private static String safe(String s) { return s == null ? "" : s; }

    private static int parseColor(String value, int fallback) {
        try { return Color.parseColor(value); } catch (Exception e) { return fallback; }
    }

    private static int tint(int color) {
        int r = Color.red(color), g = Color.green(color), b = Color.blue(color);
        return Color.rgb((r + 255 * 5) / 6, (g + 255 * 5) / 6, (b + 255 * 5) / 6);
    }

    private static List<ScheduleRepository.Ev> day(List<ScheduleRepository.Ev> events, LocalDate date) {
        ArrayList<ScheduleRepository.Ev> out = new ArrayList<>();
        for (ScheduleRepository.Ev e : events) if (date.toString().equals(e.date)) out.add(e);
        out.sort(Comparator.comparing(e -> e.time == null ? "" : e.time));
        return out;
    }
}
