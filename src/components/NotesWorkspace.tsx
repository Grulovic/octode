import { createContext, lazy, Suspense, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { FileText, WrapText } from "lucide-react";
import { Plus, Save, Search, FolderOpen, Trash2, X } from "./DesignIcons";
import { desktop } from "../lib/bridge";
import { loadNotes, registerNotesBackup, saveNote, deleteNote, noteLanguage, noteFilename, type Note } from "../lib/notes";
import { disposeRetainedEditorModel } from "../lib/retainedEditorModels";
import { registerPendingToolSave } from "../lib/toolSaves";
import type { WorkspaceRuntime } from "../lib/workspaceRegistry";
import { exportText } from "../lib/export";
import { pickNoteFiles, readNotePaths, readNoteFiles } from "../lib/noteFiles";
import { installFilePathDrop } from "../lib/terminalDrop";
import { confirmAction } from "./ToolLayout";
import MarkdownPreview from "./MarkdownPreview";
import FileIcon from "./FileIcon";
import PanelResize, { usePanelSize } from "./PanelResize";
import "./notes.css";
const EditorPane = lazy(() => desktop ? import("./EditorPane") : import("./PreviewEditor"));
const same = (a: Note, b?: Note) => !!b && a.title === b.title && a.text === b.text;
function useNotesModel(runtime: WorkspaceRuntime) {
  const [notes, render] = useState<Note[]>([]);
  const [search, setSearch] = useState("");

  const current = useRef(notes);
  const saved = useRef(new Map<string, Note>());
  const [active, setActive] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const pending = useRef<Promise<boolean> | null>(null);
  const [revision, reload] = useState(0);
  const [visible, setVisible] = useState(false);
  const [wrap, setWrap] = useState(false);
  const [markdown, setMarkdown] = useState(false);
  const setNotes = (items: Note[]) => { current.current = items; render(items); };
  useEffect(() => () => { for (const note of current.current) disposeRetainedEditorModel(`notes://${note.id}.txt`); }, []);
  useEffect(() => registerNotesBackup(() => loading ? null : { notes: current.current }), [loading]);
  const dirty = () => current.current.some((note) => !same(note, saved.current.get(note.id)));
  useEffect(() => runtime.register("global-notes", { saveCode: async () => true, flushLayout: async () => {}, hasUnsavedSettings: dirty }), [runtime]);
  useEffect(() => registerPendingToolSave("global-notes", () => pending.current ?? Promise.resolve(true)), []);
  useEffect(() => {
    let gone = false;
    setLoading(true); setError("");
    void loadNotes().then((items) => {
      if (gone) return;
      saved.current = new Map(items.map((note) => [note.id, note]));
      setNotes(items); setActive(items[0]?.id ?? ""); setLoading(false);
    }).catch((reason) => { if (!gone) { setError(String(reason)); setLoading(false); } });
    return () => { gone = true; };
  }, [revision]);
  useEffect(() => {
    const imported = () => { void loadNotes().then((items) => {
      const additions = items.filter((item) => !current.current.some((note) => note.id === item.id));
      for (const item of additions) saved.current.set(item.id, item);
      setNotes([...additions, ...current.current]);
    }).catch((reason) => setError(String(reason))); };
    window.addEventListener("octode-app-data-imported", imported);
    return () => window.removeEventListener("octode-app-data-imported", imported);
  }, []);
  const addCopies = (copies: Note[]) => {
    if (!copies.length) return;
    setNotes([...copies, ...current.current]); setActive(copies[0].id); setSearch("");
  };
  const create = () => addCopies([{ id: crypto.randomUUID(), title: "", text: "" }]);
  const update = (patch: Partial<Pick<Note, "title" | "text">>) => setNotes(current.current.map((note) => note.id === active ? { ...note, ...patch } : note));
  const save = (): Promise<boolean> => {
    if (pending.current) return pending.current;
    const snapshot = current.current.find((note) => note.id === active);
    if (!snapshot || same(snapshot, saved.current.get(snapshot.id))) return Promise.resolve(true);
    setSaving(true); setError("");
    const job = saveNote(snapshot).then((result) => {
      saved.current.set(snapshot.id, result);
      // Keep edits made while this save was in flight.
      setNotes(current.current.map((note) => note === snapshot ? result : note));
      return true;
    }).catch((reason) => { setError(`Could not save note: ${String(reason)}. Your draft is still open.`); return false; }).finally(() => { pending.current = null; setSaving(false); });
    pending.current = job;
    return job;
  };
  const remove = (id: string): Promise<boolean> => {
    if (pending.current) return pending.current;
    const target = current.current.find((item) => item.id === id);
    if (!target) return Promise.resolve(true);
    setDeleting(true); setError("");
    const job = Promise.resolve().then(async () => {
      if (!(await confirmAction(`Delete “${target.title || "Untitled note"}”? This cannot be undone.`, "Delete note"))) return true;
      await deleteNote(id);
      const index = current.current.findIndex((item) => item.id === id);
      const remaining = current.current.filter((item) => item.id !== id);
      saved.current.delete(id);
      disposeRetainedEditorModel(`notes://${id}.txt`);
      setNotes(remaining);
      setActive((selected) => selected === id ? (remaining[Math.min(index, remaining.length - 1)]?.id ?? "") : selected);
      return true;
    }).catch((reason) => { setError(`Could not delete note: ${String(reason)}. Your note is still open.`); return false; })
      .finally(() => { pending.current = null; setDeleting(false); });
    pending.current = job;
    return job;
  };
  const note = notes.find((item) => item.id === active);
  return { notes, note, active, setActive, loading, error, saving, deleting, save, remove, create, addCopies, update, dirty: dirty(), isDirty: (item: Note) => !same(item, saved.current.get(item.id)), retry: () => reload((value) => value + 1), visible, setVisible, wrap, setWrap, markdown, setMarkdown, search, setSearch };
}
const NotesContext = createContext<ReturnType<typeof useNotesModel> | null>(null);
export function NotesProvider({ runtime, children }: { runtime: WorkspaceRuntime; children: ReactNode }) {
  const model = useNotesModel(runtime);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey || event.isComposing) return;
      if (event.key === "6") {
        event.preventDefault(); event.stopImmediatePropagation();
        window.dispatchEvent(new Event("octode-dismiss-popovers"));
        model.setVisible(true);
      } else if (event.key.toLowerCase() === "s" && model.visible && !document.querySelector('[aria-modal="true"]')) {
        event.preventDefault(); event.stopImmediatePropagation(); void model.save();
      }
    };
    window.addEventListener("keydown", shortcut, true);
    return () => window.removeEventListener("keydown", shortcut, true);
  });
  return <NotesContext.Provider value={model}>{children}</NotesContext.Provider>;
}
export function useNotes() {
  const notes = useContext(NotesContext);
  if (!notes) throw new Error("Notes provider missing");
  return notes;
}
export default function NotesWorkspace() {
  const model = useNotes();
  const { note } = model;
  const section = useRef<HTMLElement>(null);
  const sidebar = useRef<HTMLElement>(null);
  const [savedWidth, setSidebarWidth] = usePanelSize("octode-layout:sidebar:notes", 340);
  const sidebarWidth = Math.max(320, savedWidth);
  const fileInput = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const importBusy = useRef(false);
  const [importError, setImportError] = useState("");
  const [dragging, setDragging] = useState(false);
  const importCopies = async (read: () => ReturnType<typeof readNotePaths>) => {
    if (importBusy.current || model.loading || (!model.notes.length && !!model.error)) return;
    importBusy.current = true;
    setImporting(true); setImportError("");
    try {
      const result = await read();
      model.addCopies(result.notes);
      setImportError(result.errors.join(" · "));
    } catch (reason) { setImportError(String(reason)); }
    finally { importBusy.current = false; setImporting(false); }
  };
  const open = () => {
    if (!desktop) { fileInput.current?.click(); return; }
    void importCopies(async () => readNotePaths(await pickNoteFiles()));
  };
  const dropHandlers = useRef({ model, importCopies });
  dropHandlers.current = { model, importCopies };
  useEffect(() => {
    if (!section.current) return;
    return installFilePathDrop(section.current, {
      native: desktop,
      capture: true,
      windows: navigator.platform.toLowerCase().includes("win"),
      active: () => dropHandlers.current.model.visible && !document.querySelector('[aria-modal="true"]'),
      onHover: setDragging,
      onError: setImportError,
      onPaths: (paths) => { void dropHandlers.current.importCopies(() => readNotePaths(paths)); },
      onFiles: (files) => { void dropHandlers.current.importCopies(() => readNoteFiles(files)); },
    });
  }, []);
  const [exporting, setExporting] = useState(false);
  const [findToken, setFindToken] = useState(0);
  const [exportError, setExportError] = useState("");
  useEffect(() => setExportError(""), [note?.id]);
  const saveAs = async () => {
    if (!note || exporting) return;
    setExporting(true);
    setExportError("");
    try {
      await exportText(note.text, noteFilename(note.title), "Save note as");
    } catch (reason) {
      setExportError(`Could not save file: ${String(reason)}. Your note is still open.`);
    } finally {
      setExporting(false);
    }
  };
  return <section ref={section} className={`notes-workspace ${dragging ? "notes-drop-target" : ""}`} aria-label="Global notes">
    <input ref={fileInput} type="file" multiple hidden aria-label="Open note files" onChange={(event) => {
      const files = Array.from(event.target.files ?? []);
      event.target.value = "";
      void importCopies(() => readNoteFiles(files));
    }} />
    {dragging && <div className="notes-drop-overlay">Drop files to create notes</div>}
    <aside ref={sidebar} className="notes-sidebar" style={{ width: sidebarWidth }}>
      <header><strong>Notes <span>{model.notes.length}</span></strong><div className="notes-file-actions"><button className="secondary-button" disabled={model.loading || importing || (!model.notes.length && !!model.error)} onClick={model.create}><Plus size={14} />New note</button><button className="secondary-button" disabled={model.loading || importing || (!model.notes.length && !!model.error)} onClick={open}><FolderOpen size={14} />{importing ? "Opening…" : "Open"}</button></div></header>
      <div className="notes-search"><Search size={14} /><input aria-label="Search notes" placeholder="Search notes…" value={model.search} onChange={(event) => model.setSearch(event.target.value)} />{model.search && <button aria-label="Clear notes search" onClick={() => model.setSearch("")}><X size={13} /></button>}</div>
      <div className="notes-list" aria-label="Notes list">{model.notes.filter((item) => `${item.title}\n${item.text}`.toLocaleLowerCase().includes(model.search.toLocaleLowerCase())).map((item) => <div key={item.id} className={`notes-list-row ${model.active === item.id ? "selected" : ""}`}><button className="notes-select" onClick={() => model.setActive(item.id)}>{/\.[^.\s/\\]+$/.test(item.title.trim()) ? <FileIcon path={item.title.trim()} size={16} /> : <FileText size={16} />}<span>{item.title || "Untitled note"}<small>{item.text.split("\n").find((line) => line.trim()) || "Empty note"}</small></span>{model.isDirty(item) && <span className="tool-unsaved-dot" aria-label="Unsaved note" />}</button>{<button className="notes-delete" aria-label={`Delete note ${item.title || "Untitled note"}`} title="Delete note" disabled={model.saving || model.deleting} onClick={() => void model.remove(item.id)}><Trash2 size={15} /></button>}</div>)}</div>
    </aside>
    <PanelResize target={sidebar} size={sidebarWidth} onResize={setSidebarWidth} minSize={320} label="Resize Notes sidebar" />
    <div className="notes-main">
      <header>{note ? <input aria-label="Note title" placeholder="Untitled note" value={note.title} readOnly={model.deleting} maxLength={200} onChange={(event) => model.update({ title: event.target.value })} /> : <strong>Notes</strong>}<span className="notes-save-state">{model.saving ? "Saving…" : note && model.isDirty(note) ? "Unsaved changes" : "Saved"}</span><button className="primary-button" disabled={!note || model.loading || model.saving || model.deleting || !model.isDirty(note)} onClick={() => void model.save()}><Save size={14} />Save</button><button className="secondary-button notes-save-as" disabled={!note || model.loading || exporting} onClick={() => void saveAs()}>{exporting ? "Saving file…" : "Save as…"}</button></header>
      <div className="notes-toolbar" role="toolbar" aria-label="Note tools">
        <span>{note ? noteLanguage(note.title) === "plaintext" ? "Plain text" : noteLanguage(note.title).toUpperCase() : "Notes"}</span>
        <div className="notes-toolbar-actions">
          <button aria-label="Find in note" title="Find in note" disabled={!note || model.loading || model.markdown} onClick={() => setFindToken((value) => value + 1)}><Search size={15} /></button>
          <button aria-label="Word wrap" title="Word wrap" aria-pressed={model.wrap} disabled={!note || model.loading || model.markdown} onClick={() => model.setWrap((value) => !value)}><WrapText size={16} /></button>
          <button aria-label="Markdown preview" title="Toggle Markdown preview" aria-pressed={model.markdown} disabled={!note || model.loading} onClick={() => model.setMarkdown((value) => !value)}>MD</button>
        </div>
      </div>
      {importError && <div className="error-banner" role="alert">{importError}</div>}
      {exportError && <div className="error-banner" role="alert">{exportError}</div>}
      {model.error && <div className="error-banner" role="alert">{model.error}{!model.notes.length && <button onClick={model.retry}>Retry</button>}</div>}
      {model.loading ? <div className="loading">Loading notes…</div> : note && model.markdown ? <MarkdownPreview text={note.text} /> : note ? <div className="notes-editor"><Suspense fallback={<div className="loading">Opening note…</div>}>{<EditorPane key={note.id} document={{ path: `notes://${note.id}.txt`, name: note.title || "Untitled note", text: note.text, saved: note.text }} modelPath={`notes://${note.id}.txt`} retainModel readOnly={model.deleting} languageId={noteLanguage(note.title)} wordWrap={model.wrap ? "on" : "off"} findToken={findToken} onChange={(text) => model.update({ text })} />}</Suspense></div> : <div className="notes-empty"><FileText size={28} /><h2>A little space for your thoughts.</h2><p>Plain-text notes, shared across all your projects.</p><button className="secondary-button" disabled={!!model.error} onClick={model.create}><Plus size={14} />New note</button></div>}
      {note && <footer>{note.text.split("\n").length} lines · {note.text.length} characters<span>{noteLanguage(note.title) === "plaintext" ? "Plain text" : noteLanguage(note.title).toUpperCase()} · {navigator.platform.toLowerCase().includes("mac") ? "⌘" : "Ctrl"}S to save</span></footer>}
    </div>
  </section>;
}
