package com.miai.app;

import android.net.Uri;
import android.graphics.Color;
import android.text.SpannableString;
import android.text.Spanned;
import android.text.style.ForegroundColorSpan;
import android.text.style.AbsoluteSizeSpan;
import android.util.Base64;
import com.getcapacitor.*;
import com.getcapacitor.annotation.CapacitorPlugin;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MimeTypes;
import androidx.media3.common.Effect;
import androidx.media3.effect.*;
import androidx.media3.transformer.*;
import java.io.*;
import java.util.*;

/** Private transient cache only; encrypted originals/output registration remain owned by AssetStore. */
@CapacitorPlugin(name="MiaiMedia")
public class MiaiMediaPlugin extends Plugin {
  private Transformer transformer;
  private PluginCall pending;
  private File work;
  @Override public void load() { cleanAll(); }
  private void cleanAll() {
    for(String d:new String[]{"miai-media","miai-media-out"}){File root=new File(getContext().getCacheDir(),d);if(root.exists()) delete(root);}
  }
  /** Only files the app staged under cache/miai-stage are accepted as inputs. */
  private File stagedFile(String rel) throws IOException {
    File root=new File(getContext().getCacheDir(),"miai-stage").getCanonicalFile();
    File f=new File(getContext().getCacheDir(),rel==null?"":rel).getCanonicalFile();
    if(!f.getPath().startsWith(root.getPath()+File.separator)||!f.isFile())throw new IOException("ruta");
    if(f.length()>2048L*1024*1024)throw new IOException("grande");
    return f;
  }
  private void deleteStaged(PluginCall call) {
    try{JSArray clips=call.getArray("clips",new JSArray());for(int n=0;n<clips.length();n++)try{stagedFile(clips.getJSONObject(n).getString("path")).delete();}catch(Exception ignored){}
      String a=call.getString("audioPath",null);if(a!=null)try{stagedFile(a).delete();}catch(Exception ignored){}}catch(Exception ignored){}
  }
  private void delete(File f) {if(f.isDirectory()) {File[] children=f.listFiles();if(children!=null)for(File c:children)delete(c);}f.delete();}
  @PluginMethod public void editVideo(PluginCall call) {
    if(pending!=null) {call.reject("Ya hay una exportación activa");return;}
    JSArray clips=call.getArray("clips");
    if(clips==null||clips.length()==0||clips.length()>8) {call.reject("Elige de uno a ocho clips");return;}
    pending=call;
    getActivity().runOnUiThread(() -> {
      try {
        work=new File(getContext().getCacheDir(),"miai-media/"+UUID.randomUUID());if(!work.mkdirs())throw new IOException();
        List<EditedMediaItem> items=new ArrayList<>();
        for(int n=0;n<clips.length();n++) {
          org.json.JSONObject clip=clips.getJSONObject(n);
          // Clips arrive as private cache files written in small pieces by the app (no whole-video base64 in memory).
          File input=stagedFile(clip.getString("path"));
          long start=clip.optLong("startMs",0),end=clip.optLong("endMs",0);
          if(start<0||end<=start)throw new IOException();
          MediaItem media=new MediaItem.Builder().setUri(Uri.fromFile(input)).setClippingConfiguration(new MediaItem.ClippingConfiguration.Builder().setStartPositionMs(start).setEndPositionMs(end).build()).build();
          items.add(new EditedMediaItem.Builder(media).setRemoveAudio(call.getBoolean("mute",false)).build());
        }
        List<Effect> effects=new ArrayList<>();
        int rotation=call.getInt("rotation",0);
        if(rotation!=0)effects.add(new ScaleAndRotateTransformation.Builder().setRotationDegrees(rotation).build());
        String ratio=call.getString("ratio","original");
        if(ratio.equals("16:9"))effects.add(Presentation.createForAspectRatio(16f/9f,Presentation.LAYOUT_SCALE_TO_FIT));
        if(ratio.equals("9:16"))effects.add(Presentation.createForAspectRatio(9f/16f,Presentation.LAYOUT_SCALE_TO_FIT));
        effects.add(Presentation.createForHeight(720));
        JSArray captions=call.getArray("captions",new JSArray());
        if(captions.length()>0) {
          OverlaySettings position=new OverlaySettings.Builder().setBackgroundFrameAnchor(0,-0.8f).build();
          TextOverlay overlay=new TextOverlay() {
            @Override public SpannableString getText(long timeUs) {
              String text="";
              for(int n=0;n<captions.length();n++)try {org.json.JSONObject c=captions.getJSONObject(n);if(timeUs>=c.getDouble("start")*1000000 && timeUs<c.getDouble("end")*1000000)text=c.getString("text");}catch(Exception ignored){}
              SpannableString span=new SpannableString(text);
              span.setSpan(new ForegroundColorSpan(Color.WHITE),0,span.length(),Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);span.setSpan(new AbsoluteSizeSpan(36),0,span.length(),Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);return span;
            }
            @Override public OverlaySettings getOverlaySettings(long timeUs) {return position;}
          };
          effects.add(new OverlayEffect(Collections.singletonList(overlay)));
        }
        EditedMediaItemSequence videoSeq=new EditedMediaItemSequence.Builder(items).build();
        Composition.Builder cb;
        String audio=call.getString("audioPath",null);
        if(audio!=null&&!audio.isEmpty()) {
          // Background track (already mixed and trimmed on-device as WAV) as a second, audio-only sequence.
          File af=stagedFile(audio);
          EditedMediaItem audioItem=new EditedMediaItem.Builder(new MediaItem.Builder().setUri(Uri.fromFile(af)).build()).setRemoveVideo(true).build();
          cb=new Composition.Builder(videoSeq,new EditedMediaItemSequence.Builder(Collections.singletonList(audioItem)).build());
        } else cb=new Composition.Builder(videoSeq);
        Composition composition=cb.setEffects(new Effects(Collections.emptyList(),effects)).build();
        File outDir=new File(getContext().getCacheDir(),"miai-media-out");outDir.mkdirs();
        File output=new File(outDir,UUID.randomUUID()+".mp4");
        transformer=new Transformer.Builder(getContext()).setVideoMimeType(MimeTypes.VIDEO_H264).setAudioMimeType(MimeTypes.AUDIO_AAC).addListener(new Transformer.Listener() {
          @Override public void onCompleted(Composition c,ExportResult r) {
            new Thread(() -> {
              try {
                if(!output.isFile()||output.length()==0)throw new IOException();
                // The app reads this file in pieces, encrypts it into the library and deletes it.
                JSObject result=new JSObject();result.put("path","miai-media-out/"+output.getName());result.put("size",output.length());call.resolve(result);
              }catch(Exception e){output.delete();call.reject("No se pudo recuperar el video exportado");}
              finally {deleteStaged(call);delete(work);pending=null;transformer=null;}
            }).start();
          }
          @Override public void onError(Composition c,ExportResult r,ExportException e) {output.delete();deleteStaged(call);delete(work);pending=null;transformer=null;call.reject("Android no pudo procesar estos clips. Revisa formato, duración y espacio libre.");}
        }).build();
        transformer.start(composition,output.getAbsolutePath());
      } catch(Exception e) {deleteStaged(call);if(work!=null)delete(work);pending=null;transformer=null;call.reject("No se pudo preparar la exportación local");}
    });
  }
  @PluginMethod public void cancel(PluginCall call) {
    getActivity().runOnUiThread(() -> {if(transformer!=null)transformer.cancel();if(pending!=null)pending.reject("Exportación cancelada");pending=null;transformer=null;if(work!=null)delete(work);call.resolve();});
  }
}