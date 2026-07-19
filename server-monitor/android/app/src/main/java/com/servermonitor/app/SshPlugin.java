package com.servermonitor.app;

import android.util.Log;
import android.os.PowerManager;
import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import androidx.activity.result.ActivityResult;
import androidx.documentfile.provider.DocumentFile;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.ActivityCallback;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.ByteArrayOutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import com.getcapacitor.JSArray;

@CapacitorPlugin(name = "SshPlugin")
public class SshPlugin extends Plugin {
    private static final String TAG = "SshPlugin";
    private final Map<String, SshConnection> connections = new ConcurrentHashMap<>();
    private final Set<String> restartingFlags = ConcurrentHashMap.newKeySet();
    private final Object lifecycleLock = new Object();
    private final ExecutorService executor = Executors.newCachedThreadPool();
    private final OkHttpClient webDavClient = new OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build();
    private PowerManager.WakeLock wakeLock;
    private volatile boolean destroyed;

    @Override
    public void load() {
        Log.d(TAG, "Plugin loaded");
    }

    @PluginMethod
    public void connect(PluginCall call) {
        String id = call.getString("id", "");
        String host = call.getString("host", "");
        int port = call.getInt("port", 22);
        String username = call.getString("username", "root");
        String password = call.getString("password", "");
        String keyData = call.getString("keyData", "");
        String keyPassphrase = call.getString("keyPassphrase", "");
        String jumpHost = call.getString("jumpHost", "");
        int jumpPort = call.getInt("jumpPort", 22);
        String jumpUsername = call.getString("jumpUsername", "root");
        String jumpPassword = call.getString("jumpPassword", "");

        Log.d(TAG, "connect() id=" + id + " host=" + host + " port=" + port + " user=" + username);

        if (host.isEmpty()) {
            Log.e(TAG, "connect() rejected: empty host");
            call.reject("Host is required");
            return;
        }

        executor.execute(() -> {
            SshConnection conn = new SshConnection(id, host, port, username);
            boolean success;

            if (!jumpHost.isEmpty() && !jumpPassword.isEmpty()) {
                success = conn.connectViaJump(password, jumpHost, jumpPort, jumpUsername, jumpPassword);
            } else if (!keyData.isEmpty()) {
                byte[] keyBytes = android.util.Base64.decode(keyData, android.util.Base64.DEFAULT);
                byte[] passphrase = keyPassphrase.isEmpty() ? null : keyPassphrase.getBytes();
                success = conn.connectWithKey(keyBytes, passphrase);
            } else {
                success = conn.connect(password);
            }

            if (success) {
                if (destroyed) {
                    conn.disconnect();
                    call.reject("Plugin is destroyed");
                    return;
                }
                Log.d(TAG, "connect() SUCCESS for " + id);
                replaceConnection(id, conn);
                updateForegroundService();
                JSObject result = new JSObject();
                result.put("success", true);
                result.put("connectionId", id);
                call.resolve(result);
            } else {
                String err = conn.getLastError();
                Log.e(TAG, "connect() FAILED for " + id + ": " + err);
                JSObject result = new JSObject();
                result.put("success", false);
                result.put("error", err.isEmpty() ? "Connection failed" : err);
                call.resolve(result);
            }
        });
    }

    @PluginMethod
    public void disconnect(PluginCall call) {
        String id = call.getString("connectionId", "");
        removeConnection(id, connections.get(id));
        updateForegroundService();
        JSObject result = new JSObject();
        result.put("success", true);
        call.resolve(result);
    }

    @PluginMethod
    public void execCommand(PluginCall call) {
        String id = call.getString("connectionId", "");
        String command = call.getString("command", "");
        SshConnection conn = connections.get(id);

        if (conn == null) {
            call.reject("Not connected");
            return;
        }

        executor.execute(() -> {
            String output = conn.execCommand(command);
            JSObject result = new JSObject();
            result.put("output", output);
            call.resolve(result);
        });
    }

    @PluginMethod
    public void startShell(PluginCall call) {
        String id = call.getString("connectionId", "");
        SshConnection conn = connections.get(id);

        if (conn == null) {
            call.reject("Not connected");
            return;
        }

        executor.execute(() -> {
            conn.setPtyListener((connectionId, data) -> {
                JSObject event = new JSObject();
                event.put("connectionId", connectionId);
                event.put("data", data);
                notifyListeners("shellData", event);
            });
            // Register death listener so heartbeat can auto-restart dead shell
            conn.setShellDeathListener(deadId -> {
                if (!restartingFlags.add(deadId)) return;
                Log.d(TAG, "ShellDeathListener: restarting shell for " + deadId);
                boolean restarted = conn.restartShell();
                if (restarted) {
                    JSObject evt = new JSObject();
                    evt.put("connectionId", deadId);
                    evt.put("restarted", true);
                    notifyListeners("shellRestarted", evt);
                } else {
                    Log.e(TAG, "ShellDeathListener: restart failed for " + deadId);
                    removeConnection(deadId, conn);
                    updateForegroundService();
                    JSObject evt = new JSObject();
                    evt.put("connectionId", deadId);
                    evt.put("disconnected", true);
                    notifyListeners("connectionLost", evt);
                }
                restartingFlags.remove(deadId);
            });

            boolean success = conn.startShell();
            JSObject result = new JSObject();
            result.put("success", success);
            call.resolve(result);
        });
    }

    @PluginMethod
    public void writeToShell(PluginCall call) {
        String id = call.getString("connectionId", "");
        String data = call.getString("data", "");
        SshConnection conn = connections.get(id);

        if (conn != null) {
            executor.execute(() -> {
                boolean ok = conn.writeToShell(data);
                if (!ok) {
                    if (!restartingFlags.add(id)) return;
                    // Shell channel may be dead but session alive — try restarting
                    Log.d(TAG, "writeToShell failed for " + id + ", attempting shell restart");
                    boolean restarted = conn.restartShell();
                    if (restarted) {
                        Log.d(TAG, "Shell restarted OK for " + id);
                        JSObject event = new JSObject();
                        event.put("connectionId", id);
                        event.put("restarted", true);
                        notifyListeners("shellRestarted", event);
                        // Replay the data that triggered this restart
                        conn.writeToShell(data);
                    } else {
                        Log.e(TAG, "Shell restart failed for " + id + ", disconnecting");
                        removeConnection(id, conn);
                        updateForegroundService();
                        JSObject event = new JSObject();
                        event.put("connectionId", id);
                        event.put("disconnected", true);
                        notifyListeners("connectionLost", event);
                    }
                    restartingFlags.remove(id);
                }
            });
        }
        call.resolve();
    }

    @PluginMethod
    public void resizePty(PluginCall call) {
        String id = call.getString("connectionId", "");
        int cols = call.getInt("cols", 80);
        int rows = call.getInt("rows", 24);
        SshConnection conn = connections.get(id);

        if (conn != null) {
            conn.resizePty(cols, rows);
        }
        call.resolve();
    }

    @PluginMethod
    public void stopShell(PluginCall call) {
        String id = call.getString("connectionId", "");
        SshConnection conn = connections.get(id);

        if (conn != null) {
            executor.execute(conn::stopShell);
        }
        call.resolve();
    }

    @PluginMethod
    public void listFiles(PluginCall call) {
        String id = call.getString("connectionId", "");
        String path = call.getString("path", "/root");
        SshConnection conn = connections.get(id);

        if (conn == null) {
            call.reject("Not connected");
            return;
        }

        executor.execute(() -> {
            List<Map<String, Object>> files = conn.listFiles(path);
            JSObject result = new JSObject();
            result.put("files", new org.json.JSONArray(files));
            result.put("path", path);
            call.resolve(result);
        });
    }

    @PluginMethod
    public void deleteFile(PluginCall call) {
        String id = call.getString("connectionId", "");
        String path = call.getString("path", "");
        SshConnection conn = connections.get(id);

        if (conn == null) {
            call.reject("Not connected");
            return;
        }

        executor.execute(() -> {
            boolean success = conn.deleteFile(path);
            JSObject result = new JSObject();
            result.put("success", success);
            call.resolve(result);
        });
    }

    @PluginMethod
    public void createDirectory(PluginCall call) {
        String id = call.getString("connectionId", "");
        String path = call.getString("path", "");
        SshConnection conn = connections.get(id);

        if (conn == null) {
            call.reject("Not connected");
            return;
        }

        executor.execute(() -> {
            boolean success = conn.createDirectory(path);
            JSObject result = new JSObject();
            result.put("success", success);
            call.resolve(result);
        });
    }

    @PluginMethod
    public void readFile(PluginCall call) {
        String id = call.getString("connectionId", "");
        String path = call.getString("path", "");
        SshConnection conn = connections.get(id);

        if (conn == null) {
            call.reject("Not connected");
            return;
        }

        executor.execute(() -> {
            String content = conn.readFile(path);
            JSObject result = new JSObject();
            result.put("content", content);
            call.resolve(result);
        });
    }

    @PluginMethod
    public void readFileChunk(PluginCall call) {
        String id = call.getString("connectionId", "");
        String path = call.getString("path", "");
        Double offsetValue = call.getDouble("offset");
        Double maxBytesValue = call.getDouble("maxBytes");
        long offset = offsetValue != null ? Math.max(0L, offsetValue.longValue()) : 0L;
        int maxBytes = Math.min(Math.max(maxBytesValue != null ? maxBytesValue.intValue() : 5 * 1024 * 1024, 1), 5 * 1024 * 1024);
        SshConnection conn = connections.get(id);

        if (conn == null) {
            call.reject("Not connected");
            return;
        }

        executor.execute(() -> {
            SshConnection.FileChunk chunk = conn.readFileChunk(path, offset, maxBytes);
            JSObject result = new JSObject();
            result.put("content", chunk.content);
            result.put("size", chunk.size);
            result.put("bytes", chunk.bytes);
            result.put("firstLine", chunk.firstLine);
            result.put("error", chunk.error);
            call.resolve(result);
        });
    }

    @PluginMethod
    public void isConnected(PluginCall call) {
        String id = call.getString("connectionId", "");
        SshConnection conn = connections.get(id);
        JSObject result = new JSObject();
        if (conn != null) {
            boolean alive = conn.checkAlive();
            result.put("connected", alive);
            if (!alive) {
                removeConnection(id, conn);
                updateForegroundService();
            }
        } else {
            result.put("connected", false);
        }
        call.resolve(result);
    }

    @PluginMethod
    public void uploadFile(PluginCall call) {
        String id = call.getString("connectionId", "");
        String remotePath = call.getString("remotePath", "");
        String base64Data = call.getString("data", "");
        SshConnection conn = connections.get(id);

        if (conn == null) {
            call.reject("Not connected");
            return;
        }
        if (remotePath.isEmpty()) {
            call.reject("remotePath is required");
            return;
        }

        executor.execute(() -> {
            byte[] data = android.util.Base64.decode(base64Data, android.util.Base64.DEFAULT);
            boolean success = conn.uploadFile(data, remotePath);
            JSObject result = new JSObject();
            result.put("success", success);
            call.resolve(result);
        });
    }

    @PluginMethod
    public void uploadDirectory(PluginCall call) {
        String id = call.getString("connectionId", "");
        String remotePath = call.getString("remotePath", "");
        if (connections.get(id) == null) {
            call.reject("Not connected");
            return;
        }
        if (remotePath.isEmpty()) {
            call.reject("remotePath is required");
            return;
        }
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        startActivityForResult(call, intent, "uploadDirectoryResult");
    }

    @PluginMethod
    public void saveConfigBackup(PluginCall call) {
        String fileName = call.getString("fileName", "server-monitor-backup.json");
        String base64Data = call.getString("data", "");
        if (base64Data.isEmpty()) {
            call.reject("Backup data is required");
            return;
        }
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("application/json");
        intent.putExtra(Intent.EXTRA_TITLE, fileName);
        intent.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        startActivityForResult(call, intent, "saveConfigBackupResult");
    }

    @PluginMethod
    public void saveDownloadedFile(PluginCall call) {
        String fileName = call.getString("fileName", "download");
        String base64Data = call.getString("data", "");
        if (base64Data.isEmpty()) {
            call.reject("Download data is required");
            return;
        }
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("application/octet-stream");
        intent.putExtra(Intent.EXTRA_TITLE, fileName);
        intent.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        startActivityForResult(call, intent, "saveDownloadedFileResult");
    }

    @ActivityCallback
    private void saveConfigBackupResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            JSObject output = new JSObject();
            output.put("success", false);
            output.put("cancelled", true);
            call.resolve(output);
            return;
        }
        Uri uri = result.getData().getData();
        String base64Data = call.getString("data", "");
        executor.execute(() -> {
            try (OutputStream outputStream = getContext().getContentResolver().openOutputStream(uri, "w")) {
                if (outputStream == null) throw new IllegalStateException("Unable to open backup destination");
                outputStream.write(android.util.Base64.decode(base64Data, android.util.Base64.DEFAULT));
                outputStream.flush();
                JSObject output = new JSObject();
                output.put("success", true);
                call.resolve(output);
            } catch (Exception error) {
                call.reject("Unable to save backup: " + error.getMessage());
            }
        });
    }

    @ActivityCallback
    private void saveDownloadedFileResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            JSObject output = new JSObject();
            output.put("success", false);
            output.put("cancelled", true);
            call.resolve(output);
            return;
        }
        Uri uri = result.getData().getData();
        String base64Data = call.getString("data", "");
        executor.execute(() -> {
            try (OutputStream outputStream = getContext().getContentResolver().openOutputStream(uri, "w")) {
                if (outputStream == null) throw new IllegalStateException("Unable to open download destination");
                outputStream.write(android.util.Base64.decode(base64Data, android.util.Base64.DEFAULT));
                outputStream.flush();
                JSObject output = new JSObject();
                output.put("success", true);
                call.resolve(output);
            } catch (Exception error) {
                call.reject("Unable to save download: " + error.getMessage());
            }
        });
    }

    @PluginMethod
    public void uploadWebDavBackup(PluginCall call) {
        String url = call.getString("url", "");
        String username = call.getString("username", "");
        String password = call.getString("password", "");
        String path = call.getString("path", "");
        String fileName = call.getString("fileName", "");
        String base64Data = call.getString("data", "");
        if (fileName.isEmpty() || base64Data.isEmpty()) {
            call.reject("Backup file name and data are required");
            return;
        }
        executor.execute(() -> {
            try {
                HttpURLConnection connection = createWebDavConnection(url, username, password, path, fileName, "PUT");
                connection.setDoOutput(true);
                connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                byte[] content = android.util.Base64.decode(base64Data, android.util.Base64.DEFAULT);
                try (OutputStream output = connection.getOutputStream()) {
                    output.write(content);
                }
                int status = connection.getResponseCode();
                if (status < 200 || status >= 300) throw new IllegalStateException(webDavError(connection, status));
                JSObject result = new JSObject();
                result.put("success", true);
                result.put("fileName", fileName);
                call.resolve(result);
            } catch (Exception error) {
                call.reject("WebDAV backup failed: " + error.getMessage());
            }
        });
    }

    @PluginMethod
    public void testWebDavConnection(PluginCall call) {
        String url = call.getString("url", "");
        String username = call.getString("username", "");
        String password = call.getString("password", "");
        String path = call.getString("path", "");
        executor.execute(() -> {
            try {
                HttpURLConnection connection = createWebDavConnection(url, username, password, path, "", "OPTIONS");
                connection.setDoInput(true);
                int status = connection.getResponseCode();
                if (status < 200 || status >= 300) throw new IllegalStateException(webDavError(connection, status));
                String davHeader = connection.getHeaderField("DAV");
                if (davHeader == null || davHeader.isEmpty()) throw new IllegalStateException("Server response does not advertise WebDAV support");
                String testFileName = ".server-monitor-write-test-" + System.currentTimeMillis() + ".tmp";
                HttpURLConnection writeConnection = createWebDavConnection(url, username, password, path, testFileName, "PUT");
                writeConnection.setDoOutput(true);
                writeConnection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                try (OutputStream output = writeConnection.getOutputStream()) {
                    output.write("{}".getBytes(StandardCharsets.UTF_8));
                }
                int writeStatus = writeConnection.getResponseCode();
                if (writeStatus < 200 || writeStatus >= 300) throw new IllegalStateException(webDavError(writeConnection, writeStatus));
                HttpURLConnection deleteConnection = createWebDavConnection(url, username, password, path, testFileName, "DELETE");
                int deleteStatus = deleteConnection.getResponseCode();
                if ((deleteStatus < 200 || deleteStatus >= 300) && deleteStatus != 404) throw new IllegalStateException("Write test succeeded but temporary file cleanup failed: " + webDavError(deleteConnection, deleteStatus));
                JSObject result = new JSObject();
                result.put("success", true);
                call.resolve(result);
            } catch (Exception error) {
                call.reject("WebDAV connection test failed: " + error.getMessage());
            }
        });
    }

    @PluginMethod
    public void listWebDavBackups(PluginCall call) {
        String url = call.getString("url", "");
        String username = call.getString("username", "");
        String password = call.getString("password", "");
        String path = call.getString("path", "");
        executor.execute(() -> {
            try (Response response = webDavClient.newCall(createWebDavRequest(url, username, password, path, "")
                .header("Depth", "1")
                .header("Content-Type", "text/xml; charset=utf-8")
                .method("PROPFIND", RequestBody.create("", MediaType.get("text/xml; charset=utf-8")))
                .build()).execute()) {
                int status = response.code();
                if (status != 207 && (status < 200 || status >= 300)) throw new IllegalStateException(webDavError(response));
                String responseBody = response.body() == null ? "" : response.body().string();
                JSArray files = new JSArray();
                Matcher matcher = Pattern.compile("(?is)<[^>]*href[^>]*>\\s*(.*?)\\s*</[^>]*href>").matcher(responseBody);
                Set<String> names = ConcurrentHashMap.newKeySet();
                while (matcher.find()) {
                    String href = matcher.group(1).replace("&amp;", "&");
                    String decoded = Uri.decode(href);
                    int separator = decoded.lastIndexOf('/');
                    String name = separator >= 0 ? decoded.substring(separator + 1) : decoded;
                    if (name.startsWith("server-monitor-backup-") && name.endsWith(".json") && names.add(name)) files.put(name);
                }
                JSObject result = new JSObject();
                result.put("files", files);
                call.resolve(result);
            } catch (Exception error) {
                call.reject("WebDAV backup list failed: " + error.getMessage());
            }
        });
    }

    @PluginMethod
    public void downloadWebDavBackup(PluginCall call) {
        String url = call.getString("url", "");
        String username = call.getString("username", "");
        String password = call.getString("password", "");
        String path = call.getString("path", "");
        String fileName = call.getString("fileName", "");
        if (fileName.isEmpty()) {
            call.reject("Backup file name is required");
            return;
        }
        executor.execute(() -> {
            try {
                HttpURLConnection connection = createWebDavConnection(url, username, password, path, fileName, "GET");
                int status = connection.getResponseCode();
                if (status < 200 || status >= 300) throw new IllegalStateException(webDavError(connection, status));
                String data = android.util.Base64.encodeToString(readBytes(connection.getInputStream()), android.util.Base64.NO_WRAP);
                JSObject result = new JSObject();
                result.put("data", data);
                call.resolve(result);
            } catch (Exception error) {
                call.reject("WebDAV backup download failed: " + error.getMessage());
            }
        });
    }

    private HttpURLConnection createWebDavConnection(String baseUrl, String username, String password, String path, String fileName, String method) throws Exception {
        String directoryUrl = buildWebDavDirectoryUrl(baseUrl, path);
        String targetUrl = fileName.isEmpty() ? directoryUrl : directoryUrl + Uri.encode(fileName);
        HttpURLConnection connection = (HttpURLConnection) new URL(targetUrl).openConnection();
        connection.setRequestMethod(method);
        connection.setConnectTimeout(15000);
        connection.setReadTimeout(30000);
        connection.setRequestProperty("Accept", "application/json, text/xml, */*");
        if (!username.isEmpty() || !password.isEmpty()) {
            String credential = username + ":" + password;
            String authorization = android.util.Base64.encodeToString(credential.getBytes(StandardCharsets.UTF_8), android.util.Base64.NO_WRAP);
            connection.setRequestProperty("Authorization", "Basic " + authorization);
        }
        return connection;
    }

    private Request.Builder createWebDavRequest(String baseUrl, String username, String password, String path, String fileName) {
        String directoryUrl = buildWebDavDirectoryUrl(baseUrl, path);
        String targetUrl = fileName.isEmpty() ? directoryUrl : directoryUrl + Uri.encode(fileName);
        Request.Builder request = new Request.Builder()
            .url(targetUrl)
            .header("Accept", "application/json, text/xml, */*");
        if (!username.isEmpty() || !password.isEmpty()) {
            String credential = username + ":" + password;
            String authorization = android.util.Base64.encodeToString(credential.getBytes(StandardCharsets.UTF_8), android.util.Base64.NO_WRAP);
            request.header("Authorization", "Basic " + authorization);
        }
        return request;
    }

    private String buildWebDavDirectoryUrl(String baseUrl, String remotePath) {
        String normalized = baseUrl.trim();
        if (!(normalized.startsWith("https://") || normalized.startsWith("http://"))) throw new IllegalArgumentException("WebDAV URL must start with http:// or https://");
        while (normalized.endsWith("/")) normalized = normalized.substring(0, normalized.length() - 1);
        StringBuilder result = new StringBuilder(normalized).append('/');
        for (String segment : remotePath.trim().split("/")) {
            if (segment.isEmpty() || segment.equals(".")) continue;
            if (segment.equals("..")) throw new IllegalArgumentException("WebDAV path cannot contain ..");
            result.append(Uri.encode(segment)).append('/');
        }
        return result.toString();
    }

    private String webDavError(HttpURLConnection connection, int status) {
        String statusMessage = webDavStatusMessage(status);
        if (statusMessage != null) return statusMessage;
        try {
            InputStream stream = connection.getErrorStream();
            String detail = stream == null ? "" : readStream(stream).trim();
            return "HTTP " + status + (detail.isEmpty() ? "" : ": " + detail);
        } catch (Exception ignored) {
            return "HTTP " + status;
        }
    }

    private String webDavError(Response response) {
        String statusMessage = webDavStatusMessage(response.code());
        if (statusMessage != null) return statusMessage;
        try {
            String detail = response.body() == null ? "" : response.body().string().trim();
            return "HTTP " + response.code() + (detail.isEmpty() ? "" : ": " + detail);
        } catch (Exception ignored) {
            return "HTTP " + response.code();
        }
    }

    private String webDavStatusMessage(int status) {
        if (status == 401) return "HTTP 401: WebDAV username or password was rejected";
        if (status == 403) return "HTTP 403: WebDAV server denied write access. Check the WebDAV URL, remote directory, and account permissions";
        if (status == 404) return "HTTP 404: WebDAV URL or remote directory was not found";
        if (status == 405) return "HTTP 405: Server does not allow this WebDAV operation";
        if (status == 409) return "HTTP 409: Remote directory does not exist";
        return null;
    }

    private String readStream(InputStream input) throws Exception {
        return new String(readBytes(input), StandardCharsets.UTF_8);
    }

    private byte[] readBytes(InputStream input) throws Exception {
        try (InputStream stream = input; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            int read;
            while ((read = stream.read(buffer)) != -1) output.write(buffer, 0, read);
            return output.toByteArray();
        }
    }

    @ActivityCallback
    private void uploadDirectoryResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            call.reject("Directory selection cancelled");
            return;
        }
        Uri treeUri = result.getData().getData();
        if (treeUri == null) {
            call.reject("Directory URI unavailable");
            return;
        }
        int flags = result.getData().getFlags() & Intent.FLAG_GRANT_READ_URI_PERMISSION;
        try {
            getContext().getContentResolver().takePersistableUriPermission(treeUri, flags);
        } catch (SecurityException ignored) {
        }
        String id = call.getString("connectionId", "");
        String remotePath = call.getString("remotePath", "");
        SshConnection connection = connections.get(id);
        executor.execute(() -> {
            DocumentFile root = DocumentFile.fromTreeUri(getContext(), treeUri);
            if (connection == null || root == null || !root.isDirectory()) {
                call.reject("Unable to open selected directory");
                return;
            }
            int totalFiles = countFiles(root);
            int[] uploadedFiles = {0};
            String rootName = root.getName() == null ? "folder" : root.getName();
            boolean success = uploadDirectoryTree(connection, id, root, trimTrailingSlash(remotePath) + "/" + rootName, totalFiles, uploadedFiles);
            JSObject output = new JSObject();
            output.put("success", success);
            output.put("files", uploadedFiles[0]);
            call.resolve(output);
        });
    }

    private int countFiles(DocumentFile directory) {
        int count = 0;
        for (DocumentFile child : directory.listFiles()) {
            count += child.isDirectory() ? countFiles(child) : 1;
        }
        return count;
    }

    private boolean uploadDirectoryTree(SshConnection connection, String connectionId, DocumentFile directory, String remoteDirectory, int totalFiles, int[] uploadedFiles) {
        connection.createDirectory(remoteDirectory);
        for (DocumentFile child : directory.listFiles()) {
            String name = child.getName();
            if (name == null || name.contains("/")) continue;
            String remotePath = remoteDirectory + "/" + name;
            if (child.isDirectory()) {
                if (!uploadDirectoryTree(connection, connectionId, child, remotePath, totalFiles, uploadedFiles)) return false;
                continue;
            }
            try (InputStream input = getContext().getContentResolver().openInputStream(child.getUri())) {
                if (input == null || !connection.uploadFile(input, remotePath)) return false;
            } catch (Exception e) {
                return false;
            }
            uploadedFiles[0]++;
            JSObject event = new JSObject();
            event.put("connectionId", connectionId);
            event.put("fileName", name);
            event.put("uploadedFiles", uploadedFiles[0]);
            event.put("totalFiles", totalFiles);
            event.put("progress", totalFiles == 0 ? 100 : Math.round(uploadedFiles[0] * 100f / totalFiles));
            notifyListeners("directoryUploadProgress", event);
        }
        return true;
    }

    private String trimTrailingSlash(String path) {
        return path.length() > 1 && path.endsWith("/") ? path.substring(0, path.length() - 1) : path;
    }

    @PluginMethod
    public void appendToFile(PluginCall call) {
        String id = call.getString("connectionId", "");
        String remotePath = call.getString("remotePath", "");
        String base64Data = call.getString("data", "");
        SshConnection conn = connections.get(id);

        if (conn == null) {
            call.reject("Not connected");
            return;
        }
        if (remotePath.isEmpty() || base64Data.isEmpty()) {
            call.reject("remotePath and data are required");
            return;
        }

        executor.execute(() -> {
            byte[] data = android.util.Base64.decode(base64Data, android.util.Base64.DEFAULT);
            boolean success = conn.appendToFile(data, remotePath);
            JSObject result = new JSObject();
            result.put("success", success);
            call.resolve(result);
        });
    }

    @PluginMethod
    public void downloadFile(PluginCall call) {
        String id = call.getString("connectionId", "");
        String remotePath = call.getString("remotePath", "");
        SshConnection conn = connections.get(id);

        if (conn == null) {
            call.reject("Not connected");
            return;
        }

        executor.execute(() -> {
            byte[] data = conn.downloadFile(remotePath);
            JSObject result = new JSObject();
            if (data != null) {
                result.put("success", true);
                result.put("data", android.util.Base64.encodeToString(data, android.util.Base64.DEFAULT));
            } else {
                result.put("success", false);
                result.put("error", conn.getLastError());
            }
            call.resolve(result);
        });
    }

    @PluginMethod
    public void copyRemoteFile(PluginCall call) {
        String sourceConnectionId = call.getString("sourceConnectionId", "");
        String sourcePath = call.getString("sourcePath", "");
        String destinationConnectionId = call.getString("destinationConnectionId", "");
        String destinationPath = call.getString("destinationPath", "");
        SshConnection source = connections.get(sourceConnectionId);
        SshConnection destination = connections.get(destinationConnectionId);

        if (source == null || destination == null) {
            call.reject("Source and destination connections are required");
            return;
        }
        if (sourcePath.isEmpty() || destinationPath.isEmpty()) {
            call.reject("Source and destination paths are required");
            return;
        }

        executor.execute(() -> {
            boolean success = source.copyFileTo(destination, sourcePath, destinationPath);
            JSObject result = new JSObject();
            result.put("success", success);
            if (!success) result.put("error", source.getLastError());
            call.resolve(result);
        });
    }

    @Override
    protected void handleOnDestroy() {
        destroyed = true;
        for (SshConnection connection : connections.values()) {
            connection.disconnect();
        }
        connections.clear();
        restartingFlags.clear();
        executor.shutdownNow();
        releaseWakeLock();
        SshForegroundService.stop(getContext());
        super.handleOnDestroy();
    }

    private void replaceConnection(String id, SshConnection replacement) {
        SshConnection previous = connections.put(id, replacement);
        if (previous != null && previous != replacement) {
            executor.execute(previous::disconnect);
        }
    }

    private void removeConnection(String id, SshConnection expected) {
        if (expected != null && connections.remove(id, expected)) {
            executor.execute(expected::disconnect);
        }
    }

    private void updateForegroundService() {
        synchronized (lifecycleLock) {
            int count = connections.size();
            if (!destroyed && count > 0) {
                SshForegroundService.update(getContext(), count);
                acquireWakeLock();
            } else {
                SshForegroundService.stop(getContext());
                releaseWakeLock();
            }
        }
    }

    private void acquireWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) return;
        PowerManager pm = (PowerManager) getContext().getSystemService(android.content.Context.POWER_SERVICE);
        if (pm != null) {
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "ServerMonitor:SSH");
            wakeLock.acquire();
            Log.d(TAG, "WakeLock acquired");
        }
    }

    private void releaseWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) {
            wakeLock.release();
            Log.d(TAG, "WakeLock released");
        }
        wakeLock = null;
    }
}
