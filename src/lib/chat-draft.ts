// Saves a chat answer while the model is still writing, so closing the app or locking the screen never loses it.
// Writes are serialized (one at a time), throttled, and can be forced (screen locked / app hidden).
export const activeDrafts = new Set<string>();

export type DraftSaver = { push(text: string, force?: boolean): void; settle(): Promise<void>; id(): string | null };

export function createDraftSaver(o: {
  create(text: string): Promise<string>;
  update(id: string, text: string): Promise<void>;
  onError?(e: unknown): void;
  intervalMs?: number;
  initialId?: string | null;
  now?: () => number;
}): DraftSaver {
  let id: string | null = o.initialId ?? null, last = -Infinity, chain: Promise<void> = Promise.resolve(), warned = false, pending: string | null = null;
  const now = o.now ?? Date.now, interval = o.intervalMs ?? 1500;
  if (id) activeDrafts.add(id);
  const write = () => {
    chain = chain.then(async () => {
      const text = pending; pending = null;
      if (text === null) return;
      if (!id) { id = await o.create(text); activeDrafts.add(id); } else await o.update(id, text);
    }).catch((e) => { if (!warned) { warned = true; o.onError?.(e); } });
  };
  return {
    push(text, force = false) {
      if (!text.trim()) return;
      pending = text;
      if (!force && now() - last < interval) return;
      last = now(); write();
    },
    async settle() { if (pending !== null) write(); await chain; },
    id: () => id,
  };
}
