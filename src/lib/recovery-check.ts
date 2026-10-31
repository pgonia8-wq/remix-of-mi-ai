import type { Repo } from "./db/repo";
import { openWithPassword, sealWithPassword } from "./crypto";

/** Destructive test of sentinel projects only; never invoked by product UI. */
export async function checkSentinelRecovery(repo: Repo, projectId: string) {
  const original = await repo.dumpAll();
  const plain = JSON.stringify(original);
  const password = "miai-selftest-backup-password";
  const sealed = await sealWithPassword(password, plain);
  if (sealed.includes("MIAI_PLAINTEXT_PROBE_7f3a")) throw new Error("backup-not-encrypted");
  let rejected = false;
  try { await openWithPassword("incorrect-password", sealed); } catch { rejected = true; }
  if (!rejected) throw new Error("wrong-password-accepted");
  await repo.deleteProject(projectId);
  if (await repo.getProject(projectId)) throw new Error("project-not-deleted");
  await repo.restoreAll(JSON.parse(await openWithPassword(password, sealed)));
  const restored = await repo.dumpAll();
  for (const table of ["projects", "chats", "messages", "memory_items", "memory_versions", "documents"]) {
    const canonical = (rows: unknown[]) => JSON.stringify([...rows].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
    if (canonical(original.tables[table] ?? []) !== canonical(restored.tables[table] ?? [])) {
      throw new Error("backup-recovery-mismatch");
    }
  }
}