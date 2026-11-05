// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import NotesWorkspace, { NotesProvider, useNotes } from "./NotesWorkspace";
import { createWorkspaceRuntime } from "../lib/workspaceRegistry";
import { waitForPendingToolSaves } from "../lib/toolSaves";
import type { Note } from "../lib/notes";
const storage = vi.hoisted(() => ({ layout: vi.fn(), load: vi.fn(), save: vi.fn(), delete: vi.fn(), export: vi.fn(), readPaths: vi.fn(), readFiles: vi.fn() }));
vi.mock("../lib/noteFiles", () => ({ pickNoteFiles: vi.fn(), readNotePaths: storage.readPaths, readNoteFiles: storage.readFiles }));
vi.mock("../lib/export", () => ({ exportText: storage.export }));
vi.mock("../lib/notes", () => ({ loadNotes: storage.load, loadNoteFolders: async () => [], saveNotesWorkspace: async (folders: unknown, notes: unknown, note: Note) => { storage.layout(folders, notes, note); return note ? storage.save(note) : undefined; }, registerNotesBackup: () => () => {}, saveNote: storage.save, deleteNote: storage.delete, noteLanguage: () => "plaintext", noteFilename: (title: string) => title || "Untitled note.txt" }));
vi.mock("./PreviewEditor", () => ({ default: () => <div>Plain text editor</div> }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
it("keeps all note drafts globally and only acknowledges the version explicitly saved", async () => {
  storage.load.mockResolvedValue([]);
  let finish: (note: Note) => void = () => {};
  storage.save.mockImplementation((note: Note) => new Promise<Note>((resolve) => { finish = () => resolve(note); }));
  const runtime = createWorkspaceRuntime();
  let model!: ReturnType<typeof useNotes>;
  function Harness() { model = useNotes(); return <NotesWorkspace />; }
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<NotesProvider runtime={runtime}><Harness /></NotesProvider>));
    await act(async () => model.create());
    await act(async () => model.update({ title: "Scratch", text: "one\ntwo" }));
    const first = model.active;
    expect(storage.save).not.toHaveBeenCalled();
    expect(runtime.hasUnsavedSettings()).toBe(true);
    let pending!: Promise<boolean>;
    await act(async () => { pending = model.save(); });
    await act(async () => model.update({ text: "one\ntwo\nthree" }));
    await act(async () => { finish(storage.save.mock.calls[0][0]); await pending; });
    expect(model.note?.text).toBe("one\ntwo\nthree");
    expect(model.dirty).toBe(true);
    expect(runtime.hasUnsavedSettings()).toBe(true);
    storage.save.mockImplementation(async (note) => note);
    await act(async () => { await model.save(); });
    expect(runtime.hasUnsavedSettings()).toBe(false);
    await act(async () => model.create());
    await act(async () => model.update({ title: "Second", text: "another" }));
    await act(async () => model.setActive(first));
    expect(model.note?.title).toBe("Scratch");
    expect(model.note?.text).toBe("one\ntwo\nthree");
    expect(model.notes).toHaveLength(2);
    expect(runtime.hasUnsavedSettings()).toBe(true);
    expect(await waitForPendingToolSaves()).toBe(true);
  } finally { await act(async () => root.unmount()); host.remove(); }
});
it("retains drafts and reports a failed save so it can be retried", async () => {
  storage.load.mockResolvedValue([]); storage.save.mockRejectedValue(new Error("Disk full"));
  const runtime = createWorkspaceRuntime();
  let model!: ReturnType<typeof useNotes>;
  function Harness() { model = useNotes(); return <NotesWorkspace />; }
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<NotesProvider runtime={runtime}><Harness /></NotesProvider>));
    await act(async () => model.create());
    await act(async () => model.update({ text: "keep me" }));
    await act(async () => { expect(await model.save()).toBe(false); });
    expect(model.note?.text).toBe("keep me");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Disk full");
    await act(async () => (host.querySelector('[aria-label="Dismiss note error"]') as HTMLButtonElement).click());
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(model.note?.text).toBe("keep me");
    expect(runtime.hasUnsavedSettings()).toBe(true);
    storage.save.mockImplementation(async (note) => note);
    await act(async () => { expect(await model.save()).toBe(true); });
    expect(runtime.hasUnsavedSettings()).toBe(false);
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it("Save as exports the current draft without marking the app note saved", async () => {
  storage.load.mockResolvedValue([]); storage.save.mockClear(); storage.export.mockResolvedValue("/tmp/scratch.sql");
  const runtime = createWorkspaceRuntime();
  let model!: ReturnType<typeof useNotes>;
  function Harness() { model = useNotes(); return <NotesWorkspace />; }
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<NotesProvider runtime={runtime}><Harness /></NotesProvider>));
    await act(async () => model.create());
    await act(async () => model.update({ title: "scratch.sql", text: "select 1;" }));
    const saveAs = host.querySelector<HTMLButtonElement>(".notes-save-as")!;
    await act(async () => saveAs.click());
    expect(storage.export).toHaveBeenCalledWith("select 1;", "scratch.sql", "Save note as");
    expect(storage.save).not.toHaveBeenCalled();
    expect(model.dirty).toBe(true);
    storage.export.mockRejectedValue(new Error("Disk full"));
    await act(async () => saveAs.click());
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Disk full");
    expect(model.note?.text).toBe("select 1;");
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it("opens selected files and drops file copies without overwriting the current draft or saving implicitly", async () => {
  storage.load.mockResolvedValue([]); storage.save.mockClear();
  const runtime = createWorkspaceRuntime();
  let model!: ReturnType<typeof useNotes>;
  function Harness() { model = useNotes(); return <NotesWorkspace />; }
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<NotesProvider runtime={runtime}><Harness /></NotesProvider>));
    await act(async () => { model.setVisible(true); model.create(); });
    await act(async () => model.update({ title: "Existing", text: "keep this draft" }));
    const old = model.active;
    storage.readFiles.mockResolvedValueOnce({ notes: [{ id: "imported-1", title: "query.sql", text: "select 1;" }], errors: [] });
    const picker = host.querySelector<HTMLInputElement>('[aria-label="Open note files"]')!;
    const open = [...host.querySelectorAll<HTMLButtonElement>(".notes-file-actions button")].find((button) => button.textContent === "Open")!;
    const showPicker = vi.spyOn(picker, "click");
    await act(async () => open.click());
    expect(showPicker).toHaveBeenCalledOnce();
    Object.defineProperty(picker, "files", { value: [new File(["select 1;"], "query.sql")] });
    await act(async () => picker.dispatchEvent(new Event("change", { bubbles: true })));
    expect(model.note).toMatchObject({ title: "query.sql", text: "select 1;" });
    expect(model.notes.find((note) => note.id === old)?.text).toBe("keep this draft");
    storage.readFiles.mockResolvedValueOnce({ notes: [{ id: "imported-2", title: "scratch.php", text: "<?php echo 1;" }], errors: [] });
    const drop = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(drop, "dataTransfer", { value: { types: ["Files"], files: [new File(["<?php echo 1;"], "scratch.php")], getData: () => "" } });
    const child = host.querySelector<HTMLElement>(".notes-editor > div")!;
    const childDrop = vi.fn(); child.addEventListener("drop", childDrop);
    await act(async () => child.dispatchEvent(drop));
    expect(drop.defaultPrevented).toBe(true);
    expect(childDrop).not.toHaveBeenCalled();
    expect(model.note).toMatchObject({ title: "scratch.php", text: "<?php echo 1;" });
    expect(model.notes).toHaveLength(3);
    expect(storage.save).not.toHaveBeenCalled();
    expect(runtime.hasUnsavedSettings()).toBe(true);
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it("deletes persisted notes only after confirmation and retains notes on failure", async () => {
  const one = { id: "one", title: "First", text: "keep until confirmed" };
  const two = { id: "two", title: "Second", text: "other" };
  storage.load.mockResolvedValue([one, two]); storage.delete.mockReset().mockResolvedValue(undefined);
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  let model!: ReturnType<typeof useNotes>;
  function Harness() { model = useNotes(); return <NotesWorkspace />; }
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<NotesProvider runtime={createWorkspaceRuntime()}><Harness /></NotesProvider>));
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Delete note First"]')!.click());
    expect(storage.delete).not.toHaveBeenCalled(); expect(model.notes).toHaveLength(2);
    confirm.mockReturnValue(true); storage.delete.mockRejectedValueOnce(new Error("Disk failure"));
    await act(async () => { expect(await model.remove("one")).toBe(false); });
    expect(model.note).toEqual(one); expect(model.error).toContain("Disk failure");
    await act(async () => { expect(await model.remove("one")).toBe(true); });
    expect(storage.delete).toHaveBeenLastCalledWith("one"); expect(model.note).toEqual(two);
    await act(async () => { await model.remove("two"); });
    expect(model.notes).toEqual([]); expect(model.note).toBeUndefined();
    storage.delete.mockClear();
    await act(async () => model.create());
    await act(async () => { await model.remove(model.active); });
    expect(storage.delete).toHaveBeenCalledOnce(); expect(model.dirty).toBe(false);
  } finally { confirm.mockRestore(); await act(async () => root.unmount()); host.remove(); }
});
it("toggles Markdown preview beside wrap without changing or saving the draft", async () => {
  storage.load.mockResolvedValue([]); storage.save.mockClear();
  let model!: ReturnType<typeof useNotes>;
  function Harness() { model = useNotes(); return <NotesWorkspace />; }
  const host = document.createElement("div"); const root = createRoot(host);
  try {
    await act(async () => root.render(<NotesProvider runtime={createWorkspaceRuntime()}><Harness /></NotesProvider>));
    await act(async () => model.create());
    await act(async () => model.update({ title: "Scratch", text: "# Preview\n\n**Hello**" }));
    const toggle = host.querySelector<HTMLButtonElement>('[aria-label="Markdown preview"]')!;
    expect(toggle.previousElementSibling?.getAttribute("aria-label")).toBe("Word wrap");
    await act(async () => toggle.click());
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(host.querySelector('[aria-label="Markdown formatting"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="Bold"]')).not.toBeNull();
    await act(async () => Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent === "Preview")!.click());
    expect(host.querySelector("article h1")?.textContent).toBe("Preview");
    expect(host.querySelector("article strong")?.textContent).toBe("Hello");
    await act(async () => toggle.click());
    expect(host.querySelector("article")).toBeNull();
    expect(model.note?.text).toBe("# Preview\n\n**Hello**"); expect(model.dirty).toBe(true);
    expect(storage.save).not.toHaveBeenCalled();
  } finally { await act(async () => root.unmount()); }
});

it("searches note titles and contents and deletes notes after confirmation", async () => {
  storage.load.mockResolvedValue([{ id: "one", title: "query.sql", text: "select rooms" }, { id: "two", title: "Shopping", text: "buy milk" }]);
  storage.save.mockImplementation(async (note) => note); storage.delete.mockResolvedValue(undefined);
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
  let model!: ReturnType<typeof useNotes>;
  function Harness() { model = useNotes(); return <NotesWorkspace />; }
  const host = document.createElement("div"); const root = createRoot(host);
  try {
    await act(async () => root.render(<NotesProvider runtime={createWorkspaceRuntime()}><Harness /></NotesProvider>));
    await act(async () => model.setSearch("ROOMS"));
    expect(host.querySelector('.notes-list')?.textContent).toContain("query.sql"); expect(host.querySelector('.notes-list')?.textContent).not.toContain("Shopping");
    await act(async () => model.setSearch("Shopping")); expect(host.querySelector('.notes-list')?.textContent).toContain("buy milk");
    await act(async () => { model.setSearch(""); model.setActive("one"); });
    await act(async () => model.update({ text: "latest unsaved draft" }));
    await act(async () => { await model.remove("one"); });
    expect(storage.delete).toHaveBeenCalledWith("one");
    expect(model.notes.some((note) => note.id === "one")).toBe(false);
    expect(host.querySelector('[aria-label="Restore note query.sql"]')).toBeNull();
  } finally { confirm.mockRestore(); await act(async () => root.unmount()); }
});

it("reloads Notes after Replace while Merge preserves existing live drafts", async () => {
  storage.load.mockResolvedValue([{ id: "old", title: "Existing", text: "saved" }]);
  const runtime = createWorkspaceRuntime();
  let model!: ReturnType<typeof useNotes>;
  function Harness() { model = useNotes(); return <NotesWorkspace />; }
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<NotesProvider runtime={runtime}><Harness /></NotesProvider>));
    await act(async () => { model.update({ text: "live draft" }); model.setFolders([{ id: "draft-folder", name: "Unsaved folder", parentId: "" }]); });
    storage.load.mockResolvedValue([{ id: "copy", title: "Imported", text: "copy" }, { id: "old", title: "Existing", text: "saved" }]);
    await act(async () => window.dispatchEvent(new CustomEvent("octode-app-data-imported", { detail: { mode: "merge" } })));
    expect(model.notes.find((note) => note.id === "old")?.text).toBe("live draft");
    expect(model.folders).toEqual([{ id: "draft-folder", name: "Unsaved folder", parentId: "" }]);
    storage.load.mockResolvedValue([{ id: "replacement", title: "Restored", text: "backup" }]);
    await act(async () => window.dispatchEvent(new CustomEvent("octode-app-data-imported", { detail: { mode: "replace" } })));
    expect(model.notes).toEqual([{ id: "replacement", title: "Restored", text: "backup" }]);
    expect(model.active).toBe("replacement");
    expect(model.folders).toEqual([]);
    expect(runtime.hasUnsavedSettings()).toBe(false);
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it("keeps folder changes pending, preserves other note drafts on Save, and exposes collapsed search matches", async () => {
  const one = { id: "one", title: "First", text: "saved" };
  const two = { id: "two", title: "Second", text: "saved too" };
  storage.load.mockResolvedValue([one, two]); storage.save.mockReset().mockImplementation(async (note) => note);
  let model!: ReturnType<typeof useNotes>;
  function Harness() { model = useNotes(); return <NotesWorkspace />; }
  const runtime = createWorkspaceRuntime();
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<NotesProvider runtime={runtime}><Harness /></NotesProvider>));
    await act(async () => {
      model.setFolders([{ id: "work", name: "Work", parentId: "" }, { id: "sql", name: "SQL", parentId: "work" }]);
      model.update({ folderId: "sql", text: "unsaved SQL draft" });
    });
    await act(async () => model.setActive("two"));
    expect(runtime.hasUnsavedSettings()).toBe(true);
    expect(storage.save).not.toHaveBeenCalled();
    await act(async () => { expect(await model.save()).toBe(true); });
    expect(model.layoutDirty).toBe(false);
    expect(model.notes.find((note) => note.id === "one")?.text).toBe("unsaved SQL draft");
    expect(model.isDirty(model.notes.find((note) => note.id === "one")!)).toBe(true);
    // Saving the tree must not save the other note's body.
    expect(storage.save).not.toHaveBeenCalled();
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Collapse all folders"]')!.click());
    expect(host.querySelector('[aria-label="Collapse folder SQL"]')).toBeNull();
    expect(host.querySelector('.notes-list')?.textContent).not.toContain("First");
    await act(async () => model.setSearch("SQL"));
    expect(host.querySelector('.notes-list')?.textContent).toContain("First");
    await act(async () => model.setSearch(""));
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Expand folder Work"]')!.click());
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Remove folder Work"]')!.click());
    expect(model.folders).toEqual([{ id: "sql", name: "SQL", parentId: "" }]);
    expect(model.notes).toHaveLength(2);
    expect(model.layoutDirty).toBe(true);
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it("creates nested folders from the API-style toolbar and can save an empty folder tree", async () => {
  storage.load.mockResolvedValue([]); storage.save.mockClear();
  let model!: ReturnType<typeof useNotes>;
  function Harness() { model = useNotes(); return <NotesWorkspace />; }
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<NotesProvider runtime={createWorkspaceRuntime()}><Harness /></NotesProvider>));
    const select = host.querySelector<HTMLSelectElement>('select[aria-label="Add note or folder"]')!;
    await act(async () => { select.value = "folder"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    const first = model.folders[0].id;
    await act(async () => host.querySelector<HTMLInputElement>('[aria-label="Folder name"]')!.blur());
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="New subfolder in New folder"]')!.click());
    expect(model.folders[0].parentId).toBe(first);
    expect(model.creationFolder).toBe(model.folders[0].id);
    await act(async () => host.querySelector<HTMLInputElement>('[aria-label="Folder name"]')!.blur());
    expect(model.dirty).toBe(true);
    await act(async () => { expect(await model.save()).toBe(true); });
    expect(model.dirty).toBe(false);
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it("Cmd/Ctrl+N creates a draft in the selected folder only while Notes is active", async () => {
  storage.load.mockResolvedValue([{ id: "saved", title: "Existing", text: "saved text", folderId: "" }]);
  storage.save.mockClear();
  let model!: ReturnType<typeof useNotes>;
  function Harness() { model = useNotes(); return <NotesWorkspace />; }
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  const press = (options: KeyboardEventInit = {}) => window.dispatchEvent(new KeyboardEvent("keydown", { key: "n", metaKey: true, bubbles: true, cancelable: true, ...options }));
  try {
    await act(async () => root.render(<NotesProvider runtime={createWorkspaceRuntime()}><Harness /></NotesProvider>));
    await act(async () => press());
    expect(model.notes).toHaveLength(1);
    await act(async () => {
      model.setVisible(true);
      model.setFolders([{ id: "work", name: "Work", parentId: "" }]);
      model.setCreationFolder("work");
      model.update({ text: "keep this draft" });
    });
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Collapse all folders"]')!.click());
    await act(async () => press());
    expect(model.note).toMatchObject({ title: "", text: "", folderId: "work" });
    expect(model.notes.find((note) => note.id === "saved")?.text).toBe("keep this draft");
    expect(host.querySelector('[aria-label="Collapse folder Work"]')).not.toBeNull();
    expect(storage.save).not.toHaveBeenCalled();
    await act(async () => { press({ repeat: true }); press({ shiftKey: true }); press({ isComposing: true }); });
    expect(model.notes).toHaveLength(2);
    const modal = document.createElement("div"); modal.setAttribute("aria-modal", "true"); host.append(modal);
    await act(async () => press());
    expect(model.notes).toHaveLength(2); modal.remove();
    await act(async () => press({ metaKey: false, ctrlKey: true }));
    expect(model.notes).toHaveLength(3);
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it("duplicates the current draft into the same folder without saving", async () => {
  storage.load.mockResolvedValue([{ id: "original", title: "query.sql", text: "select 1;", folderId: "folder" }]);
  storage.save.mockClear();
  let model!: ReturnType<typeof useNotes>;
  function Harness() { model = useNotes(); return <NotesWorkspace />; }
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<NotesProvider runtime={createWorkspaceRuntime()}><Harness /></NotesProvider>));
    await act(async () => { model.setFolders([{ id: "folder", name: "Queries", parentId: "" }]); model.update({ text: "select 2;" }); });
    await act(async () => (host.querySelector('[aria-label="Duplicate note query.sql"]') as HTMLButtonElement).click());
    expect(model.notes).toHaveLength(2);
    expect(model.note).toMatchObject({ title: "query.sql", text: "select 2;", folderId: "folder" });
    expect(model.active).not.toBe("original");
    expect(model.isDirty(model.note!)).toBe(true);
    expect(storage.save).not.toHaveBeenCalled();
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it("autosaves dragged note and folder order while leaving edited note text unsaved", async () => {
  localStorage.removeItem("octode-layout:notes-collapsed");
  storage.load.mockResolvedValue([{ id: "a", title: "A", text: "saved", folderId: "work" }, { id: "b", title: "B", text: "other", folderId: "work" }]);
  storage.save.mockClear(); storage.layout.mockClear();
  let model!: ReturnType<typeof useNotes>;
  function Harness() { model = useNotes(); return <NotesWorkspace />; }
  const runtime = createWorkspaceRuntime();
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  const original = document.elementFromPoint;
  const settle = async () => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 450)); }); };
  const drag = async (source: Element, target: Element, y = 39) => {
    document.elementFromPoint = () => target;
    await act(async () => {
      source.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, clientX: 1, clientY: 1 }));
      window.dispatchEvent(new MouseEvent("mousemove", { clientX: 100, clientY: y }));
      window.dispatchEvent(new MouseEvent("mouseup", { clientX: 100, clientY: y }));
    });
  };
  try {
    await act(async () => root.render(<NotesProvider runtime={runtime}><Harness /></NotesProvider>));
    await act(async () => model.setFolders([{ id: "work", name: "Work" }, { id: "personal", name: "Personal" }, { id: "child", name: "Child", parentId: "work" }]));
    await settle();
    expect(model.layoutDirty).toBe(false);
    storage.layout.mockClear();
    await act(async () => model.update({ title: "Draft title", text: "unsaved text" }));
    await settle();
    expect(storage.layout).not.toHaveBeenCalled();
    await drag(host.querySelector('[data-note-id="a"]')!, host.querySelector('[data-note-id="b"]')!);
    expect(model.notes.map((note) => note.id)).toEqual(["b", "a"]);
    await settle();
    expect(model.layoutDirty).toBe(false);
    expect(storage.layout.mock.calls.at(-1)?.[2]).toBeUndefined();
    expect(storage.save).not.toHaveBeenCalled();
    expect(model.notes.find((note) => note.id === "a")?.text).toBe("unsaved text");
    const work = host.querySelector('[data-note-folder="work"] > .folder-heading')!;
    const personal = host.querySelector('[data-note-folder="personal"] > .folder-heading')!;
    vi.spyOn(personal, "getBoundingClientRect").mockReturnValue({ top: 0, bottom: 40, height: 40 } as DOMRect);
    await drag(work, personal);
    expect(model.folders.map((folder) => folder.id)).toEqual(["personal", "work", "child"]);
    expect(model.folders.find((folder) => folder.id === "child")?.parentId).toBe("work");
    // Flush on quit/restart must also include a layout waiting for its debounce.
    await act(async () => runtime.flushAllLayouts());
    expect(model.layoutDirty).toBe(false);
    expect(storage.save).not.toHaveBeenCalled();
    expect(runtime.hasUnsavedSettings()).toBe(true);
    const child = host.querySelector('[data-note-folder="child"] > .folder-heading')!;
    vi.spyOn(child, "getBoundingClientRect").mockReturnValue({ top: 0, bottom: 40, height: 40 } as DOMRect);
    await drag(work, child, 20);
    expect(model.folders.find((folder) => folder.id === "work")?.parentId ?? "").toBe("");
  } finally { document.elementFromPoint = original; await act(async () => root.unmount()); host.remove(); }
});

it("retains a failed automatic folder save and retries without saving note text", async () => {
  storage.load.mockResolvedValue([{ id: "a", title: "A", text: "saved" }]);
  storage.layout.mockReset().mockImplementationOnce(() => { throw new Error("Disk full"); });
  storage.save.mockClear();
  let model!: ReturnType<typeof useNotes>;
  function Harness() { model = useNotes(); return <NotesWorkspace />; }
  const runtime = createWorkspaceRuntime();
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<NotesProvider runtime={runtime}><Harness /></NotesProvider>));
    await act(async () => { model.setFolders([{ id: "folder", name: "New folder" }]); model.update({ text: "unsaved" }); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 450)); });
    expect(model.layoutSaveFailed).toBe(true);
    expect(model.error).toContain("Disk full");
    expect(runtime.hasUnsavedSettings()).toBe(true);
    expect(storage.layout).toHaveBeenCalledTimes(1);
    await act(async () => { expect(await model.retryLayout()).toBe(true); });
    expect(model.layoutDirty).toBe(false);
    expect(model.notes[0].text).toBe("unsaved");
    expect(storage.save).not.toHaveBeenCalled();
  } finally { storage.layout.mockReset(); await act(async () => root.unmount()); host.remove(); }
});
