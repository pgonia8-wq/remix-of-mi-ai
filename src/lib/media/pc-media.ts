import type {Core} from '../core';
import {rpc} from '../nodes/client';
import { mixBackground, validateAudioTracks, type AudioTrack } from '../video-edit';
import type {VideoPlan} from '../../../pc-node/media-plan.mjs';
export type MediaSession={nodeId:string;sessionId:string;jobId:string;kind:'stems'|'video'};
const encode=(bytes:Uint8Array)=>{let s='';for(let i=0;i<bytes.length;i+=32768)s+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(s);};
export async function submitMedia(core:Core,pid:string,nodeId:string,kind:'stems'|'video',assetIds:string[],plan?:VideoPlan,tracks:AudioTrack[]=[]){
 if(!await core.repo.getProject(pid))throw Error('Proyecto inválido');
 const assets=await Promise.all(assetIds.map(id=>core.assets.get(pid,id)));if(assets.some(a=>!a||a.size>60*1024**2))throw Error('Archivo ajeno al proyecto o demasiado grande');
 const caps=await rpc<{ffmpeg:boolean;demucs:boolean}>(core.repo,nodeId,'media.capabilities',{});if(kind==='stems'?!caps.demucs:!caps.ffmpeg)throw Error(kind==='stems'?'Instala Demucs y sus pesos locales en el nodo PC.':'Instala FFmpeg en el nodo PC.');
 let background:Uint8Array|undefined;
 if(kind==='video'&&plan&&tracks.length){const {videoArgs}=await import('../../../pc-node/media-plan.mjs');const duration=videoArgs(plan,assetIds,'out.mp4').duration;validateAudioTracks(tracks,duration);const audio=await mixBackground(core,pid,tracks,duration);if(audio){background=Uint8Array.from(atob(audio),c=>c.charCodeAt(0));plan={...plan,audio:true};}}
 const job=await core.jobs.create(pid,{capability:`media.pc.${kind}`,params:{nodeId,kind,assetIds,plan}});await core.jobs.markSent(pid,job.id);
 let sessionId='';
 try{sessionId=(await rpc<{sessionId:string}>(core.repo,nodeId,'media.create',{projectId:pid})).sessionId;
 // Persist session before transfer/submit: recovery consults status, never resubmits.
 await core.jobs.transition(pid,job.id,'processing',{phase:'accepted',remote_id:sessionId,recovery:JSON.stringify({nodeId,kind,sessionId})});
 for(let index=0;index<assetIds.length;index++){const bytes=await core.assets.read(pid,assetIds[index]??'');try{for(let offset=0;offset<bytes.length;offset+=512*1024)await rpc(core.repo,nodeId,'media.upload',{projectId:pid,sessionId,index,offset,data:encode(bytes.subarray(offset,offset+512*1024))});}finally{bytes.fill(0);}}
 if(background){try{for(let offset=0;offset<background.length;offset+=512*1024)await rpc(core.repo,nodeId,'media.upload',{projectId:pid,sessionId,index:assetIds.length,offset,data:encode(background.subarray(offset,offset+512*1024))});}finally{background.fill(0);}}
 await rpc(core.repo,nodeId,'media.submit',{projectId:pid,sessionId,kind,plan});return {nodeId,sessionId,jobId:job.id,kind} satisfies MediaSession;
 }catch(e){const j=await core.jobs.get(pid,job.id);if(j?.status==='processing')await core.jobs.transition(pid,job.id,'recovery_required',{error:'Consulta el nodo antes de repetir; la sesión puede existir.'});else if(j?.status==='submitting')await core.jobs.transition(pid,job.id,'recovery_required');throw e;}
}
export async function collectMedia(core:Core,pid:string,s:MediaSession){
 const job=await core.jobs.get(pid,s.jobId);if(!job||job.remote_id!==s.sessionId)throw Error('Trabajo ajeno al proyecto');
 const status=await rpc<{status:string;outputs:{path:string;size:number;name:string}[]}>(core.repo,s.nodeId,'media.status',{projectId:pid,sessionId:s.sessionId});if(status.status!=='succeeded')return status;
 const existing=(await core.assets.list(pid)).filter(a=>a.job_id===s.jobId);let result=[...existing];
 for(const o of status.outputs){if(existing.some(a=>a.name===o.name))continue;if(o.size>100*1024**2)throw Error('Resultado demasiado grande');
 const stream=async function*(){for(let offset=0;offset<o.size;){const r=await rpc<{data:string}>(core.repo,s.nodeId,'media.read',{projectId:pid,sessionId:s.sessionId,path:o.path,offset});const bytes=Uint8Array.from(atob(r.data),c=>c.charCodeAt(0));if(!bytes.length||offset+bytes.length>o.size)throw Error('Resultado truncado');offset+=bytes.length;yield bytes;}};
 result.push(await core.assets.put(pid,stream(),{kind:s.kind==='stems'?'audio':'video',name:o.name,mime:s.kind==='stems'?'audio/wav':'video/mp4',capability:`media.pc.${s.kind}`,jobId:s.jobId}));}
 if(!result.length)throw Error('El motor no produjo archivos');await core.jobs.finishAttempt(pid,s.jobId,'completed');if(job.status!=='completed')await core.jobs.transition(pid,s.jobId,'completed',{phase:'received',progress:1});await rpc(core.repo,s.nodeId,'media.cleanup',{projectId:pid,sessionId:s.sessionId});return {...status,assets:result};
}
