// @vitest-environment jsdom
import { expect, it } from "vitest";
import { noteLanguage, noteFilename } from "./notes";
it.each([
  ["scratch.php", "php"], ["queries.sql", "sql"], ["Example.JSON", "json"],
  ["example.ts", "typescript"], ["markup.html", "html"], ["example.php  ", "php"],
  ["My notes", "plaintext"], ["php", "plaintext"], ["SQL", "plaintext"],
  ["note.unknown", "plaintext"], ["query.sql notes", "plaintext"],
])("uses the note title extension: %s", (title, expected) => {
  expect(noteLanguage(title)).toBe(expected);
});

it.each([["scratch.sql", "scratch.sql"], ["Scratch", "Scratch.txt"], ["", "Untitled note.txt"], ["../scratch.php", "scratch.php"]])("suggests a filename for %s", (title, expected) => {
  expect(noteFilename(title)).toBe(expected);
});

import { registerNotesBackup, notesForBackup } from "./notes";
it("includes live note drafts in a detached backup snapshot and skips unloaded providers", () => {
  const notes = [{ id: "draft", title: "Unsaved", text: "latest text" }];
  const stop = registerNotesBackup(() => ({ notes }));
  const snapshot = notesForBackup()!; expect(snapshot.notes[0].text).toBe("latest text");
  notes[0].text = "more editing"; expect(snapshot.notes[0].text).toBe("latest text");
  stop(); expect(notesForBackup()).toBeNull();
  const unloaded = registerNotesBackup(() => null); expect(notesForBackup()).toBeNull(); unloaded();
});
