package com.cleanmanager.widget;
import android.app.*;import android.appwidget.*;import android.content.*;import android.net.*;import android.widget.*;
public final class WidgetUtil{
 static final String WEB="https://clean-manager-60bc9.web.app/";static final String PREV="cm.prev",NEXT="cm.next";
 static void setup(Context c,AppWidgetManager m,int id,int layout,String mode){
  RemoteViews r=new RemoteViews(c.getPackageName(),layout);
  Intent svc=new Intent(c,WidgetPageService.class);svc.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID,id);svc.putExtra("mode",mode);svc.setData(Uri.parse("cmwidget://"+mode+"/"+id+"?v=4"));r.setRemoteAdapter(R.id.stack,svc);
  Intent open=new Intent(Intent.ACTION_VIEW,Uri.parse(WEB));r.setOnClickPendingIntent(R.id.open_app,PendingIntent.getActivity(c,id,open,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE));
  Intent tmpl=new Intent(Intent.ACTION_VIEW);r.setPendingIntentTemplate(R.id.stack,PendingIntent.getActivity(c,id+10000,tmpl,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_MUTABLE));
  if(mode.equals("weekly")||mode.equals("monthly")){Class<?> provider=mode.equals("weekly")?WeeklyWidgetProvider.class:MonthlyWidgetProvider.class;r.setOnClickPendingIntent(R.id.prev,nav(c,provider,id,PREV,id+20000));r.setOnClickPendingIntent(R.id.next,nav(c,provider,id,NEXT,id+30000));}
  m.updateAppWidget(id,r);m.notifyAppWidgetViewDataChanged(id,R.id.stack);
 }
 static PendingIntent nav(Context c,Class<?> k,int id,String a,int req){Intent i=new Intent(c,k);i.setAction(a);i.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID,id);return PendingIntent.getBroadcast(c,req,i,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);}
 static void handleNav(Context c,Intent i,int layout){String a=i.getAction();if(!PREV.equals(a)&&!NEXT.equals(a))return;int id=i.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID,-1);if(id<0)return;RemoteViews r=new RemoteViews(c.getPackageName(),layout);if(NEXT.equals(a))r.showNext(R.id.stack);else r.showPrevious(R.id.stack);AppWidgetManager.getInstance(c).updateAppWidget(id,r);}
 static void refreshAll(Context c){AppWidgetManager m=AppWidgetManager.getInstance(c);Class<?>[]cs={DailyWidgetProvider.class,WeeklyWidgetProvider.class,MonthlyWidgetProvider.class,ListWidgetProvider.class};for(Class<?>k:cs)for(int id:m.getAppWidgetIds(new ComponentName(c,k)))m.notifyAppWidgetViewDataChanged(id,R.id.stack);}
}
