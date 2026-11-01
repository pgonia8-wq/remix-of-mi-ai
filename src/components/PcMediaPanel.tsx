import {useState} from 'react';
import {toast} from 'sonner';
import {Play,RefreshCw,Trash2} from 'lucide-react';
import {Button} from './ui/button';
import {inputCls} from './AppShell';
import {useCoreQuery,useCoreMutate} from '@/lib/use-app';
import {nodes,rpc} from '@/lib/nodes/client';
import {submitMedia,collectMedia,type MediaSession} from '@/lib/media/pc-media';
import type {AudioTrack} from '@/lib/video-edit';
import type {VideoPlan} from '../../pc-node/media-plan.mjs';
export function PcMediaPanel({pid,kind,assetIds,plan,tracks=[]}:{pid:string;kind:'stems'|'video';assetIds:string[];plan?:VideoPlan;tracks?:AudioTrack[]}){
 const {data:list=[]}=useCoreQuery(['media-nodes',pid],c=>nodes.list(c.repo));const {data:jobs=[]}=useCoreQuery(['pc-media-jobs',pid,kind],async c=>(await c.jobs.list(pid)).filter(j=>j.capability_id===`media.pc.${kind}`&&j.remote_id&&j.recovery&&j.status!=='completed'));
 const [nodeId,setNodeId]=useState(''),[busy,setBusy]=useState(false);const mutate=useCoreMutate();
 async function action(fn:Parameters<typeof mutate>[0]){setBusy(true);try{await mutate(fn);}catch(e){toast.error(e instanceof Error?e.message:'Operación no completada');}finally{setBusy(false);}}
 return <section className="space-y-3 border-t pt-5"><h2 className="font-semibold">{kind==='stems'?'Separación · Demucs':'Render avanzado · FFmpeg'}</h2><select className={inputCls} aria-label={`PC para ${kind}`} value={nodeId} onChange={e=>setNodeId(e.target.value)}><option value="">PC emparejada</option>{list.filter(n=>!n.revoked).map(n=><option key={n.id} value={n.id}>{n.name} · {n.status}</option>)}</select><Button disabled={busy||!nodeId||!assetIds.length} onClick={()=>{if(!confirm(kind==='stems'?'¿Enviar una copia a tu PC para separar voz, batería, bajo y otros con Demucs? Requiere pesos locales instalados. Las copias temporales se eliminan al recoger los resultados.':'¿Enviar clips a tu PC y renderizar con FFmpeg? Las copias temporales se eliminan al recoger el MP4. Este render no incluye subtítulos ni audio original; añade una pista de fondo.'))return;action(async c=>{await submitMedia(c,pid,nodeId,kind,assetIds,plan,tracks);toast.success('Trabajo enviado a tu PC.');});}}><Play/>{kind==='stems'?'Separar 4 stems':'Renderizar MP4'}</Button>
 {jobs.map(j=>{let s:MediaSession;try{s={...JSON.parse(j.recovery??'{}'),jobId:j.id};}catch{return null;}return <div key={j.id} className="flex flex-wrap items-center gap-2 border-b py-2 text-xs"><span className="flex-1">{j.status}</span><Button size="sm" variant="outline" disabled={busy} onClick={()=>action(async c=>{const r=await collectMedia(c,pid,s);toast.success(r.status==='succeeded'?'Resultados cifrados en Biblioteca.':`PC: ${r.status}`);})}><RefreshCw/>Recoger</Button><Button size="icon" variant="ghost" aria-label="Cancelar y limpiar trabajo PC" onClick={()=>action(async c=>{await rpc(c.repo,s.nodeId,'media.cleanup',{projectId:pid,sessionId:s.sessionId});const current=await c.jobs.get(pid,j.id);if(current&&['processing','recovery_required'].includes(current.status))await c.jobs.transition(pid,j.id,'cancelled');})}><Trash2/></Button></div>;})}
 </section>;
}
