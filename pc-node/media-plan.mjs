// Browser-safe validated FFmpeg plan. Executed only by the paired PC, never by the WebView.
export function videoArgs(plan, inputs, output) {
  const {clips,overlays=[],width=1280,height=720}=plan;
  if(!Array.isArray(clips)||!clips.length||clips.length>8||overlays.length>4||![720,1280].includes(width)||![720,1280].includes(height))throw Error('Plan de video inválido');
  const args=['-hide_banner','-nostdin','-y'], filters=[];let duration=0,prev='v0';
  const finite=(x,min,max)=>Number.isFinite(x)&&x>=min&&x<=max;
  clips.forEach((c,i)=>{
    if(!finite(c.start,0,600)||!finite(c.end,c.start+0.01,600)||!['cut','fade','wipeleft','slideright','circleopen'].includes(c.transition)||!finite(c.transitionSeconds,0,3))throw Error('Clip inválido');
    args.push('-i',inputs[i]);const len=c.end-c.start;
    filters.push(`[${i}:v]trim=start=${c.start}:end=${c.end},setpts=PTS-STARTPTS,scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p[v${i}]`);
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
  // Audio inputs are pre-mixed to WAV in the phone; no codec guesses or accidental original audio duplication.
  if(plan.audio){args.push('-i',inputs[inputs.length-1]);}
  args.push('-filter_complex_threads','1','-filter_complex',filters.join(';'),'-map',`[${prev}]`);
  if(plan.audio)args.push('-map',`${clips.length+overlays.length}:a`,'-c:a','aac');else args.push('-an');
  args.push('-t',String(duration),'-c:v','libx264','-preset','veryfast','-pix_fmt','yuv420p','-movflags','+faststart',output);
  return {args,duration};
}
