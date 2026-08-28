package com.cleanmanager.widget;

import android.app.*;import android.os.*;import android.webkit.*;import android.widget.*;import org.json.*;

public class MainActivity extends Activity {
  static final String WEB="https://clean-manager-60bc9.web.app/";
  WebView web; TextView status; Handler h=new Handler(Looper.getMainLooper());
  @Override public void onCreate(Bundle b){super.onCreate(b);setContentView(R.layout.activity_main);status=findViewById(R.id.status);web=findViewById(R.id.web);WebSettings s=web.getSettings();s.setJavaScriptEnabled(true);s.setDomStorageEnabled(true);web.setWebViewClient(new WebViewClient(){@Override public void onPageFinished(WebView v,String u){poll();}});web.loadUrl(WEB);}
  void poll(){web.evaluateJavascript("(function(){return localStorage.getItem('loginUser')||''})()",v->{try{String raw=new JSONArray("["+v+"]").getString(0);if(raw!=null&&!raw.isEmpty()){JSONObject j=new JSONObject(raw);String cid=j.optString("companyId","");if(!cid.isEmpty()){getSharedPreferences("cm",MODE_PRIVATE).edit().putString("companyId",cid).apply();status.setText("위젯 연결 완료 · 홈 화면에서 일간/주간/월간 위젯을 추가하세요.");WidgetUtil.refreshAll(this);return;}}}catch(Exception ignored){}h.postDelayed(this::poll,2000);});}
  @Override protected void onDestroy(){h.removeCallbacksAndMessages(null);super.onDestroy();}
}
