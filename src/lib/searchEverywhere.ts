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
  value.normalize("NFKC").toLocaleLowerCase().replaceAll("\\", "/");
const words = (value: string) =>
  normalize(
    value
      .replace(/([A-Z])([A-Z][a-z])/g, "$1 $2")
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2"),
  )
    .split(/[^\p{L}\p{N}_$]+/u)
    .filter(Boolean);
const categoryOrder: Record<SearchEntry["kind"], number> = {
  file: 0,
  class: 1,
  server: 2,
  database: 3,
  query: 3,
  table: 3,
  request: 4,
  folder: 4,
  environment: 4,
  function: 5,
};
export function matchingEntries(
  entries: SearchEntry[],
  query: string,
  limit = 100,
): SearchEntry[] {
  // Unquoted terms can span names, folders and extensions in any order.
  // Quotes keep a multiword name together; slash/backslash paths also work.
  const terms = [...query.matchAll(/"([^"]+)"|'([^']+)'|(\S+)/gu)]
    .flatMap((match) => {
      const phrase = match[1] ?? match[2];
      if (phrase !== undefined)
        return [{ text: normalize(phrase), phrase: true, path: false }];
      const token = normalize(match[3]);
      if (token.endsWith("/"))
        return [{ text: token, phrase: false, path: true }];
      return token.split(/[/:.]+/u).filter(Boolean)
        .map((text) => ({ text, phrase: false, path: false }));
    })
    .filter((term, i, all) => all.findIndex((other) =>
      other.text === term.text && other.phrase === term.phrase && other.path === term.path,
    ) === i);
  // Include declarations in the same file, so folder + class works even when
  // a class name and its filename differ. Compute this once for each search.
  const symbols = new Map<string, string[]>();
  for (const entry of entries)
    if (entry.kind === "class" || entry.kind === "function") {
      const labels = symbols.get(entry.path) ?? [];
      labels.push(normalize(entry.label));
      symbols.set(entry.path, labels);
    }
  return entries
    .map((entry) => {
      const label = normalize(entry.label);
      const stem = entry.kind === "file" ? label.replace(/\.[^.]+$/, "") : label;
      const labelWords = words(entry.label);
      // Search the workspace folder, not ancestors such as macOS /Users,
      // which otherwise makes "user" match every file in every project.
      const rootName = entry.root.split(/[\\/]/).filter(Boolean).pop() ?? "";
      const location = normalize(`${rootName}/${entry.relative}`);
      const segments = words(entry.relative + " " + rootName);
      // A file can be found by its declarations, but a symbol must match its
      // own name/location, never borrow an unrelated sibling declaration.
      const declarations = entry.kind === "file"
        ? symbols.get(entry.path) ?? []
        : [];
      let rank = 0;
      for (const term of terms) {
        const labelRank = term.path
          ? Infinity
          : term.phrase
            ? label.includes(term.text) ? (label === term.text ? 0 : 20) : Infinity
            : Math.min(
                matchRank(label, term.text),
                matchRank(stem, term.text),
                labelWords.includes(term.text) ? 15 : Infinity,
              );
        const pathRank = !term.phrase && segments.includes(term.text)
          ? 30
          : !term.phrase && segments.some((segment) => segment.startsWith(term.text))
            ? 35
            : location.includes(term.text)
              ? 40
              : Infinity;
        const symbolRank = !term.path && declarations.some((name) => name.includes(term.text))
          ? 45
          : Infinity;
        const best = Math.min(labelRank, pathRank, symbolRank);
        if (!Number.isFinite(best)) return null;
        // Repeated occurrences don't make a weaker name outrank an exact one.
        // Every term must match; a fuzzy abbreviation is only a fallback.
        rank += best;
      }
      return { entry, rank };
    })
    .filter(
      (value): value is { entry: SearchEntry; rank: number } => value !== null,
    )
    .sort(
      (a, b) =>
        categoryOrder[a.entry.kind] - categoryOrder[b.entry.kind] ||
        a.rank - b.rank ||
        a.entry.label.length - b.entry.label.length ||
        a.entry.label.localeCompare(b.entry.label) ||
        a.entry.path.localeCompare(b.entry.path) ||
        a.entry.line - b.entry.line,
    )
    .slice(0, limit)
    .map((value) => value.entry);
}
