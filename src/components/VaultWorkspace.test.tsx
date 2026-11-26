// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { NotesProvider } from "./NotesWorkspace";
import { VaultProvider, useVaults } from "./VaultProvider";
import VaultWorkspace from "./VaultWorkspace";
import { createWorkspaceRuntime } from "../lib/workspaceRegistry";
import * as storage from "../lib/vaults";
import { vaultsForBackup, type VaultDocument } from "../lib/vaults";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });
const setup = async () => {
  const runtime = createWorkspaceRuntime();
  let model!: ReturnType<typeof useVaults>;
  function Harness() { model = useVaults(); return model.visible ? <VaultWorkspace/> : null; }
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  await act(async () => root.render(<NotesProvider runtime={runtime}><VaultProvider runtime={runtime}><Harness/></VaultProvider></NotesProvider>));
  const close = async () => { await act(async () => root.unmount()); host.remove(); };
  await act(async () => model.setVisible(true));
  return { get model() { return model; }, host, runtime, close };
};
it("keeps vault drafts across navigation and only explicitly saves the selected vault", async () => {
  vi.spyOn(storage, "listVaults").mockResolvedValue([]);
  const save = vi.spyOn(storage, "saveVault").mockImplementation(async (doc) => ({ ...doc, revision: "saved" }));
  const app = await setup();
  try {
    await act(async () => app.model.create());
    await act(async () => app.model.update({ ...app.model.doc!, name: "Production", items: [{ id: "password", kind: "password", label: "Login", value: "keep-private" }] }));
    const first = app.model.doc!;
    await act(async () => app.model.setVisible(false));
    expect(app.runtime.hasUnsavedSettings()).toBe(true);
    expect(save).not.toHaveBeenCalled();
    await act(async () => { app.model.setVisible(true); app.model.create(); });
    const second = app.model.doc!;
    await act(async () => app.model.select(first));
    expect(app.model.doc?.items[0].value).toBe("keep-private");
    await act(async () => app.model.save());
    expect(save).toHaveBeenCalledTimes(1);
    expect(app.model.isDirty(first.id)).toBe(false);
    expect(app.model.isDirty(second.id)).toBe(true);
    expect(app.runtime.hasUnsavedSettings()).toBe(true);
    expect(app.host.textContent).not.toContain("keep-private");
    const reveal = app.host.querySelector<HTMLButtonElement>('[aria-label="Show password"]')!;
    await act(async () => reveal.click());
    expect(app.host.textContent).toContain("keep-private");
    await act(async () => app.model.setVisible(false));
    await act(async () => app.model.setVisible(true));
    expect(app.host.textContent).not.toContain("keep-private");
    expect(vaultsForBackup([], true).find((doc) => doc.id === first.id)?.items[0].value).toBe("keep-private");
    expect(vaultsForBackup([], false).find((doc) => doc.id === first.id)?.items[0].value).toBe("");
  } finally { await app.close(); }
});
it("retains failed saves and discards only after confirmation", async () => {
  vi.spyOn(storage, "listVaults").mockResolvedValue([]);
  vi.spyOn(storage, "saveVault").mockRejectedValue(new Error("Disk full"));
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  const app = await setup();
  try {
    await act(async () => app.model.create());
    await act(async () => app.model.save());
    expect(app.host.querySelector('[role="alert"]')?.textContent).toContain("Disk full");
    expect(app.model.editing).toBe(true);
    expect(app.runtime.hasUnsavedSettings()).toBe(true);
    await act(async () => app.model.discard());
    expect(app.model.doc).toBeDefined();
    confirm.mockReturnValue(true);
    await act(async () => app.model.discard());
    expect(app.model.doc).toBeUndefined();
    expect(app.runtime.hasUnsavedSettings()).toBe(false);
  } finally { await app.close(); }
});
it("ignores stale vault loads and preserves live drafts on merge import", async () => {
  const meta: VaultDocument = { id: "existing", projectId: "", name: "Existing", revision: "rev", items: [] };
  vi.spyOn(storage, "listVaults").mockResolvedValue([meta]);
  let resolve!: (doc: VaultDocument) => void;
  vi.spyOn(storage, "loadVault").mockImplementation(() => new Promise((done) => { resolve = done; }));
  const app = await setup();
  try {
    let pending!: Promise<void>;
    await act(async () => { pending = app.model.select(meta); });
    await act(async () => app.model.create());
    const draft = app.model.doc;
    await act(async () => { resolve(meta); await pending; });
    expect(app.model.doc).toBe(draft);
    await act(async () => window.dispatchEvent(new CustomEvent("octode-app-data-imported", { detail: { mode: "merge" } })));
    expect(app.model.doc).toBe(draft);
    await act(async () => window.dispatchEvent(new CustomEvent("octode-app-data-imported", { detail: { mode: "replace" } })));
    expect(app.model.doc).toBeUndefined();
  } finally { await app.close(); }
});
it("reorders items above and below targets and rejects unsafe URL schemes", () => {
  const items = ["a", "b", "c"].map((id) => ({ id, kind: "value" as const, label: id, value: "" }));
  expect(storage.moveVaultItem(items, "a", "c", true).map((item) => item.id)).toEqual(["b", "c", "a"]);
  expect(storage.moveVaultItem(items, "c", "a", false).map((item) => item.id)).toEqual(["c", "a", "b"]);
  expect(storage.moveVaultItem(items, "x", "a", false)).toBe(items);
  expect(storage.vaultUrl("javascript:alert(1)")).toBeNull();
  expect(storage.vaultUrl("file:///etc/passwd")).toBeNull();
  expect(storage.vaultUrl("https://example.com/login")).toBe("https://example.com/login");
});
