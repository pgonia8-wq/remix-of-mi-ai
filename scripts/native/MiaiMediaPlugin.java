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
    File root=new File(getContext().getCacheDir(),"miai-media");
    if(root.exists()) delete(root);
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
          byte[] bytes=Base64.decode(clip.getString("data"),Base64.DEFAULT);
          if(bytes.length>50*1024*1024)throw new IOException();
          File input=new File(work,"input-"+n+".mp4");try(FileOutputStream out=new FileOutputStream(input)) {out.write(bytes);}Arrays.fill(bytes,(byte)0);
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
        String audio=call.getString("audio",null);
        if(audio!=null&&!audio.isEmpty()) {
          // Background track (already mixed and trimmed on-device as WAV) as a second, audio-only sequence.
          byte[] ab=Base64.decode(audio,Base64.DEFAULT);
          if(ab.length>80*1024*1024)throw new IOException();
          File af=new File(work,"background.wav");try(FileOutputStream out=new FileOutputStream(af)) {out.write(ab);}Arrays.fill(ab,(byte)0);
          EditedMediaItem audioItem=new EditedMediaItem.Builder(new MediaItem.Builder().setUri(Uri.fromFile(af)).build()).setRemoveVideo(true).build();
          cb=new Composition.Builder(videoSeq,new EditedMediaItemSequence.Builder(Collections.singletonList(audioItem)).build());
        } else cb=new Composition.Builder(videoSeq);
        Composition composition=cb.setEffects(new Effects(Collections.emptyList(),effects)).build();
        File output=new File(work,"output.mp4");
        transformer=new Transformer.Builder(getContext()).setVideoMimeType(MimeTypes.VIDEO_H264).setAudioMimeType(MimeTypes.AUDIO_AAC).addListener(new Transformer.Listener() {
          @Override public void onCompleted(Composition c,ExportResult r) {
            new Thread(() -> {
              try {
                if(output.length()>100*1024*1024)throw new IOException();
                byte[] bytes=java.nio.file.Files.readAllBytes(output.toPath());JSObject result=new JSObject();result.put("data",Base64.encodeToString(bytes,Base64.NO_WRAP));Arrays.fill(bytes,(byte)0);call.resolve(result);
              }catch(Exception e){call.reject("No se pudo recuperar el video exportado");}
              finally {delete(work);pending=null;transformer=null;}
            }).start();
          }
          @Override public void onError(Composition c,ExportResult r,ExportException e) {delete(work);pending=null;transformer=null;call.reject("Android no pudo procesar estos clips. Revisa formato, duración y espacio libre.");}
        }).build();
        transformer.start(composition,output.getAbsolutePath());
      } catch(Exception e) {if(work!=null)delete(work);pending=null;transformer=null;call.reject("No se pudo preparar la exportación local");}
    });
  }
  @PluginMethod public void cancel(PluginCall call) {
    getActivity().runOnUiThread(() -> {if(transformer!=null)transformer.cancel();if(pending!=null)pending.reject("Exportación cancelada");pending=null;transformer=null;if(work!=null)delete(work);call.resolve();});
  }
}