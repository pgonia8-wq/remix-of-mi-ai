// Browser-safe validated FFmpeg plan. Executed only by the paired PC, never by the WebView.
export function videoArgs(plan, inputs, output) {
  const {clips,overlays=[],width=1280,height=720}=plan;
  if(!Array.isArray(clips)||!clips.length||clips.length>8||overlays.length>4||![720,1280].includes(width)||![720,1280].includes(height))throw Error('Plan de video inválido');
  if(![0,90,180,270].includes(plan.rotation??0))throw Error('Rotación inválida');
  const args=['-hide_banner','-nostdin','-y'], filters=[];let duration=0,prev='v0';
  const finite=(x,min,max)=>Number.isFinite(x)&&x>=min&&x<=max;
  clips.forEach((c,i)=>{
    if(!finite(c.start,0,600)||!finite(c.end,c.start+0.01,600)||!['cut','fade','wipeleft','slideright','circleopen'].includes(c.transition)||!finite(c.transitionSeconds,0,3))throw Error('Clip inválido');
    args.push('-i',inputs[i]);const len=c.end-c.start;
    filters.push(`[${i}:v]trim=start=${c.start}:end=${c.end},setpts=PTS-STARTPTS,${plan.rotation===90?'transpose=1,':plan.rotation===270?'transpose=2,':plan.rotation===180?'hflip,vflip,':''}scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p[v${i}]`);
    if(i===0){duration=len;return;}
    const d=c.transition==='cut'?0:c.transitionSeconds;
    if(d>=len/2 || d>= (clips[i-1].end-clips[i-1].start)/2)throw Error('Transición demasiado larga');
    const label=`join${i}`;
    if(d>0)filters.push(`[${prev}][v${i}]xfade=transition=${c.transition}:duration=${d}:offset=${duration-d}[${label}]`);
    else filters.push(`[${prev}][v${i}]concat=n=2:v=1:a=0[${label}]`);
    duration+=len-d;prev=label;
  });
  overlays.forEach((o,i)=>{
    if(!finite(o.offset,0,duration)||!finite(o.length,0.01,duration-o.offset)||!finite(o.scale,0.1,1)||!finite(o.x,0,1)||!finite(o.y,0,1)||!finite(o.endX,0,1)||!finite(o.endY,0,1))throw Error('Capa inválida');
    const index=clips.length+i,label=`layer${i}`;args.push('-i',inputs[index]);
    filters.push(`[${index}:v]trim=duration=${o.length},setpts=PTS-STARTPTS+${o.offset}/TB,scale=${Math.round(width*o.scale/2)*2}:-2[ov${i}]`);
    const interp=`min(1,max(0,(t-${o.offset})/${o.length}))`;
    filters.push(`[${prev}][ov${i}]overlay=x='(W-w)*(${o.x}+(${o.endX-o.x})*${interp})':y='(H-h)*(${o.y}+(${o.endY-o.y})*${interp})':enable='between(t,${o.offset},${o.offset+o.length})':eof_action=pass[${label}]`);prev=label;
  });
  if(plan.captionFiles?.length){for(let i=0;i<plan.captionFiles.length;i++){const c=plan.captionFiles[i];if(!finite(c.start,0,duration)||!finite(c.end,c.start+0.01,duration)||!/^caption-\d+\.txt$/.test(c.file))throw Error('Subtítulo inválido');const label=`caption${i}`;filters.push(`[${prev}]drawtext=textfile=${c.file}:fontcolor=white:fontsize=32:box=1:boxcolor=black@0.6:x=(w-text_w)/2:y=h-text_h-40:enable='between(t,${c.start},${c.end})'[${label}]`);prev=label;}}
  // Audio inputs are pre-mixed to WAV in the phone; no codec guesses or accidental original audio duplication.
  if(plan.audio){args.push('-i',inputs[inputs.length-1]);}
  args.push('-filter_complex_threads','1','-filter_complex',filters.join(';'),'-map',`[${prev}]`);
  let audioPrev='a0';
  if(plan.originalAudio&&!plan.mute){clips.forEach((c,i)=>{if(plan.hasAudio?.[i])filters.push(`[${i}:a]atrim=start=${c.start}:end=${c.end},asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo[a${i}]`);else filters.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${c.end-c.start},asetpts=PTS-STARTPTS[a${i}]`);if(i>0){const label=`audio${i}`,d=c.transition==='cut'?0:c.transitionSeconds;if(d>0)filters.push(`[${audioPrev}][a${i}]acrossfade=d=${d}[${label}]`);else filters.push(`[${audioPrev}][a${i}]concat=n=2:v=0:a=1[${label}]`);audioPrev=label;}});if(plan.audio){filters.push(`[${audioPrev}][${clips.length+overlays.length}:a]amix=inputs=2:duration=first:normalize=0[amixed]`);audioPrev='amixed';}}
  // Reassign filters after constructing audio chains.
  args[args.indexOf('-filter_complex')+1]=filters.join(';');
  if(plan.originalAudio&&!plan.mute)args.push('-map',`[${audioPrev}]`,'-c:a','aac');else if(plan.audio)args.push('-map',`${clips.length+overlays.length}:a`,'-c:a','aac');else args.push('-an');
  args.push('-t',String(duration),'-c:v','libx264','-preset','veryfast','-pix_fmt','yuv420p','-movflags','+faststart',output);
  return {args,duration};
}
