package org.zeolite.app;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.BindException;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.NetworkInterface;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.SocketException;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Deque;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Direct sync over the local network (Wi-Fi): a small HTTP server sharing the
 * open vault with a PC or another device on the same network, which syncs with
 * it like with a WebDAV server. Same protocol and rules as the Windows app's
 * server (apps/desktop/src-tauri/src/lan.rs):
 *
 *   GET    /zeolite/v1/info          {"app":"zeolite","name":…}
 *   GET    /zeolite/v1/list          {"files":{path: version}}
 *   GET    /zeolite/v1/file?path=…   the file
 *   PUT    /zeolite/v1/file?path=…   {"version":…} (folders created)
 *   DELETE /zeolite/v1/file?path=…   204 (also when already gone)
 *
 * Every request carries the pairing code ("Authorization: Bearer <code>");
 * after too many wrong codes the server stops. Only files the sync handles are
 * reachable: no hidden folders or files, no "..".
 *
 * Plain Java (no Android classes), so it can be tested on any JVM.
 */
public class LanServer {

    public interface Listener {
        /** A device wrote or deleted this vault-relative path. */
        void changed(String path);
        /** The server stopped by itself (too many wrong pairing codes). */
        void locked();
    }

    static final int MAX_FAILURES = 20;
    static final long MAX_UPLOAD = 200L * 1024 * 1024;

    private final File root;
    private final String name;
    private final String token;
    private final Listener listener;
    private final ServerSocket socket;
    private final ExecutorService pool = Executors.newFixedThreadPool(4);
    private final AtomicInteger failures = new AtomicInteger();
    private volatile boolean running = true;

    /** Listen on {@code port}, or on one of the next ports if it is taken (0: any free port). */
    public LanServer(File root, String name, String token, int port, Listener listener) throws IOException {
        if (token == null || token.length() < 6) throw new IOException("The pairing code is too short.");
        this.root = root;
        this.name = name;
        this.token = token;
        this.listener = listener;
        this.socket = bind(port);
        Thread accept = new Thread(this::acceptLoop, "zeolite-lan");
        accept.setDaemon(true);
        accept.start();
    }

    private static ServerSocket bind(int port) throws IOException {
        IOException last = null;
        int tries = port == 0 ? 1 : 10;
        for (int i = 0; i < tries; i++) {
            ServerSocket s = new ServerSocket();
            s.setReuseAddress(true);
            try {
                s.bind(new InetSocketAddress(port == 0 ? 0 : port + i));
                return s;
            } catch (BindException e) {
                last = e;
                s.close();
            }
        }
        throw new IOException("Cannot start sharing: port " + port + " and the next ones are in use (" + (last == null ? "" : last.getMessage()) + ").");
    }

    public int port() {
        return socket.getLocalPort();
    }

    public File root() {
        return root;
    }

    public String token() {
        return token;
    }

    public boolean isRunning() {
        return running && !socket.isClosed();
    }

    public void stop() {
        running = false;
        try {
            socket.close();
        } catch (IOException ignored) {
            // Already closed.
        }
        pool.shutdownNow();
    }

    private void acceptLoop() {
        while (running) {
            try {
                Socket client = socket.accept();
                pool.execute(() -> serve(client));
            } catch (IOException e) {
                if (!running) return;
            } catch (java.util.concurrent.RejectedExecutionException e) {
                return;
            }
        }
    }

    // --- HTTP ----------------------------------------------------------------

    private static final class Request {
        String method;
        String route;
        String query = "";
        final Map<String, String> headers = new HashMap<>();
        long length;
        InputStream body;
    }

    private void serve(Socket client) {
        try (Socket c = client) {
            c.setSoTimeout(30_000);
            InputStream in = new BufferedInputStream(c.getInputStream());
            OutputStream out = c.getOutputStream();
            Request req = readHead(in);
            if (req == null) return;
            req.body = in;
            handle(req, out);
            out.flush();
        } catch (IOException ignored) {
            // Connection dropped.
        }
    }

    /** Request line and headers (at most 16 KB). */
    private static Request readHead(InputStream in) throws IOException {
        ByteArrayOutputStream head = new ByteArrayOutputStream();
        int last4 = 0;
        // Until the blank line ending the headers: \r\n\r\n.
        while (last4 != 0x0d0a0d0a) {
            int b = in.read();
            if (b < 0 || head.size() > 16 * 1024) return null;
            head.write(b);
            last4 = (last4 << 8) | b;
        }
        String[] lines = head.toString("ISO-8859-1").split("\r\n");
        String[] first = lines[0].split(" ");
        if (first.length < 2) return null;
        Request r = new Request();
        r.method = first[0].toUpperCase(Locale.ROOT);
        String target = first[1];
        int q = target.indexOf('?');
        r.route = q < 0 ? target : target.substring(0, q);
        if (q >= 0) r.query = target.substring(q + 1);
        for (int i = 1; i < lines.length; i++) {
            int colon = lines[i].indexOf(':');
            if (colon > 0) r.headers.put(lines[i].substring(0, colon).trim().toLowerCase(Locale.ROOT), lines[i].substring(colon + 1).trim());
        }
        try {
            r.length = Long.parseLong(r.headers.getOrDefault("content-length", "0"));
        } catch (NumberFormatException e) {
            r.length = 0;
        }
        return r;
    }

    private static void respond(OutputStream out, int status, String type, byte[] body) throws IOException {
        String reason = status == 200 ? "OK" : status == 204 ? "No Content" : status == 400 ? "Bad Request" : status == 401 ? "Unauthorized" : status == 404 ? "Not Found" : status == 405 ? "Method Not Allowed" : status == 413 ? "Payload Too Large" : "Error";
        StringBuilder h = new StringBuilder();
        h.append("HTTP/1.1 ").append(status).append(' ').append(reason).append("\r\n");
        h.append("Access-Control-Allow-Origin: *\r\n");
        h.append("Access-Control-Allow-Headers: Authorization, Content-Type\r\n");
        h.append("Access-Control-Allow-Methods: GET, PUT, DELETE, OPTIONS\r\n");
        h.append("Access-Control-Max-Age: 600\r\n");
        h.append("Cache-Control: no-store\r\n");
        if (type != null) h.append("Content-Type: ").append(type).append("\r\n");
        h.append("Content-Length: ").append(body.length).append("\r\n");
        h.append("Connection: close\r\n\r\n");
        out.write(h.toString().getBytes(StandardCharsets.ISO_8859_1));
        out.write(body);
    }

    private static void json(OutputStream out, int status, String body) throws IOException {
        respond(out, status, "application/json; charset=utf-8", body.getBytes(StandardCharsets.UTF_8));
    }

    private static void error(OutputStream out, int status, String message) throws IOException {
        json(out, status, "{\"error\":" + quote(message) + "}");
    }

    static String quote(String s) {
        StringBuilder b = new StringBuilder("\"");
        for (char ch : s.toCharArray()) {
            switch (ch) {
                case '"': b.append("\\\""); break;
                case '\\': b.append("\\\\"); break;
                case '\n': b.append("\\n"); break;
                case '\r': b.append("\\r"); break;
                case '\t': b.append("\\t"); break;
                default:
                    if (ch < 0x20) b.append(String.format(Locale.ROOT, "\\u%04x", (int) ch));
                    else b.append(ch);
            }
        }
        return b.append('"').toString();
    }

    private void handle(Request req, OutputStream out) throws IOException {
        if (req.method.equals("OPTIONS")) {
            respond(out, 204, null, new byte[0]);
            return;
        }
        if (!("Bearer " + token).equals(req.headers.get("authorization"))) {
            int n = failures.incrementAndGet();
            error(out, 401, "Wrong pairing code.");
            if (n >= MAX_FAILURES) {
                stop();
                if (listener != null) listener.locked();
            }
            return;
        }
        if (req.method.equals("GET") && req.route.equals("/zeolite/v1/info")) {
            json(out, 200, "{\"app\":\"zeolite\",\"name\":" + quote(name) + "}");
            return;
        }
        if (req.method.equals("GET") && req.route.equals("/zeolite/v1/list")) {
            json(out, 200, "{\"files\":" + list() + "}");
            return;
        }
        if (!req.route.equals("/zeolite/v1/file")) {
            error(out, 404, "Unknown address.");
            return;
        }
        String path = safePath(req.query);
        if (path == null) {
            error(out, 400, "Not a path that can be synced.");
            return;
        }
        File file = new File(root, path);
        switch (req.method) {
            case "GET": {
                if (!file.isFile()) {
                    error(out, 404, "No such file.");
                    return;
                }
                respond(out, 200, "application/octet-stream", readAll(file));
                return;
            }
            case "PUT": {
                if (req.length > MAX_UPLOAD) {
                    error(out, 413, "File too large.");
                    return;
                }
                File dir = file.getParentFile();
                if (dir != null && !dir.isDirectory() && !dir.mkdirs()) {
                    error(out, 500, "Cannot create the folder.");
                    return;
                }
                // Written next to the file, then renamed: a broken upload never leaves half a note.
                File tmp = new File(dir, "." + file.getName() + ".zeolite-upload");
                try (OutputStream w = new FileOutputStream(tmp)) {
                    byte[] buf = new byte[65536];
                    long left = req.length;
                    while (left > 0) {
                        int n = req.body.read(buf, 0, (int) Math.min(buf.length, left));
                        if (n < 0) throw new IOException("Upload cut short.");
                        w.write(buf, 0, n);
                        left -= n;
                    }
                } catch (IOException e) {
                    tmp.delete();
                    error(out, 400, e.getMessage() == null ? "Upload failed." : e.getMessage());
                    return;
                }
                if (file.exists() && !file.delete() || !tmp.renameTo(file)) {
                    tmp.delete();
                    error(out, 500, "Cannot write the file.");
                    return;
                }
                json(out, 200, "{\"version\":" + quote(version(file)) + "}");
                if (listener != null) listener.changed(path);
                return;
            }
            case "DELETE": {
                if (file.isFile() && !file.delete()) {
                    error(out, 500, "Cannot delete the file.");
                    return;
                }
                respond(out, 204, null, new byte[0]);
                if (listener != null) listener.changed(path);
                return;
            }
            default:
                error(out, 405, "Method not allowed.");
        }
    }

    /** A vault-relative path from the query, if it is one the sync may touch. */
    static String safePath(String query) {
        for (String kv : query.split("&")) {
            if (!kv.startsWith("path=")) continue;
            String path;
            try {
                path = URLDecoder.decode(kv.substring(5), "UTF-8");
            } catch (Exception e) {
                return null;
            }
            if (path.isEmpty() || path.length() >= 1024 || path.contains("\\") || path.contains(":") || path.contains("\0")) return null;
            for (String part : path.split("/", -1)) {
                if (part.isEmpty() || part.startsWith(".") || part.equals("node_modules")) return null;
            }
            return path;
        }
        return null;
    }

    static String version(File f) {
        return f.lastModified() + "-" + f.length();
    }

    private String list() {
        StringBuilder b = new StringBuilder("{");
        Deque<Object[]> stack = new ArrayDeque<>();
        stack.push(new Object[] { root, "" });
        boolean first = true;
        while (!stack.isEmpty()) {
            Object[] top = stack.pop();
            File[] entries = ((File) top[0]).listFiles();
            if (entries == null) continue;
            for (File e : entries) {
                String n = e.getName();
                if (n.startsWith(".") || n.equals("node_modules")) continue;
                String rel = ((String) top[1]).isEmpty() ? n : top[1] + "/" + n;
                if (e.isDirectory()) stack.push(new Object[] { e, rel });
                else if (e.isFile()) {
                    if (!first) b.append(',');
                    first = false;
                    b.append(quote(rel)).append(':').append(quote(version(e)));
                }
            }
        }
        return b.append('}').toString();
    }

    private static byte[] readAll(File f) throws IOException {
        try (InputStream in = new FileInputStream(f)) {
            ByteArrayOutputStream out = new ByteArrayOutputStream((int) Math.min(f.length(), Integer.MAX_VALUE));
            byte[] buf = new byte[65536];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            return out.toByteArray();
        }
    }

    /** This device's IPv4 addresses on local networks, Wi-Fi first. */
    public static List<String> localAddresses() {
        List<String> wifi = new ArrayList<>();
        List<String> other = new ArrayList<>();
        try {
            for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!ni.isUp() || ni.isLoopback()) continue;
                String n = ni.getName().toLowerCase(Locale.ROOT);
                for (InetAddress a : Collections.list(ni.getInetAddresses())) {
                    if (!(a instanceof Inet4Address) || a.isLoopbackAddress() || a.isLinkLocalAddress()) continue;
                    (n.startsWith("wlan") || n.startsWith("ap") || n.startsWith("swlan") ? wifi : other).add(a.getHostAddress());
                }
            }
        } catch (SocketException ignored) {
            // No network.
        }
        wifi.addAll(other);
        return wifi;
    }
}
