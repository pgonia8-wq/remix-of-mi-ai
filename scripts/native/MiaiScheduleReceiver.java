package com.miai.app;

import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.os.Build;

/** Survives process death/reboot; prompts the user without silently starting billed actions. */
public class MiaiScheduleReceiver extends BroadcastReceiver {
  @Override public void onReceive(Context c, Intent i) {
    android.content.SharedPreferences prefs=c.getSharedPreferences(MiaiSchedulePlugin.PREFS,Context.MODE_PRIVATE);
    if(Intent.ACTION_BOOT_COMPLETED.equals(i.getAction())||Intent.ACTION_MY_PACKAGE_REPLACED.equals(i.getAction())) {
      for(java.util.Map.Entry<String,?> e:prefs.getAll().entrySet()) if(e.getValue() instanceof Long) MiaiSchedulePlugin.arm(c,e.getKey(),(Long)e.getValue());return;
    }
    String id=i.getStringExtra("id");
    if(id==null||!prefs.contains(id))return;
    long due=prefs.getLong(id,Long.MAX_VALUE);
    if(due>System.currentTimeMillis()) {MiaiSchedulePlugin.arm(c,id,due);return;}
    if(Build.VERSION.SDK_INT>=33 && c.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED)return;
    NotificationManager n=(NotificationManager)c.getSystemService(Context.NOTIFICATION_SERVICE);if(n==null)return;
    n.createNotificationChannel(new NotificationChannel("miai_schedules","Programaciones MI AI",NotificationManager.IMPORTANCE_DEFAULT));
    Intent open=new Intent(c,MainActivity.class);open.setAction(Intent.ACTION_VIEW);open.setData(android.net.Uri.parse("miai://automation/"+id));open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TOP);
    PendingIntent p=PendingIntent.getActivity(c,0,open,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
    n.notify(id,1,new Notification.Builder(c,"miai_schedules").setSmallIcon(c.getApplicationInfo().icon).setContentTitle("MI AI · Programación pendiente").setContentText("Abre la aplicación para revisar y autorizar la ejecución.").setContentIntent(p).setAutoCancel(true).build());
  }
}