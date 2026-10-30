// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import { pickNoteFiles, readNoteFiles, readNotePaths } from "./noteFiles";
const native = vi.hoisted(() => ({ invoke: vi.fn(), open: vi.fn() }));
vi.mock("./bridge", () => ({ invoke: native.invoke }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: native.open }));
beforeEach(() => { native.invoke.mockReset(); native.open.mockReset(); });
it("opens files with a native picker and treats cancellation as no notes", async () => {
  native.open.mockResolvedValueOnce(null).mockResolvedValueOnce(["/tmp/a.sql", "/tmp/b.php"]);
  expect(await pickNoteFiles()).toEqual([]);
  expect(await pickNoteFiles()).toEqual(["/tmp/a.sql", "/tmp/b.php"]);
  expect(native.open).toHaveBeenCalledWith({ title: "Open files as notes", multiple: true, directory: false });
});
it("copies filenames and exact text, keeps valid files if another fails, and never writes source files", async () => {
  native.invoke.mockImplementation(async (_command, { path }) => {
    if (path === "/tmp/folder") throw new Error("Not a text file");
    return "select 1;\r\n-- 二\n";
  });
  const result = await readNotePaths(["/tmp/query.sql", "C:\\notes\\scratch.php", "/tmp/folder"]);
  expect(result.notes.map((note) => note.title)).toEqual(["query.sql", "scratch.php"]);
  expect(result.notes.every((note) => note.text === "select 1;\r\n-- 二\n")).toBe(true);
  expect(result.notes[0].id).not.toBe(result.notes[1].id);
  expect(result.errors[0]).toContain("folder");
  expect(native.invoke.mock.calls.every(([command]) => command === "read_import_file")).toBe(true);
});
it("rejects binary, oversized, and excessive file imports", async () => {
  native.invoke.mockResolvedValueOnce("binary\0data").mockResolvedValueOnce("a".repeat(2 * 1024 * 1024 + 1));
  const result = await readNotePaths(["/tmp/binary.dat", "/tmp/huge.txt"]);
  expect(result.notes).toEqual([]);
  expect(result.errors).toHaveLength(2);
  expect(result.errors[0]).toContain("binary file");
  expect(result.errors[1]).toContain("2 MB");
  await expect(readNotePaths(Array.from({ length: 21 }, () => "/tmp/test"))).rejects.toThrow("20 files");
});
it("reads browser-dropped UTF-8 files and reports invalid encoding", async () => {
  const buffer = new TextEncoder().encode("<?php\n// café\n");
  const file = { name: "scratch.php", size: buffer.byteLength, arrayBuffer: async () => buffer.buffer } as File;
  const invalid = { name: "bad.txt", size: 1, arrayBuffer: async () => new Uint8Array([255]).buffer } as File;
  const result = await readNoteFiles([file, invalid]);
  expect(result.notes[0]).toMatchObject({ title: "scratch.php", text: "<?php\n// café\n" });
  expect(result.errors).toHaveLength(1);
});
