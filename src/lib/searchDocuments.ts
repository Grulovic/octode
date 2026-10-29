import type { SearchEntry } from "./searchEverywhere";
import type { SavedTool, ToolDocument } from "../toolTypes";
// Read live drafts without saving them or copying credentials into the index.
const readers = new Map<string, () => ToolDocument>();
export function registerSearchDocument(
  projectId: string,
  tool: SavedTool,
  read: () => ToolDocument,
) {
  const key = `${projectId}:${tool}`;
  readers.set(key, read);
  return () => {
    if (readers.get(key) === read) readers.delete(key);
  };
}
export function searchDocument(projectId: string, tool: SavedTool) {
  return readers.get(`${projectId}:${tool}`)?.();
}

const lists = new Map<string, SearchEntry[]>();
export function registerSearchList(projectId: string, entries: SearchEntry[]) {
  lists.set(projectId, entries);
  return () => {
    if (lists.get(projectId) === entries) lists.delete(projectId);
  };
}
export const searchList = (projectId: string) => lists.get(projectId) ?? [];
