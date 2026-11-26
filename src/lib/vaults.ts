import { desktop, invoke } from "./bridge";
export type VaultKind = "section" | "url" | "value" | "password" | "note";
export interface VaultItem { id: string; kind: VaultKind; label: string; value: string }
export interface VaultDocument { id: string; name: string; projectId: string; revision: string; items: VaultItem[] }
// Browser preview deliberately keeps vault contents only in memory.
const preview = new Map<string, VaultDocument>();
export async function listVaults(): Promise<VaultDocument[]> {
  return desktop ? invoke("list_vaults") : [...preview.values()].map((doc) => ({ ...doc, items: [] }));
}
export async function loadVault(id: string): Promise<VaultDocument> {
  if (desktop) return invoke("load_vault", { id });
  const doc = preview.get(id);
  if (!doc) throw new Error("Vault no longer exists");
  return structuredClone(doc);
}
export async function saveVault(document: VaultDocument): Promise<VaultDocument> {
  if (desktop) return invoke("save_vault", { document, expected: document.revision });
  if ((preview.get(document.id)?.revision ?? "") !== document.revision) throw new Error("Vault changed elsewhere");
  const saved = structuredClone({ ...document, revision: crypto.randomUUID() });
  preview.set(saved.id, saved);
  return saved;
}
export async function deleteVault(document: VaultDocument): Promise<void> {
  if (desktop) await invoke("delete_vault", { id: document.id, expected: document.revision });
  else preview.delete(document.id);
}
export function moveVaultItem(items: VaultItem[], source: string, target: string, after: boolean): VaultItem[] {
  if (source === target) return items;
  const item = items.find((item) => item.id === source);
  if (!item || !items.some((item) => item.id === target)) return items;
  const next = items.filter((item) => item.id !== source);
  next.splice(next.findIndex((item) => item.id === target) + Number(after), 0, item);
  return next;
}
export function vaultUrl(value: string): string | null {
  try { const url = new URL(value); return ["https:", "http:"].includes(url.protocol) ? url.href : null; } catch { return null; }
}

let backupReader: (() => VaultDocument[]) | undefined;
export function registerVaultBackup(read: () => VaultDocument[]) {
  backupReader = read;
  return () => { if (backupReader === read) backupReader = undefined; };
}
export function vaultsForBackup(saved: VaultDocument[], includeCredentials: boolean): VaultDocument[] {
  const drafts = backupReader?.() ?? [];
  const docs = new Map(saved.map((doc) => [doc.id, doc]));
  for (const doc of drafts) docs.set(doc.id, doc);
  return [...docs.values()].map((doc) => ({ ...doc, items: doc.items.map((item) => ({ ...item, value: item.kind === "password" && !includeCredentials ? "" : item.value })) }));
}
