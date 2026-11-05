import { useEffect, useRef, useState, type MouseEvent } from "react";
import { FileText } from "lucide-react";
import { Copy, ChevronDown, ChevronRight, FolderOpen, FolderPlus, FoldVertical, Pencil, Plus, Search, Trash2, X } from "./DesignIcons";
import CustomSelect from "./CustomSelect";
import FileIcon from "./FileIcon";
import { desktop } from "../lib/bridge";
import { canMoveFolder, folderAncestors, orderedFolders } from "../lib/apiFolders";
import { moveTab } from "../hooks/useTabReorder";
import type { Note, NoteFolder } from "../lib/notes";
import type { useNotes } from "./NotesWorkspace";

type Drop = { id: string; kind: "note" | "folder"; edge: "before" | "after" | "inside" };
type Drag = { id: string; kind: "note" | "folder"; x: number; y: number; moved: boolean };
export default function NotesSidebar({ model, importing, onOpen }: { model: ReturnType<typeof useNotes>; importing: boolean; onOpen: () => void }) {
  const [collapsed, setCollapsed] = useState<string[]>(() => {
    try { const value = JSON.parse(localStorage.getItem("octode-layout:notes-collapsed") ?? "[]"); return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : []; } catch { return []; }
  });
  useEffect(() => { localStorage.setItem("octode-layout:notes-collapsed", JSON.stringify(collapsed)); }, [collapsed]);
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState("");
  const cancelRename = useRef(false);
  const list = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const suppressClick = useRef(false);
  const [drop, setDrop] = useState<Drop | null>(null);
  const busy = model.loading || model.deleting || importing || (!model.notes.length && !!model.error);
  const creationFolder = model.folders.some((folder) => folder.id === model.creationFolder) ? model.creationFolder : "";
  const query = model.search.trim().toLocaleLowerCase();
  const reveal = (folderId: string) => setCollapsed((previous) => previous.filter((id) => id !== folderId && !folderAncestors(model.folders, folderId).includes(id)));
  const edit = (folder: NoteFolder) => { cancelRename.current = false; setName(folder.name); setEditing(folder.id); };
  const createFolder = (parentId = creationFolder) => {
    const folder = { id: crypto.randomUUID(), name: "New folder", parentId };
    model.setFolders([folder, ...model.folders]); model.setCreationFolder(folder.id); model.setSearch(""); reveal(parentId); edit(folder);
    requestAnimationFrame(() => list.current?.querySelector("input")?.scrollIntoView?.({ block: "nearest" }));
  };
  const addNote = () => { reveal(creationFolder); model.create(creationFolder); };
  const newNoteTarget = useRef({ addNote, busy, visible: model.visible });
  newNoteTarget.current = { addNote, busy, visible: model.visible };
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const create = () => {
      const target = newNoteTarget.current;
      if (!target.visible || target.busy || document.querySelector('[aria-modal="true"]')) return;
      window.dispatchEvent(new Event("octode-dismiss-popovers"));
      target.addNote();
      requestAnimationFrame(() => { if (!disposed) document.querySelector<HTMLInputElement>('.notes-main input[aria-label="Note title"]')?.focus(); });
    };
    const key = (event: KeyboardEvent) => {
      if (!newNoteTarget.current.visible || !(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey || event.isComposing || event.key.toLowerCase() !== "n") return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (!event.repeat) create();
    };
    window.addEventListener("keydown", key, true);
    if (desktop) void import("@tauri-apps/api/event").then(async ({ listen }) => {
      const stop = await listen("octode-new-note", create);
      if (disposed) stop(); else unlisten = stop;
    });
    return () => { disposed = true; unlisten?.(); window.removeEventListener("keydown", key, true); };
  }, []);
  const move = (item: Pick<Drag, "id" | "kind">, parentId: string) => {
    if (busy) return;
    if (item.kind === "folder") {
      if (!canMoveFolder(model.folders, item.id, parentId)) return;
      model.setFolders(model.folders.map((folder) => folder.id === item.id ? { ...folder, parentId } : folder));
    } else {
      if (parentId && !model.folders.some((folder) => folder.id === parentId)) return;
      model.setNotes(model.notes.map((note) => note.id === item.id ? { ...note, folderId: parentId } : note));
    }
    reveal(parentId);
  };
  const place = (item: Pick<Drag, "id" | "kind">, target: Drop) => {
    if (busy) return;
    if (target.edge === "inside") { move(item, target.id); return; }
    if (item.kind !== target.kind || item.id === target.id) return;
    if (item.kind === "note") {
      const destination = model.notes.find((note) => note.id === target.id);
      if (!destination) return;
      model.setNotes(moveTab(model.notes.map((note) => note.id === item.id ? { ...note, folderId: destination.folderId ?? "" } : note), item.id, target.id, target.edge === "after", (note) => note.id));
      reveal(destination.folderId ?? "");
    } else {
      const destination = model.folders.find((folder) => folder.id === target.id);
      if (!destination || !canMoveFolder(model.folders, item.id, destination.parentId ?? "")) return;
      model.setFolders(moveTab(model.folders.map((folder) => folder.id === item.id ? { ...folder, parentId: destination.parentId ?? "" } : folder), item.id, target.id, target.edge === "after", (folder) => folder.id));
      reveal(destination.parentId ?? "");
    }
  };
  const latest = useRef({ place, folders: model.folders }); latest.current = { place, folders: model.folders };
  useEffect(() => {
    const targetAt = (event: globalThis.MouseEvent): Drop | null => {
      const element = document.elementFromPoint(event.clientX, event.clientY);
      const item = drag.current;
      if (!element || !item) return null;
      const row = element.closest<HTMLElement>("[data-note-id]");
      if (row && item.kind === "note") {
        if (row.dataset.noteId === item.id) return null;
        const rect = row.getBoundingClientRect();
        return { kind: "note", id: row.dataset.noteId!, edge: event.clientY < rect.top + rect.height / 2 ? "before" : "after" };
      }
      let group = element.closest<HTMLElement>("[data-note-folder]");
      // Margin gaps hit the list itself rather than the heading or its children.
      if (!group && item.kind === "folder" && list.current?.contains(element)) {
        let nearest = 13;
        for (const heading of list.current.querySelectorAll<HTMLElement>(".folder-heading")) {
          if (heading.closest<HTMLElement>("[data-note-folder]")?.dataset.noteFolder === item.id) continue;
          const rect = heading.getBoundingClientRect();
          const distance = Math.min(Math.abs(event.clientY - rect.top), Math.abs(event.clientY - rect.bottom));
          if (distance < nearest) { nearest = distance; group = heading.closest<HTMLElement>("[data-note-folder]"); }
        }
      }
      if (!group) return null;
      const id = group.dataset.noteFolder ?? "";
      if (item.kind === "folder" && id === item.id) return null;
      let edge: Drop["edge"] = "inside";
      const heading = group.querySelector<HTMLElement>(":scope > .folder-heading");
      if (item.kind === "folder" && heading) {
        const rect = heading.getBoundingClientRect();
        if (event.clientY < rect.top + rect.height / 3) edge = "before";
        else if (event.clientY > rect.bottom - rect.height / 3) edge = "after";
      }
      if (item.kind === "folder") {
        const parent = edge === "inside" ? id : latest.current.folders.find((folder) => folder.id === id)?.parentId ?? "";
        if (!canMoveFolder(latest.current.folders, item.id, parent)) return null;
      }
      return { kind: "folder", id, edge };
    };
    const moving = (event: globalThis.MouseEvent) => {
      const item = drag.current;
      if (!item || (!item.moved && Math.hypot(event.clientX - item.x, event.clientY - item.y) < 6)) return;
      item.moved = true; event.preventDefault();
      const bounds = list.current?.getBoundingClientRect();
      if (bounds && list.current) {
        if (event.clientY < bounds.top + 24) list.current.scrollTop -= 20;
        else if (event.clientY > bounds.bottom - 24) list.current.scrollTop += 20;
      }
      setDrop(targetAt(event));
    };
    const finish = (event: globalThis.MouseEvent) => {
      const item = drag.current;
      const target = item?.moved ? targetAt(event) : null;
      drag.current = null;
      if (item?.moved) {
        if (target) latest.current.place(item, target);
        suppressClick.current = true; setTimeout(() => { suppressClick.current = false; }, 0);
      }
      setDrop(null);
    };
    const cancel = () => { drag.current = null; setDrop(null); };
    window.addEventListener("mousemove", moving); window.addEventListener("mouseup", finish); window.addEventListener("blur", cancel);
    window.addEventListener("pointermove", moving); window.addEventListener("pointerup", finish); window.addEventListener("pointercancel", cancel);
    return () => {
      window.removeEventListener("mousemove", moving); window.removeEventListener("mouseup", finish); window.removeEventListener("blur", cancel);
      window.removeEventListener("pointermove", moving); window.removeEventListener("pointerup", finish); window.removeEventListener("pointercancel", cancel);
    };
  }, []);
  const start = (event: MouseEvent, id: string, kind: Drag["kind"]) => {
    if (busy || event.button !== 0 || (event.target as Element).closest("input,.folder-edit,.folder-delete,.notes-delete,.notes-duplicate,.notes-move")) return;
    event.preventDefault(); drag.current = { id, kind, x: event.clientX, y: event.clientY, moved: false };
  };
  const removeFolder = (folder: NoteFolder) => {
    const parentId = folder.parentId ?? "";
    model.setFolders(model.folders.filter((item) => item.id !== folder.id).map((item) => item.parentId === folder.id ? { ...item, parentId } : item));
    model.setNotes(model.notes.map((note) => (note.folderId ?? "") === folder.id ? { ...note, folderId: parentId } : note));
    if (creationFolder === folder.id) model.setCreationFolder(parentId);
  };
  const matchingFolder = (id: string) => [id, ...folderAncestors(model.folders, id)].some((id) => model.folders.find((folder) => folder.id === id)?.name.toLocaleLowerCase().includes(query));
  const visibleNotes = model.notes.filter((note) => !query || `${note.title}\n${note.text}`.toLocaleLowerCase().includes(query) || matchingFolder(note.folderId ?? ""));
  const noteRow = (note: Note) => <div key={note.id} className={`notes-list-row sidebar-tree-row ${model.active === note.id ? "selected" : ""}`} data-note-id={note.id} data-note-drop={drop?.kind === "note" && drop.id === note.id ? drop.edge : undefined} draggable={false} onPointerDown={(event) => start(event, note.id, "note")} onMouseDown={(event) => start(event, note.id, "note")} title="Drag to sort or move to a folder">
    <button className="notes-select sidebar-tree-select" onClick={() => { if (!suppressClick.current) { model.setActive(note.id); model.setCreationFolder(note.folderId ?? ""); } }}>{/\.[^.\s/\\]+$/.test(note.title.trim()) ? <FileIcon path={note.title.trim()} size={16} /> : <FileText size={16} />}<span>{note.title || "Untitled note"}<small>{note.text.split("\n").find((line) => line.trim()) || "Empty note"}</small></span>{model.isDirty(note) && <span className="tool-unsaved-dot" aria-label="Unsaved note" />}</button>
    <CustomSelect className="notes-move" aria-label={`Move note ${note.title || "Untitled note"}`} title="Move note to folder" value={note.folderId ?? ""} triggerContent={<FolderOpen size={14} />} disabled={busy} onChange={(event) => move({ id: note.id, kind: "note" }, event.target.value)}><option value="">Unfiled</option>{orderedFolders(model.folders).map(({ folder, depth }) => <option key={folder.id} value={folder.id}>{`${"　".repeat(depth)}${folder.name}`}</option>)}</CustomSelect>
    <button className="notes-duplicate sidebar-tree-action sidebar-tree-duplicate" aria-label={`Duplicate note ${note.title || "Untitled note"}`} title="Duplicate note" disabled={busy} onClick={() => model.addCopies([{ ...note, id: crypto.randomUUID() }])}><Copy size={14} /></button>
    <button className="notes-delete sidebar-tree-action sidebar-tree-delete" aria-label={`Delete note ${note.title || "Untitled note"}`} title="Delete note" disabled={model.saving || model.deleting} onClick={() => void model.remove(note.id)}><Trash2 size={15} /></button>
  </div>;
  return <>
    <header><strong>Notes <span>{model.notes.length}</span></strong><div className="notes-file-actions"><button className="secondary-button" disabled={busy} title="New note (Cmd/Ctrl+N)" onClick={addNote}><Plus size={14} />New note</button><button className="secondary-button" disabled={busy} onClick={onOpen}><FolderOpen size={14} />{importing ? "Opening…" : "Open"}</button></div></header>
    <div className="notes-search"><Search size={14} /><input spellCheck={false} autoComplete="off" autoCorrect="off" autoCapitalize="off" aria-label="Search notes" placeholder="Search notes…" value={model.search} onChange={(event) => model.setSearch(event.target.value)} />{model.search && <button aria-label="Clear notes search" onClick={() => model.setSearch("")}><X size={13} /></button>}</div>
    <div className={`service-subheading api-request-heading notes-folder-toolbar ${drop?.id === "" && drop.edge === "inside" ? "notes-folder-drop" : ""}`} role="toolbar" aria-label="Notes folders" data-note-folder="" onClick={(event) => { if (event.target === event.currentTarget) model.setCreationFolder(""); }}>
      <button className="notes-root" aria-pressed={!creationFolder} title="Select top level; drop here to move out of a folder" onClick={() => model.setCreationFolder("")}>All notes</button><span className="api-request-actions-spacer" />
      <CustomSelect className="api-add-menu" aria-label="Add note or folder" title={creationFolder ? `Add inside ${model.folders.find((folder) => folder.id === creationFolder)?.name}` : "Add at top level"} value="" triggerContent={<Plus size={15} />} disabled={busy} onChange={(event) => { if (event.target.value === "note") addNote(); if (event.target.value === "folder") createFolder(); }}><option value="" disabled>Add…</option><option value="note">Add note</option><option value="folder">Add folder</option></CustomSelect>
      <button title="Collapse all folders" aria-label="Collapse all folders" disabled={!model.folders.length} onClick={() => { model.setSearch(""); setCollapsed(model.folders.map((folder) => folder.id)); }}><FoldVertical size={14} /></button>
    </div>
    <div ref={list} className="notes-list sidebar-tree-list" aria-label="Notes list" onClick={(event) => { if (event.target === event.currentTarget) model.setCreationFolder(""); }}>
      {[{ folder: { id: "", name: "Unfiled", parentId: "" }, depth: 0 }, ...orderedFolders(model.folders)].filter(({ folder }) => {
        if (!query) return !folderAncestors(model.folders, folder.id).some((id) => collapsed.includes(id));
        return matchingFolder(folder.id) || visibleNotes.some((note) => (note.folderId ?? "") === folder.id || folderAncestors(model.folders, note.folderId ?? "").includes(folder.id));
      }).map(({ folder, depth }) => <div key={folder.id} role="group" aria-label={`Note folder ${folder.name}`} data-note-folder={folder.id} className={`notes-folder sidebar-tree-folder ${drop?.id === folder.id && drop.edge === "inside" ? "notes-folder-drop" : ""}`} style={{ marginLeft: depth * 14 }}>
        {folder.id && <div data-note-drop={drop?.kind === "folder" && drop.id === folder.id && drop.edge !== "inside" ? drop.edge : undefined} className={`folder-heading sidebar-tree-heading ${creationFolder === folder.id ? "selected" : ""}`} title="Drag above or below a folder to sort; drop in the middle to move inside" draggable={false} onPointerDown={(event) => { if (editing !== folder.id) start(event, folder.id, "folder"); }} onMouseDown={(event) => { if (editing !== folder.id) start(event, folder.id, "folder"); }} onClick={(event) => { if (!suppressClick.current && !(event.target as Element).closest(".folder-edit,.folder-delete,input")) model.setCreationFolder(folder.id); }}>
          <button className={`folder-toggle ${editing === folder.id ? "" : "folder-name-button"}`} aria-label={`${!query && collapsed.includes(folder.id) ? "Expand" : "Collapse"} folder ${folder.name}`} aria-expanded={!!query || !collapsed.includes(folder.id)} onClick={() => { if (!suppressClick.current) setCollapsed((previous) => previous.includes(folder.id) ? previous.filter((id) => id !== folder.id) : [...previous, folder.id]); }}>{!query && collapsed.includes(folder.id) ? <ChevronRight size={14} /> : <ChevronDown size={14} />}{editing !== folder.id && <span>{folder.name}</span>}{(model.isFolderDirty(folder) || model.notes.some((note) => ((note.folderId ?? "") === folder.id || folderAncestors(model.folders, note.folderId ?? "").includes(folder.id)) && model.isDirty(note))) && <span className="tool-unsaved-dot" aria-label={`Unsaved changes in folder ${folder.name}`} />}</button>
          {editing === folder.id && <input autoFocus spellCheck={false} autoComplete="off" autoCorrect="off" autoCapitalize="off" aria-label="Folder name" maxLength={200} value={name} onFocus={(event) => event.currentTarget.select()} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === "Escape") { event.preventDefault(); cancelRename.current = event.key === "Escape"; event.currentTarget.blur(); } }} onBlur={() => { if (!cancelRename.current) model.setFolders(model.folders.map((item) => item.id === folder.id ? { ...item, name: name.trim() || folder.name } : item)); setEditing(null); }} />}
          <button className="folder-edit" aria-label={`New subfolder in ${folder.name}`} title="New subfolder" disabled={busy} onClick={() => createFolder(folder.id)}><FolderPlus size={14} /></button>
          <CustomSelect className="notes-move folder-edit" aria-label={`Move folder ${folder.name}`} title="Move folder" value={folder.parentId ?? ""} triggerContent={<FolderOpen size={14} />} disabled={busy} onChange={(event) => move({ id: folder.id, kind: "folder" }, event.target.value)}><option value="">Top level</option>{orderedFolders(model.folders).filter(({ folder: parent }) => canMoveFolder(model.folders, folder.id, parent.id)).map(({ folder: parent, depth }) => <option key={parent.id} value={parent.id}>{`${"　".repeat(depth)}${parent.name}`}</option>)}</CustomSelect>
          <button className="folder-edit" aria-label={`Edit folder ${folder.name}`} title="Edit folder name" disabled={busy} onClick={() => edit(folder)}><Pencil size={12} /></button>
          <button className="folder-delete" aria-label={`Remove folder ${folder.name}`} title="Remove folder (keep notes)" disabled={busy} onClick={(event) => { event.stopPropagation(); removeFolder(folder); }}><Trash2 size={12} /></button>
          <span className="folder-count">{visibleNotes.filter((note) => (note.folderId ?? "") === folder.id || folderAncestors(model.folders, note.folderId ?? "").includes(folder.id)).length}</span>
        </div>}
        {(!!query || !folder.id || !collapsed.includes(folder.id)) && visibleNotes.filter((note) => (note.folderId ?? "") === folder.id).map(noteRow)}
      </div>)}
      {query && !visibleNotes.length && !model.folders.some((folder) => matchingFolder(folder.id)) && <div className="notes-search-empty">No matching notes or folders</div>}
    </div>
  </>;
}
