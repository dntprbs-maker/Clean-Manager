package com.cleanmanager.widget;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
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

    @Override public void onUpdate(Context c, AppWidgetManager m, int[] ids) { for (int id : ids) renderAsync(c,m,id); }

    @Override public void onReceive(Context c, Intent i) {
        super.onReceive(c,i);
        String a=i.getAction();
        if(!PREV.equals(a)&&!NEXT.equals(a)) return;
        int id=i.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID,-1);
        if(id<0) return;
        int offset=c.getSharedPreferences(PREF,Context.MODE_PRIVATE).getInt("offset_"+id,0);
        offset += NEXT.equals(a)?1:-1;
        c.getSharedPreferences(PREF,Context.MODE_PRIVATE).edit().putInt("offset_"+id,offset).apply();
        renderAsync(c,AppWidgetManager.getInstance(c),id);
    }

    private static void renderAsync(Context c,AppWidgetManager m,int id){
        RemoteViews loading=base(c,id);
        loading.setViewVisibility(R.id.loading,View.VISIBLE);
        m.updateAppWidget(id,loading);
        new Thread(() -> {
            int offset=c.getSharedPreferences(PREF,Context.MODE_PRIVATE).getInt("offset_"+id,0);
            LocalDate base=LocalDate.now().with(TemporalAdjusters.previousOrSame(DayOfWeek.SUNDAY)).plusWeeks(offset);
            List<ScheduleRepository.Ev> evs=ScheduleRepository.load(c,base,base.plusDays(6));
            RemoteViews r=base(c,id);
            r.setViewVisibility(R.id.loading,View.GONE);
            r.setTextViewText(R.id.week_title,base.format(DateTimeFormatter.ofPattern("M월 d일"))+" ~ "+base.plusDays(6).format(DateTimeFormatter.ofPattern("M월 d일")));
            r.removeAllViews(R.id.week_row1); r.removeAllViews(R.id.week_row2);
            String[] ko={"일","월","화","수","목","금","토"};
            for(int k=0;k<8;k++){
                RemoteViews cell=new RemoteViews(c.getPackageName(),R.layout.week_cell);
                if(k<7){
                    LocalDate d=base.plusDays(k);
                    cell.setTextViewText(R.id.cell_date,ko[k]+"  "+d.format(DateTimeFormatter.ofPattern("M/d")));
                    if(k==0) cell.setTextColor(R.id.cell_date,Color.rgb(220,38,38));
                    if(k==6) cell.setTextColor(R.id.cell_date,Color.rgb(37,99,235));
                    List<ScheduleRepository.Ev> day=day(evs,d);
                    for(ScheduleRepository.Ev e:day){
                        RemoteViews chip=new RemoteViews(c.getPackageName(),R.layout.event_chip);
                        String text=(e.time==null||e.time.isEmpty()?"":e.time+" ")+e.title;
                        chip.setTextViewText(R.id.chip,text);
                        int color=parseColor(e.color,Color.rgb(107,114,128));
                        chip.setTextColor(R.id.chip,color);
                        chip.setInt(R.id.chip,"setBackgroundColor",tint(color));
                        cell.addView(R.id.cell_events,chip);
                    }
                    if(day.isEmpty()){
                        RemoteViews empty=new RemoteViews(c.getPackageName(),R.layout.event_chip);
                        empty.setTextViewText(R.id.chip,"일정 없음");
                        empty.setTextColor(R.id.chip,Color.rgb(148,163,184));
                        empty.setInt(R.id.chip,"setBackgroundColor",Color.TRANSPARENT);
                        cell.addView(R.id.cell_events,empty);
                    }
                } else {
                    cell.setTextViewText(R.id.cell_date,"");
                    cell.setViewVisibility(R.id.cell_events,View.INVISIBLE);
                }
                r.addView(k<4?R.id.week_row1:R.id.week_row2,cell);
            }
            m.updateAppWidget(id,r);
        }).start();
    }

    private static RemoteViews base(Context c,int id){
        RemoteViews r=new RemoteViews(c.getPackageName(),R.layout.widget_weekly);
        r.setOnClickPendingIntent(R.id.prev,nav(c,id,PREV,id+20000));
        r.setOnClickPendingIntent(R.id.next,nav(c,id,NEXT,id+30000));
        return r;
    }

    private static PendingIntent nav(Context c,int id,String action,int req){
        Intent i=new Intent(c,WeeklyWidgetProvider.class); i.setAction(action); i.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID,id);
        return PendingIntent.getBroadcast(c,req,i,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
    }
    private static int parseColor(String s,int def){try{return Color.parseColor(s);}catch(Exception e){return def;}}
    private static int tint(int color){int r=Color.red(color),g=Color.green(color),b=Color.blue(color);return Color.rgb((r+255*5)/6,(g+255*5)/6,(b+255*5)/6);}
    private static List<ScheduleRepository.Ev> day(List<ScheduleRepository.Ev> evs,LocalDate d){
        ArrayList<ScheduleRepository.Ev> out=new ArrayList<>(); for(ScheduleRepository.Ev e:evs) if(d.toString().equals(e.date)) out.add(e);
        out.sort(Comparator.comparing(e->e.time==null?"":e.time)); return out;
    }
}
