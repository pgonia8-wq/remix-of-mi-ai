import { afterEach, expect, it, vi } from "vitest";
import initSqlJs from "sql.js";
import { Repo } from "@/lib/db/repo";
import { wrapSqlJs } from "@/lib/db/sql";
import { unb64 } from "@/lib/crypto";

vi.mock("sql.js", async importOriginal => {
  const actual = await importOriginal<typeof import("sql.js")>();
  return { default: () => actual.default() };
});

afterEach(() => { localStorage.clear(); vi.resetModules(); });

it("persists an explicitly saved Azure provider before save resolves, including encrypted credential and verification", async () => {
  localStorage.clear();
  const { getRepo } = await import("@/lib/app-db");
  const repo = await getRepo();
  const id = await repo.saveProvider({ name: "Azure prueba", kind: "azure_openai", endpoint: "https://resource.services.ai.azure.com/openai/v1/chat/completions", apiKey: "TEST-NOT-A-REAL-KEY", deployment: "deployment", model: "deployment" });
  // Controlled repository status only: does not claim a live provider connection.
  await repo.setProviderVerification(id, "verified");
  const stored = localStorage.getItem("miai_preview_db");
  expect(stored).not.toBeNull();
  if (!stored) throw new Error("Save resolved without durable preview data");
  const SQL = await initSqlJs();
  const reloaded = new Repo(wrapSqlJs(new SQL.Database(unb64(stored))), { encrypt: async () => "", decrypt: async () => "" });
  expect((await reloaded.listProviders())[0]).toMatchObject({ id, kind: "azure_openai", deployment: "deployment", has_key: true, verification_status: "verified" });
  expect(new TextDecoder().decode(unb64(stored))).not.toContain("TEST-NOT-A-REAL-KEY");
});