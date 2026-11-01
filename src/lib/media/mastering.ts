import type { PcmAudio } from '../audio-edit';
export type EqBand = { frequency: number; gain: number; q: number };
export type Dynamics = { threshold: number; ratio: number; attack: number; release: number };
export type MasterSettings = { eq: EqBand[]; bands: Dynamics[]; crossover: [number, number]; gainDb: number; ceilingDb: number; lookaheadMs: number };
export const DEFAULT_MASTER: MasterSettings = { eq: [{frequency:100,gain:0,q:0.7},{frequency:1000,gain:0,q:1},{frequency:8000,gain:0,q:0.7}], bands: [0,1,2].map(() => ({threshold:-18,ratio:2,attack:0.02,release:0.2})), crossover:[200,3000], gainDb:0,ceilingDb:-1,lookaheadMs:5 };
export function validateMaster(s: MasterSettings, rate: number) {
  if (s.eq.length > 8 || s.bands.length !== 3 || ![s.gainDb,s.ceilingDb,s.lookaheadMs,...s.crossover].every(Number.isFinite) || s.gainDb < -24 || s.gainDb > 24 || s.ceilingDb > 0 || s.ceilingDb < -12 || s.lookaheadMs < 1 || s.lookaheadMs > 20 || s.crossover[0] < 40 || s.crossover[1] <= s.crossover[0] || s.crossover[1] >= rate/2) throw new Error('Parámetros de masterización inválidos.');
  for (const e of s.eq) if (![e.frequency,e.gain,e.q].every(Number.isFinite) || e.frequency < 20 || e.frequency >= rate/2 || Math.abs(e.gain)>18 || e.q<0.1 || e.q>12) throw new Error('EQ fuera de rango.');
  for (const d of s.bands) if (![d.threshold,d.ratio,d.attack,d.release].every(Number.isFinite) || d.threshold < -60 || d.threshold > 0 || d.ratio < 1 || d.ratio > 20 || d.attack<0.001 || d.attack>1 || d.release<0.01 || d.release>2) throw new Error('Compresor fuera de rango.');
}
/** Linked stereo look-ahead sample-peak limiter; not a certified intersample/true-peak limiter. */
export function limitPcm(a:PcmAudio, ceilingDb:number, lookaheadMs:number):PcmAudio {
  const len=a.channels[0]?.length??0;
  if(!len || !Number.isFinite(ceilingDb) || ceilingDb>0 || ceilingDb< -12 || !Number.isFinite(lookaheadMs) || lookaheadMs<1 || lookaheadMs>20) throw new Error('Limitador inválido.');
  const ceiling=10**(ceilingDb/20),ahead=Math.ceil(a.sampleRate*lookaheadMs/1000), peaks=new Float32Array(len);
  for(let i=0;i<len;i++) for(const ch of a.channels) peaks[i]=Math.max(peaks[i]??0,Math.abs(ch[i]??0));
  const queue:number[]=[], maxima=new Float32Array(len); let head=0, next=0;
  for(let i=0;i<len;i++){while(next<len && next<=i+ahead){while(queue.length>head && (peaks[queue[queue.length-1]??0]??0)<=(peaks[next]??0))queue.pop();queue.push(next++);}while(head<queue.length && (queue[head]??0)<i)head++;maxima[i]=peaks[queue[head]??i]??0;}
  let gain=1; const release=Math.exp(-1/(0.08*a.sampleRate)), gains=new Float32Array(len);
  for(let i=0;i<len;i++){const wanted=Math.min(1,ceiling/Math.max(ceiling,maxima[i]??0));gain=wanted<gain?wanted:wanted+(gain-wanted)*release;gains[i]=gain;}
  return {sampleRate:a.sampleRate,channels:a.channels.map(ch=>Float32Array.from(ch,(v,i)=>Math.max(-ceiling,Math.min(ceiling,v*(gains[i]??1)))))};
}
export function audioMeter(a:PcmAudio){let peak=0,sum=0,n=0;for(const ch of a.channels)for(const x of ch){peak=Math.max(peak,Math.abs(x));sum+=x*x;n++;}return {samplePeakDb:peak?20*Math.log10(peak):-120,rmsDb:sum?10*Math.log10(sum/Math.max(1,n)):-120};}
/** Proven browser Web Audio biquads/compressors; offline render, no network. Three parallel bands. */
export async function masterPcm(a:PcmAudio,s:MasterSettings):Promise<PcmAudio>{
  validateMaster(s,a.sampleRate); const length=a.channels[0]?.length??0;
  if(!length || length>a.sampleRate*600 || a.channels.length>2)throw new Error('Audio no compatible.');
  const ctx=new OfflineAudioContext(a.channels.length,length,a.sampleRate), buffer=ctx.createBuffer(a.channels.length,length,a.sampleRate);
  a.channels.forEach((ch,i)=>buffer.copyToChannel(ch.slice() as Float32Array<ArrayBuffer>,i));const source=ctx.createBufferSource();source.buffer=buffer;
  let tail:AudioNode=source;
  for(const e of s.eq){const f=ctx.createBiquadFilter();f.type='peaking';f.frequency.value=e.frequency;f.gain.value=e.gain;f.Q.value=e.q;tail.connect(f);tail=f;}
  const out=ctx.createGain();out.gain.value=10**(s.gainDb/20);out.connect(ctx.destination);
  for(let i=0;i<3;i++){let node=tail;const add=(type:BiquadFilterType,freq:number)=>{const f=ctx.createBiquadFilter();f.type=type;f.frequency.value=freq;f.Q.value=Math.SQRT1_2;node.connect(f);node=f;};if(i>0)add('highpass',s.crossover[i===1?0:1]);if(i<2)add('lowpass',s.crossover[i===0?0:1]);const d=s.bands[i];if(!d)continue;const compressor=ctx.createDynamicsCompressor();compressor.threshold.value=d.threshold;compressor.ratio.value=d.ratio;compressor.attack.value=d.attack;compressor.release.value=d.release;compressor.knee.value=6;node.connect(compressor);compressor.connect(out);}
  source.start();const result=await ctx.startRendering();return limitPcm({sampleRate:result.sampleRate,channels:a.channels.map((_,i)=>result.getChannelData(i).slice())},s.ceilingDb,s.lookaheadMs);
}
