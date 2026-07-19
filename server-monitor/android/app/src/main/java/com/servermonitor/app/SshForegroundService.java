package com.servermonitor.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;

public class SshForegroundService extends Service {
    private static final int NOTIFICATION_ID = 1001;
    private static final String CHANNEL_ID = "ssh_session";
    private static volatile boolean running = false;
    private int activeSessionCount;

    @Override
    public void onCreate() {
        super.onCreate();
        createChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        int count = intent != null ? intent.getIntExtra("count", activeSessionCount) : activeSessionCount;
        if (count <= 0) {
            running = false;
            stopForeground(true);
            stopSelf(startId);
            return START_NOT_STICKY;
        }
        activeSessionCount = count;
        Notification notification = buildNotification(count);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
        running = true;
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        running = false;
        super.onDestroy();
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        // Keep the foreground service while users switch tasks. SSH sessions
        // remain owned by the app process and need the service priority.
        super.onTaskRemoved(rootIntent);
    }

    // Android 15 calls this when the system reaches the foreground-service timeout.
    public void onTimeout(int startId, int fgsType) {
        running = false;
        stopForeground(true);
        stopSelf(startId);
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    public static void update(Context context, int count) {
        if (count <= 0) {
            stop(context);
            return;
        }
        Intent intent = new Intent(context, SshForegroundService.class);
        intent.putExtra("count", count);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(intent);
        } else {
            context.startService(intent);
        }
    }

    public static void stop(Context context) {
        context.stopService(new Intent(context, SshForegroundService.class));
    }

    public static boolean isRunning() {
        return running;
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "SSH Session",
                NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("Keeps SSH connections alive");
            channel.setShowBadge(false);
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) nm.createNotificationChannel(channel);
        }
    }

    private Notification buildNotification(int count) {
        Intent intent = new Intent(this, MainActivity.class);
        PendingIntent pi = PendingIntent.getActivity(
            this, 0, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0)
        );

        String title = "Server Monitor";
        String text = count > 0
            ? "SSH sessions: " + count + " active"
            : "SSH connection active";

        return new Notification.Builder(this, CHANNEL_ID)
            .setContentTitle(title)
            .setContentText(text)
            .setSmallIcon(android.R.drawable.ic_menu_info_details)
            .setContentIntent(pi)
            .setOngoing(true)
            .setPriority(Notification.PRIORITY_LOW)
            .build();
    }
}
