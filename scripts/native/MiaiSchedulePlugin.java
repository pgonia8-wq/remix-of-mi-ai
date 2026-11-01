package com.miai.app;

import android.Manifest;
import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.os.Build;
import com.getcapacitor.*;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;

/** Native due-date triggers: opaque IDs only, never prompts, keys or provider calls. */
@CapacitorPlugin(name="MiaiSchedule", permissions={@Permission(alias="notifications", strings={Manifest.permission.POST_NOTIFICATIONS})})
public class MiaiSchedulePlugin extends Plugin {
  public static final String PREFS="miai_due_triggers";
  static PendingIntent pending(Context c, String id) {
    Intent i=new Intent(c, MiaiScheduleReceiver.class);
    i.setAction("com.miai.app.DUE");
    i.setData(android.net.Uri.parse("miai-internal://schedule/"+id));
    i.putExtra("id",id);
    return PendingIntent.getBroadcast(c,0,i,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
  }
  static void arm(Context c, String id, long due) {
    AlarmManager a=(AlarmManager)c.getSystemService(Context.ALARM_SERVICE);
    if(a!=null) a.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP,Math.max(due,System.currentTimeMillis()+1000),pending(c,id));
  }
  private boolean valid(String id) {return id!=null && id.matches("[a-fA-F0-9-]{36}");}
  @PluginMethod public void schedule(PluginCall call) {
    String id=call.getString("id"); Long due=call.getLong("dueAt");
    if(!valid(id)||due==null||due<=0) {call.reject("Programación inválida");return;}
    if(!getContext().getSharedPreferences(PREFS,Context.MODE_PRIVATE).edit().putLong(id,due).commit()) {call.reject("No se pudo guardar el disparador");return;}
    arm(getContext(),id,due); call.resolve();
  }
  @PluginMethod public void cancel(PluginCall call) {
    String id=call.getString("id");if(!valid(id)) {call.reject("Programación inválida");return;}
    AlarmManager a=(AlarmManager)getContext().getSystemService(Context.ALARM_SERVICE);
    if(a!=null) a.cancel(pending(getContext(),id));
    getContext().getSharedPreferences(PREFS,Context.MODE_PRIVATE).edit().remove(id).commit();
    NotificationManager n=(NotificationManager)getContext().getSystemService(Context.NOTIFICATION_SERVICE);
    if(n!=null)n.cancel(id,1);call.resolve();
  }
  @PluginMethod public void requestNotifications(PluginCall call) {
    if(Build.VERSION.SDK_INT>=33 && getPermissionState("notifications")!=PermissionState.GRANTED) {
      requestPermissionForAlias("notifications",call,"notificationsResult");return;
    }
    notificationsResult(call);
  }
  @com.getcapacitor.annotation.PermissionCallback private void notificationsResult(PluginCall call) {
    JSObject out=new JSObject();out.put("granted",Build.VERSION.SDK_INT<33||getPermissionState("notifications")==PermissionState.GRANTED);call.resolve(out);
  }
}