package org.zeolite.app;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;

/**
 * Shares the open vault on the local network (Wi-Fi) so that a PC syncs with
 * this phone or tablet ("Share this vault"). The PC only makes outgoing
 * connections, so this works on PCs where Windows Firewall cannot be opened
 * without administrator rights. See LanServer for the protocol.
 *
 * Events: "changed" {path} when a device writes or deletes a file, "locked"
 * when too many wrong pairing codes stopped the server.
 */
@CapacitorPlugin(name = "LanShare")
public class LanSharePlugin extends Plugin {

    private LanServer server;

    private JSObject info(LanServer s) {
        JSObject ret = new JSObject();
        JSArray ips = new JSArray();
        for (String ip : LanServer.localAddresses()) ips.put(ip);
        ret.put("ips", ips);
        ret.put("port", s.port());
        return ret;
    }

    @PluginMethod
    public synchronized void start(PluginCall call) {
        String path = call.getString("path");
        String token = call.getString("token");
        String name = call.getString("name", "");
        int port = call.getInt("port", 47123);
        if (path == null || token == null) {
            call.reject("Missing vault folder or pairing code.");
            return;
        }
        File root = new File(path);
        if (!root.isDirectory()) {
            call.reject("The vault folder cannot be found.");
            return;
        }
        // Already sharing this vault with this code: keep it.
        if (server != null && server.isRunning() && server.root().equals(root) && server.token().equals(token)) {
            call.resolve(info(server));
            return;
        }
        if (server != null) server.stop();
        try {
            server = new LanServer(root, name, token, port, new LanServer.Listener() {
                @Override
                public void changed(String p) {
                    JSObject e = new JSObject();
                    e.put("path", p);
                    notifyListeners("changed", e);
                }

                @Override
                public void locked() {
                    notifyListeners("locked", new JSObject());
                }
            });
            call.resolve(info(server));
        } catch (Exception e) {
            server = null;
            call.reject(e.getMessage() == null ? "Cannot start sharing." : e.getMessage());
        }
    }

    @PluginMethod
    public synchronized void stop(PluginCall call) {
        if (server != null) server.stop();
        server = null;
        call.resolve();
    }

    @PluginMethod
    public synchronized void status(PluginCall call) {
        JSObject ret = server != null && server.isRunning() ? info(server) : new JSObject();
        ret.put("running", server != null && server.isRunning());
        call.resolve(ret);
    }

    @Override
    protected void handleOnDestroy() {
        if (server != null) server.stop();
        server = null;
    }
}
