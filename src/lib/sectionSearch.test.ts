// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { loadSectionEntries } from "./sectionSearch";
import { registerSearchDocument, registerSearchList } from "./searchDocuments";
import { apiDocument, apiRequest, databaseDocument } from "./toolDefaults";
import { previewProject } from "./bridge";
import * as tools from "./toolsBridge";
import { matchingEntries } from "./searchEverywhere";
afterEach(() => vi.restoreAllMocks());
describe("section search", () => {
  it("uses live names and folder context without indexing credentials or request bodies", async () => {
    const doc = apiDocument();
    doc.folders.push({ id: "rooms", name: "Room admin" });
    doc.requests.push({
      ...apiRequest(),
      name: "List rooms",
      folderId: "rooms",
      body: "never-index-body",
      url: "https://never-index-url",
      credential: { id: "secret", secret: true, value: "never-index-token" },
    });
    const remove = registerSearchDocument(previewProject.id, "api", () => doc);
    try {
      const { entries } = await loadSectionEntries(previewProject);
      expect(matchingEntries(entries, "admin rooms")[0]?.label).toBe(
        "List rooms",
      );
      expect(JSON.stringify(entries)).not.toContain("never-index");
      expect(
        (await loadSectionEntries({ ...previewProject, id: "other-project" }))
          .entries,
      ).toEqual([]);
    } finally {
      remove();
    }
  });
  it("keeps other lists searchable when one document fails, and includes loaded tables without connecting", async () => {
    vi.spyOn(tools, "loadTool").mockImplementation(
      async (_project, tool, fallback) => {
        if (tool === "servers") throw new Error("Unavailable");
        return fallback();
      },
    );
    const database = databaseDocument();
    database.queries.push({
      id: "report",
      name: "Revenue report",
      connectionId: "db",
      sql: "never-index-sql",
    });
    const removeDoc = registerSearchDocument(
      previewProject.id,
      "database",
      () => database,
    );
    const removeList = registerSearchList(previewProject.id, [
      {
        label: "rooms",
        kind: "table",
        path: "table:rooms",
        relative: "Production / Tables",
        root: "Database",
        line: 1,
        target: {
          tool: "database",
          id: "rooms",
          connectionId: "db",
          schema: "public",
        },
      },
    ]);
    try {
      const result = await loadSectionEntries(previewProject);
      expect(result.errors).toHaveLength(1);
      expect(result.entries.map((entry) => entry.kind)).toEqual([
        "table",
        "query",
      ]);
      expect(JSON.stringify(result.entries)).not.toContain("never-index");
    } finally {
      removeDoc();
      removeList();
    }
  });
});
