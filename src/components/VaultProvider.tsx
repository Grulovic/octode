import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { listProjects, desktop, previewProject } from "../lib/bridge";
import { deleteVault, registerVaultBackup, listVaults, loadVault, saveVault, type VaultDocument } from "../lib/vaults";
import type { Project } from "../types";
import type { WorkspaceRuntime } from "../lib/workspaceRegistry";
import { registerPendingToolSave } from "../lib/toolSaves";
import { useSaveShortcut } from "../lib/saveShortcut";
import { useNotes } from "./NotesWorkspace";
import { confirmAction } from "./ToolLayout";
function useModel(runtime: WorkspaceRuntime) {
  const notes = useNotes();
  const [visible, show] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [catalog, setCatalog] = useState<VaultDocument[]>([]);
  const [drafts, setDrafts] = useState<Record<string, VaultDocument>>({});
  const [saved, setSaved] = useState<Record<string, VaultDocument>>({});
  const [active, setActive] = useState("");
  const [editing, setEditing] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const pending = useRef<Promise<unknown> | null>(null);
  const loadingId = useRef(0);
  const dirty = Object.values(drafts).some((doc) => JSON.stringify(doc) !== JSON.stringify(saved[doc.id]));
  const latest = useRef({ dirty, drafts }); latest.current = { dirty, drafts };
  useEffect(() => registerVaultBackup(() => Object.values(latest.current.drafts)), []);
  useEffect(() => runtime.register("global-vaults", { saveCode: async () => true, flushLayout: async () => { await pending.current; }, hasUnsavedSettings: () => latest.current.dirty }), [runtime]);
  useEffect(() => registerPendingToolSave("global-vaults", async () => { await pending.current; return true; }), []);
  const refresh = async () => {
    const [docs, projects] = await Promise.all([listVaults(), desktop ? listProjects() : Promise.resolve([previewProject])]);
    setCatalog(docs); setProjects(projects);
  };
  useEffect(() => { if (visible) void refresh().catch((e) => setError(String(e))); }, [visible]);
  useEffect(() => { if (notes.visible) show(false); }, [notes.visible]);
  useEffect(() => {
    const imported = (event: Event) => {
      ++loadingId.current; setLoading(false);
      if ((event as CustomEvent).detail?.mode === "replace") { setDrafts({}); setSaved({}); setActive(""); setEditing({}); }
      void refresh().catch((e) => setError(String(e)));
    };
    window.addEventListener("octode-app-data-imported", imported);
    return () => window.removeEventListener("octode-app-data-imported", imported);
  }, []);
  const setVisible = (value: boolean) => { if (value) notes.setVisible(false); show(value); };
  const select = async (meta: VaultDocument) => {
    if (saving) return;
    setActive(meta.id); setError(""); const request = ++loadingId.current;
    if (drafts[meta.id]) { setLoading(false); return; }
    setLoading(true);
    try {
      const doc = meta.revision ? await loadVault(meta.id) : meta;
      if (request !== loadingId.current) return;
      setDrafts((old) => ({ ...old, [doc.id]: doc }));
      setSaved((old) => ({ ...old, [doc.id]: doc }));
    } catch (e) { if (request === loadingId.current) setError(String(e)); }
    finally { if (request === loadingId.current) setLoading(false); }
  };
  const update = (doc: VaultDocument) => setDrafts((old) => ({ ...old, [doc.id]: doc }));
  const save = async () => {
    const doc = drafts[active]; if (!doc || saving || loading) return;
    setSaving(true); setError("");
    const job = saveVault(doc).then((result) => {
      setSaved((old) => ({ ...old, [doc.id]: result }));
      setDrafts((old) => ({ ...old, [doc.id]: old[doc.id] === doc ? result : { ...old[doc.id], revision: result.revision } }));
      setCatalog((old) => [...old.filter((item) => item.id !== doc.id), { ...result, items: [] }]);
      setEditing((old) => ({ ...old, [doc.id]: false }));
    }).catch((e) => setError(`Could not save vault: ${String(e)}. Your draft is kept.`)).finally(() => { pending.current = null; setSaving(false); });
    pending.current = job; await job;
  };
  useSaveShortcut(visible && !!editing[active] && !saving, save);
  const create = () => {
    if (saving) return;
    ++loadingId.current; setLoading(false); setError("");
    const doc: VaultDocument = { id: crypto.randomUUID(), name: "New vault", projectId: "", revision: "", items: [] };
    update(doc); setActive(doc.id); setEditing((old) => ({ ...old, [doc.id]: true }));
  };
  const discard = async () => {
    if (!(await confirmAction("Discard changes to this vault?", "Discard vault changes"))) return;
    let doc = saved[active];
    if (doc?.revision) {
      setLoading(true);
      try { doc = await loadVault(doc.id); setSaved((old) => ({ ...old, [doc!.id]: doc! })); }
      catch (e) { setError(`Could not reload vault: ${String(e)}. Your draft is kept.`); return; }
      finally { setLoading(false); }
    }
    if (doc) update(doc);
    else { setDrafts((old) => { const next = { ...old }; delete next[active]; return next; }); setActive(""); }
    setEditing((old) => ({ ...old, [active]: false }));
  };
  const remove = async () => {
    const doc = drafts[active]; if (!doc || projects.some((project) => project.id === doc.id) || saving) return;
    if (!(await confirmAction(`Delete “${doc.name}” and all its items? This cannot be undone.`, "Delete vault"))) return;
    setSaving(true); setError("");
    const job = Promise.resolve().then(async () => {
      if (doc.revision) await deleteVault(doc);
      setCatalog((old) => old.filter((item) => item.id !== doc.id));
      setDrafts((old) => { const next = { ...old }; delete next[doc.id]; return next; });
      setSaved((old) => { const next = { ...old }; delete next[doc.id]; return next; }); setActive("");
    }).catch((e) => setError(String(e))).finally(() => { pending.current = null; setSaving(false); });
    pending.current = job; await job;
  };
  const projectVaults = projects.map((project) => ({ id: project.id, name: project.name, projectId: project.id, items: [], revision: catalog.find((doc) => doc.id === project.id)?.revision ?? "" }));
  const customVaults = [...catalog, ...Object.values(drafts).filter((doc) => !catalog.some((item) => item.id === doc.id))].filter((doc) => !projects.some((project) => project.id === doc.id)).map((doc) => drafts[doc.id] ?? doc);
  return { visible, setVisible, projectVaults, customVaults, select, active, doc: drafts[active], update, create, save, discard, remove, editing: !!editing[active], edit: () => setEditing((old) => ({ ...old, [active]: true })), dirty, isDirty: (id: string) => !!drafts[id] && JSON.stringify(drafts[id]) !== JSON.stringify(saved[id]), saving, loading, error };
}
const Context = createContext<ReturnType<typeof useModel> | null>(null);
export function VaultProvider({ runtime, children }: { runtime: WorkspaceRuntime; children: ReactNode }) {
  const model = useModel(runtime);
  return <Context.Provider value={model}>{children}</Context.Provider>;
}
export function useVaults() { const value = useContext(Context); if (!value) throw new Error("Missing VaultProvider"); return value; }
