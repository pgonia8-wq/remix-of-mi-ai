package com.miai.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

/**
 * Keeps the app process alive while autonomous agents work with the screen off or the app in the background.
 * Started only by the app while a run is being driven, shows an ongoing notification, never restarts by itself
 * and never calls providers on its own: all work keeps happening inside the app's normal gated executor.
 */
public class MiaiWorkService extends Service {
  static final String CH = "miai_agents";
  static final int ID = 7201;
  private PowerManager.WakeLock wake;

  @Override public IBinder onBind(Intent i) { return null; }

  @Override public int onStartCommand(Intent i, int flags, int startId) {
    if (i == null) { stopSelf(); return START_NOT_STICKY; }
    String title = i.getStringExtra("title"); String text = i.getStringExtra("text");
    Notification n = build(title == null ? "Agentes de MI AI trabajando" : title, text == null ? "Toca para ver el avance" : text);
    if (Build.VERSION.SDK_INT >= 34) startForeground(ID, n, android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE); else startForeground(ID, n);
    if (wake == null) {
      PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
      wake = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "miai:agents");
      wake.setReferenceCounted(false);
    }
    wake.acquire(4L * 60 * 60 * 1000); // bounded: released on stop or after 4 h at most
    return START_NOT_STICKY;
  }

  private Notification build(String title, String text) {
    if (Build.VERSION.SDK_INT >= 26) ((NotificationManager) getSystemService(NOTIFICATION_SERVICE)).createNotificationChannel(new NotificationChannel(CH, "Agentes trabajando", NotificationManager.IMPORTANCE_LOW));
    Intent open = getPackageManager().getLaunchIntentForPackage(getPackageName());
    PendingIntent pi = open == null ? null : PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CH) : new Notification.Builder(this);
    b.setContentTitle(title).setContentText(text).setSmallIcon(android.R.drawable.stat_notify_sync).setOngoing(true).setOnlyAlertOnce(true);
    if (pi != null) b.setContentIntent(pi);
    return b.build();
  }

  @Override public void onDestroy() {
    if (wake != null && wake.isHeld()) wake.release();
    wake = null;
    stopForeground(true);
    super.onDestroy();
  }
}
