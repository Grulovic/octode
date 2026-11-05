import { expect, it } from "vitest";
import { apiDocument, apiRequest } from "./toolDefaults";
import { placeApiItem } from "./apiOrdering";

it("sorts requests across folders while preserving their IDs and content", () => {
  const a = { ...apiRequest(), name: "A", folderId: "one" }, b = { ...apiRequest(), name: "B", folderId: "two" };
  const doc = { ...apiDocument(), folders: [{ id: "one", name: "One" }, { id: "two", name: "Two" }], requests: [a, b] };
  const result = placeApiItem(doc, { id: a.id }, { id: b.id, kind: "request", edge: "after" });
  expect(result.requests.map((request) => request.id)).toEqual([b.id, a.id]);
  expect(result.requests[1]).toEqual({ ...a, folderId: "two" });
  expect(placeApiItem(doc, { id: "unsaved" }, { id: b.id, kind: "request", edge: "after" })).toBe(doc);
});
it("sorts sibling folders with their descendants and rejects cycles", () => {
  const doc = { ...apiDocument(), folders: [{ id: "one", name: "One" }, { id: "child", name: "Child", parentId: "one" }, { id: "two", name: "Two" }] };
  const result = placeApiItem(doc, { id: "one", kind: "folder" }, { id: "two", kind: "folder", edge: "after" });
  expect(result.folders.map((folder) => folder.id)).toEqual(["child", "two", "one"]);
  expect(result.folders.find((folder) => folder.id === "child")?.parentId).toBe("one");
  expect(placeApiItem(doc, { id: "one", kind: "folder" }, { id: "child", kind: "folder", edge: "inside" })).toBe(doc);
});
