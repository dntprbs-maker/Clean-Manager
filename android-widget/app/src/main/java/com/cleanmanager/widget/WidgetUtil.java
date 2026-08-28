package com.cleanmanager.widget;
import android.app.*;import android.appwidget.*;import android.content.*;import android.net.*;import android.widget.*;
public final class WidgetUtil {
 static final String WEB="https://clean-manager-60bc9.web.app/";
 static void setup(Context c, AppWidgetManager m,int id,int layout,String mode){RemoteViews r=new RemoteViews(c.getPackageName(),layout);Intent svc=new Intent(c,WidgetPageService.class);svc.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID,id);svc.putExtra("mode",mode);svc.setData(Uri.parse("cmwidget://"+mode+"/"+id));r.setRemoteAdapter(R.id.stack,svc);Intent open=new Intent(Intent.ACTION_VIEW,Uri.parse(WEB));r.setOnClickPendingIntent(R.id.open_app,PendingIntent.getActivity(c,id,open,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE));m.updateAppWidget(id,r);m.notifyAppWidgetViewDataChanged(id,R.id.stack);}
 static void refreshAll(Context c){AppWidgetManager m=AppWidgetManager.getInstance(c);Class<?>[] cs={DailyWidgetProvider.class,WeeklyWidgetProvider.class,MonthlyWidgetProvider.class};for(Class<?> k:cs){for(int id:m.getAppWidgetIds(new ComponentName(c,k)))m.notifyAppWidgetViewDataChanged(id,R.id.stack);}}
}
