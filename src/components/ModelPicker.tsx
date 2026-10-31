import { useMemo } from "react";
import { route, type RouteMode } from "@/lib/core/router";
import { useCoreQuery } from "@/lib/use-app";
import { inputCls } from "@/components/AppShell";

/** Router-backed model selector for any capability, with the router's explanation. */
export function ModelPicker({ capability, mode, setMode, manual, setManual }: { capability: string; mode: RouteMode; setMode: (m: RouteMode) => void; manual: string; setManual: (s: string) => void }) {
  const { data: models = [] } = useCoreQuery(["models"], (c) => c.repo.registry.listModels());
  const d = useMemo(() => route(models, { capability, mode, manualModelId: manual || null }), [models, capability, mode, manual]);
  const compatible = models.filter((m) => m.capabilities.includes(capability) && m.status === "active" && m.provider_enabled);
  return (
    <div className="space-y-1">
      <div className="flex gap-2">
        <select aria-label="Selección de modelo" className={inputCls} value={mode} onChange={(e) => setMode(e.target.value as RouteMode)}>
          <option value="auto">Automático</option><option value="favorite">Favoritos</option><option value="manual">Manual</option>
        </select>
        {mode === "manual" && <select aria-label="Modelo" className={inputCls} value={manual} onChange={(e) => setManual(e.target.value)}><option value="">Elige modelo</option>{compatible.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>}
      </div>
      <p className={`text-xs ${d.ok ? "text-muted-foreground" : "text-destructive"}`}>{d.ok ? <>Modelo: <b>{d.model.name}</b> — {d.reasons.join(" · ")}</> : d.reason}</p>
    </div>
  );
}
