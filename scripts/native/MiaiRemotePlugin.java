package com.miai.app;

import android.app.AlertDialog;
import android.content.Intent;
import android.util.Base64;
import com.getcapacitor.*;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.jcraft.jsch.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.*;

/** Remote Linux only. No local shell, no saved passwords, strict user-provided trusted host keys. */
@CapacitorPlugin(name="MiaiRemote")
public class MiaiRemotePlugin extends Plugin {
  private final ExecutorService executor = Executors.newSingleThreadExecutor();
  private static final int CAP = 1024 * 1024;
  private static final long APPROVAL_TIMEOUT_MS = 5 * 60 * 1000L;
  private void approve(PluginCall call, String operation, Runnable task) {
    getActivity().runOnUiThread(() -> { AlertDialog dialog = new AlertDialog.Builder(getActivity())
      .setTitle("Autorizar operación remota")
      .setMessage(call.getString("user", "") + "@" + call.getString("host", "") + " · " + (call.getString("privateKey", "").isEmpty() ? "contraseña" : "clave privada") + "\n" + operation + "\n\nClave de host confiada:\n" + call.getString("knownHosts", "") + "\n\nUna operación remota puede modificar o borrar datos. Verifica la clave del servidor por una vía independiente.")
      .setNegativeButton("Cancelar", (d,w) -> call.reject("Operación cancelada"))
      .setPositiveButton("Autorizar", (d,w) -> executor.execute(task))
      .setOnCancelListener(d -> call.reject("Operación cancelada")).create();
      dialog.show();
      // A confirmation nobody answers must not hang the agent for hours.
      new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(() -> { if (dialog.isShowing()) { dialog.dismiss(); call.reject("No confirmaste la operación en el teléfono (se canceló a los 5 minutos)."); } }, APPROVAL_TIMEOUT_MS);
    });
  }
  private Session session(PluginCall call) throws Exception { return MiaiSsh.open(call, false); }
  @PluginMethod public void exec(PluginCall call) {
    String command=call.getString("command", "");
    if(command.length()==0 || command.length()>8000 || command.indexOf('\0')>=0) { call.reject("Comando no válido"); return; }
    approve(call, command, () -> {
      Session s=null; ChannelExec c=null;
      try {
        s=session(call); c=(ChannelExec)s.openChannel("exec"); c.setCommand(command); c.setInputStream(null);
        InputStream out=c.getInputStream(), err=c.getErrStream(); c.connect(15000);
        ByteArrayOutputStream data=new ByteArrayOutputStream(); byte[] buf=new byte[4096]; long deadline=System.currentTimeMillis()+30000;
        while(true) {
          for(InputStream in: new InputStream[]{out,err}) while(in.available()>0) {
            int n=in.read(buf,0,Math.min(buf.length,in.available())); if(n<0) break;
            if(data.size()+n>CAP) throw new IOException("Output cap"); data.write(buf,0,n);
          }
          if(c.isClosed() && out.available()==0 && err.available()==0) break;
          if(System.currentTimeMillis()>deadline) throw new IOException("Timeout");
          Thread.sleep(20);
        }
        JSObject result=new JSObject(); result.put("output",data.toString("UTF-8")); result.put("exitCode",c.getExitStatus()); call.resolve(result);
      } catch(Exception e) { call.reject(MiaiSsh.explain(e, "SSH no confirmó el resultado; no repitas acciones sin revisar el servidor.")); }
      finally { if(c!=null)c.disconnect(); if(s!=null)s.disconnect(); }
    });
  }
  @PluginMethod public void sftp(PluginCall call) {
    String path=call.getString("path", "."), action=call.getString("action", "list");
    if(path.length()>1000 || path.indexOf('\0')>=0 || !(action.equals("list")||action.equals("read")||action.equals("write"))) { call.reject("Operación SFTP no válida"); return; }
    String encoded=call.getString("data", "");
    if(encoded.length()>CAP*2) {call.reject("Archivo demasiado grande (1 MB)"); return;}
    approve(call, "SFTP "+action+" "+path, () -> {
      Session s=null; ChannelSftp c=null;
      try {
        s=session(call); c=(ChannelSftp)s.openChannel("sftp"); c.connect(15000); JSObject result=new JSObject();
        if(action.equals("list")) {
          StringBuilder list=new StringBuilder();
          c.ls(path, entry -> {
            if(list.length()>64000) return ChannelSftp.LsEntrySelector.BREAK;
            list.append(entry.getAttrs().isDir()?"[dir] ":"[file] ").append(entry.getFilename()).append("\n");
            return ChannelSftp.LsEntrySelector.CONTINUE;
          });
          result.put("output",list.toString());
        } else if(action.equals("read")) {
          ByteArrayOutputStream bytes=new ByteArrayOutputStream();
          try(InputStream in=c.get(path)) { byte[] b=new byte[4096]; int n; while((n=in.read(b))!=-1) { if(bytes.size()+n>CAP)throw new IOException("Read cap"); bytes.write(b,0,n); } }
          result.put("data",Base64.encodeToString(bytes.toByteArray(),Base64.NO_WRAP)); result.put("output","Archivo recibido: "+bytes.size()+" bytes");
        } else {
          byte[] bytes=Base64.decode(encoded,Base64.DEFAULT); if(bytes.length>CAP)throw new IOException("Write cap");
          String temp=path+".miai-"+java.util.UUID.randomUUID()+".tmp";
          c.put(new ByteArrayInputStream(bytes),temp); c.rename(temp,path); result.put("output","Archivo transferido"); java.util.Arrays.fill(bytes,(byte)0);
        }
        call.resolve(result);
      } catch(Exception e) {call.reject(MiaiSsh.explain(e, "SFTP no confirmó el resultado."));}
      finally { if(c!=null)c.disconnect(); if(s!=null)s.disconnect(); }
    });
  }
  @PluginMethod public void openTermux(PluginCall call) {
    getActivity().runOnUiThread(() -> {
      try { Intent i=getContext().getPackageManager().getLaunchIntentForPackage("com.termux"); if(i==null) {call.reject("Termux no está instalado"); return;} getActivity().startActivity(i); call.resolve(); }
      catch(Exception e){call.reject("No se pudo abrir Termux");}
    });
  }
}