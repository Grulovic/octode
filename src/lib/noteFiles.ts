import { invoke } from "./bridge";
import { filename } from "./workspace";
import type { Note } from "./notes";
const maxBytes = 2 * 1024 * 1024;
function copy(name: string, text: string): Note {
  if (name.length > 200) throw new Error("Filename exceeds the 200-character note title limit");
  if (new TextEncoder().encode(text).length > maxBytes) throw new Error("Choose a text file no larger than 2 MB");
  if (text.includes("\0")) throw new Error("This appears to be a binary file; choose a text file");
  return { id: crypto.randomUUID(), title: name, text };
}
export async function pickNoteFiles(): Promise<string[]> {
  const paths = await (await import("@tauri-apps/plugin-dialog")).open({ title: "Open files as notes", multiple: true, directory: false });
  return paths === null ? [] : Array.isArray(paths) ? paths : [paths];
}
async function readCopies<T>(files: T[], name: (file: T) => string, read: (file: T) => Promise<string>) {
  if (files.length > 20) throw new Error("Open up to 20 files at a time");
  const notes: Note[] = [], errors: string[] = [];
  for (const file of files) {
    try { notes.push(copy(name(file), await read(file))); }
    catch (reason) { errors.push(`${name(file)}: ${String(reason)}`); }
  }
  return { notes, errors };
}
export function readNotePaths(paths: string[]) {
  return readCopies(paths, filename, (path) => invoke<string>("read_import_file", { path }));
}
export function readNoteFiles(files: File[]) {
  return readCopies(files, (file) => file.name, async (file) => {
    if (file.size > maxBytes) throw new Error("Choose a text file no larger than 2 MB");
    return new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
  });
}
