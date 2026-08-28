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
import java.time.temporal.ChronoUnit;
import java.time.temporal.TemporalAdjusters;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

public class WeeklyWidgetProvider extends AppWidgetProvider {
    private static final String PREV = "cm.week.prev";
    private static final String NEXT = "cm.week.next";
    private static final String SELECT = "cm.week.select";
    private static final String PREF = "cm_week_widget";

    @Override public void onUpdate(Context c, AppWidgetManager m, int[] ids) {
        for (int id : ids) renderAsync(c, m, id);
    }

    @Override public void onReceive(Context c, Intent i) {
        super.onReceive(c, i);
        String a = i.getAction();
        if (!PREV.equals(a) && !NEXT.equals(a) && !SELECT.equals(a)) return;
        int id = i.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, -1);
        if (id < 0) return;
        int offset = c.getSharedPreferences(PREF, Context.MODE_PRIVATE).getInt("offset_" + id, 0);
        if (SELECT.equals(a)) {
            String ds = i.getStringExtra("date");
            try {
                LocalDate selected = LocalDate.parse(ds).with(TemporalAdjusters.previousOrSame(DayOfWeek.SUNDAY));
                LocalDate current = LocalDate.now().with(TemporalAdjusters.previousOrSame(DayOfWeek.SUNDAY));
                offset = (int)(ChronoUnit.DAYS.between(current, selected) / 7);
            } catch (Exception ignored) { return; }
        } else {
            offset += NEXT.equals(a) ? 1 : -1;
        }
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
                    .with(TemporalAdjusters.previousOrSame(DayOfWeek.SUNDAY))
                    .plusWeeks(offset);
            List<ScheduleRepository.Ev> evs = ScheduleRepository.load(c, base, base.plusDays(6));
            RemoteViews r = base(c, id);
            r.setViewVisibility(R.id.loading, View.GONE);
            r.setTextViewText(R.id.year_title, base.plusDays(3).getYear() + "년");
            r.setTextViewText(R.id.week_title,
                    base.format(DateTimeFormatter.ofPattern("M월 d일 (일)")) + " ~ " +
                    base.plusDays(6).format(DateTimeFormatter.ofPattern("M월 d일 (토)")));
            r.removeAllViews(R.id.week_row1);
            r.removeAllViews(R.id.week_row2);

            String[] ko = {"일","월","화","수","목","금","토"};
            for (int k = 0; k < 4; k++) r.addView(R.id.week_row1, dayCell(c,id,base.plusDays(k),ko[k],evs,k));
            r.addView(R.id.week_row2, miniCalendar(c,id,base));
            for (int k = 4; k < 7; k++) r.addView(R.id.week_row2, dayCell(c,id,base.plusDays(k),ko[k],evs,k));
            m.updateAppWidget(id, r);
        }).start();
    }

    private static RemoteViews dayCell(Context c,int id,LocalDate d,String dayName,List<ScheduleRepository.Ev> evs,int k){
        RemoteViews cell = new RemoteViews(c.getPackageName(), R.layout.week_cell);
        cell.setTextViewText(R.id.cell_date, dayName + "  " + d.format(DateTimeFormatter.ofPattern("M/d")));
        if (d.getDayOfWeek()==DayOfWeek.SUNDAY) cell.setTextColor(R.id.cell_date, Color.rgb(220,38,38));
        if (d.getDayOfWeek()==DayOfWeek.SATURDAY) cell.setTextColor(R.id.cell_date, Color.rgb(37,99,235));
        List<ScheduleRepository.Ev> day = day(evs, d);
        for (int q = 0; q < day.size(); q++) {
            RemoteViews chip = new RemoteViews(c.getPackageName(), R.layout.event_chip);
            ScheduleRepository.Ev e = day.get(q);
            String text = (e.time == null || e.time.isEmpty() ? "" : e.time + " ") + e.title;
            chip.setTextViewText(R.id.chip, text);
            int color=parseColor(e.color,Color.rgb(156,163,175));
            chip.setTextColor(R.id.chip,color);
            chip.setInt(R.id.chip,"setBackgroundColor",tint(color));
            chip.setOnClickPendingIntent(R.id.chip, openDate(c, id * 100 + k * 10 + q, d));
            cell.addView(R.id.cell_events, chip);
        }
        if (day.isEmpty()) {
            RemoteViews empty = new RemoteViews(c.getPackageName(), R.layout.event_chip);
            empty.setTextViewText(R.id.chip, "일정 없음");
            empty.setTextColor(R.id.chip, Color.rgb(148,163,184));
            empty.setInt(R.id.chip, "setBackgroundColor", Color.TRANSPARENT);
            cell.addView(R.id.cell_events, empty);
        }
        cell.setOnClickPendingIntent(R.id.cell, openDate(c, id * 10 + k, d));
        return cell;
    }

    private static RemoteViews miniCalendar(Context c,int id,LocalDate selectedWeek){
        RemoteViews mini=new RemoteViews(c.getPackageName(),R.layout.week_mini_calendar);
        YearMonth ym=YearMonth.from(selectedWeek.plusDays(3));
        mini.setTextViewText(R.id.mini_month,ym.getMonthValue()+"월");
        int[] rows={R.id.mini_row1,R.id.mini_row2,R.id.mini_row3,R.id.mini_row4,R.id.mini_row5,R.id.mini_row6};
        LocalDate first=ym.atDay(1);
        LocalDate start=first.minusDays(first.getDayOfWeek().getValue()%7);
        LocalDate selectedEnd=selectedWeek.plusDays(6);
        for(int n=0;n<42;n++){
            LocalDate d=start.plusDays(n);
            RemoteViews cell=new RemoteViews(c.getPackageName(),R.layout.week_mini_date);
            cell.setTextViewText(R.id.mini_date,String.valueOf(d.getDayOfMonth()));
            boolean inMonth=d.getMonthValue()==ym.getMonthValue();
            int text=!inMonth?Color.rgb(180,184,190):d.getDayOfWeek()==DayOfWeek.SUNDAY?Color.rgb(220,38,38):d.getDayOfWeek()==DayOfWeek.SATURDAY?Color.rgb(37,99,235):Color.rgb(48,49,52);
            cell.setTextColor(R.id.mini_date,text);
            if(!d.isBefore(selectedWeek)&&!d.isAfter(selectedEnd)) cell.setInt(R.id.mini_date,"setBackgroundResource",R.drawable.mini_week_selected);
            cell.setOnClickPendingIntent(R.id.mini_date,selectWeek(c,id,50000+id*100+n,d));
            mini.addView(rows[n/7],cell);
        }
        return mini;
    }

    private static RemoteViews base(Context c, int id) {
        RemoteViews r = new RemoteViews(c.getPackageName(), R.layout.widget_weekly);
        r.setOnClickPendingIntent(R.id.prev, nav(c, id, PREV, id + 20000));
        r.setOnClickPendingIntent(R.id.next, nav(c, id, NEXT, id + 30000));
        Intent app=new Intent(Intent.ACTION_VIEW,Uri.parse(WidgetUtil.WEB));
        r.setOnClickPendingIntent(R.id.brand,PendingIntent.getActivity(c,id+40000,app,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE));
        return r;
    }

    private static PendingIntent nav(Context c, int id, String action, int req) {
        Intent i = new Intent(c, WeeklyWidgetProvider.class);
        i.setAction(action);
        i.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id);
        return PendingIntent.getBroadcast(c, req, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static PendingIntent selectWeek(Context c,int id,int req,LocalDate d){
        Intent i=new Intent(c,WeeklyWidgetProvider.class);i.setAction(SELECT);i.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID,id);i.putExtra("date",d.toString());
        return PendingIntent.getBroadcast(c,req,i,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
    }

    private static PendingIntent openDate(Context c, int req, LocalDate d) {
        Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(WidgetUtil.WEB + "?widgetDate=" + d));
        return PendingIntent.getActivity(c, req, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static int parseColor(String s,int def){try{return Color.parseColor(s);}catch(Exception e){return def;}}
    private static int tint(int color){int r=Color.red(color),g=Color.green(color),b=Color.blue(color);return Color.rgb((r+255*5)/6,(g+255*5)/6,(b+255*5)/6);}

    private static List<ScheduleRepository.Ev> day(List<ScheduleRepository.Ev> evs, LocalDate d) {
        ArrayList<ScheduleRepository.Ev> out = new ArrayList<>();
        for (ScheduleRepository.Ev e : evs) if (d.toString().equals(e.date)) out.add(e);
        out.sort(Comparator.comparing(e -> e.time == null ? "" : e.time));
        return out;
    }
}
