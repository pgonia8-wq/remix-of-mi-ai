import { afterEach, describe, expect, it, vi } from "vitest";
import { canSaveConnection, verifyConnection, type DraftConnection } from "@/lib/core/connection-test";
import { getAdapter } from "@/lib/core/adapters";

vi.mock("@/lib/core/adapters", () => ({ getAdapter: vi.fn() }));
const draft: DraftConnection = { adapterId: "elevenlabs", capability: "audio.tts", credentials: { kind: "elevenlabs", model: "test", apiKey: "fixture-not-a-real-key", endpoint: null, deployment: null, apiVersion: null, extraParams: null } };
afterEach(() => vi.resetAllMocks());
describe("manual connection save verification", () => {
  it("requires a real nonempty result before allowing save", async () => {
    vi.mocked(getAdapter).mockReturnValue({ id: "test", label: "test", operations: {}, supports: () => true, run: async () => ({ kind: "files", files: [{ bytes: new Uint8Array(200), mime: "audio/mpeg", name: "test.mp3" }] }) });
    expect(canSaveConnection(draft, null)).toBe(false);
    const result = await verifyConnection(draft);
    expect(canSaveConnection(draft, result)).toBe(true);
  });
  it("rejects empty results and does not permit saving", async () => {
    vi.mocked(getAdapter).mockReturnValue({ id: "test", label: "test", operations: {}, supports: () => true, run: async () => ({ kind: "search", results: [] }) });
    expect(canSaveConnection(draft, await verifyConnection(draft))).toBe(false);
  });
  it("invalidates verification when key, model or capability changes", async () => {
    vi.mocked(getAdapter).mockReturnValue({ id: "test", label: "test", operations: {}, supports: () => true, run: async () => ({ kind: "text", text: "OK" }) });
    const result = await verifyConnection(draft);
    expect(canSaveConnection({ ...draft, credentials: { ...draft.credentials, apiKey: "changed" } }, result)).toBe(false);
    expect(canSaveConnection({ ...draft, credentials: { ...draft.credentials, model: "changed" } }, result)).toBe(false);
    expect(canSaveConnection({ ...draft, capability: "embedding" }, result)).toBe(false);
  });
  it("does not expose provider errors containing keys", async () => {
    vi.mocked(getAdapter).mockReturnValue({ id: "test", label: "test", operations: {}, supports: () => true, run: async () => { throw Error(draft.credentials.apiKey ?? ""); } });
    const result = await verifyConnection(draft);
    expect(result.ok).toBe(false);
    expect(result.message).not.toContain(draft.credentials.apiKey);
  });
});