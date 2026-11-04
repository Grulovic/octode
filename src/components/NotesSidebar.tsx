import { useEffect, useRef, useState, type MouseEvent } from "react";
import { FileText } from "lucide-react";
import { ChevronDown, ChevronRight, FolderOpen, FolderPlus, FoldVertical, Pencil, Plus, Search, Trash2, X } from "./DesignIcons";
import CustomSelect from "./CustomSelect";
import FileIcon from "./FileIcon";
import { canMoveFolder, folderAncestors, orderedFolders } from "../lib/apiFolders";
import type { Note, NoteFolder } from "../lib/notes";
import type { useNotes } from "./NotesWorkspace";

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
  const [drop, setDrop] = useState<string | null>(null);
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
  const latest = useRef({ move, busy }); latest.current = { move, busy };
  useEffect(() => {
    const targetAt = (event: globalThis.MouseEvent) => document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-note-folder]");
    const moving = (event: globalThis.MouseEvent) => {
      const item = drag.current;
      if (!item || (!item.moved && Math.hypot(event.clientX - item.x, event.clientY - item.y) < 6)) return;
      item.moved = true; event.preventDefault(); setDrop(targetAt(event)?.dataset.noteFolder ?? null);
    };
    const finish = (event: globalThis.MouseEvent) => {
      const item = drag.current; drag.current = null;
      if (item?.moved) {
        const target = targetAt(event);
        if (target) latest.current.move(item, target.dataset.noteFolder ?? "");
        suppressClick.current = true; setTimeout(() => { suppressClick.current = false; }, 0);
      }
      setDrop(null);
    };
    const cancel = () => { drag.current = null; setDrop(null); };
    window.addEventListener("mousemove", moving); window.addEventListener("mouseup", finish); window.addEventListener("blur", cancel);
    return () => { window.removeEventListener("mousemove", moving); window.removeEventListener("mouseup", finish); window.removeEventListener("blur", cancel); };
  }, []);
  const start = (event: MouseEvent, id: string, kind: Drag["kind"]) => {
    if (busy || event.button !== 0 || (event.target as Element).closest("input,.folder-edit,.folder-delete,.notes-delete,.notes-move")) return;
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
  const noteRow = (note: Note) => <div key={note.id} className={`notes-list-row ${model.active === note.id ? "selected" : ""}`} draggable={false} onMouseDown={(event) => start(event, note.id, "note")} title="Drag to a folder to move this note">
    <button className="notes-select" onClick={() => { if (!suppressClick.current) { model.setActive(note.id); model.setCreationFolder(note.folderId ?? ""); } }}>{/\.[^.\s/\\]+$/.test(note.title.trim()) ? <FileIcon path={note.title.trim()} size={16} /> : <FileText size={16} />}<span>{note.title || "Untitled note"}<small>{note.text.split("\n").find((line) => line.trim()) || "Empty note"}</small></span>{model.isDirty(note) && <span className="tool-unsaved-dot" aria-label="Unsaved note" />}</button>
    <CustomSelect className="notes-move" aria-label={`Move note ${note.title || "Untitled note"}`} title="Move note to folder" value={note.folderId ?? ""} triggerContent={<FolderOpen size={14} />} disabled={busy} onChange={(event) => move({ id: note.id, kind: "note" }, event.target.value)}><option value="">Unfiled</option>{orderedFolders(model.folders).map(({ folder, depth }) => <option key={folder.id} value={folder.id}>{`${"　".repeat(depth)}${folder.name}`}</option>)}</CustomSelect>
    <button className="notes-delete" aria-label={`Delete note ${note.title || "Untitled note"}`} title="Delete note" disabled={model.saving || model.deleting} onClick={() => void model.remove(note.id)}><Trash2 size={15} /></button>
  </div>;
  return <>
    <header><strong>Notes <span>{model.notes.length}</span></strong><div className="notes-file-actions"><button className="secondary-button" disabled={busy} onClick={addNote}><Plus size={14} />New note</button><button className="secondary-button" disabled={busy} onClick={onOpen}><FolderOpen size={14} />{importing ? "Opening…" : "Open"}</button></div></header>
    <div className="notes-search"><Search size={14} /><input spellCheck={false} autoComplete="off" autoCorrect="off" autoCapitalize="off" aria-label="Search notes" placeholder="Search notes…" value={model.search} onChange={(event) => model.setSearch(event.target.value)} />{model.search && <button aria-label="Clear notes search" onClick={() => model.setSearch("")}><X size={13} /></button>}</div>
    <div className={`service-subheading api-request-heading notes-folder-toolbar ${drop === "" ? "notes-folder-drop" : ""}`} role="toolbar" aria-label="Notes folders" data-note-folder="" onClick={(event) => { if (event.target === event.currentTarget) model.setCreationFolder(""); }}>
      <button className="notes-root" aria-pressed={!creationFolder} title="Select top level; drop here to move out of a folder" onClick={() => model.setCreationFolder("")}>All notes</button><span className="api-request-actions-spacer" />
      <CustomSelect className="api-add-menu" aria-label="Add note or folder" title={creationFolder ? `Add inside ${model.folders.find((folder) => folder.id === creationFolder)?.name}` : "Add at top level"} value="" triggerContent={<Plus size={15} />} disabled={busy} onChange={(event) => { if (event.target.value === "note") addNote(); if (event.target.value === "folder") createFolder(); }}><option value="" disabled>Add…</option><option value="note">Add note</option><option value="folder">Add folder</option></CustomSelect>
      <button title="Collapse all folders" aria-label="Collapse all folders" disabled={!model.folders.length} onClick={() => { model.setSearch(""); setCollapsed(model.folders.map((folder) => folder.id)); }}><FoldVertical size={14} /></button>
    </div>
    <div ref={list} className="notes-list" aria-label="Notes list" onClick={(event) => { if (event.target === event.currentTarget) model.setCreationFolder(""); }}>
      {[{ folder: { id: "", name: "Unfiled", parentId: "" }, depth: 0 }, ...orderedFolders(model.folders)].filter(({ folder }) => {
        if (!query) return !folderAncestors(model.folders, folder.id).some((id) => collapsed.includes(id));
        return matchingFolder(folder.id) || visibleNotes.some((note) => (note.folderId ?? "") === folder.id || folderAncestors(model.folders, note.folderId ?? "").includes(folder.id));
      }).map(({ folder, depth }) => <div key={folder.id} role="group" aria-label={`Note folder ${folder.name}`} data-note-folder={folder.id} className={`notes-folder ${drop === folder.id ? "notes-folder-drop" : ""}`} style={{ marginLeft: depth * 14 }}>
        {folder.id && <div className={`folder-heading ${creationFolder === folder.id ? "selected" : ""}`} draggable={false} onMouseDown={(event) => { if (editing !== folder.id) start(event, folder.id, "folder"); }} onClick={(event) => { if (!suppressClick.current && !(event.target as Element).closest(".folder-edit,.folder-delete,input")) model.setCreationFolder(folder.id); }}>
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
