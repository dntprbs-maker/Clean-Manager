package com.cleanmanager.app;

import android.net.Uri;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.cleanmanager.app.widget.WidgetSessionStore;
import com.cleanmanager.app.widget.WidgetRefresher;

@CapacitorPlugin(name = "WidgetSession")
public class WidgetSessionPlugin extends Plugin {
    private boolean trustedOrigin() {
        String url = getBridge().getWebView().getUrl();
        if (url == null) return false;
        Uri uri = Uri.parse(url);
        String host = uri.getHost();
        return ("https".equals(uri.getScheme()) && ("www.clean-manager.com".equals(host) || "clean-manager.com".equals(host)))
                || (("https".equals(uri.getScheme()) || "capacitor".equals(uri.getScheme())) && "localhost".equals(host));
    }
    @PluginMethod
    public void setSession(PluginCall call) {
        // Capacitor invokes plugins off the UI thread; WebView.getUrl requires it.
        getActivity().runOnUiThread(() -> {
            try {
                if (!trustedOrigin()) { call.reject("Untrusted session origin"); return; }
                boolean changed = WidgetSessionStore.set(getContext(), call.getString("idToken", ""), call.getString("refreshToken", ""),
                        call.getString("companyId", ""), call.getString("userId", ""));
                WidgetRefresher.refreshAllAsync(getContext(), changed);
                call.resolve();
            } catch (Exception e) { call.reject("Widget session rejected"); }
        });
    }
    @PluginMethod
    public void invalidateData(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            try {
                if (!trustedOrigin()) { call.reject("Untrusted session origin"); return; }
                WidgetSessionStore.invalidateData(getContext());
                WidgetRefresher.refreshAllAsync(getContext(), false);
                call.resolve();
            } catch (Exception e) { call.reject("Widget refresh failed"); }
        });
    }
    @PluginMethod
    public void clearSession(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            try {
                if (!trustedOrigin()) { call.reject("Untrusted session origin"); return; }
                WidgetSessionStore.clear(getContext());
                WidgetRefresher.redrawAll(getContext());
                call.resolve();
            } catch (Exception e) { call.reject("Widget session clear failed"); }
        });
    }
}
