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
export interface Note { id: string; title: string; text: string }
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
