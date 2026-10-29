import { loadTool } from "./toolsBridge";
import { searchDocument, searchList } from "./searchDocuments";
import { apiDocument, serverDocument, databaseDocument } from "./toolDefaults";
import type {
  ApiDocument,
  ServerDocument,
  DatabaseDocument,
} from "../toolTypes";
import type { Project } from "../types";
import type { SearchEntry } from "./searchEverywhere";
export async function loadSectionEntries(
  project: Project,
): Promise<{ entries: SearchEntry[]; errors: string[] }> {
  const results = await Promise.allSettled([
    searchDocument(project.id, "api") ?? loadTool(project, "api", apiDocument),
    searchDocument(project.id, "servers") ??
      loadTool(project, "servers", serverDocument),
    searchDocument(project.id, "database") ??
      loadTool(project, "database", databaseDocument),
  ]);
  const entries: SearchEntry[] = [...searchList(project.id)],
    errors: string[] = [];
  const add = (
    tool: "api" | "servers" | "database",
    kind: SearchEntry["kind"],
    id: string,
    label: string,
    location: string,
    connectionId?: string,
  ) =>
    entries.push({
      path: `${tool}:${kind}:${id}`,
      label,
      relative: location,
      root:
        tool === "api" ? "API" : tool === "servers" ? "Servers" : "Database",
      kind,
      line: 1,
      target: { tool, id, connectionId },
    });
  results.forEach((result, i) => {
    if (result.status === "rejected")
      errors.push(
        `Could not search ${["API", "Servers", "Database"][i]}: ${String(result.reason)}`,
      );
  });
  if (results[0].status === "fulfilled") {
    const doc = results[0].value as ApiDocument;
    for (const item of doc.requests)
      add(
        "api",
        "request",
        item.id,
        item.name,
        `${item.method} / ${doc.folders.find((f) => f.id === item.folderId)?.name ?? "Requests"}`,
      );
    for (const item of doc.folders)
      add("api", "folder", item.id, item.name, "Request folders");
    for (const item of doc.environments)
      add("api", "environment", item.id, item.name, "Environments");
  }
  if (results[1].status === "fulfilled")
    for (const item of (results[1].value as ServerDocument).connections)
      add("servers", "server", item.id, item.name, "Connections");
  if (results[2].status === "fulfilled") {
    const doc = results[2].value as DatabaseDocument;
    for (const item of doc.connections)
      add(
        "database",
        "database",
        item.id,
        item.name,
        `${item.engine} / Connections`,
      );
    for (const item of doc.queries)
      add(
        "database",
        "query",
        item.id,
        item.name,
        `${doc.connections.find((c) => c.id === item.connectionId)?.name ?? ""} / Saved queries`,
        item.connectionId,
      );
  }
  return { entries, errors };
}
