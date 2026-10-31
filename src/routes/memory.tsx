import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Archive, FileText, History, Pencil, Plus, Search, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import type { MemoryKind } from "@/lib/db/repo";
import { useActiveProjectId, useMutate, useRepoQuery } from "@/lib/use-app";
import { deletePrivateFile, isTextFile, savePrivateFile } from "@/lib/files";
import { NeedProject, btnCls, btnGhost, inputCls } from "@/components/AppShell";

export const Route = createFileRoute("/memory")({
  head: () => ({
    meta: [
      { title: "Memoria y documentos — MI AI" },
      { name: "description", content: "Hechos, decisiones e hipótesis versionados y documentos privados del proyecto, con búsqueda local." },
      { property: "og:title", content: "Memoria y documentos — MI AI" },
      { property: "og:description", content: "Memoria versionada y documentos privados del proyecto." },
    ],
  }),
  component: MemoryPage,
});

const KINDS: { k: MemoryKind; label: string }[] = [
  { k: "hecho", label: "Hecho" },
  { k: "decision", label: "Decisión" },
  { k: "hipotesis", label: "Hipótesis" },
];

function MemoryPage() {
  const pid = useActiveProjectId();
  const [tab, setTab] = useState<"memoria" | "docs" | "buscar">("memoria");
  if (!pid) return <NeedProject />;
  return (
    <div className="space-y-4 p-4">
      <div className="grid grid-cols-3 gap-1 rounded-lg bg-secondary p-1 text-sm">
        {(["memoria", "docs", "buscar"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`rounded-md py-1.5 ${tab === t ? "bg-card text-primary" : "text-muted-foreground"}`}>
            {t === "memoria" ? "Memoria" : t === "docs" ? "Documentos" : "Buscar"}
          </button>
        ))}
      </div>
      {tab === "memoria" && <MemoryTab pid={pid} />}
      {tab === "docs" && <DocsTab pid={pid} />}
      {tab === "buscar" && <SearchTab pid={pid} />}
    </div>
  );
}

function MemoryTab({ pid }: { pid: string }) {
  const { data: items = [] } = useRepoQuery(["memory", pid], (r) => r.listMemory(pid));
  const mutate = useMutate();
  const [kind, setKind] = useState<MemoryKind>("hecho");
  const [text, setText] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [histFor, setHistFor] = useState<string | null>(null);
  const { data: hist = [] } = useRepoQuery(["hist", pid, histFor], (r) => r.memoryHistory(pid, histFor!), !!histFor);

  async function save() {
    if (!text.trim()) return;
    await mutate<unknown>((r) => (editing ? r.editMemory(pid, editing, kind, text.trim()) : r.addMemory(pid, kind, text.trim())));
    setText("");
    setEditing(null);
  }
  return (
    <div className="space-y-3">
      <div className="space-y-2 rounded-xl border bg-card p-3">
        <div className="flex gap-1">
          {KINDS.map(({ k, label }) => (
            <button key={k} onClick={() => setKind(k)} className={`rounded-full px-3 py-1 text-xs ${kind === k ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground"}`}>
              {label}
            </button>
          ))}
        </div>
        <textarea className={inputCls} rows={2} placeholder="Ej.: El cliente prefiere entregas los lunes" value={text} onChange={(e) => setText(e.target.value)} />
        <button className={btnCls + " w-full"} onClick={save} disabled={!text.trim()}>
          <Plus className="h-4 w-4" /> {editing ? "Guardar nueva versión" : "Añadir a la memoria"}
        </button>
      </div>
      {items.map((m) => (
        <div key={m.id} className="rounded-xl border bg-card p-3 text-sm">
          <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
            <span className="rounded bg-accent px-2 py-0.5 text-accent-foreground">{KINDS.find((k) => k.k === m.kind)?.label}</span>v{m.version}
            <span className="flex-1" />
            <button aria-label="Editar" onClick={() => (setEditing(m.id), setKind(m.kind), setText(m.content))}>
              <Pencil className="h-4 w-4" />
            </button>
            <button aria-label="Historial" onClick={() => setHistFor(histFor === m.id ? null : m.id)}>
              <History className="h-4 w-4" />
            </button>
            <button aria-label="Archivar" onClick={() => mutate((r) => r.archiveMemory(pid, m.id, true))}>
              <Archive className="h-4 w-4" />
            </button>
          </div>
          <p>{m.content}</p>
          {histFor === m.id && (
            <ul className="mt-2 space-y-1 border-t pt-2 text-xs text-muted-foreground">
              {hist.map((h) => (
                <li key={h.id}>
                  v{h.version} · {new Date(h.created_at).toLocaleString()} — {h.content}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
      {!items.length && <p className="text-center text-sm text-muted-foreground">La memoria del proyecto está vacía.</p>}
    </div>
  );
}

function DocsTab({ pid }: { pid: string }) {
  const { data: docs = [] } = useRepoQuery(["docs", pid], (r) => r.listDocs(pid));
  const mutate = useMutate();
  async function upload(files: FileList | null) {
    for (const f of Array.from(files ?? [])) {
      try {
        const filePath = await savePrivateFile(pid, f);
        const text = isTextFile(f) ? await f.text() : null;
        await mutate((r) => r.addDoc(pid, { name: f.name, mime: f.type, size: f.size, text, filePath }));
      } catch (e) {
        toast.error(`No se pudo guardar ${f.name}: ${(e as Error).message}`);
      }
    }
  }
  return (
    <div className="space-y-3">
      <label className={btnCls + " w-full cursor-pointer"}>
        <Upload className="h-4 w-4" /> Añadir documentos
        <input type="file" multiple className="hidden" onChange={(e) => upload(e.target.files)} />
      </label>
      {docs.map((d) => (
        <div key={d.id} className="flex items-center gap-3 rounded-xl border bg-card p-3 text-sm">
          <FileText className="h-5 w-5 text-primary" />
          <div className="flex-1">
            <div className="font-medium">{d.name}</div>
            <div className="text-xs text-muted-foreground">
              {(d.size / 1024).toFixed(1)} KB {d.text_content ? "· texto indexado" : "· sin texto buscable"}
            </div>
          </div>
          <button
            aria-label="Eliminar documento"
            onClick={async () => {
              const removed = await mutate((r) => r.deleteDoc(pid, d.id));
              await deletePrivateFile(removed?.file_path ?? null);
            }}
          >
            <Trash2 className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>
      ))}
      {!docs.length && <p className="text-center text-sm text-muted-foreground">Sin documentos.</p>}
    </div>
  );
}

function SearchTab({ pid }: { pid: string }) {
  const [q, setQ] = useState("");
  const { data } = useRepoQuery(["search", pid, q], (r) => r.search(pid, q), q.trim().length > 1);
  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
        <input className={inputCls + " pl-9"} placeholder="Buscar en chats, memoria y documentos" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {data && (
        <div className="space-y-2 text-sm">
          {data.memory.map((m) => (
            <div key={m.id} className="rounded-lg border bg-card p-2">🧠 {m.content}</div>
          ))}
          {data.docs.map((d) => (
            <div key={d.id} className="rounded-lg border bg-card p-2">📄 {d.name}</div>
          ))}
          {data.messages.map((m) => (
            <div key={m.id} className="rounded-lg border bg-card p-2">💬 {m.content.slice(0, 200)}</div>
          ))}
          {!data.memory.length && !data.docs.length && !data.messages.length && <p className="text-muted-foreground">Sin resultados.</p>}
        </div>
      )}
    </div>
  );
}
