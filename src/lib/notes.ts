import { desktop, invoke } from "./bridge";
import { language } from "./workspace";
export function noteLanguage(title: string): string {
  const name = title.trim();
  return /\.[a-z0-9]+$/i.test(name) ? language(name) : "plaintext";
}
export function noteFilename(title: string): string {
  const name = title.trim().split(/[\\/]/).at(-1)?.replace(/[\x00-\x1f]/g, "").trim();
  if (!name || name === "." || name === "..") return "Untitled note.txt";
  return /\.[a-z0-9]+$/i.test(name) ? name : `${name}.txt`;
}
export interface Note { id: string; title: string; text: string; folderId?: string }
export interface NoteFolder { id: string; name: string; parentId?: string }
const key = "octode-global-notes";
export async function loadNotes(): Promise<Note[]> {
  if (desktop) return invoke("load_notes");
  const notes: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
  if (!Array.isArray(notes) || !notes.every((note) => note && typeof note.id === "string" && typeof note.title === "string" && typeof note.text === "string")) throw new Error("Could not read saved notes");
  return notes;
}
export async function saveNote(note: Note): Promise<Note> {
  if (desktop) return invoke("save_note", { note });
  const previous = await loadNotes();
  localStorage.setItem(key, JSON.stringify(previous.some((item) => item.id === note.id) ? previous.map((item) => item.id === note.id ? note : item) : [note, ...previous]));
  return { ...note };
}
export async function deleteNote(id: string): Promise<void> {
  if (desktop) return invoke("delete_note", { id });
  const previous = await loadNotes();
  localStorage.setItem(key, JSON.stringify(previous.filter((note) => note.id !== id)));
}

const foldersKey = "octode-global-note-folders";
export async function loadNoteFolders(): Promise<NoteFolder[]> {
  if (desktop) return invoke("load_note_folders");
  const folders: unknown = JSON.parse(localStorage.getItem(foldersKey) ?? "[]");
  if (!Array.isArray(folders) || !folders.every((folder) => folder && typeof folder.id === "string" && typeof folder.name === "string" && (!folder.parentId || typeof folder.parentId === "string"))) throw new Error("Could not read saved note folders");
  return folders;
}
export async function saveNotesWorkspace(folders: NoteFolder[], notes: Note[], note?: Note): Promise<Note | undefined> {
  const locations = notes.map(({ id, folderId }) => ({ id, folderId: folderId ?? "" }));
  if (desktop) return invoke("save_notes_workspace", { folders, locations, note: note ?? null });
  const previous = await loadNotes();
  const next: Note[] = previous.map((item) => ({ ...item, folderId: locations.find((location) => location.id === item.id)?.folderId ?? item.folderId }));
  if (note) {
    const index = next.findIndex((item) => item.id === note.id);
    if (index < 0) next.unshift(note); else next[index] = note;
  }
  localStorage.setItem(key, JSON.stringify(next));
  localStorage.setItem(foldersKey, JSON.stringify(folders));
  return note ? { ...note } : undefined;
}

let backupReader: (() => { notes: Note[]; noteFolders?: NoteFolder[] } | null) | undefined;
export function registerNotesBackup(read: () => { notes: Note[]; noteFolders?: NoteFolder[] } | null) {
  backupReader = read;
  return () => { if (backupReader === read) backupReader = undefined; };
}
export function notesForBackup() { const notes = backupReader?.(); return notes ? structuredClone(notes) : null; }
