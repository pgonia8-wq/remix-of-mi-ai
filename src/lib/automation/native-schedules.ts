import { registerPlugin } from "@capacitor/core";
import { isNative } from "../app-db";
import type { Repo } from "../db/repo";

export const MiaiSchedule = registerPlugin<{
  schedule(o: { id: string; dueAt: number }): Promise<void>;
  cancel(o: { id: string }): Promise<void>;
  requestNotifications(): Promise<{ granted: boolean }>;
}>("MiaiSchedule");

export async function syncNativeSchedules(repo: Repo) {
  if (!isNative()) return;
  const pending = await repo.sql.all<{ id: string; due_at: number }>("SELECT id,due_at FROM schedules WHERE status='scheduled'");
  for (const s of pending) await MiaiSchedule.schedule({ id: s.id, dueAt: s.due_at });
}