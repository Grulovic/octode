import { expect, it } from "vitest";
import { orderedFolders, folderAncestors, canMoveFolder } from "./apiFolders";
const folders = [{ id: "leaf", name: "Leaf", parentId: "child" }, { id: "root", name: "Root" }, { id: "child", name: "Child", parentId: "root" }, { id: "other", name: "Other" }];
it("orders descendants beneath parents and supplies ancestor chains", () => {
  expect(orderedFolders(folders).map(({ folder, depth }) => [folder.id, depth])).toEqual([["root", 0], ["child", 1], ["leaf", 2], ["other", 0]]);
  expect(folderAncestors(folders, "leaf")).toEqual(["child", "root"]);
});
it("rejects self/descendant moves and nonexistent targets", () => {
  expect(canMoveFolder(folders, "root", "leaf")).toBe(false);
  expect(canMoveFolder(folders, "root", "root")).toBe(false);
  expect(canMoveFolder(folders, "child", "missing")).toBe(false);
  expect(canMoveFolder(folders, "child", "other")).toBe(true);
  expect(canMoveFolder(folders, "child", "")).toBe(true);
});
it("displays orphaned folders and terminates for malformed cycles", () => {
  const malformed = [{ id: "a", name: "A", parentId: "b" }, { id: "b", name: "B", parentId: "a" }, { id: "c", name: "C", parentId: "missing" }];
  expect(orderedFolders(malformed)).toHaveLength(3);
  expect(folderAncestors(malformed, "a")).toEqual(["b"]);
});
