// One-shot hand-off of shared text/files into a chat composer (memory only, never persisted).
const pending = new Map<string, { text: string; files: File[] }>();
export function setChatHandoff(chatId: string, v: { text: string; files: File[] }) { pending.set(chatId, v); }
export function takeChatHandoff(chatId: string) { const v = pending.get(chatId); pending.delete(chatId); return v ?? null; }
