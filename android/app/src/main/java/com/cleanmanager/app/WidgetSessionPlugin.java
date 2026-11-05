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
        if (!trustedOrigin()) { call.reject("Untrusted session origin"); return; }
        try {
            WidgetSessionStore.set(getContext(), call.getString("idToken", ""), call.getString("refreshToken", ""),
                    call.getString("companyId", ""), call.getString("userId", ""));
            WidgetRefresher.refreshAllAsync(getContext(), true);
            call.resolve();
        } catch (Exception e) { call.reject("Widget session rejected"); }
    }
    @PluginMethod
    public void clearSession(PluginCall call) {
        if (!trustedOrigin()) { call.reject("Untrusted session origin"); return; }
        WidgetSessionStore.clear(getContext());
        WidgetRefresher.redrawAll(getContext());
        call.resolve();
    }
}
