import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {videoArgs} from './media-plan.mjs';
export function mediaMethods({resolveIn,startJob,state,save,toolchains,cfg,kill}){
 const project=(p)=>{if(!/^[A-Za-z0-9_-]{1,64}$/.test(p.projectId))throw Error('Proyecto inválido');};
 const id=(v)=>{if(!/^[a-f0-9-]{36}$/.test(v))throw Error('Sesión inválida');return v;};
 const dir=(p)=>`.media/${id(p.sessionId)}`;
 const owned=(d,p)=>{project(p);const s=state.media?.[id(p.sessionId)];if(!s||s.deviceId!==d||s.projectId!==p.projectId)throw Error('Sesión ajena al proyecto/dispositivo');return s;};
 return {
  'media.capabilities':async()=>({ffmpeg:!!toolchains.ffmpeg,demucs:!!toolchains.demucs&&!!cfg.demucsModels,model:'htdemucs',localWeights:!!cfg.demucsModels}),
  'media.create':async(d,p)=>{project(p);const sessionId=randomUUID();state.media??={};state.media[sessionId]={deviceId:d,projectId:p.projectId,rootIndex:0,createdAt:Date.now(),jobId:null};const {target}=await resolveIn(0,p.projectId,`.media/${sessionId}`);await fs.mkdir(target,{recursive:true,mode:0o700});await save();return {sessionId};},
  'media.upload':async(d,p)=>{const s=owned(d,p);if(s.jobId)throw Error('Sesión ya enviada');if(!Number.isInteger(p.index)||p.index<0||p.index>12||!Number.isInteger(p.offset)||p.offset<0||p.offset>60*1024**2)throw Error('Trozo inválido');const bytes=Buffer.from(p.data,'base64');if(bytes.length>512*1024)throw Error('Trozo demasiado grande');const {target}=await resolveIn(0,p.projectId,`${dir(p)}/input-${p.index}`);const st=await fs.stat(target).catch(()=>null);if((st?.size??0)!==p.offset)throw Error('Orden de transferencia inválido');await fs.appendFile(target,bytes,{mode:0o600});return {offset:p.offset+bytes.length};},
  'media.submit':async(d,p)=>{const s=owned(d,p);if(s.jobId)return {jobId:s.jobId,duplicate:true};const {base,target}=await resolveIn(0,p.projectId,dir(p));let argv;
   if(p.kind==='stems'){if(!toolchains.demucs||!cfg.demucsModels)throw Error('Demucs y repositorio local htdemucs no instalados');argv=['demucs','--repo',cfg.demucsModels,'-n','htdemucs','--device','cpu','--shifts','0','--out',path.join(target,'stems'),path.join(target,'input-0')];}
   else if(p.kind==='video'){if(!toolchains.ffmpeg)throw Error('FFmpeg no instalado');const count=p.plan.clips.length+(p.plan.overlays?.length??0)+(p.plan.audio?1:0);const inputs=Array.from({length:count},(_,i)=>path.join(target,`input-${i}`));for(const input of inputs)await fs.access(input);argv=['ffmpeg',...videoArgs(p.plan,inputs,path.join(target,'result.mp4')).args];}
   else throw Error('Operación multimedia inválida');
   // Fixed host tools need their installed models/codecs; Docker generic node image cannot provide them.
   if(cfg.isolation==='docker')throw Error('Multimedia requiere modo process con herramientas instaladas; no se sustituye por imagen sin motores');
   const result=await startJob(d,{argv,projectId:p.projectId,cwd:path.relative(base,target),timeoutMs:600000,maxOutput:20000,opKey:`media:${p.projectId}:${p.sessionId}`,mediaHost:true});s.jobId=result.jobId;await save();return result;
  },
  'media.status':async(d,p)=>{const s=owned(d,p),j=state.jobs[s.jobId];let outputs=[];if(j?.status==='succeeded'){const {target}=await resolveIn(0,p.projectId,dir(p));const walk=async(folder)=>{for(const e of await fs.readdir(folder,{withFileTypes:true})){const full=path.join(folder,e.name);if(e.isSymbolicLink())continue;if(e.isDirectory())await walk(full);else if(/\.(wav|mp4)$/i.test(e.name)){const st=await fs.stat(full);if(st.size>100*1024**2)throw Error('Resultado demasiado grande');outputs.push({path:path.relative(target,full).split(path.sep).join('/'),size:st.size,name:e.name});}}};await walk(target);}
   return {status:j?.status??'uploading',jobId:s.jobId,output:j?.output??'',outputs};},
  'media.read':async(d,p)=>{owned(d,p);if(!Number.isInteger(p.offset)||p.offset<0)throw Error('Offset inválido');const {target}=await resolveIn(0,p.projectId,`${dir(p)}/${p.path}`);if(!/\.(wav|mp4)$/i.test(target))throw Error('Resultado inválido');const f=await fs.open(target,'r');try{const b=Buffer.alloc(512*1024);const {bytesRead}=await f.read(b,0,b.length,p.offset);return {data:b.subarray(0,bytesRead).toString('base64')};}finally{await f.close();}},
  'media.cleanup':async(d,p)=>{const s=owned(d,p);if(s.jobId)kill(s.jobId,'cancel');const {target}=await resolveIn(0,p.projectId,dir(p));await fs.rm(target,{recursive:true,force:true});delete state.media[p.sessionId];await save();return {removed:true};}
 };
}
