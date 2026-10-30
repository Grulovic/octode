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
