// Self-test triggered by CI on the emulator via deep links:
//   miai://selftest/write  -> creates sentinel data (project, chat, provider with a fake key)
//   miai://selftest/verify -> after app restart, checks persistence and isolation
// Results go to logcat as "MIAI_SELFTEST PASS|FAIL <phase> <reason>" — never the secret itself.
import { getRepo } from "./app-db";
import { checkSentinelRecovery } from "./recovery-check";

export const SENTINEL_TEXT = "MIAI_PLAINTEXT_PROBE_7f3a";
export const SENTINEL_KEY = "sk-MIAI-KEY-PROBE-9c2e";

export async function runSelfTest(phase: "write" | "verify") {
  const log = (ok: boolean, why: string) => console.log(`MIAI_SELFTEST ${ok ? "PASS" : "FAIL"} ${phase} ${why}`);
  try {
    const repo = await getRepo();
    if (phase === "write") {
      const a = await repo.createProject("selftest-A");
      await repo.createProject("selftest-B");
      const c = await repo.createChat(a.id, "selftest-chat");
      await repo.addMessage(a.id, c.id, "user", SENTINEL_TEXT);
      await repo.addMessage(a.id, c.id, "assistant", "selftest-answer");
      const memory = await repo.addMemory(a.id, "hipotesis", "selftest-memory-v1");
      await repo.editMemory(a.id, memory, "decision", "selftest-memory-v2");
      await repo.addDoc(a.id, { name: "selftest.txt", mime: "text/plain", size: 17, text: "selftest-document", filePath: null });
      await repo.saveProvider({ name: "selftest", kind: "openai", model: "m", apiKey: SENTINEL_KEY });
      return log(true, "written");
    }
    const projects = await repo.listProjects();
    const a = projects.find((p) => p.name === "selftest-A");
    const b = projects.find((p) => p.name === "selftest-B");
    if (!a || !b) return log(false, "projects-not-persisted");
    const chats = await repo.listChats(a.id);
    const msgs = chats[0] ? await repo.listMessages(a.id, chats[0].id) : [];
    if (!msgs.some((m) => m.content === SENTINEL_TEXT)) return log(false, "messages-not-persisted");
    if ((await repo.listChats(b.id)).length || (await repo.search(b.id, "PROBE")).messages.length) return log(false, "isolation-broken");
    const prov = (await repo.listProviders()).find((p) => p.name === "selftest");
    if (!prov || (await repo.getProviderSecret(prov.id)) !== SENTINEL_KEY) return log(false, "key-roundtrip");
    if (JSON.stringify(await repo.dumpAll()).includes(SENTINEL_KEY)) return log(false, "key-in-export");
    await checkSentinelRecovery(repo, a.id);
    log(true, "encrypted-backup-restored-wrong-password-rejected");
    log(true, "persisted-isolated-keyok");
  } catch {
    log(false, "native-check-failed");
  }
}
