import type { ProviderKind } from "../../db/repo";

export type AdapterCredentials = {
  kind: ProviderKind; endpoint: string | null; apiKey: string | null; deployment: string | null; apiVersion: string | null; model: string; extraParams: string | null;
};
export type InputFile = { bytes: Uint8Array; mime: string; name: string };
export type RunRequest = { capability: string; model: string; prompt?: string; params?: Record<string, unknown>; files?: InputFile[]; idempotencyKey?: string; signal?: AbortSignal };
export type OutputFile = { bytes: Uint8Array; mime: string; name: string };
export type RunResult =
  | { kind: "text"; text: string }
  | { kind: "files"; files: OutputFile[]; text?: string }
  | { kind: "remote"; remoteId: string };

/** What an adapter can really do for one capability. */
export type OperationSupport = { async: boolean; cancel: boolean; poll: boolean; recover: boolean; idempotencyHeader: string | null };

export interface ProviderAdapter {
  id: string;
  label: string;
  operations: Record<string, OperationSupport>;
  supports(capability: string): boolean;
  run(c: AdapterCredentials, r: RunRequest): Promise<RunResult>;
  poll?(c: AdapterCredentials, remoteId: string): Promise<RunResult | { kind: "pending"; progress?: number }>;
  cancel?(c: AdapterCredentials, remoteId: string): Promise<void>;
  recover?(c: AdapterCredentials, remoteId: string): Promise<RunResult | null>;
  /** Voices available for TTS (provider catalog + the user's own). */
  listVoices?(c: AdapterCredentials): Promise<{ id: string; name: string }[]>;
  /** Official catalog listing, only where the provider exposes one. */
  listModels?(c: AdapterCredentials): Promise<string[]>;
}

export const sync = (idempotencyHeader: string | null = null): OperationSupport => ({ async: false, cancel: false, poll: false, recover: false, idempotencyHeader });

export function b64ToBytes(s: string) { return Uint8Array.from(atob(s), (c) => c.charCodeAt(0)); }
export const trimSlash = (s: string) => s.replace(/\/+$/, "");
