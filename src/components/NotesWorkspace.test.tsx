// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import NotesWorkspace, { NotesProvider, useNotes } from "./NotesWorkspace";
import { createWorkspaceRuntime } from "../lib/workspaceRegistry";
import { waitForPendingToolSaves } from "../lib/toolSaves";
import type { Note } from "../lib/notes";
const storage = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn(), delete: vi.fn(), export: vi.fn(), readPaths: vi.fn(), readFiles: vi.fn() }));
vi.mock("../lib/noteFiles", () => ({ pickNoteFiles: vi.fn(), readNotePaths: storage.readPaths, readNoteFiles: storage.readFiles }));
vi.mock("../lib/export", () => ({ exportText: storage.export }));
vi.mock("../lib/notes", () => ({ loadNotes: storage.load, saveNote: storage.save, deleteNote: storage.delete, noteLanguage: () => "plaintext", noteFilename: (title: string) => title || "Untitled note.txt" }));
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
    expect(storage.delete).not.toHaveBeenCalled(); expect(model.dirty).toBe(false);
  } finally { confirm.mockRestore(); await act(async () => root.unmount()); host.remove(); }
});
