package com.servermonitor.app;

import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Base64;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;

public class PtyBridge extends Thread {
    private final InputStream inputStream;
    private final String connectionId;
    private volatile boolean running = true;
    private final List<PtyListener> listeners = new CopyOnWriteArrayList<>();
    private final List<String> suppressedEchoes = new ArrayList<>();
    private String pendingEcho = "";

    public interface PtyListener {
        void onData(String connectionId, String data);
    }

    public PtyBridge(InputStream inputStream, String connectionId) {
        this.inputStream = inputStream;
        this.connectionId = connectionId;
    }

    public void addListener(PtyListener listener) {
        listeners.add(listener);
    }

    public void removeListener(PtyListener listener) {
        listeners.remove(listener);
    }

    /**
     * The remote shell may restore terminal echo while reading profile files.
     * Hide only the exact setup commands sent by the app, preserving MOTD and
     * every other byte from the interactive session.
     */
    public synchronized void suppressEcho(String command) {
        suppressedEchoes.add(command);
        suppressedEchoes.add(command.replace("\n", "\r\n"));
    }

    private synchronized byte[] filterSetupEcho(byte[] bytes) {
        if (suppressedEchoes.isEmpty()) return bytes;

        String data = pendingEcho + new String(bytes, StandardCharsets.ISO_8859_1);
        boolean removed;
        do {
            removed = false;
            for (int i = 0; i < suppressedEchoes.size(); i++) {
                String command = suppressedEchoes.get(i);
                int position = data.indexOf(command);
                if (position == -1) continue;
                data = data.substring(0, position) + data.substring(position + command.length());
                suppressedEchoes.remove(i);
                String alternate = command.contains("\r\n")
                    ? command.replace("\r\n", "\n")
                    : command.replace("\n", "\r\n");
                suppressedEchoes.remove(alternate);
                removed = true;
                break;
            }
        } while (removed);

        int keep = 0;
        for (String command : suppressedEchoes) {
            int max = Math.min(data.length(), command.length() - 1);
            for (int length = max; length > keep; length--) {
                if (data.regionMatches(data.length() - length, command, 0, length)) {
                    keep = length;
                    break;
                }
            }
        }

        pendingEcho = keep == 0 ? "" : data.substring(data.length() - keep);
        String visible = keep == 0 ? data : data.substring(0, data.length() - keep);
        return visible.getBytes(StandardCharsets.ISO_8859_1);
    }

    @Override
    public void run() {
        byte[] buf = new byte[8192];
        try {
            while (running) {
                int len = inputStream.read(buf);
                if (len == -1) break;
                if (len > 0) {
                    byte[] visible = filterSetupEcho(Arrays.copyOf(buf, len));
                    if (visible.length == 0) continue;
                    String data = Base64.getEncoder().encodeToString(visible);
                    for (PtyListener listener : listeners) {
                        listener.onData(connectionId, data);
                    }
                }
            }
        } catch (Exception e) {
            if (running) {
                e.printStackTrace();
            }
        }
    }

    public void stopReading() {
        running = false;
        try {
            inputStream.close();
        } catch (Exception ignored) {}
    }
}
