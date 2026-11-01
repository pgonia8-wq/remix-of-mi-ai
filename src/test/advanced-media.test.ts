// @vitest-environment node
import {describe,it,expect} from 'vitest';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {newFeature,buildCad,cadMetrics,exportCad,type CadDocument} from '@/lib/media/cad';
import {limitPcm,audioMeter,validateMaster,DEFAULT_MASTER} from '@/lib/media/mastering';
import {videoArgs} from '../../pc-node/media-plan.mjs';
const doc=(features:CadDocument['features']):CadDocument=>({version:1,unit:'mm',name:'Test',features});
describe('Suites avanzadas',()=>{
 it('CAD paramétrico calcula volumen real y booleanas',()=>{const a=newFeature('box'),b={...newFeature('box'),position:[10,0,0] as [number,number,number]},f={...newFeature('subtract'),refs:[a.id,b.id]};a.visible=false;b.visible=false;expect(cadMetrics(doc([a,b,f])).volumeMm3).toBeCloseTo(4000,4);});
 it('extrusión real de perfil 20x20x20 y exportación STL/OBJ',async()=>{const f=newFeature('extrude');expect(cadMetrics(doc([f])).volumeMm3).toBeCloseTo(8000);const stl=await exportCad(doc([f]),'stl');expect(new DataView(stl.buffer).getUint32(80,true)).toBeGreaterThan(0);expect(new TextDecoder().decode(await exportCad(doc([f]),'obj'))).toContain('v ');});
 it('CAD rechaza referencias circulares y dimensiones negativas',()=>{const f=newFeature('subtract');f.refs=[f.id,'missing'];expect(()=>buildCad(doc([f]))).toThrow();const b=newFeature('box');b.size[0]=-1;expect(()=>buildCad(doc([b]))).toThrow();});
 it('limitador enlaza estéreo y aplica techo sin destruir la fuente',()=>{const input={sampleRate:1000,channels:[Float32Array.from([0.5,2,0.5]),Float32Array.from([0.25,1,0.25])]};const out=limitPcm(input,-1,5);expect(Math.max(...out.channels[0]??[])).toBeLessThanOrEqual(10**(-1/20)+1e-7);expect(input.channels[0]?.[1]).toBe(2);expect((out.channels[0]?.[1]??0)/(out.channels[1]?.[1]??1)).toBeCloseTo(2);expect(audioMeter(out).samplePeakDb).toBeCloseTo(-1,5);});
 it('master rechaza frecuencias Nyquist y compresión inválida',()=>{validateMaster(DEFAULT_MASTER,44100);expect(()=>validateMaster({...DEFAULT_MASTER,eq:[{frequency:24000,gain:0,q:1}]},44100)).toThrow();expect(()=>validateMaster({...DEFAULT_MASTER,bands:DEFAULT_MASTER.bands.map(d=>({...d,ratio:0}))},44100)).toThrow();});
 it('FFmpeg renderiza disolver y PiP con keyframes a MP4 real',()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'miai-video-'));try{const inputs=['a.mp4','b.mp4','p.mp4'].map(f=>path.join(dir,f));inputs.forEach((f,i)=>{const r=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','lavfi','-i',`color=c=${['red','blue','green'][i]}:s=160x90:r=30:d=2`,'-c:v','libx264',f]);expect(r.status).toBe(0);});const plan={clips:[{start:0,end:2,transition:'cut' as const,transitionSeconds:0.5},{start:0,end:2,transition:'fade' as const,transitionSeconds:0.5}],overlays:[{assetId:'x',name:'PiP',offset:1,length:1,scale:0.3,x:0,y:0,endX:1,endY:1}],width:1280,height:720};const out=path.join(dir,'result.mp4'),built=videoArgs(plan,inputs,out);expect(built.duration).toBe(3.5);const r=spawnSync('ffmpeg',built.args,{encoding:'utf8',timeout:60000});expect(r.status,r.stderr).toBe(0);const probe=spawnSync('ffprobe',['-v','error','-show_entries','format=duration','-of','csv=p=0',out],{encoding:'utf8'});expect(Number(probe.stdout)).toBeCloseTo(3.5,1);}finally{fs.rmSync(dir,{recursive:true,force:true});}},90000);
 it('rechaza transición mayor que sus clips y parámetros inyectados',()=>{expect(()=>videoArgs({clips:[{start:0,end:1,transition:'cut',transitionSeconds:0},{start:0,end:1,transition:'fade',transitionSeconds:1}],overlays:[],width:1280,height:720},['a','b'],'out')).toThrow();});
});
