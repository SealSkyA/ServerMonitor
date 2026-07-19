package com.servermonitor.app;

import android.util.Log;
import com.jcraft.jsch.*;
import java.io.*;
import java.util.*;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

public class SshConnection {
    private static final String TAG = "SshConnection";
    private static final long MAX_IN_MEMORY_FILE_BYTES = 8L * 1024L * 1024L;
    // RFC 4254 terminal opcode 53 (ECHO), set to false, followed by TTY_OP_END.
    private static final byte[] PTY_ECHO_DISABLED = {53, 0, 0, 0, 0, 0};

    private Session session;
    private Session jumpSession;
    private int jumpForwardingPort = -1;
    private ChannelShell shellChannel;
    private String id;
    private String host;
    private int port;
    private String username;
    private volatile boolean connected = false;
    private PipedOutputStream shellStdin;
    private PipedInputStream shellStdout;
    private PtyBridge ptyBridge;
    private PtyBridge.PtyListener ptyListener;
    private ScheduledExecutorService heartbeatExecutor;
    private ShellDeathListener deathListener;
    private String lastError = "";

    public interface ShellDeathListener {
        void onShellDead(String connectionId);
    }

    public void setShellDeathListener(ShellDeathListener listener) {
        this.deathListener = listener;
    }

    public void setPtyListener(PtyBridge.PtyListener listener) {
        this.ptyListener = listener;
    }

    public SshConnection(String id, String host, int port, String username) {
        this.id = id;
        this.host = host;
        this.port = port;
        this.username = username;
    }

    public String getId() { return id; }
    public boolean isConnected() { return connected && session != null && session.isConnected(); }

    public boolean checkAlive() {
        if (!connected || session == null) return false;
        try {
            session.sendKeepAliveMsg();
            if (!session.isConnected()) {
                connected = false;
                return false;
            }
            // Verify with a real exec to detect broken TCP connections
            // that sendKeepAliveMsg alone misses after network switches
            ChannelExec channel = (ChannelExec) session.openChannel("exec");
            channel.setCommand("echo OK");
            channel.connect(5000);
            channel.disconnect();
            connected = true;
            return true;
        } catch (Exception e) {
            connected = false;
            return false;
        }
    }
    public String getLastError() { return lastError; }

    public synchronized boolean connect(String password) {
        lastError = "";
        Log.d(TAG, "connect() called for " + username + "@" + host + ":" + port);

        try {
            JSch jsch = new JSch();
            session = jsch.getSession(username, host, port);
            session.setPassword(password);

            java.util.Properties config = new java.util.Properties();
            config.put("StrictHostKeyChecking", "no");
            config.put("PreferredAuthentications", "password,keyboard-interactive");
            config.put("TCPKeepAlive", "yes");
            session.setConfig(config);
            session.setTimeout(0);
            session.setServerAliveInterval(30000);
            session.setServerAliveCountMax(3);

            Log.d(TAG, "Connecting...");
            session.connect(15000);
            Log.d(TAG, "Connected successfully!");

            connected = true;
            return true;

        } catch (JSchException e) {
            Log.e(TAG, "JSchException: " + e.getMessage(), e);
            lastError = e.getMessage() != null ? e.getMessage() : "JSch exception";
            if (e.getCause() != null) {
                Log.e(TAG, "Cause: " + e.getCause().getMessage());
                lastError += " | Cause: " + e.getCause().getMessage();
            }
            disconnect();
            return false;
        } catch (Exception e) {
            Log.e(TAG, "Unexpected: " + e.getClass().getSimpleName() + ": " + e.getMessage(), e);
            lastError = e.getClass().getSimpleName() + ": " + e.getMessage();
            disconnect();
            return false;
        }
    }

    public synchronized boolean connectWithKey(byte[] privateKey, byte[] passphrase) {
        lastError = "";
        Log.d(TAG, "connectWithKey() called for " + username + "@" + host + ":" + port);

        try {
            JSch jsch = new JSch();
            if (passphrase != null && passphrase.length > 0) {
                jsch.addIdentity(id, privateKey, null, passphrase);
            } else {
                jsch.addIdentity(id, privateKey, null, null);
            }

            session = jsch.getSession(username, host, port);
            java.util.Properties config = new java.util.Properties();
            config.put("StrictHostKeyChecking", "no");
            config.put("TCPKeepAlive", "yes");
            session.setConfig(config);
            session.setTimeout(0);
            session.setServerAliveInterval(30000);
            session.setServerAliveCountMax(3);
            session.connect(15000);

            connected = true;
            return true;

        } catch (JSchException e) {
            Log.e(TAG, "JSchException (key): " + e.getMessage(), e);
            lastError = e.getMessage() != null ? e.getMessage() : "JSch key auth exception";
            disconnect();
            return false;
        } catch (Exception e) {
            Log.e(TAG, "Unexpected exception (key): " + e.getMessage(), e);
            lastError = e.getClass().getSimpleName() + ": " + e.getMessage();
            disconnect();
            return false;
        }
    }

    public synchronized boolean connectViaJump(String password, String jumpHost, int jumpPort,
                                    String jumpUser, String jumpPassword) {
        lastError = "";
        Log.d(TAG, "connectViaJump() target=" + host + ":" + port + " via " + jumpUser + "@" + jumpHost + ":" + jumpPort);
        disconnect();

        try {
            JSch jsch = new JSch();
            jumpSession = jsch.getSession(jumpUser, jumpHost, jumpPort);
            jumpSession.setPassword(jumpPassword);
            java.util.Properties config = new java.util.Properties();
            config.put("StrictHostKeyChecking", "no");
            jumpSession.setConfig(config);
            jumpSession.setTimeout(0);
            jumpSession.connect(120000);
            Log.d(TAG, "Jump session connected OK");

            jumpForwardingPort = jumpSession.setPortForwardingL(0, host, port);
            int localPort = jumpForwardingPort;
            Log.d(TAG, "Port forwarding localhost:" + localPort + " -> " + host + ":" + port);

            try { Thread.sleep(3000); } catch (InterruptedException ie) { Thread.currentThread().interrupt(); }

            Exception lastTargetError = null;
            session = null;

            for (int attempt = 0; attempt < 5; attempt++) {
                if (!jumpSession.isConnected()) {
                    lastError = "Jump session died before target connect";
                    Log.e(TAG, "connectViaJump: " + lastError);
                    disconnect();
                    return false;
                }
                try {
                    if (attempt > 0) {
                        Log.d(TAG, "Retry target #" + (attempt + 1) + " — waiting 3s...");
                        try { Thread.sleep(3000); } catch (InterruptedException ie) { Thread.currentThread().interrupt(); }
                    }
                    session = jsch.getSession(username, "127.0.0.1", localPort);
                    session.setPassword(password);
                    session.setConfig(config);
                    session.setTimeout(0);
                    session.setHostKeyAlias(host);
                    Log.d(TAG, "Connecting target via tunnel (hostKeyAlias=" + host + ")...");
                    session.connect(180000);
                    Log.d(TAG, "Target session connected via jump OK");
                    connected = true;
                    return true;
                } catch (JSchException je) {
                    lastTargetError = je;
                    Log.w(TAG, "Target attempt #" + (attempt + 1) + " JSchException: " + je.getMessage());
                    if (je.getCause() != null) {
                        Log.w(TAG, "  Caused by: " + je.getCause().getClass().getSimpleName() + ": " + je.getCause().getMessage());
                    }
                    if (session != null && session.isConnected()) {
                        session.disconnect();
                    }
                } catch (Exception e) {
                    lastTargetError = e;
                    Log.w(TAG, "Target attempt #" + (attempt + 1) + " Exception: " + e.getClass().getSimpleName() + ": " + e.getMessage());
                    if (session != null && session.isConnected()) {
                        session.disconnect();
                    }
                }
            }

            String targetErr = lastTargetError != null ? lastTargetError.getMessage() : "unknown";
            lastError = "Target unreachable via jump: " + (targetErr != null ? targetErr : "Connection refused");
            Log.e(TAG, "connectViaJump: all target connect attempts exhausted");
            disconnect();
            return false;

        } catch (Exception e) {
            Log.e(TAG, "connectViaJump fatal: " + e.getMessage(), e);
            lastError = e.getMessage() != null ? e.getMessage() : "Jump connection failed";
            disconnect();
            return false;
        }
    }

    public String execCommand(String command) {
        if (!connected) return "ERROR:DISCONNECTED:Not connected";
        try {
            if (session == null || !session.isConnected()) {
                connected = false;
                return "ERROR:DISCONNECTED:Session lost";
            }
            ChannelExec channel = (ChannelExec) session.openChannel("exec");
            channel.setCommand(command);
            InputStream in = channel.getInputStream();
            InputStream err = channel.getErrStream();
            channel.connect(10000);

            StringBuilder output = new StringBuilder();
            byte[] buf = new byte[8192];
            int len;
            while ((len = in.read(buf)) != -1) {
                output.append(new String(buf, 0, len));
            }
            while ((len = err.read(buf)) != -1) {
                output.append(new String(buf, 0, len));
            }
            channel.disconnect();
            return output.toString();
        } catch (JSchException e) {
            Log.e(TAG, "execCommand JSchException: " + e.getMessage());
            connected = false;
            return "ERROR:DISCONNECTED:" + (e.getMessage() != null ? e.getMessage() : "Session error");
        } catch (Exception e) {
            Log.e(TAG, "execCommand error: " + e.getMessage());
            if (e.getMessage() != null && e.getMessage().contains("socket")) {
                connected = false;
                return "ERROR:DISCONNECTED:Socket error";
            }
            return "ERROR: " + e.getMessage();
        }
    }

    public boolean startShell() {
        if (session == null || !session.isConnected()) return false;
        try {
            if (shellChannel != null && shellChannel.isConnected()) {
                shellChannel.disconnect();
            }

            shellChannel = (ChannelShell) session.openChannel("shell");
            shellChannel.setPty(true);
            shellChannel.setPtyType("xterm-256color", 80, 24, 800, 600);
            // Disable echo before requesting the login shell so internal hooks
            // never become visible terminal output. The setup restores echo.
            shellChannel.setTerminalMode(PTY_ECHO_DISABLED);

            shellStdin = new PipedOutputStream();
            shellStdout = new PipedInputStream();
            shellChannel.setInputStream(new PipedInputStream(shellStdin));
            shellChannel.setOutputStream(new PipedOutputStream(shellStdout));
            shellChannel.connect(5000);

            ptyBridge = new PtyBridge(shellStdout, id);
            if (ptyListener != null) ptyBridge.addListener(ptyListener);

            try {
                String commandHook = "{ trap 'printf \"\\033]777;cmd;%s\\033\\\\\" \"$BASH_COMMAND\"' DEBUG; preexec() { printf \"\\033]777;cmd;%s\\033\\\\\" \"$1\"; }; } 2>/dev/null\n";
                String directoryHook = "{ PROMPT_COMMAND='printf \"\\033]777;pwd;%s\\033\\\\\" \"$PWD\";'\"${PROMPT_COMMAND:-}\"; precmd() { printf \"\\033]777;pwd;%s\\033\\\\\" \"$PWD\"; }; cd() { command cd \"$@\" && printf \"\\033]777;pwd;%s\\033\\\\\" \"$PWD\"; }; printf \"\\033]777;pwd;%s\\033\\\\\" \"$PWD\"; } 2>/dev/null; stty echo\n";
                // A single interactive input produces one ready prompt. Sending
                // each setup line separately left three empty prompts behind.
                String setup = "stty -echo; " + commandHook.trim() + "; " + directoryHook;
                ptyBridge.suppressEcho(setup);
                ptyBridge.start();
                shellStdin.write(setup.getBytes());
                shellStdin.flush();
            } catch (Exception e) {
                Log.w(TAG, "Failed to inject shell hooks: " + e.getMessage());
            }

            // Keepalive without injecting bytes into interactive programs such as vim.
            if (heartbeatExecutor != null) heartbeatExecutor.shutdownNow();
            heartbeatExecutor = Executors.newSingleThreadScheduledExecutor();
            final Session sess = session;
            heartbeatExecutor.scheduleWithFixedDelay(() -> {
                if (!sess.isConnected() || shellChannel == null || shellChannel.isClosed()) {
                    connected = false;
                    if (deathListener != null) deathListener.onShellDead(id);
                    return;
                }
                try {
                    sess.sendKeepAliveMsg();
                } catch (Exception e) {
                    connected = false;
                    if (deathListener != null) deathListener.onShellDead(id);
                }
            }, 5, 5, TimeUnit.SECONDS);

            connected = true;
            return true;
        } catch (Exception e) {
            Log.e(TAG, "startShell error: " + e.getMessage(), e);
            return false;
        }
    }

    public boolean restartShell() {
        if (session == null || !session.isConnected()) {
            connected = false;
            return false;
        }
        stopShell();
        return startShell();
    }

    public boolean writeToShell(String data) {
        if (shellStdin == null) return false;
        if (session == null || !session.isConnected()) {
            connected = false;
            return false;
        }

        for (int attempt = 0; attempt < 2; attempt++) {
            try {
                shellStdin.write(data.getBytes());
                shellStdin.flush();
                return true;
            } catch (IOException e) {
                Log.e(TAG, "writeToShell error (attempt " + (attempt + 1) + "): " + e.getMessage());
                if (attempt == 0) {
                    try { Thread.sleep(100); } catch (InterruptedException ignored) {}
                }
            }
        }

        if (session != null && session.isConnected()) {
            return false;
        }
        connected = false;
        return false;
    }

    public void resizePty(int cols, int rows) {
        if (shellChannel != null && shellChannel.isConnected()) {
            shellChannel.setPtySize(cols, rows, 800, 600);
        }
    }

    public void stopShell() {
        if (heartbeatExecutor != null) {
            heartbeatExecutor.shutdownNow();
            heartbeatExecutor = null;
        }
        if (ptyBridge != null) {
            ptyBridge.stopReading();
            ptyBridge = null;
        }
        if (shellChannel != null) {
            shellChannel.disconnect();
            shellChannel = null;
        }
    }

    public List<Map<String, Object>> listFiles(String path) {
        List<Map<String, Object>> files = new ArrayList<>();
        if (!connected) return files;
        ChannelSftp sftp = null;

        try {
            sftp = (ChannelSftp) session.openChannel("sftp");
            sftp.connect(5000);

            Vector<ChannelSftp.LsEntry> entries = sftp.ls(path);
            for (ChannelSftp.LsEntry entry : entries) {
                String name = entry.getFilename();
                if (name.equals(".") || name.equals("..")) continue;

                Map<String, Object> file = new HashMap<>();
                file.put("name", name);
                file.put("type", entry.getAttrs().isDir() ? "directory" : "file");
                file.put("size", entry.getAttrs().getSize());
                file.put("permissions", entry.getAttrs().getPermissionsString());
                file.put("modified", new Date(entry.getAttrs().getMTime() * 1000L).toString());
                files.add(file);
            }
        } catch (Exception e) {
            Log.e(TAG, "listFiles error: " + e.getMessage(), e);
        } finally {
            disconnectChannel(sftp);
        }
        return files;
    }

    public boolean deleteFile(String path) {
        if (!connected) return false;
        ChannelSftp sftp = null;
        try {
            sftp = (ChannelSftp) session.openChannel("sftp");
            sftp.connect(5000);
            sftp.rm(path);
            return true;
        } catch (Exception e) {
            try {
                disconnectChannel(sftp);
                sftp = (ChannelSftp) session.openChannel("sftp");
                sftp.connect(5000);
                sftp.rmdir(path);
                return true;
            } catch (Exception ex) {
                return false;
            }
        } finally {
            disconnectChannel(sftp);
        }
    }

    public boolean createDirectory(String path) {
        if (!connected) return false;
        ChannelSftp sftp = null;
        try {
            sftp = (ChannelSftp) session.openChannel("sftp");
            sftp.connect(5000);
            sftp.mkdir(path);
            return true;
        } catch (Exception e) {
            return false;
        } finally {
            disconnectChannel(sftp);
        }
    }

    public String readFile(String path) {
        if (!connected) return "ERROR: Not connected";
        ChannelSftp sftp = null;
        InputStream input = null;
        try {
            sftp = (ChannelSftp) session.openChannel("sftp");
            sftp.connect(5000);
            long size = sftp.lstat(path).getSize();
            if (size > MAX_IN_MEMORY_FILE_BYTES) {
                return "ERROR: File exceeds the 8 MiB read limit";
            }
            input = sftp.get(path);
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int len;
            long total = 0;
            while ((len = input.read(buf)) != -1) {
                total += len;
                if (total > MAX_IN_MEMORY_FILE_BYTES) {
                    return "ERROR: File exceeds the 8 MiB read limit";
                }
                output.write(buf, 0, len);
            }
            return output.toString("UTF-8");
        } catch (Exception e) {
            return "ERROR: " + e.getMessage();
        } finally {
            closeQuietly(input);
            disconnectChannel(sftp);
        }
    }

    public long getFileSize(String path) {
        if (!connected) return -1;
        ChannelSftp sftp = null;
        try {
            sftp = (ChannelSftp) session.openChannel("sftp");
            sftp.connect(5000);
            return sftp.lstat(path).getSize();
        } catch (Exception e) {
            return -1;
        } finally {
            disconnectChannel(sftp);
        }
    }

    public static class FileChunk {
        public final String content;
        public final long size;
        public final int bytes;
        public final long firstLine;
        public final boolean error;

        FileChunk(String content, long size, int bytes, long firstLine, boolean error) {
            this.content = content;
            this.size = size;
            this.bytes = bytes;
            this.firstLine = firstLine;
            this.error = error;
        }
    }

    public FileChunk readFileChunk(String path, long offset, int maxBytes) {
        if (!connected) return new FileChunk("Not connected", -1, 0, 1, true);
        ChannelSftp sftp = null;
        InputStream input = null;
        try {
            sftp = (ChannelSftp) session.openChannel("sftp");
            sftp.connect(5000);
            long size = sftp.lstat(path).getSize();
            input = sftp.get(path);
            long remaining = offset;
            long firstLine = 1;
            byte[] buffer = new byte[8192];
            while (remaining > 0) {
                int read = input.read(buffer, 0, (int) Math.min(buffer.length, remaining));
                if (read == -1) {
                    return new FileChunk("", size, 0, firstLine, false);
                }
                for (int i = 0; i < read; i++) {
                    if (buffer[i] == '\n') firstLine++;
                }
                remaining -= read;
            }
            ByteArrayOutputStream output = new ByteArrayOutputStream(maxBytes);
            int total = 0;
            int lastByte = -1;
            while (total < maxBytes) {
                int read = input.read(buffer, 0, Math.min(buffer.length, maxBytes - total));
                if (read == -1) break;
                output.write(buffer, 0, read);
                total += read;
                lastByte = buffer[read - 1];
            }

            // Keep adjacent chunks on line boundaries so their displayed line
            // ranges remain continuous. The overflow cap protects single-line files.
            int overflowLimit = maxBytes + 65536;
            while (total < size && lastByte != '\n' && total < overflowLimit) {
                lastByte = input.read();
                if (lastByte == -1) break;
                output.write(lastByte);
                total++;
            }

            String content = output.toString("UTF-8");
            if (lastByte == '\n' && content.endsWith("\n")) {
                content = content.substring(0, content.length() - 1);
                if (content.endsWith("\r")) content = content.substring(0, content.length() - 1);
            }
            return new FileChunk(content, size, total, firstLine, false);
        } catch (Exception e) {
            return new FileChunk(e.getMessage() == null ? "Unable to read file" : e.getMessage(), -1, 0, 1, true);
        } finally {
            closeQuietly(input);
            disconnectChannel(sftp);
        }
    }

    public synchronized void disconnect() {
        stopShell();
        if (session != null) {
            try {
                if (session.isConnected()) {
                    session.disconnect();
                }
            } catch (Exception e) {
                Log.w(TAG, "disconnect() error: " + e.getMessage());
            }
            session = null;
        }
        if (jumpSession != null) {
            try {
                if (jumpForwardingPort >= 0 && jumpSession.isConnected()) {
                    jumpSession.delPortForwardingL(jumpForwardingPort);
                }
            } catch (Exception e) {
                Log.w(TAG, "jump forwarding cleanup error: " + e.getMessage());
            }
            try {
                if (jumpSession.isConnected()) {
                    jumpSession.disconnect();
                }
            } catch (Exception e) {
                Log.w(TAG, "jump session cleanup error: " + e.getMessage());
            }
            jumpSession = null;
        }
        jumpForwardingPort = -1;
        connected = false;
    }

    public boolean uploadFile(byte[] data, String remotePath) {
        if (!connected || data == null) return false;
        ChannelSftp sftp = null;
        try {
            sftp = (ChannelSftp) session.openChannel("sftp");
            sftp.connect(5000);
            sftp.put(new ByteArrayInputStream(data), remotePath);
            Log.d(TAG, "uploadFile success: " + remotePath + " (" + data.length + " bytes)");
            return true;
        } catch (Exception e) {
            Log.e(TAG, "uploadFile error: " + e.getMessage(), e);
            lastError = e.getMessage() != null ? e.getMessage() : "Upload failed";
            return false;
        } finally {
            disconnectChannel(sftp);
        }
    }

    public boolean uploadFile(InputStream input, String remotePath) {
        if (!connected || input == null) return false;
        ChannelSftp sftp = null;
        try {
            sftp = (ChannelSftp) session.openChannel("sftp");
            sftp.connect(5000);
            sftp.put(input, remotePath);
            return true;
        } catch (Exception e) {
            Log.e(TAG, "upload stream error: " + e.getMessage(), e);
            lastError = e.getMessage() != null ? e.getMessage() : "Upload failed";
            return false;
        } finally {
            disconnectChannel(sftp);
        }
    }

    public boolean appendToFile(byte[] data, String remotePath) {
        if (!connected || data == null || data.length == 0) return false;
        ChannelSftp sftp = null;
        try {
            sftp = (ChannelSftp) session.openChannel("sftp");
            sftp.connect(5000);
            sftp.put(new ByteArrayInputStream(data), remotePath, ChannelSftp.APPEND);
            return true;
        } catch (Exception e) {
            Log.e(TAG, "appendToFile error: " + e.getMessage(), e);
            lastError = e.getMessage() != null ? e.getMessage() : "Append failed";
            return false;
        } finally {
            disconnectChannel(sftp);
        }
    }

    public byte[] downloadFile(String remotePath) {
        if (!connected) return null;
        ChannelSftp sftp = null;
        InputStream input = null;
        try {
            sftp = (ChannelSftp) session.openChannel("sftp");
            sftp.connect(5000);
            long size = sftp.lstat(remotePath).getSize();
            if (size > MAX_IN_MEMORY_FILE_BYTES) {
                lastError = "File exceeds the 8 MiB download limit";
                return null;
            }
            input = sftp.get(remotePath);
            ByteArrayOutputStream baos = new ByteArrayOutputStream();
            byte[] buf = new byte[65536];
            int len;
            long total = 0;
            while ((len = input.read(buf)) != -1) {
                total += len;
                if (total > MAX_IN_MEMORY_FILE_BYTES) {
                    lastError = "File exceeds the 8 MiB download limit";
                    return null;
                }
                baos.write(buf, 0, len);
            }
            return baos.toByteArray();
        } catch (Exception e) {
            Log.e(TAG, "downloadFile error: " + e.getMessage(), e);
            lastError = e.getMessage() != null ? e.getMessage() : "Download failed";
            return null;
        } finally {
            closeQuietly(input);
            disconnectChannel(sftp);
        }
    }

    public boolean copyFileTo(SshConnection destination, String sourcePath, String destinationPath) {
        if (!connected || destination == null || !destination.connected) return false;
        ChannelSftp sourceSftp = null;
        ChannelSftp destinationSftp = null;
        InputStream input = null;
        try {
            sourceSftp = (ChannelSftp) session.openChannel("sftp");
            destinationSftp = (ChannelSftp) destination.session.openChannel("sftp");
            sourceSftp.connect(5000);
            destinationSftp.connect(5000);
            input = sourceSftp.get(sourcePath);
            destinationSftp.put(input, destinationPath);
            return true;
        } catch (Exception e) {
            String message = e.getMessage() != null ? e.getMessage() : "Copy failed";
            lastError = message;
            destination.lastError = message;
            Log.e(TAG, "copyFileTo error: " + message, e);
            return false;
        } finally {
            closeQuietly(input);
            disconnectChannel(destinationSftp);
            disconnectChannel(sourceSftp);
        }
    }

    private void disconnectChannel(Channel channel) {
        if (channel != null && channel.isConnected()) {
            channel.disconnect();
        }
    }

    private void closeQuietly(Closeable closeable) {
        if (closeable == null) return;
        try {
            closeable.close();
        } catch (IOException ignored) {
        }
    }

    public PtyBridge getPtyBridge() {
        return ptyBridge;
    }
}
