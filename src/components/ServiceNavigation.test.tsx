// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { databaseConnection, serverConnection } from "../lib/toolDefaults";
const harness = vi.hoisted(() => ({ native: vi.fn(), document: {} as any }));
vi.mock("../lib/toolsBridge", () => ({
  nativeTool: (...args: any[]) => harness.native(...args),
  loadTool: async () => ({ connections: [] }),
}));
vi.mock("../hooks/useToolDocument", () => ({
  useToolDocument: () => {
    const [document, setDocument] = useState(harness.document);
    return {
      document,
      setDocument,
      loading: false,
      saving: false,
      saveError: "",
      dirty: false,
      save: async () => true,
    };
  },
}));
vi.mock("./RemoteTerminal", () => ({
  default: ({ session }: { session: string }) => <div>Terminal {session}</div>,
}));
vi.mock("./EditorPane", () => ({
  default: ({ document }: any) => <pre>{document.text}</pre>,
}));
import DatabaseWorkspace from "./DatabaseWorkspace";
import ServersWorkspace from "./ServersWorkspace";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
const props = {
  project: { id: "test", name: "Test", roots: ["/project"], updatedAt: 0 },
  visible: true,
  onError: vi.fn(),
  onDirty: vi.fn(),
};
const buttons = () => [
  ...document.querySelectorAll<HTMLButtonElement>("button"),
];
const click = async (name: string) => {
  const button = buttons().find(
    (button) => button.textContent?.trim() === name,
  );
  if (!button) throw new Error(`No button ${name}`);
  await act(async () => button.click());
};
const result = (rows: any[] = []) => ({
  columns: [{ name: "id", dataType: "INTEGER" }],
  rows,
  rowsAffected: 0,
  elapsedMs: 2,
  truncated: true,
});
beforeEach(() => {
  localStorage.clear();
  harness.native.mockReset();
  props.onError.mockClear();
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById("root")!);
});
afterEach(async () => {
  await act(async () => root.unmount());
});
it("shows a table page even if metadata fails and fetches pagination automatically", async () => {
  const connection = { ...databaseConnection(), id: "db", name: "Fixture" };
  harness.document = { version: 1, connections: [connection], queries: [] };
  harness.native.mockImplementation(async (command, args) => {
    if (command === "database_connect") return "db-session";
    if (command === "database_tables")
      return { rows: [[{ value: "main" }, { value: "rooms" }]] };
    if (command === "database_metadata")
      throw new Error("Metadata permission denied");
    if (command === "database_browse")
      return result([
        [
          {
            kind: "text",
            value: args.request.page === 0 ? "first room" : "second page",
          },
        ],
      ]);
  });
  await act(async () => root.render(<DatabaseWorkspace {...props} />));
  await click("Fixturesqlite");
  await click("Connect");
  await click("roomsmain");
  expect(document.querySelector(".database-results")?.textContent).toContain(
    "first room",
  );
  expect(document.querySelector(".database-notice")?.textContent).toContain(
    "Metadata permission denied",
  );
  await act(async () =>
    document
      .querySelector<HTMLButtonElement>('[aria-label="Next page"]')!
      .click(),
  );
  expect(document.querySelector(".database-results")?.textContent).toContain(
    "second page",
  );
  expect(harness.native).toHaveBeenCalledWith(
    "database_browse",
    expect.objectContaining({
      request: expect.objectContaining({ table: "rooms", page: 1 }),
    }),
  );
  expect(document.querySelectorAll(".database-sidebar-section")).toHaveLength(
    0,
  );
  expect(
    document.querySelector(".database-connections-list summary"),
  ).toBeNull();
  expect(document.querySelector(".database-table-list")?.textContent).toContain(
    "rooms",
  );
  expect(document.querySelector(".database-table-list summary")).toBeNull();
  expect(document.querySelector(".database-query-list summary")).toBeNull();
});
it("displays rows while metadata is still pending and shows browse failures inline", async () => {
  harness.document = {
    version: 1,
    connections: [{ ...databaseConnection(), id: "db", name: "Fixture" }],
    queries: [],
  };
  let rejectRows: ((error: Error) => void) | undefined;
  harness.native.mockImplementation(async (command) => {
    if (command === "database_connect") return "db-session";
    if (command === "database_tables")
      return { rows: [[{ value: "main" }, { value: "rooms" }]] };
    if (command === "database_metadata") return new Promise(() => {});
    if (command === "database_browse")
      return result([[{ kind: "text", value: "available now" }]]);
  });
  await act(async () => root.render(<DatabaseWorkspace {...props} />));
  await click("Fixturesqlite");
  await click("Connect");
  await click("roomsmain");
  expect(document.querySelector(".database-results")?.textContent).toContain(
    "available now",
  );
  harness.native.mockImplementation(async (command) => {
    if (command === "database_metadata") return new Promise(() => {});
    if (command === "database_browse")
      return new Promise((_resolve, reject) => {
        rejectRows = reject;
      });
  });
  await click("Load rows");
  expect(document.body.textContent).toContain("Loading rows…");
  await act(async () => {
    rejectRows!(new Error("SELECT denied"));
  });
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(
    "SELECT denied",
  );
});
it("keeps the visible grid while sorting and replaces rows only after success", async () => {
  const connection = { ...databaseConnection(), id: "db", name: "Fixture" };
  harness.document = { version: 1, connections: [connection], queries: [] };
  let resolveRows: ((value: ReturnType<typeof result>) => void) | undefined;
  let rejectRows: ((reason: Error) => void) | undefined;
  harness.native.mockImplementation(async (command, args) => {
    if (command === "database_connect") return "db-session";
    if (command === "database_tables")
      return {
        rows: [
          [{ value: "main" }, { value: "rooms" }],
          [{ value: "main" }, { value: "users" }],
        ],
      };
    if (command === "database_metadata") return new Promise(() => {});
    if (command === "database_browse") {
      if (!args.request.sort && args.request.table === "rooms")
        return result([[{ kind: "text", value: "original rows" }]]);
      return new Promise((resolve, reject) => {
        resolveRows = resolve;
        rejectRows = reject;
      });
    }
  });
  await act(async () => root.render(<DatabaseWorkspace {...props} />));
  await click("Fixturesqlite");
  await click("Connect");
  await click("roomsmain");
  const grid = document.querySelector(".data-grid");
  const sortButton = () =>
    document.querySelector<HTMLButtonElement>(".data-grid th button")!;
  await act(async () => sortButton().click());
  expect(document.querySelector(".data-grid")).toBe(grid);
  expect(grid?.textContent).toContain("original rows");
  expect(
    document.querySelector(".database-results")?.getAttribute("aria-busy"),
  ).toBe("true");
  expect(harness.native).toHaveBeenLastCalledWith(
    "database_browse",
    expect.objectContaining({
      request: expect.objectContaining({
        sort: "id",
        descending: false,
        page: 0,
      }),
    }),
  );
  await act(async () =>
    resolveRows!(result([[{ kind: "text", value: "sorted rows" }]])),
  );
  expect(document.querySelector(".data-grid")).toBe(grid);
  expect(grid?.textContent).toContain("sorted rows");
  expect(grid?.textContent).not.toContain("original rows");
  expect(sortButton().textContent).toContain("↑");
  await act(async () => sortButton().click());
  expect(grid?.textContent).toContain("sorted rows");
  await act(async () => rejectRows!(new Error("Sort unavailable")));
  expect(grid?.textContent).toContain("sorted rows");
  expect(sortButton().textContent).toContain("↑");
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(
    "Sort unavailable",
  );
  await click("usersmain");
  expect(document.querySelector(".data-grid")).toBeNull();
});

it("connects directly into SFTP with the newly returned session, then reuses it for Terminal", async () => {
  harness.document = {
    version: 1,
    connections: [{ ...serverConnection(), id: "ssh", name: "Test server" }],
  };
  harness.native.mockImplementation(async (command) => {
    if (command === "ssh_connect") return "new-ssh-session";
    if (command === "sftp_list") return { path: "/home/test", entries: [] };
  });
  await act(async () => root.render(<ServersWorkspace {...props} />));
  const server =
    document.querySelector<HTMLButtonElement>(".service-list-item")!;
  expect(server.textContent).toContain("Test server");
  await act(async () => server.click());
  await click("SFTP files");
  expect(harness.native).toHaveBeenCalledWith("sftp_list", {
    id: "new-ssh-session",
    path: ".",
  });
  expect(
    (document.querySelector('[aria-label="Remote folder"]') as HTMLInputElement)
      .value,
  ).toBe("/home/test");
  await click("terminal");
  expect(
    harness.native.mock.calls.filter(([command]) => command === "ssh_connect"),
  ).toHaveLength(1);
});
it("separates connection selection, tables, and saved queries under the connected database", async () => {
  harness.document = {
    version: 1,
    connections: [{ ...databaseConnection(), id: "db", name: "Fixture" }],
    queries: [
      {
        id: "q",
        name: "Rooms query",
        sql: "SELECT * FROM rooms",
        connectionId: "db",
      },
    ],
  };
  harness.native.mockImplementation(async (command) => {
    if (command === "database_connect") return "db-session";
    if (command === "database_tables")
      return { rows: [[{ value: "main" }, { value: "rooms" }]] };
    if (command === "database_metadata") return new Promise(() => {});
    if (command === "database_browse")
      return result([[{ kind: "text", value: "Room one" }]]);
  });
  await act(async () => root.render(<DatabaseWorkspace {...props} />));
  await click("Fixturesqlite");
  const connectionList = document.querySelector<HTMLDivElement>(
    ".database-connections-list",
  )!;
  expect(connectionList.hidden).toBe(false);
  expect(document.querySelector(".database-connection-nav")).toBeNull();
  await click("Connect");
  expect(connectionList.hidden).toBe(true);
  expect(
    document.querySelector(".database-connection-nav")?.textContent,
  ).toContain("Fixture");
  await click("roomsmain");
  expect(document.querySelector(".database-results")?.textContent).toContain(
    "Room one",
  );
  const breadcrumb = document.querySelector(
    '[aria-label="Database breadcrumb"]',
  )!;
  expect(breadcrumb.textContent).toBe("Fixture/Tables/rooms");
  expect(breadcrumb.querySelector('[aria-current="page"]')?.textContent).toBe(
    "rooms",
  );
  expect(document.querySelector(".schema-toolbar")).toBeNull();
  expect(document.body.textContent).not.toContain("Create / alter table");
  await click("Console");
  await click("Rooms query");
  expect(
    document.querySelector(".database-connection-nav")?.textContent,
  ).toContain("Console");
  expect(
    document.querySelector(".database-query-list .service-subheading")
      ?.textContent,
  ).toBe("Saved queries");
  expect(document.querySelectorAll(".service-main .service-tabs")).toHaveLength(
    0,
  );
  expect(document.querySelector('[title="New query"]')).not.toBeNull();
  const tables = [...document.querySelectorAll<HTMLButtonElement>("button")]
    .filter((button) => button.textContent?.startsWith("Tables"))
    .at(-1)!;
  await act(async () => tables.click());
  expect(document.querySelector(".database-results")?.textContent).toContain(
    "Room one",
  );
  await act(async () => document.querySelector<HTMLButtonElement>(".database-connection-back")!.click());
  expect(connectionList.hidden).toBe(false);
  expect(document.querySelector(".database-results")).toBeNull();
});
it("opens table information from the header without disclosures and returns to the same data page", async () => {
  harness.document = {
    version: 1,
    connections: [{ ...databaseConnection(), id: "db", name: "Fixture" }],
    queries: [],
  };
  harness.native.mockImplementation(async (command) => {
    if (command === "database_connect") return "db-session";
    if (command === "database_tables")
      return { rows: [[{ value: "main" }, { value: "rooms" }]] };
    if (command === "database_browse")
      return result([[{ kind: "text", value: "Room data" }]]);
    if (command === "database_metadata")
      return {
        columns: [
          {
            name: "id",
            dataType: "INTEGER",
            nullable: false,
            primaryKey: true,
            defaultValue: null,
            generated: false,
          },
        ],
        indexes: {
          ...result(),
          columns: [{ name: "name", dataType: "TEXT" }],
          rows: [[{ kind: "text", value: "rooms_primary" }]],
          truncated: false,
        },
        foreignKeys: { ...result(), rows: [], truncated: false },
        editable: false,
        reason: "Read-only connection",
      };
  });
  await act(async () => root.render(<DatabaseWorkspace {...props} />));
  await click("Fixturesqlite");
  await click("Connect");
  await click("roomsmain");
  expect(
    [...document.querySelectorAll(".database-header-buttons button")].map(
      (button) => button.textContent,
    ),
  ).toEqual(["Table info", "Disconnect"]);
  expect(document.querySelector('[aria-label="Table info"]')).toBeNull();
  await click("Table info");
  const info = document.querySelector('[aria-label="Table info"]')!;
  expect(
    [...info.querySelectorAll("h3")].map((heading) => heading.textContent),
  ).toEqual(["Columns", "Indexes", "Relationships"]);
  expect(info.textContent).toContain("rooms_primary");
  expect(info.textContent).toContain("No relationships.");
  expect(info.querySelector("details")).toBeNull();
  expect(document.querySelector(".database-results")).toBeNull();
  await click("Table data");
  expect(document.querySelector('[aria-label="Table info"]')).toBeNull();
  expect(document.querySelector(".database-results")?.textContent).toContain(
    "Room data",
  );
  expect(
    harness.native.mock.calls.filter(
      ([command]) => command === "database_browse",
    ),
  ).toHaveLength(1);
});

it("retains WHERE drafts and applied filters separately across tables and pagination", async () => {
  harness.document = { version: 1, connections: [{ ...databaseConnection(), id: "db", name: "Fixture" }], queries: [] };
  harness.native.mockImplementation(async (command) => {
    if (command === "database_connect") return "session";
    if (command === "database_tables") return { rows: [[{ value: "main" }, { value: "rooms" }], [{ value: "main" }, { value: "users" }]] };
    if (command === "database_metadata") return new Promise(() => {});
    if (command === "database_browse") return result([[{ kind: "text", value: "row" }]]);
  });
  await act(async () => root.render(<DatabaseWorkspace {...props} />));
  await click("Fixturesqlite"); await click("Connect"); await click("roomsmain");
  const input = () => document.querySelector<HTMLInputElement>('[aria-label="Quick WHERE expression"]')!;
  const typeFilter = async (value: string) => act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input(), value);
    input().dispatchEvent(new Event("input", { bubbles: true }));
  });
  await typeFilter("id > 10"); await click("Load rows");
  await typeFilter("id > 20");
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Next page"]')!.click());
  expect(harness.native).toHaveBeenLastCalledWith("database_browse", expect.objectContaining({ request: expect.objectContaining({ filter: "id > 10", page: 1 }) }));
  expect(input().value).toBe("id > 20");
  await click("usersmain"); expect(input().value).toBe("");
  await click("roomsmain"); expect(input().value).toBe("id > 20");
  expect(harness.native).toHaveBeenLastCalledWith("database_browse", expect.objectContaining({ request: expect.objectContaining({ filter: "id > 10" }) }));
  await click("roomsmain"); expect(input().value).toBe("id > 20");
});
