import type { Project } from "../types";
import { desktop, invoke, listDirectory, readFile } from "./bridge";
export interface SearchEntry {
  path: string;
  relative: string;
  root: string;
  label: string;
  kind:
    | "file"
    | "class"
    | "function"
    | "server"
    | "database"
    | "request"
    | "folder"
    | "environment"
    | "query"
    | "table";
  target?: {
    tool: "api" | "servers" | "database";
    id: string;
    connectionId?: string;
    schema?: string;
  };
  line: number;
  preview?: string;
}
export interface SearchIndex {
  entries: SearchEntry[];
  truncated: boolean;
}
// Cache just the last workspace; one scan per opening, never one scan per keystroke.
let cached: { key: string; index: SearchIndex } | undefined;
const key = (project: Project) => JSON.stringify([project.id, project.roots]);
export const cachedSearchIndex = (project: Project) =>
  cached?.key === key(project) ? cached.index : undefined;
export async function loadSearchIndex(project: Project): Promise<SearchIndex> {
  let index: SearchIndex;
  if (desktop)
    index = await invoke("search_everywhere_index", { projectId: project.id });
  else {
    const entries: SearchEntry[] = [];
    const visit = async (directory: string, root: string) => {
      for (const file of await listDirectory(project, directory)) {
        if (file.directory) {
          await visit(file.path, root);
          continue;
        }
        const base = {
          path: file.path,
          relative: file.path.slice(root.length + 1),
          root,
        };
        entries.push({ ...base, label: file.name, kind: "file", line: 1 });
        const text = await readFile(project, file.path);
        const pattern =
          /\b(?:(class|interface|trait|enum)\s+([\p{L}_$][\p{L}\p{N}_$]*)|function\s*&?\s*([\p{L}_$][\p{L}\p{N}_$]*)\s*\()/gu;
        for (const match of text.matchAll(pattern))
          entries.push({
            ...base,
            label: match[2] ?? match[3],
            kind: match[2] ? "class" : "function",
            line: text.slice(0, match.index).split("\n").length,
          });
      }
    };
    for (const root of project.roots) await visit(root, root);
    index = { entries, truncated: false };
  }
  cached = { key: key(project), index };
  return index;
}
function matchRank(label: string, query: string): number {
  if (label === query) return 0;
  if (label.startsWith(query)) return 10;
  if (label.includes(query)) return 20;
  let cursor = 0;
  for (const char of label) if (char === query[cursor]) cursor++;
  return cursor === query.length ? 50 : Infinity;
}
const normalize = (value: string) =>
  value.normalize("NFKC").toLocaleLowerCase();
const words = (value: string) =>
  normalize(value.replace(/([a-z0-9])([A-Z])/g, "$1 $2"))
    .split(/[^\p{L}\p{N}_$]+/u)
    .filter(Boolean);
export function matchingEntries(
  entries: SearchEntry[],
  query: string,
  limit = 100,
): SearchEntry[] {
  const terms = [
    ...new Set(normalize(query.trim()).split(/\s+/).filter(Boolean)),
  ];
  // Include declarations in the same file, so folder + class works even when
  // a class name and its filename differ. Compute this once for each search.
  const symbols = new Map<string, string[]>();
  for (const entry of entries)
    if (entry.kind !== "file") {
      const labels = symbols.get(entry.path) ?? [];
      labels.push(normalize(entry.label));
      symbols.set(entry.path, labels);
    }
  return entries
    .map((entry) => {
      const label = normalize(entry.label);
      const location = normalize(`${entry.relative} ${entry.root}`).replaceAll(
        "\\",
        "/",
      );
      const segments = words(
        entry.relative + " " + entry.root.split(/[\\/]/).pop(),
      );
      const declarations = symbols.get(entry.path) ?? [];
      let rank = 0;
      for (const term of terms) {
        const labelRank = matchRank(label, term);
        const pathRank = segments.includes(term)
          ? 30
          : segments.some((segment) => segment.startsWith(term))
            ? 35
            : location.includes(term)
              ? 40
              : Infinity;
        const symbolRank = declarations.some((name) => name.includes(term))
          ? 45
          : Infinity;
        const best = Math.min(labelRank, pathRank, symbolRank);
        if (!Number.isFinite(best)) return null;
        // Prefer results supported by several fields, while preserving stronger
        // exact/prefix matches. Every query term must match somewhere.
        const evidence =
          Number(Number.isFinite(labelRank)) +
          Number(Number.isFinite(pathRank)) +
          Number(Number.isFinite(symbolRank));
        rank += best - (evidence - 1) * 0.5;
      }
      return { entry, rank };
    })
    .filter(
      (value): value is { entry: SearchEntry; rank: number } => value !== null,
    )
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        (a.entry.kind === "file" ? 0 : 1) - (b.entry.kind === "file" ? 0 : 1) ||
        a.entry.label.localeCompare(b.entry.label) ||
        a.entry.path.localeCompare(b.entry.path) ||
        a.entry.line - b.entry.line,
    )
    .slice(0, limit)
    .map((value) => value.entry);
}
