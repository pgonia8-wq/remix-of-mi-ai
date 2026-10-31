import { useSyncExternalStore } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getRepo } from "./app-db";
import type { Repo } from "./db/repo";
import { getCore, type Core } from "./core";

const KEY = "miai_active_project";
const listeners = new Set<() => void>();
export function setActiveProject(id: string | null) {
  if (id) localStorage.setItem(KEY, id);
  else localStorage.removeItem(KEY);
  listeners.forEach((l) => l());
}
export function useActiveProjectId(): string | null {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => localStorage.getItem(KEY),
    () => null,
  );
}

export function useRepoQuery<T>(key: unknown[], fn: (r: Repo) => Promise<T>, enabled = true) {
  return useQuery({ queryKey: key, queryFn: async () => fn(await getRepo()), enabled });
}

export function useMutate() {
  const qc = useQueryClient();
  return async <T,>(fn: (r: Repo) => Promise<T>): Promise<T> => {
    const out = await fn(await getRepo());
    await qc.invalidateQueries();
    return out;
  };
}

export function useCoreQuery<T>(key: unknown[], fn: (c: Core) => Promise<T>, enabled = true) {
  return useQuery({ queryKey: ["core", ...key], queryFn: async () => fn(await getCore()), enabled });
}
export function useCoreMutate() {
  const qc = useQueryClient();
  return async <T,>(fn: (c: Core) => Promise<T>): Promise<T> => {
    try { return await fn(await getCore()); } finally { await qc.invalidateQueries(); }
  };
}
