import type { ApiDocument } from "../toolTypes";
import { canMoveFolder } from "./apiFolders";
import { moveTab } from "../hooks/useTabReorder";

export type ApiDrag = { id: string; kind?: "folder" };
export type ApiDrop = { id: string; kind: "request" | "folder"; edge: "before" | "after" | "inside" };

// Also applies to the saved baseline, so layout saves never include request drafts.
export function placeApiItem(doc: ApiDocument, source: ApiDrag, target: ApiDrop): ApiDocument {
  if (source.kind === "folder") {
    if (target.kind !== "folder") return doc;
    const destination = doc.folders.find((folder) => folder.id === target.id);
    if (target.edge !== "inside" && !destination) return doc;
    const parentId = target.edge === "inside" ? target.id : destination?.parentId ?? "";
    if (!canMoveFolder(doc.folders, source.id, parentId) || source.id === target.id) return doc;
    const folders = doc.folders.map((folder) => folder.id === source.id ? { ...folder, parentId } : folder);
    return { ...doc, folders: target.edge === "inside" ? folders : moveTab(folders, source.id, target.id, target.edge === "after", (folder) => folder.id) };
  }
  if (!doc.requests.some((request) => request.id === source.id)) return doc;
  const destination = doc.requests.find((request) => request.id === target.id);
  if (target.edge !== "inside" && (target.kind !== "request" || !destination || target.id === source.id)) return doc;
  const folderId = target.edge === "inside" ? target.id : destination!.folderId;
  if (folderId && !doc.folders.some((folder) => folder.id === folderId)) return doc;
  const requests = doc.requests.map((request) => request.id === source.id ? { ...request, folderId } : request);
  return { ...doc, requests: target.edge === "inside" ? requests : moveTab(requests, source.id, target.id, target.edge === "after", (request) => request.id) };
}
