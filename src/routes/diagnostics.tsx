import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Gauge, KeyRound } from "lucide-react";
import { toast } from "sonner";
import { useCoreMutate, useCoreQuery } from "@/lib/use-app";
import { getCore } from "@/lib/core";
import { encryptAsset, decryptAsset, collect, memorySource, newDek } from "@/lib/core/asset-crypto";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/diagnostics")({
  head: () => ({
    meta: [
      { title: "Diagnóstico de seguridad — MI AI" },
      { name: "description", content: "Nivel real de Android Keystore, perfil de rendimiento y medición de cifrado en este teléfono." },
      { property: "og:title", content: "Diagnóstico de seguridad — MI AI" },
      { property: "og:description", content: "Protección de llaves y rendimiento de cifrado medidos en el dispositivo." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Diagnostics,
});

type Bench = { mb: number; encMs: number; decMs: number; encMBs: number; decMBs: number; heapMB: number | null; profile: string; blockSize: number; concurrency: number };

const PROT: Record<string, string> = {
  strongbox: "StrongBox (chip de seguridad dedicado), verificado", tee: "Entorno de ejecución seguro (TEE), verificado", "secure-hardware": "Hardware seguro (nivel exacto no expuesto por Android < 12)",
  software: "Keystore por software: sin hardware seguro verificado", "preview-insecure": "Vista de desarrollo: SIN Android Keystore", "secure-storage": "Almacenamiento seguro del sistema",
};

function Diagnostics() {
  const { data } = useCoreQuery(["diag"], async (c) => ({ info: await c.keys.info(), versions: await c.keys.versions(), device: c.device, profile: c.profile, startup: c.startup,
    reports: await c.repo.sql.all<{ id: string; device: string; report: string; created_at: number }>(`SELECT * FROM device_reports ORDER BY created_at DESC LIMIT 20`) }));
  const mutate = useCoreMutate();
  const [bench, setBench] = useState<Bench | null>(null);
  const [running, setRunning] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  async function runBench(mb: number) {
    setRunning(true); setErrors([]);
    try {
      const c = await getCore();
      const p = c.profile, total = mb * 1024 * 1024, dek = newDek();
      const heap = () => (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? null;
      let peak = heap();
      async function* src() { const chunk = new Uint8Array(256 * 1024); for (let i = 0; i < total; i += chunk.length) { crypto.getRandomValues(chunk.subarray(0, 65536)); const h = heap(); if (h && peak !== null) peak = Math.max(peak, h); yield chunk.subarray(0, Math.min(chunk.length, total - i)); } }
      const t0 = performance.now();
      const file = await collect(encryptAsset(src(), { assetId: "bench", projectId: "bench" }, dek, { blockSize: p.blockSize, concurrency: p.concurrency }));
      const t1 = performance.now();
      let n = 0; for await (const b of decryptAsset(memorySource(file), { assetId: "bench", projectId: "bench" }, dek)) { n += b.length; const h = heap(); if (h && peak !== null) peak = Math.max(peak, h); }
      const t2 = performance.now();
      if (n !== total) throw new Error("Tamaño descifrado incorrecto");
      const r: Bench = { mb, encMs: Math.round(t1 - t0), decMs: Math.round(t2 - t1), encMBs: +(mb / ((t1 - t0) / 1000)).toFixed(1), decMBs: +(mb / ((t2 - t1) / 1000)).toFixed(1), heapMB: peak ? Math.round(peak / 1048576) : null, profile: p.name, blockSize: p.blockSize, concurrency: p.concurrency };
      setBench(r);
      const dev = c.device.manufacturer ? `${c.device.manufacturer} ${c.device.model}` : "navegador (vista de desarrollo)";
      await mutate(async (cc) => cc.repo.sql.run(`INSERT INTO device_reports (id, device, report, created_at) VALUES (?,?,?,?)`, [crypto.randomUUID(), dev, JSON.stringify({ bench: r, device: c.device, key: await cc.keys.info() }), Date.now()]));
    } catch (e) { setErrors([(e as Error).message]); } finally { setRunning(false); }
  }

  async function rotate() {
    if (!confirm("Crear una nueva llave maestra y volver a envolver las llaves de todos los archivos. ¿Continuar?")) return;
    try { const r = await mutate((c) => c.keys.rotate()); toast.success(`Llave v${r.newVersion}: ${r.rewrapped} archivos re-envueltos; retiradas ${r.retired.join(", ") || "ninguna"}`); }
    catch (e) { toast.error((e as Error).message); }
  }

  if (!data) return <p className="p-4 text-sm text-muted-foreground">Midiendo…</p>;
  const d = data.device;
  const row = (k: string, v: string | number | null | undefined) => (<><dt className="text-muted-foreground">{k}</dt><dd className="col-span-2 break-words">{v === null || v === undefined || v === "" ? "no disponible" : v}</dd></>);
  return (
    <div className="space-y-4 p-4 text-sm">
      <h1 className="text-2xl font-bold">Diagnóstico</h1>
      <section className="space-y-2 rounded-xl border bg-card p-3">
        <h2 className="flex items-center gap-2 font-semibold"><KeyRound className="h-4 w-4" /> Llaves</h2>
        <dl className="grid grid-cols-3 gap-1 text-xs">
          {row("Protección real", PROT[data.info.protection] ?? data.info.protection)}
          {row("StrongBox disponible", data.info.strongBoxAvailable === null ? null : data.info.strongBoxAvailable ? "sí" : "no")}
          {row("StrongBox usado", data.info.strongBoxUsed ? "sí" : "no")}
          {row("Versión activa", `v${data.info.version}`)}
          {row("Versiones", data.versions.map((v) => `v${v.id} ${v.status}`).join(", "))}
        </dl>
        <Button variant="outline" size="sm" onClick={rotate}>Rotar llave maestra</Button>
        <p className="text-xs text-muted-foreground">Android Keystore y el cifrado local no protegen por completo ante un teléfono comprometido, malware con privilegios o alguien con acceso a la app desbloqueada.</p>
      </section>
      <section className="space-y-2 rounded-xl border bg-card p-3">
        <h2 className="flex items-center gap-2 font-semibold"><Gauge className="h-4 w-4" /> Dispositivo y perfil</h2>
        <dl className="grid grid-cols-3 gap-1 text-xs">
          {row("Origen de datos", d.source === "native" ? "Android (medido)" : "navegador (estimado)")}
          {row("Equipo", d.manufacturer ? `${d.manufacturer} ${d.model} · Android SDK ${d.sdk}` : null)}
          {row("Arquitecturas", d.abis.join(", "))}
          {row("Memoria disponible", d.availMemMB ? `${Math.round(d.availMemMB)} MB de ${Math.round(d.totalMemMB ?? 0)} MB` : null)}
          {row("Núcleos", d.cores)}
          {row("Espacio libre", d.freeStorageMB ? `${d.freeStorageMB} MB` : null)}
          {row("Batería", d.batteryPct !== null ? `${d.batteryPct}%${d.charging ? " cargando" : ""}` : null)}
          {row("Estado térmico", d.thermal)}
          {row("Perfil", `${data.profile.name} · bloque ${data.profile.blockSize / 1048576} MB · concurrencia ${data.profile.concurrency}`)}
          {row("Motivos", data.profile.reasons.join("; "))}
          {row("Al iniciar", `${data.startup.temps} temporales y ${data.startup.orphans} archivos huérfanos limpiados`)}
        </dl>
        <div className="flex gap-2">{[8, 32, 64].map((mb) => <Button key={mb} size="sm" variant="outline" disabled={running} onClick={() => runBench(mb)}>Medir {mb} MB</Button>)}</div>
        {running && <p className="text-xs text-primary">Cifrando y descifrando…</p>}
        {errors.map((e) => <p key={e} className="text-xs text-destructive">{e}</p>)}
        {bench && <p className="text-xs">Cifrado {bench.mb} MB: {bench.encMs} ms ({bench.encMBs} MB/s) · descifrado {bench.decMs} ms ({bench.decMBs} MB/s) · memoria JS máx. {bench.heapMB ?? "no expuesta"} MB</p>}
      </section>
      <section className="space-y-1 rounded-xl border bg-card p-3">
        <h2 className="font-semibold">Mediciones guardadas por equipo</h2>
        {!data.reports.length && <p className="text-xs text-muted-foreground">Aún no hay mediciones.</p>}
        {data.reports.map((r) => { const b = (JSON.parse(r.report) as { bench: Bench }).bench; return <p key={r.id} className="text-xs"><b>{r.device}</b> · {new Date(r.created_at).toLocaleString()} · {b.mb} MB · cifrado {b.encMBs} MB/s · descifrado {b.decMBs} MB/s · perfil {b.profile}</p>; })}
      </section>
    </div>
  );
}
