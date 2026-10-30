// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import {
  apiDocument,
  apiRequest,
  serverDocument,
  serverConnection,
  databaseDocument,
  databaseConnection,
} from "./lib/toolDefaults";
import * as bridge from "./lib/bridge";
import * as recovery from "./lib/recovery";
import * as toolsBridge from "./lib/toolsBridge";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
const waitFor = async <T,>(
  read: () => T | null | undefined | false,
): Promise<T> => {
  for (let attempt = 0; attempt < 100; attempt++) {
    const result = read();
    if (result) return result;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }
  throw new Error("Timed out waiting for the interface");
};
const click = async (selector: string) => {
  const element = await waitFor(() =>
    document.querySelector<HTMLButtonElement>(selector),
  );
  await act(async () => {
    element.click();
  });
};
const type = async (selector: string, value: string) => {
  const input = await waitFor(() =>
    document.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector),
  );
  const prototype =
    input instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(
      input,
      value,
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const enterCode = async () => {
  await click('[aria-label="New project"]');
  await waitFor(() => document.querySelector(".tree-root"));
};

beforeEach(async () => {
  localStorage.clear();
  document.body.innerHTML = '<div id="root"></div>';
  vi.spyOn(recovery, "loadDrafts").mockResolvedValue([]);
  vi.spyOn(window, "confirm").mockReturnValue(false);
  root = createRoot(document.getElementById("root")!);
  await act(async () => {
    root.render(<App />);
  });
});
afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  vi.restoreAllMocks();
});

describe("browser sandbox workflows", () => {
  it("Cmd+1 always selects Files from Git, Search and another section", async () => {
    await enterCode();
    const choose = async (name: string) => {
      const button = [
        ...document.querySelectorAll<HTMLButtonElement>(
          ".explorer-tabs button",
        ),
      ].find((button) => button.textContent?.trim() === name)!;
      await act(async () => button.click());
    };
    const files = async () =>
      act(async () =>
        window.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "1",
            metaKey: true,
            bubbles: true,
            cancelable: true,
          }),
        ),
      );
    await choose("Git");
    await files();
    expect(
      document
        .querySelector(".explorer-tabs button.active")
        ?.textContent?.trim(),
    ).toBe("Files");
    await choose("Search");
    await files();
    expect(
      document
        .querySelector(".explorer-tabs button.active")
        ?.textContent?.trim(),
    ).toBe("Files");
    await choose("Git");
    await click('[aria-label="API"]');
    await files();
    expect(
      document
        .querySelector(".explorer-tabs button.active")
        ?.textContent?.trim(),
    ).toBe("Files");
  });
  it("keeps separate live files, terminal tabs, API drafts and responses for each project", async () => {
    await act(async () => root.unmount());
    const alpha = {
      ...bridge.previewProject,
      id: "project-alpha",
      name: "Alpha",
    };
    const beta = { ...bridge.previewProject, id: "project-beta", name: "Beta" };
    vi.spyOn(bridge, "listProjects").mockResolvedValue([alpha, beta]);
    const layouts = vi.spyOn(bridge, "loadSession");
    const save = vi.spyOn(toolsBridge, "saveTool");
    const send = vi.spyOn(toolsBridge, "nativeTool").mockResolvedValue({
      status: 200,
      statusText: "OK",
      headers: [],
      body: '{"project":"alpha"}',
      bytes: 19,
      elapsedMs: 1,
      truncated: false,
      binary: false,
      contentType: "application/json",
    });
    root = createRoot(document.getElementById("root")!);
    await act(async () => root.render(<App />));
    const open = async (name: string) => {
      const card = await waitFor(() =>
        [...document.querySelectorAll<HTMLButtonElement>(".project-card")].find(
          (button) => button.querySelector("h3")?.textContent === name,
        ),
      );
      await act(async () => card.click());
      await waitFor(
        () => document.querySelector(".project-nav-name")?.textContent === name,
      );
    };
    await open("Alpha");
    await click('.file-tree [title="/welcome/README.md"]');
    await type('[aria-label="Edit README.md"]', "Alpha file draft");
    const editor = document.querySelector('[aria-label="Edit README.md"]');
    await click('[aria-label="Local terminal"]');
    await waitFor(() => document.querySelector(".preview-terminal"));
    await click('[aria-label="New terminal"]');
    const alphaSessions = [
      ...document.querySelectorAll(".local-terminal-session"),
    ];
    await click('[aria-label="API"]');
    await click('[title="New request"]');
    await type('[aria-label="Request name"]', "Alpha request draft");
    await type('[aria-label="Request URL"]', "https://alpha.test/status");
    await click(".request-bar .primary-button");
    const alphaRequest = document.querySelector('[aria-label="Request name"]');
    const alphaResponse = document.querySelector(".response-panel");
    await click('[aria-label="Back to projects"]');
    expect(alphaRequest?.isConnected).toBe(false);
    expect(window.confirm).not.toHaveBeenCalled();
    await open("Beta");
    await waitFor(() => document.querySelector(".tree-root"));
    expect(document.querySelectorAll(".document-tab")).toHaveLength(0);
    expect(document.querySelectorAll(".local-terminal-session")).toHaveLength(
      0,
    );
    await click('[aria-label="Local terminal"]');
    await waitFor(() => document.querySelector(".preview-terminal"));
    const betaSession = document.querySelector(".local-terminal-session");
    await click('[aria-label="API"]');
    await click('[title="New request"]');
    await type('[aria-label="Request name"]', "Beta request draft");
    const betaRequest = document.querySelector('[aria-label="Request name"]');
    await click('[aria-label="Back to projects"]');
    await open("Alpha");
    expect(document.querySelector('[aria-label="Request name"]')).toBe(
      alphaRequest,
    );
    expect((alphaRequest as HTMLInputElement).value).toBe(
      "Alpha request draft",
    );
    expect(document.querySelector(".response-panel")).toBe(alphaResponse);
    expect(alphaResponse?.textContent).toContain("alpha");
    expect([...document.querySelectorAll(".local-terminal-session")]).toEqual(
      alphaSessions,
    );
    expect(
      document.querySelector(
        '.rail-button[aria-label="API"] .rail-unsaved-dot',
      ),
    ).not.toBeNull();
    await click('[aria-label="Code"]');
    expect(document.querySelector('[aria-label="Edit README.md"]')).toBe(
      editor,
    );
    expect((editor as HTMLTextAreaElement).value).toBe("Alpha file draft");
    await click('[aria-label="Back to projects"]');
    await open("Beta");
    expect(document.querySelector('[aria-label="Request name"]')).toBe(
      betaRequest,
    );
    expect((betaRequest as HTMLInputElement).value).toBe("Beta request draft");
    expect(document.querySelectorAll(".local-terminal-session")).toHaveLength(
      1,
    );
    expect(document.querySelector(".local-terminal-session")).toBe(betaSession);
    expect(save).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledOnce();
    expect(layouts).toHaveBeenCalledTimes(2);
  });
  it("cycles selected API field text globally and keeps the React document synchronized without saving", async () => {
    await enterCode();
    await click('[aria-label="API"]');
    await click('[aria-label="API workspace"] button[title="New request"]');
    await type('[aria-label="Request name"]', "room_name");
    const input = document.querySelector<HTMLInputElement>(
      '[aria-label="Request name"]',
    )!;
    input.focus();
    input.select();
    await act(async () =>
      input.dispatchEvent(
        new KeyboardEvent("keydown", {
          code: "KeyU",
          key: "¨",
          altKey: true,
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(input.value).toBe("roomName");
    expect(document.querySelector(".service-sidebar")?.textContent).toContain(
      "roomName",
    );
    expect(input.value.slice(input.selectionStart!, input.selectionEnd!)).toBe(
      "roomName",
    );
    await click('[aria-label="Code"]');
    await click('[aria-label="API"]');
    expect(
      document.querySelector<HTMLInputElement>('[aria-label="Request name"]')!
        .value,
    ).toBe("roomName");
    expect(document.querySelector(".service-state")?.textContent).toBe(
      "1 unsaved change",
    );
  });

  it("opens projects directly in Code and returns the four-square navigation to Projects", async () => {
    await enterCode();
    expect(document.querySelector(".tools-grid")).toBeNull();
    expect(document.querySelector(".intro-strip")).toBeNull();
    expect(document.querySelector(".rail-label")).toBeNull();
    expect(
      document.querySelector('[aria-label="Toggle split editor"]'),
    ).toBeNull();
    await click('[aria-label="Workspace home"]');
    await waitFor(() => document.querySelector(".projects-grid"));
    expect(document.querySelector(".dashboard-footer")).toBeNull();
  });
  it("double Cmd+2 opens a dedicated command tab and uses the explicitly saved setting across sections", async () => {
    await enterCode();
    const key = async (key = "2") =>
      act(async () => {
        window.dispatchEvent(
          new KeyboardEvent("keydown", {
            key,
            metaKey: true,
            bubbles: true,
            cancelable: true,
          }),
        );
      });
    await key();
    await waitFor(() => document.querySelector(".preview-terminal"));
    expect(document.querySelectorAll(".local-terminal-session")).toHaveLength(
      1,
    );
    await key();
    await waitFor(
      () => document.querySelectorAll(".local-terminal-session").length === 2,
    );
    await waitFor(
      () =>
        document.querySelector(".preview-terminal code")?.textContent ===
        "codex",
    );
    await click('[aria-label="Settings"]');
    await type('[aria-label="Terminal launch command"]', "codex --resume");
    expect(localStorage.getItem("octode-editor-settings")).toBeNull();
    await click('[aria-label="Settings"][role="dialog"] button[type="submit"]');
    expect(document.querySelectorAll(".local-terminal-session")).toHaveLength(
      2,
    );
    await key("5");
    await key();
    await key();
    await waitFor(
      () => document.querySelectorAll(".local-terminal-session").length === 3,
    );
    await waitFor(() =>
      [...document.querySelectorAll(".preview-terminal code")].some(
        (item) => item.textContent === "codex --resume",
      ),
    );
    expect(
      document
        .querySelector('.main-workspace > .workspace-terminal-dock')
        ?.getAttribute("style"),
    ).toContain("flex");
  });
  it("keeps the same local terminal sessions across Code, Servers, Database and API with Cmd+2", async () => {
    await enterCode();
    const key = async (key: string) =>
      act(async () =>
        window.dispatchEvent(
          new KeyboardEvent("keydown", {
            key,
            metaKey: true,
            bubbles: true,
            cancelable: true,
          }),
        ),
      );
    await key("2");
    const first = await waitFor(() =>
      document.querySelector(".local-terminal-session"),
    );
    await click('[aria-label="New terminal"]');
    const dock = document.querySelector(".main-workspace > .workspace-terminal-dock");
    expect(dock?.querySelector(".workspace-terminal-host")).not.toBeNull();
    expect(document.querySelectorAll(".workspace-terminal-dock")).toHaveLength(1);
    for (const [shortcut, title] of [
      ["3", "Servers"],
      ["4", "Database"],
      ["5", "API"],
    ]) {
      await key(shortcut);
      await waitFor(() =>
        document.querySelector(
          `[aria-label="${title} workspace"]`,
        ),
      );
      expect(document.querySelectorAll(".local-terminal-session")).toHaveLength(
        2,
      );
      expect(document.querySelector(".local-terminal-session")).toBe(first);
      expect(document.querySelector(".main-workspace > .workspace-terminal-dock")).toBe(dock);
    }
    await key("2");
    expect(
      (
        document.querySelector(
          '.main-workspace > .workspace-terminal-dock',
        ) as HTMLElement
      ).style.display,
    ).toBe("none");
    await key("2");
    expect(document.querySelector(".local-terminal-session")).toBe(first);
  });
  it("keeps a saved database password reference and requires a database name before connecting", async () => {
    const connection = {
      ...databaseConnection(),
      name: "Password check",
      engine: "mysql" as const,
    };
    const originalLoad = toolsBridge.loadTool;
    vi.spyOn(toolsBridge, "loadTool").mockImplementation(
      async (project, tool, fallback) =>
        tool === "database"
          ? ({ ...databaseDocument(), connections: [connection] } as any)
          : originalLoad(project, tool, fallback),
    );
    const save = vi
      .spyOn(toolsBridge, "saveTool")
      .mockImplementation(async (_project, _tool, document) => {
        const sealed = structuredClone(document) as ReturnType<
          typeof databaseDocument
        >;
        sealed.connections[0].password = {
          id: "stored-password",
          secret: true,
          value: "",
          hasSecret: true,
        };
        return sealed as any;
      });
    const native = vi
      .spyOn(toolsBridge, "nativeTool")
      .mockRejectedValue(new Error("Test connection stopped"));
    await enterCode();
    await click('[aria-label="Database"]');
    await click(".database-connections-list button");
    const connect = document.querySelector<HTMLButtonElement>(
      ".connection-header .primary-button",
    )!;
    const database = [
      ...document.querySelectorAll<HTMLLabelElement>(".service-field"),
    ]
      .find((label) => label.firstElementChild?.textContent === "Database")!
      .querySelector("input")!;
    database.setAttribute("data-testid", "database-name");
    expect(connect.disabled).toBe(true);
    await type('[data-testid="database-name"]', "   ");
    expect(connect.disabled).toBe(true);
    await type('[data-testid="database-name"]', "app_database");
    expect(connect.disabled).toBe(false);
    await type('[aria-label="Password"]', "test-password");
    await click(
      '[aria-label="Database workspace"] [aria-label="Save changes"]',
    );
    expect(
      (save.mock.calls[0][2] as ReturnType<typeof databaseDocument>)
        .connections[0].password.value,
    ).toBe("test-password");
    const password = document.querySelector<HTMLInputElement>(
      '[aria-label="Password"]',
    )!;
    expect(password.placeholder).toBe("••••••••");
    expect(document.querySelector(".secret-saved")?.textContent).toBe("Saved");
    await click(".connection-header .primary-button");
    expect(native).toHaveBeenCalledWith(
      "database_connect",
      expect.objectContaining({
        connection: expect.objectContaining({
          password: {
            id: "stored-password",
            secret: true,
            value: "",
            hasSecret: true,
          },
        }),
      }),
    );
    await type('[aria-label="Password"]', "replacement");
    expect(document.querySelector(".secret-saved")).toBeNull();
    expect(password.value).toBe("replacement");
  });
  it("duplicates database connection settings with a new identity and the saved password reference", async () => {
    const connection = {
      ...databaseConnection(),
      name: "Original database",
      engine: "postgres" as const,
      database: "app_db",
      username: "reader",
      password: {
        id: "stored-secret",
        value: "",
        secret: true as const,
        hasSecret: true,
      },
    };
    const document = {
      ...databaseDocument(),
      connections: [connection],
      queries: [
        {
          id: "query",
          name: "Saved query",
          connectionId: connection.id,
          sql: "SELECT 1;",
        },
      ],
    };
    const originalLoad = toolsBridge.loadTool;
    vi.spyOn(toolsBridge, "loadTool").mockImplementation(
      async (project, tool, fallback) =>
        tool === "database"
          ? (structuredClone(document) as any)
          : originalLoad(project, tool, fallback),
    );
    const save = vi
      .spyOn(toolsBridge, "saveTool")
      .mockImplementation(async (_project, _tool, value) =>
        structuredClone(value),
      );
    const native = vi.spyOn(toolsBridge, "nativeTool");
    await enterCode();
    await click('[aria-label="Database"]');
    await click(".database-connections-list button");
    const actions = [
      ...window.document.querySelectorAll<HTMLButtonElement>(
        ".connection-header-buttons button:not(.primary-button)",
      ),
    ];
    expect(actions.map((button) => button.title)).toEqual([
      "Duplicate database",
      "Delete database",
    ]);
    expect(actions.every((button) => button.querySelector("svg"))).toBe(true);
    await act(async () => actions[0].click());
    expect(
      window.document.querySelector(".connection-header h2")?.textContent,
    ).toBe("Original database copy");
    expect(
      window.document.querySelectorAll(".database-connections-list button"),
    ).toHaveLength(2);
    expect(window.document.querySelector(".secret-saved")?.textContent).toBe(
      "Saved",
    );
    expect(save).not.toHaveBeenCalled();
    expect(native).not.toHaveBeenCalled();
    await type(".service-field input", "Renamed copy");
    await click(
      '[aria-label="Database workspace"] [aria-label="Save changes"]',
    );
    const saved = save.mock.calls[0][2] as ReturnType<typeof databaseDocument>;
    expect(saved.connections[0]).toEqual(connection);
    expect({ ...saved.connections[1], id: connection.id }).toEqual({
      ...connection,
      name: "Renamed copy",
    });
    expect(saved.connections[1].id).not.toBe(connection.id);
    expect(saved.connections[1].password).toEqual(connection.password);
    expect(saved.queries).toEqual(document.queries);
  });
  it("edits a table cell through the grid, reviews it and reloads rows only after Apply", async () => {
    const connection = {
      ...databaseConnection(),
      name: "Writable SQLite",
      file: "/test.sqlite",
      readOnly: false,
    };
    const originalLoad = toolsBridge.loadTool;
    vi.spyOn(toolsBridge, "loadTool").mockImplementation(
      async (project, tool, fallback) =>
        tool === "database"
          ? ({ ...databaseDocument(), connections: [connection] } as any)
          : originalLoad(project, tool, fallback),
    );
    let applied = false;
    const rows = () => ({
      columns: [
        { name: "id", dataType: "INTEGER" },
        { name: "name", dataType: "TEXT" },
      ],
      rows: [
        [
          { kind: "text", value: "9007199254740993" },
          { kind: "text", value: applied ? "after" : "before" },
        ],
      ],
      rowsAffected: 0,
      elapsedMs: 1,
      truncated: false,
    });
    const native = vi
      .spyOn(toolsBridge, "nativeTool")
      .mockImplementation(async (command) => {
        if (command === "database_connect") return "test-session" as any;
        if (command === "database_tables")
          return {
            ...rows(),
            rows: [
              [
                { kind: "text", value: "main" },
                { kind: "text", value: "things" },
              ],
            ],
          } as any;
        if (command === "database_browse") return rows() as any;
        if (command === "database_metadata")
          return {
            columns: rows().columns.map((column, index) => ({
              ...column,
              primaryKey: index === 0,
              nullable: index !== 0,
              generated: false,
              defaultValue: null,
            })),
            indexes: { ...rows(), rows: [] },
            foreignKeys: { ...rows(), rows: [] },
            editable: true,
            reason: "",
          } as any;
        if (command === "database_row_plan")
          return {
            statements: [
              {
                sql: "UPDATE things SET name=? WHERE id IS ?",
                parameters: ["after", "9007199254740993"],
                checkSql: null,
                checkParameters: [],
              },
            ],
          } as any;
        if (command === "database_apply_rows") {
          applied = true;
          return 1 as any;
        }
        return undefined as any;
      });
    await enterCode();
    await click('[aria-label="Database"]');
    await click(".database-connections-list button");
    await click(".connection-header .primary-button");
    expect(
      document.querySelector(
        '[aria-label="Database workspace"] .service-toolbar',
      ),
    ).toBeNull();
    await type('[aria-label="Search tables"]', "nonexistent_table");
    expect(
      document.querySelectorAll(".database-table-list .service-list-item"),
    ).toHaveLength(0);
    expect(
      document.querySelector(".database-table-search-empty")?.textContent,
    ).toContain("No matching tables.");
    await type('[aria-label="Search tables"]', "THIN");
    expect(
      document.querySelectorAll(".database-table-list .service-list-item"),
    ).toHaveLength(1);
    expect(
      document.querySelector(".database-table-list .service-list-item")
        ?.textContent,
    ).toContain("things");
    await click('[aria-label="Clear table search"]');
    expect(
      document.querySelector<HTMLInputElement>('[aria-label="Search tables"]')
        ?.value,
    ).toBe("");
    expect(document.activeElement).toBe(
      document.querySelector('[aria-label="Search tables"]'),
    );
    expect(
      document.querySelector('[aria-label="Clear table search"]'),
    ).toBeNull();
    await click(".database-table-list .service-list-item");
    await waitFor(() => document.querySelector(".data-grid td"));
    await act(async () =>
      document
        .querySelectorAll(".data-grid td")[1]
        .dispatchEvent(new MouseEvent("dblclick", { bubbles: true })),
    );
    await type('[aria-label="Edit name row 1"]', "after");
    expect(applied).toBe(false);
    expect(
      document.querySelector<HTMLButtonElement>(".data-grid th button")
        ?.disabled,
    ).toBe(true);
    await click('[aria-label="Review cell change"]');
    const review = document.querySelector(
      '[aria-label="Apply database change"]',
    )!;
    expect(review.textContent).toContain("9007199254740993");
    expect(review.textContent).toContain("BeforebeforeAfterafter");
    expect(applied).toBe(false);
    const button = [...review.querySelectorAll("button")].find(
      (button) => button.textContent === "Apply update",
    )!;
    await act(async () => button.click());
    await waitFor(
      () =>
        document.querySelectorAll(".data-grid td")[1]?.textContent === "after",
    );
    expect(applied).toBe(true);
    expect(
      native.mock.calls.filter(
        ([command]) => command === "database_apply_rows",
      ),
    ).toHaveLength(1);
    expect(
      document.querySelector<HTMLButtonElement>(".data-grid th button")
        ?.disabled,
    ).toBe(false);
    await act(async () =>
      document
        .querySelectorAll<HTMLButtonElement>(
          ".database-connection-nav .service-tabs button",
        )[1]
        .click(),
    );
    expect(
      document.querySelector(
        '[aria-label="Database workspace"] .service-toolbar',
      ),
    ).toBeNull();
    expect(document.querySelector('[aria-label="Save query"]')).not.toBeNull();
    await click('[title="Back to connections"]');
    expect(
      document.querySelector(
        '[aria-label="Database workspace"] .service-toolbar',
      ),
    ).not.toBeNull();
    expect(
      document.querySelector(
        '[aria-label="Database workspace"] [aria-label="Save changes"]',
      ),
    ).not.toBeNull();
    await click(".connection-header .primary-button");
    expect(
      document.querySelector(
        '[aria-label="Database workspace"] .service-toolbar',
      ),
    ).toBeNull();
  });
  it("keeps database errors in Database when switching to Code", async () => {
    await enterCode();
    await click('[aria-label="Database"]');
    await click(
      '[aria-label="Database workspace"] button[title="New database"]',
    );
    await click(
      '[aria-label="Database workspace"] .connection-header .primary-button',
    );
    await waitFor(() => document.querySelector(".error-banner"));
    const error = document.querySelector(".error-banner")!.textContent;
    await click('[aria-label="Code"]');
    expect(document.querySelector(".error-banner")).toBeNull();
    await click('[aria-label="Database"]');
    expect(document.querySelector(".error-banner")?.textContent).toBe(error);
  });
  it("separates API Requests and History without losing request drafts or responses", async () => {
    const api = vi.spyOn(toolsBridge, "nativeTool").mockResolvedValue({
      status: 200,
      statusText: "OK",
      headers: [],
      body: '{"ok":true}',
      bytes: 11,
      elapsedMs: 12,
      truncated: false,
      contentType: "application/json",
      binary: false,
    });
    const save = vi.spyOn(toolsBridge, "saveTool");
    await enterCode();
    await click('[aria-label="API"]');
    await click('[aria-label="API workspace"] button[title="New request"]');
    await type('[aria-label="Request name"]', "History tab QA");
    await type('[aria-label="Request URL"]', "https://example.test/history");
    await click(".request-bar .primary-button");
    const responsePane =
      document.querySelector<HTMLElement>(".response-panel")!;
    expect(responsePane.parentElement?.classList.contains("api-main")).toBe(
      true,
    );
    expect(responsePane.style.height).toBe("360px");
    Object.defineProperty(
      responsePane.closest(".service-right")!,
      "clientHeight",
      { value: 900 },
    );
    responsePane.getBoundingClientRect = () =>
      ({ height: Number.parseFloat(responsePane.style.height) }) as DOMRect;
    const divider = document.querySelector(
      '[aria-label="Resize API response"]',
    )!;
    await act(async () => {
      divider.dispatchEvent(
        new MouseEvent("mousedown", { button: 0, clientY: 500, bubbles: true }),
      );
      window.dispatchEvent(new MouseEvent("mousemove", { clientY: 420 }));
      window.dispatchEvent(new MouseEvent("mouseup"));
    });
    expect(responsePane.style.height).toBe("440px");
    await act(async () =>
      divider.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      ),
    );
    expect(responsePane.style.height).toBe("430px");
    await click("#api-history-tab");
    expect(
      document.querySelector<HTMLDivElement>("#api-requests-panel")!.hidden,
    ).toBe(true);
    expect(
      document.querySelector("#api-history-tab")?.getAttribute("aria-selected"),
    ).toBe("true");
    expect(document.querySelector("#api-history-panel")?.textContent).toContain(
      "200 · History tab QA",
    );
    await click("#api-history-panel .service-list-item");
    expect(
      document.querySelector<HTMLInputElement>('[aria-label="Request name"]')
        ?.value,
    ).toBe("History tab QA");
    expect(document.querySelector(".response-panel")?.textContent).toContain(
      "200",
    );
    await click("#api-requests-tab");
    expect(
      document.querySelector<HTMLDivElement>("#api-history-panel")!.hidden,
    ).toBe(true);
    expect(
      document.querySelector("#api-requests-panel")?.textContent,
    ).toContain("History tab QA");
    await click("#api-history-tab");
    await click('[aria-label="Clear API history"]');
    expect(document.querySelector("#api-history-panel")?.textContent).toContain(
      "No requests sent this session.",
    );
    expect(document.querySelector(".response-panel")?.textContent).toContain(
      "200",
    );
    expect(api).toHaveBeenCalledTimes(1);
    expect(save).not.toHaveBeenCalled();
  });

  it("edits and inherits environment headers when sending requests", async () => {
    const send = vi.spyOn(toolsBridge, "nativeTool").mockResolvedValue({ status: 200, statusText: "OK", headers: [], body: "ok", bytes: 2, elapsedMs: 1, truncated: false, contentType: "text/plain", binary: false });
    await enterCode();
    await click('[aria-label="API"]');
    await click('[aria-label="API workspace"] button[title="New request"]');
    await type('[aria-label="Request URL"]', "https://example.test");
    await click('[aria-label="New environment"]');
    const headers = [...document.querySelectorAll<HTMLElement>(".value-rows")].find((section) => section.querySelector("strong")?.textContent === "Headers")!;
    await act(async () => headers.querySelector<HTMLButtonElement>("button")!.click());
    await type('[aria-label="Headers 1 name"]', "X-Workspace");
    await type('[aria-label="Headers 1 value"]', "octode");
    const back = [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Back to request")!;
    await act(async () => back.click());
    await click(".request-bar .primary-button");
    expect(send).toHaveBeenCalledWith("api_send", expect.objectContaining({ request: expect.objectContaining({ headers: [expect.objectContaining({ name: "X-Workspace", value: "octode", enabled: true })] }) }));
    const headersTab = [...document.querySelectorAll<HTMLButtonElement>(".api-request-tabs button")].find((button) => button.textContent?.startsWith("Headers"))!;
    await act(async () => headersTab.click());
    const inherited = document.querySelector<HTMLElement>('[aria-label="Inherited headers"]')!;
    expect(inherited.textContent).toContain("Inherited from New environment");
    expect(inherited.querySelector<HTMLInputElement>('[aria-label="Inherited headers 1 name"]')!.readOnly).toBe(true);
    expect(inherited.querySelector<HTMLInputElement>('[aria-label="Inherited headers 1 value"]')!.readOnly).toBe(true);
    expect(inherited.querySelector<HTMLInputElement>('input[type="checkbox"]')!.disabled).toBe(true);
    expect(inherited.querySelector('[aria-label="Locked inherited header"]')).not.toBeNull();
    expect(inherited.querySelector("button")).toBeNull();
    const add = document.querySelector<HTMLButtonElement>(".api-request-body .value-rows button")!;
    await act(async () => add.click());
    await type('[aria-label="Headers 1 name"]', "x-workspace");
    await type('[aria-label="Headers 1 value"]', "request override");
    expect(document.querySelector('[aria-label="Inherited headers"]')).toBeNull();
    await click(".request-bar .primary-button");
    expect(send).toHaveBeenLastCalledWith("api_send", expect.objectContaining({ request: expect.objectContaining({ headers: [expect.objectContaining({ name: "x-workspace", value: "request override" })] }) }));
  });
  it("manages API environments above the dropdown without an environment sidebar or request tab", async () => {
    await enterCode();
    await click('[aria-label="API"]');
    const header = document.querySelector(
      '[aria-label="API workspace"] .service-toolbar',
    )!;
    expect(header.textContent).toContain("Import collection");
    expect(header.textContent).toContain("Export collection");
    expect(
      header.querySelector('[aria-label="Active environment"]'),
    ).not.toBeNull();
    expect(
      header.querySelector('[aria-label="New environment"]')?.textContent,
    ).toBe("");
    expect(
      document.querySelector(".service-sidebar")?.textContent,
    ).not.toContain("Import collection");
    expect(document.querySelector(".service-main")?.textContent).not.toContain(
      "Changes require Save.",
    );
    await click('[aria-label="New environment"]');
    expect(
      document.querySelector(".service-sidebar")?.textContent,
    ).not.toContain("Environments");
    expect(
      (
        document.querySelector(
          '[aria-label="Active environment"]',
        ) as HTMLSelectElement
      ).selectedOptions[0].textContent,
    ).toBe("New environment");
    expect(document.querySelector(".service-main")?.textContent).toContain(
      "Environment name",
    );
    const back = [
      ...document.querySelectorAll<HTMLButtonElement>("button"),
    ].find((button) => button.textContent === "Back to request")!;
    await act(async () => back.click());
    await click('[aria-label="Edit environment"]');
    expect(document.querySelector(".service-main")?.textContent).toContain(
      "Variables",
    );
    vi.mocked(window.confirm).mockReturnValue(true);
    await click('[aria-label="Delete environment"]');
    expect(
      (
        document.querySelector(
          '[aria-label="Active environment"]',
        ) as HTMLSelectElement
      ).value,
    ).toBe("");
    expect(
      document.querySelector('[aria-label="Edit environment"]'),
    ).toBeNull();
  });
  it("shows saved project colors on cards and breadcrumbs and offers ten edit choices", async () => {
    await act(async () => root.unmount());
    vi.spyOn(bridge, "listProjects").mockResolvedValue([
      { ...bridge.previewProject, color: "#68caff" },
    ]);
    root = createRoot(document.getElementById("root")!);
    await act(async () => root.render(<App />));
    expect(
      (
        document.querySelector(".project-card") as HTMLElement
      ).style.getPropertyValue("--project-color"),
    ).toBe("#68caff");
    await click('[aria-label="Edit project Welcome to Octode"]');
    expect(document.querySelectorAll(".project-colors button")).toHaveLength(
      10,
    );
    expect(
      document
        .querySelector('[aria-label="Blue"]')
        ?.getAttribute("aria-pressed"),
    ).toBe("true");
    await click('[aria-label="Close"]');
    await click(".project-card");
    await waitFor(() => document.querySelector(".tree-root"));
    expect(
      (document.querySelector(".project-nav-name") as HTMLElement).style.getPropertyValue("--project-color"),
    ).toBe("#68caff");
  });

  it("removes the Code title row, puts Collapse All first, and middle-click closes a file through autosave", async () => {
    await enterCode();
    expect(document.querySelector(".explorer-heading")).toBeNull();
    expect(
      document
        .querySelector(".file-actions button")
        ?.getAttribute("aria-label"),
    ).toBe("Collapse all folders");
    await click(".tree-root");
    await click('[title="/welcome/README.md"]');
    const tab = await waitFor(() =>
      document.querySelector<HTMLElement>(".document-tab"),
    );
    await type('[aria-label="Edit README.md"]', "Middle-click draft");
    await act(async () =>
      tab.dispatchEvent(
        new MouseEvent("mouseup", {
          button: 1,
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    await waitFor(() => !document.querySelector(".document-tab"));
    expect(
      await bridge.readFile(bridge.previewProject, "/welcome/README.md"),
    ).toBe("Middle-click draft");
  });

  it("opens combined search with two clean Shift taps and jumps to a function declaration", async () => {
    await enterCode();
    const tap = async () => {
      await act(async () => {
        window.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Shift", bubbles: true }),
        );
        window.dispatchEvent(
          new KeyboardEvent("keyup", { key: "Shift", bubbles: true }),
        );
      });
    };
    await tap();
    expect(
      document.querySelector('[aria-label="Search everywhere"][role="dialog"]'),
    ).toBeNull();
    await tap();
    await waitFor(() =>
      document.querySelector('[aria-label="Search all sections"]'),
    );
    await type('[aria-label="Search all sections"]', "WelcomeController");
    await waitFor(
      () =>
        document.querySelectorAll('#everywhere-results [role="option"]')
          .length >= 2,
    );
    expect(
      document.querySelector("#everywhere-results")?.textContent,
    ).toContain("class");
    expect(
      document.querySelector("#everywhere-results")?.textContent,
    ).toContain("file");
    await type('[aria-label="Search all sections"]', "index");
    await waitFor(() =>
      document
        .querySelector('#everywhere-results [role="option"]')
        ?.textContent?.includes("function"),
    );
    await act(async () =>
      document.querySelector('input[role="combobox"]')!.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    const editor = await waitFor(() =>
      document.querySelector<HTMLTextAreaElement>(
        '[aria-label="Edit WelcomeController.php"]',
      ),
    );
    const text = await bridge.readFile(
      bridge.previewProject,
      "/welcome/app/Http/Controllers/WelcomeController.php",
    );
    expect(text.slice(0, editor.selectionStart).split("\n").length).toBe(9);
    expect(
      document.querySelector('[aria-label="Search everywhere"][role="dialog"]'),
    ).toBeNull();
    await click('[aria-label="API"]');
    await tap();
    await tap();
    await waitFor(() =>
      document.querySelector('[aria-label="Search everywhere"][role="dialog"]'),
    );
  });

  it("searches all section lists, opens unvisited tools, and includes live unsaved API names", async () => {
    const previous = await Promise.all([
      toolsBridge.loadTool(bridge.previewProject, "api", apiDocument),
      toolsBridge.loadTool(bridge.previewProject, "servers", serverDocument),
      toolsBridge.loadTool(bridge.previewProject, "database", databaseDocument),
    ]);
    try {
      const api = apiDocument(),
        servers = serverDocument(),
        database = databaseDocument();
      const request = {
        ...apiRequest(),
        name: "SearchQA endpoint",
        folderId: "search-folder",
      };
      api.requests.push(request);
      api.folders.push({ id: "search-folder", name: "SearchQA folder" });
      api.environments.push({
        id: "search-env",
        name: "SearchQA environment",
        variables: [],
      });
      const server = { ...serverConnection(), name: "SearchQA SSH" };
      servers.connections.push(server);
      const connection = { ...databaseConnection(), name: "SearchQA SQLite" };
      database.connections.push(connection);
      database.queries.push({
        id: "search-query",
        name: "SearchQA report",
        sql: "SELECT 42;",
        connectionId: connection.id,
      });
      await toolsBridge.saveTool(bridge.previewProject, "api", api);
      await toolsBridge.saveTool(bridge.previewProject, "servers", servers);
      await toolsBridge.saveTool(bridge.previewProject, "database", database);
      const network = vi.spyOn(toolsBridge, "nativeTool");
      const save = vi.spyOn(toolsBridge, "saveTool");
      await enterCode();
      const openSearch = async (query: string) => {
        await act(async () => {
          for (let i = 0; i < 2; i++) {
            window.dispatchEvent(
              new KeyboardEvent("keydown", { key: "Shift", bubbles: true }),
            );
            window.dispatchEvent(
              new KeyboardEvent("keyup", { key: "Shift", bubbles: true }),
            );
          }
        });
        await type('[aria-label="Search all sections"]', query);
        await waitFor(() =>
          document.querySelector('#everywhere-results [role="option"]'),
        );
      };
      const choose = async () => {
        await click('#everywhere-results [role="option"]');
      };
      await openSearch("SearchQA SSH");
      await choose();
      await waitFor(
        () =>
          document.querySelector('[aria-label="Servers workspace"] h2')
            ?.textContent === server.name,
      );
      await openSearch("SearchQA SQLite");
      await choose();
      await waitFor(
        () =>
          document.querySelector('[aria-label="Database workspace"] h2')
            ?.textContent === connection.name,
      );
      await openSearch("SearchQA report");
      await choose();
      await waitFor(
        () =>
          document.querySelector<HTMLInputElement>('[aria-label="Query name"]')
            ?.value === "SearchQA report",
      );
      expect(
        document.querySelector<HTMLButtonElement>(
          '[aria-label="Database workspace"] .primary-button',
        )?.textContent,
      ).toBe("Connect");
      await openSearch("SearchQA environment");
      await choose();
      await waitFor(() =>
        document
          .querySelector('[aria-label="API workspace"]')
          ?.textContent?.includes("Back to request"),
      );
      await openSearch("SearchQA endpoint");
      await choose();
      await waitFor(
        () =>
          document.querySelector<HTMLInputElement>(
            '[aria-label="Request name"]',
          )?.value === request.name,
      );
      await type('[aria-label="Request name"]', "SearchQA live draft");
      await click('[aria-label="Servers"]');
      await openSearch("SearchQA live draft");
      await choose();
      await waitFor(
        () =>
          document.querySelector<HTMLInputElement>(
            '[aria-label="Request name"]',
          )?.value === "SearchQA live draft",
      );
      expect(
        network.mock.calls.filter(([command]) =>
          /^(ssh_connect|database_connect|database_query|api_send)$/.test(
            command,
          ),
        ),
      ).toEqual([]);
      expect(save).not.toHaveBeenCalled();
    } finally {
      await toolsBridge.saveTool(bridge.previewProject, "api", previous[0]);
      await toolsBridge.saveTool(bridge.previewProject, "servers", previous[1]);
      await toolsBridge.saveTool(
        bridge.previewProject,
        "database",
        previous[2],
      );
    }
  });

  it("restores Code drafts only after choosing Restore", async () => {
    const baseline = await bridge.readFile(
      bridge.previewProject,
      "/welcome/README.md",
    );
    vi.mocked(recovery.loadDrafts).mockResolvedValue([
      {
        path: "/welcome/README.md",
        text: "Recovered unsaved draft",
        saved: baseline,
      },
    ]);
    await enterCode();
    await waitFor(() => document.querySelector(".recovery-banner"));
    expect(
      await bridge.readFile(bridge.previewProject, "/welcome/README.md"),
    ).toBe(baseline);
    const restore = [
      ...document.querySelectorAll<HTMLButtonElement>(
        ".recovery-banner button",
      ),
    ].find((button) => button.textContent === "Restore")!;
    await act(async () => restore.click());
    await waitFor(
      () =>
        document.querySelector<HTMLTextAreaElement>(
          '[aria-label="Edit README.md"]',
        )?.value === "Recovered unsaved draft",
    );
    await click('[aria-label="Back to projects"]');
    expect(
      await bridge.readFile(bridge.previewProject, "/welcome/README.md"),
    ).toBe("Recovered unsaved draft");
  });
  it("keeps multiple terminal tabs and exposes editor settings without changing Code save rules", async () => {
    await enterCode();
    await click('[aria-label="Local terminal"]');
    await waitFor(() => document.querySelector(".preview-terminal"));
    await click('[aria-label="New terminal"]');
    await waitFor(
      () => document.querySelectorAll(".local-terminal-session").length === 2,
    );
    await click('[aria-label="Hide terminal"]');
    expect(document.querySelectorAll(".local-terminal-session")).toHaveLength(
      2,
    );
    await click('[aria-label="Settings"]');
    await waitFor(() =>
      document.querySelector('[aria-label="Editor font size"]'),
    );
    expect(
      document.querySelector('[aria-label="Settings"][role="dialog"]')
        ?.textContent,
    ).toContain(
      "Code autosaves. Server, Database, and API settings require Save",
    );
    const savedSettings = localStorage.getItem("octode-editor-settings");
    await type('[aria-label="Editor font size"]', "18");
    expect(localStorage.getItem("octode-editor-settings")).toBe(savedSettings);
    await click('.modal-footer button[type="submit"]');
    expect(
      JSON.parse(localStorage.getItem("octode-editor-settings")!).fontSize,
    ).toBe(18);
    await click('[aria-label="Settings"]');
    await type('[aria-label="Editor font size"]', "19");
    await click('[aria-label="Close settings"]');
    expect(
      JSON.parse(localStorage.getItem("octode-editor-settings")!).fontSize,
    ).toBe(18);
  });

  it("shows one header breadcrumb with clickable project home and the current tool", async () => {
    await enterCode();
    const nav = () =>
      document.querySelector('[aria-label="Project breadcrumb"]');
    expect(nav()?.textContent).toBe("Projects/Welcome to Octode/Code");
    expect(document.querySelector(".title-context")).toBeNull();
    await click('[aria-label="Project home"]');
    expect(document.querySelector(".tools-grid")).toBeNull();
    expect(nav()?.textContent).toBe("Projects/Welcome to Octode/Code");
    await click('.rail-button[aria-label="Servers"]');
    expect(nav()?.textContent).toBe("Projects/Welcome to Octode/Servers");
  });
  it("creates, renames, and deletes an open file while preserving autosaved content", async () => {
    await enterCode();
    await click(".tree-root");
    await click('[aria-label="New file"]');
    await type('[aria-label="File name or destination"]', "workflow-check.php");
    await click('.file-operation-modal button[type="submit"]');
    await waitFor(() =>
      document.querySelector('[aria-label="Edit workflow-check.php"]'),
    );
    await type('[aria-label="Edit workflow-check.php"]', '<?php echo "saved";');
    const file = await waitFor(() =>
      [...document.querySelectorAll<HTMLButtonElement>(".tree-row")].find(
        (button) => button.textContent?.includes("workflow-check.php"),
      ),
    );
    await act(async () => file.click());
    await click('[aria-label="Rename or move selected item"]');
    await type('[aria-label="File name or destination"]', "renamed-check.php");
    await click('.file-operation-modal button[type="submit"]');
    await waitFor(() =>
      document.querySelector('[aria-label="Edit renamed-check.php"]'),
    );
    expect(
      await bridge.readFile(
        bridge.previewProject,
        "/welcome/renamed-check.php",
      ),
    ).toBe('<?php echo "saved";');
    await click('[aria-label="Delete selected item"]');
    await click('.file-operation-modal button[type="submit"]');
    await waitFor(
      () => !document.querySelector('[aria-label="Edit renamed-check.php"]'),
    );
    await expect(
      bridge.readFile(bridge.previewProject, "/welcome/renamed-check.php"),
    ).rejects.toThrow();
  });
  it("reloads clean files changed externally without replacing local edits", async () => {
    await enterCode();
    await click(".tree-root");
    const button = await waitFor(() =>
      [...document.querySelectorAll<HTMLButtonElement>(".tree-row")].find(
        (button) => button.textContent?.includes("README.md"),
      ),
    );
    await act(async () => button.click());
    await waitFor(() =>
      document.querySelector('[aria-label="Edit README.md"]'),
    );
    vi.spyOn(bridge, "inspectFiles").mockResolvedValue([
      {
        path: "/welcome/README.md",
        stamp: "changed",
        content: "External update",
        error: null,
      },
    ]);
    await act(async () => window.dispatchEvent(new Event("focus")));
    await waitFor(
      () =>
        document.querySelector<HTMLTextAreaElement>(
          '[aria-label="Edit README.md"]',
        )?.value === "External update",
    );
    expect(document.querySelector(".disk-change-banner")).toBeNull();
  });
  it("pauses autosave for a disk conflict and keeps the editor draft", async () => {
    await enterCode();
    await click(".tree-root");
    const button = await waitFor(() =>
      [...document.querySelectorAll<HTMLButtonElement>(".tree-row")].find(
        (button) => button.textContent?.includes("README.md"),
      ),
    );
    await act(async () => button.click());
    await waitFor(() =>
      document.querySelector('[aria-label="Edit README.md"]'),
    );
    await type('[aria-label="Edit README.md"]', "Local draft must survive");
    const write = vi.spyOn(bridge, "saveFile");
    vi.spyOn(bridge, "inspectFiles").mockResolvedValue([
      {
        path: "/welcome/README.md",
        stamp: "conflict",
        content: "External edit",
        error: null,
      },
    ]);
    await act(async () => window.dispatchEvent(new Event("focus")));
    await waitFor(() => document.querySelector(".disk-change-banner"));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 700));
    });
    expect(
      document.querySelector<HTMLTextAreaElement>(
        '[aria-label="Edit README.md"]',
      )?.value,
    ).toBe("Local draft must survive");
    expect(write).not.toHaveBeenCalled();
    await click(".disk-change-banner button");
    await waitFor(() =>
      document.querySelector('[aria-label="Compare external changes"]'),
    );
    expect(document.querySelector(".text-compare")?.textContent).toContain(
      "Local draft must survive",
    );
  });

  it("keeps API drafts when parking a project without saving and restores explicitly saved requests", async () => {
    await click('[aria-label="New project"]');
    await click('.rail-button[aria-label="API"]');
    await click('[aria-label="API workspace"] button[title="New request"]');
    await type('[aria-label="Request URL"]', "https://example.test/users");
    const apiSave = () =>
      document.querySelector<HTMLButtonElement>(
        '[aria-label="API workspace"] .service-toolbar > [aria-label="Save changes"]',
      );
    expect(apiSave()?.disabled).toBe(false);
    expect(
      document.querySelector(
        '.rail-button[aria-label="API"] .rail-unsaved-dot',
      ),
    ).not.toBeNull();
    await click('.rail-button[aria-label="Servers"]');
    await waitFor(() =>
      document.querySelector('[aria-label="Servers workspace"]'),
    );
    await click('.rail-button[aria-label="API"]');
    expect(
      document.querySelector<HTMLInputElement>('[aria-label="Request URL"]')
        ?.value,
    ).toBe("https://example.test/users");
    expect(
      document.querySelector(
        '.rail-button[aria-label="API"] .rail-unsaved-dot',
      ),
    ).not.toBeNull();
    const save = vi.spyOn(toolsBridge, "saveTool");
    await act(async () => window.dispatchEvent(new Event("blur")));
    expect(save).not.toHaveBeenCalled();
    await click('[aria-label="Back to projects"]');
    expect(window.confirm).not.toHaveBeenCalled();
    await waitFor(() => document.querySelector(".projects-grid"));
    expect(save).not.toHaveBeenCalled();
    await click('[aria-label="New project"]');
    await waitFor(() => document.querySelector('[aria-label="API workspace"]'));
    expect(
      document.querySelector<HTMLInputElement>('[aria-label="Request URL"]')
        ?.value,
    ).toBe("https://example.test/users");
    await click(
      '[aria-label="API workspace"] .service-toolbar > [aria-label="Save changes"]',
    );
    expect(save).toHaveBeenCalledOnce();
    expect(
      document.querySelector(
        '.rail-button[aria-label="API"] .rail-unsaved-dot',
      ),
    ).toBeNull();
    await click('[aria-label="Back to projects"]');
    await waitFor(() => document.querySelector(".projects-grid"));
    await click('[aria-label="New project"]');
    await click('.rail-button[aria-label="API"]');
    await waitFor(() =>
      document.querySelector('[aria-label="API workspace"] .http-method'),
    );
    await click('[aria-label="API workspace"] .service-list-item');
    expect(
      document.querySelector<HTMLInputElement>('[aria-label="Request URL"]')
        ?.value,
    ).toBe("https://example.test/users");
  });

  it("duplicates and confirms deleting API requests directly in the sidebar without saving or sending", async () => {
    const save = vi.spyOn(toolsBridge, "saveTool");
    const send = vi.spyOn(toolsBridge, "nativeTool");
    await click('[aria-label="New project"]');
    await click('.rail-button[aria-label="API"]');
    await click('[aria-label="API workspace"] button[title="New request"]');
    await type('[aria-label="Request name"]', "Sidebar request QA");
    await type('[aria-label="Request URL"]', "https://example.test/duplicate");
    const before = document.querySelectorAll(".api-request-row").length;
    await click('[aria-label="Duplicate request Sidebar request QA"]');
    expect(document.querySelectorAll(".api-request-row")).toHaveLength(
      before + 1,
    );
    expect(
      document.querySelector<HTMLInputElement>('[aria-label="Request name"]')
        ?.value,
    ).toBe("Sidebar request QA copy");
    expect(
      document.querySelector<HTMLInputElement>('[aria-label="Request URL"]')
        ?.value,
    ).toBe("https://example.test/duplicate");
    await type('[aria-label="Request URL"]', "https://example.test/copy-only");
    await click('[aria-label="Delete request Sidebar request QA copy"]');
    expect(window.confirm).toHaveBeenCalled();
    expect(document.querySelectorAll(".api-request-row")).toHaveLength(
      before + 1,
    );
    vi.mocked(window.confirm).mockReturnValue(true);
    await click('[aria-label="Delete request Sidebar request QA copy"]');
    expect(document.querySelectorAll(".api-request-row")).toHaveLength(before);
    const original = [
      ...document.querySelectorAll<HTMLButtonElement>(
        ".api-request-row .service-list-item",
      ),
    ].find((item) => item.textContent?.includes("Sidebar request QA"))!;
    await act(async () => original.click());
    expect(
      document.querySelector<HTMLInputElement>('[aria-label="Request URL"]')
        ?.value,
    ).toBe("https://example.test/duplicate");
    expect(save).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("searches API requests across collapsed folders and clears without modifying saved requests", async () => {
    const requests = [
      {
        ...apiRequest(),
        id: "rooms",
        name: "List rooms",
        url: "https://example.test/rooms",
        folderId: "backend",
      },
      {
        ...apiRequest(),
        id: "create",
        name: "Create booking",
        method: "POST",
        url: "https://example.test/bookings",
        folderId: "backend",
      },
      {
        ...apiRequest(),
        id: "ping",
        name: "Ping",
        url: "https://example.test/health",
      },
    ];
    const originalLoad = toolsBridge.loadTool;
    vi.spyOn(toolsBridge, "loadTool").mockImplementation(
      async (project, tool, fallback) =>
        tool === "api"
          ? ({
              ...apiDocument(),
              folders: [{ id: "backend", name: "Backend" }],
              requests,
            } as any)
          : originalLoad(project, tool, fallback),
    );
    const save = vi.spyOn(toolsBridge, "saveTool");
    await enterCode();
    await click('[aria-label="API"]');
    await click('[aria-label="Collapse folder Backend"]');
    await type('[aria-label="Search requests"]', "ROOMS");
    expect(document.querySelectorAll(".api-route-row")).toHaveLength(1);
    expect(document.querySelector(".api-route-row")?.textContent).toContain(
      "List rooms",
    );
    await type('[aria-label="Search requests"]', "post");
    expect(document.querySelectorAll(".api-route-row")).toHaveLength(1);
    expect(document.querySelector(".api-route-row")?.textContent).toContain(
      "Create booking",
    );
    await type('[aria-label="Search requests"]', "/health");
    expect(document.querySelector(".api-route-row")?.textContent).toContain(
      "Ping",
    );
    await type('[aria-label="Search requests"]', "Backend");
    expect(document.querySelectorAll(".api-route-row")).toHaveLength(2);
    await type('[aria-label="Search requests"]', "no-match");
    expect(document.querySelectorAll(".api-route-row")).toHaveLength(0);
    expect(
      document.querySelector(".api-request-search-empty")?.textContent,
    ).toContain("No matching requests.");
    await click('[aria-label="Clear request search"]');
    expect(document.activeElement).toBe(
      document.querySelector('[aria-label="Search requests"]'),
    );
    expect(
      document.querySelector(
        '[aria-label="Request folder Backend"] .api-route-row',
      ),
    ).toBeNull();
    expect(document.querySelectorAll(".api-route-row")).toHaveLength(1);
    expect(
      document.querySelector('[aria-label="Clear request search"]'),
    ).toBeNull();
    expect(save).not.toHaveBeenCalled();
  });
  it("reviews unsaved changes and marks edited requests and collapsed folders until saved", async () => {
    const request = {
      ...apiRequest(),
      name: "List rooms",
      folderId: "backend",
    };
    const originalLoad = toolsBridge.loadTool;
    vi.spyOn(toolsBridge, "loadTool").mockImplementation(
      async (project, tool, fallback) =>
        tool === "api"
          ? ({
              ...apiDocument(),
              folders: [{ id: "backend", name: "Backend" }],
              requests: [request],
            } as any)
          : originalLoad(project, tool, fallback),
    );
    const save = vi
      .spyOn(toolsBridge, "saveTool")
      .mockImplementation(async (_p, _t, document) =>
        structuredClone(document),
      );
    await enterCode();
    await click('[aria-label="API"]');
    await click('[aria-label="Request folder Backend"] .service-list-item');
    await type('[aria-label="Request URL"]', "https://example.test/rooms");
    expect(
      document.querySelector('[aria-label="Unsaved request List rooms"]'),
    ).not.toBeNull();
    expect(
      document.querySelector(
        '[aria-label="Unsaved changes in folder Backend"]',
      ),
    ).not.toBeNull();
    await click('[aria-label="Collapse folder Backend"]');
    expect(
      document.querySelector('[aria-label="Unsaved request List rooms"]'),
    ).toBeNull();
    expect(
      document.querySelector(
        '[aria-label="Unsaved changes in folder Backend"]',
      ),
    ).not.toBeNull();
    await click('[title="Review unsaved changes"]');
    const review = document.querySelector(
      '[role="dialog"][aria-label="Unsaved changes"]',
    )!;
    expect(review.textContent).toContain("Requests › List rooms › Url changed");
    expect(save).not.toHaveBeenCalled();
    const button = [...review.querySelectorAll("button")].find(
      (button) => button.textContent === "Save changes",
    )!;
    await act(async () => button.click());
    expect(save).toHaveBeenCalledOnce();
    expect(
      document.querySelector(
        '[aria-label="Unsaved changes in folder Backend"]',
      ),
    ).toBeNull();
    await click('[aria-label="Expand folder Backend"]');
    expect(
      document.querySelector('[aria-label="Unsaved request List rooms"]'),
    ).toBeNull();
  });
  it("collapses API folders, hides the Unfiled heading, and keeps collapsed folders as drop targets", async () => {
    await enterCode();
    await click('[aria-label="API"]');
    await click('[aria-label="API workspace"] [title="New folder"]');
    await type('[aria-label="Folder name"]', "Backend");
    await act(async () =>
      document
        .querySelector<HTMLInputElement>('[aria-label="Folder name"]')!
        .blur(),
    );
    await click('[aria-label="API workspace"] button[title="New request"]');
    await type('[aria-label="Request name"]', "List rooms");
    const folder = () =>
      document.querySelector('[aria-label="Request folder Backend"]')!;
    const unfiled = document.querySelector(
      '[aria-label="Request folder Unfiled"]',
    )!;
    expect(unfiled.textContent).not.toContain("Unfiled");
    expect(document.querySelector('[aria-label="Folder name"]')).toBeNull();
    await click('[aria-label="Edit folder Backend"]');
    await type('[aria-label="Folder name"]', "Cancelled name");
    await act(async () =>
      document
        .querySelector<HTMLInputElement>('[aria-label="Folder name"]')!
        .dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        ),
    );
    expect(document.querySelector('[aria-label="Folder name"]')).toBeNull();
    expect(folder().querySelector(".folder-name-button")?.textContent).toBe(
      "Backend",
    );
    await click('[aria-label="Request folder Backend"] .folder-name-button');
    expect(folder().querySelector(".api-route-row")).toBeNull();
    const source = [...unfiled.querySelectorAll(".api-route-row")].find((row) =>
      row.textContent?.includes("List rooms"),
    )!;
    const transfer = { setData: vi.fn(), effectAllowed: "", dropEffect: "" };
    const drag = async (element: Element, type: string) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, "dataTransfer", { value: transfer });
      await act(async () => element.dispatchEvent(event));
    };
    await drag(source, "dragstart");
    await drag(folder(), "drop");
    expect(unfiled.textContent).not.toContain("List rooms");
    expect(folder().querySelector(".api-route-row")).toBeNull();
    await click('[aria-label="Expand folder Backend"]');
    expect(folder().textContent).toContain("List rooms");
    await drag(folder().querySelector(".api-route-row")!, "dragstart");
    await drag(document.querySelector(".api-request-heading")!, "drop");
    expect(unfiled.textContent).toContain("List rooms");
    expect(folder().querySelector(".api-route-row")).toBeNull();
  });

  it("moves API requests between sidebar folders and Unfiled by dragging, requiring explicit Save", async () => {
    const save = vi.spyOn(toolsBridge, "saveTool");
    await click('[aria-label="New project"]');
    await click('.rail-button[aria-label="API"]');
    await click('[aria-label="API workspace"] button[title="New request"]');
    await type('[aria-label="Request name"]', "Drag request QA");
    await type('[aria-label="Request URL"]', "https://example.test/drag");
    await click('[aria-label="API workspace"] button[title="New folder"]');
    await type('[aria-label="Folder name"]', "Endpoints");
    await act(async () =>
      document
        .querySelector<HTMLInputElement>('[aria-label="Folder name"]')!
        .blur(),
    );
    expect(
      document.querySelector(".request-name-row")?.querySelector("label")
        ?.textContent,
    ).toBe("Request name");
    expect(document.querySelector(".service-main")?.textContent).not.toContain(
      "Folder",
    );
    const folder = () =>
      document.querySelector<HTMLElement>(
        '[aria-label="Request folder Endpoints"]',
      )!;
    const unfiled = () =>
      document.querySelector<HTMLElement>(
        '[aria-label="Request folder Unfiled"]',
      )!;
    const source = () =>
      document
        .querySelector('[aria-label="Duplicate request Drag request QA"]')!
        .parentElement!.querySelector<HTMLButtonElement>(".service-list-item")!;
    const transfer = { setData: vi.fn(), effectAllowed: "", dropEffect: "" };
    const drag = async (element: Element, type: string) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, "dataTransfer", { value: transfer });
      await act(async () => {
        element.dispatchEvent(event);
      });
      return event;
    };
    await drag(folder(), "drop");
    expect(unfiled().textContent).toContain("Drag request QA");
    await drag(source(), "dragstart");
    expect((await drag(folder(), "dragover")).defaultPrevented).toBe(true);
    expect(folder().classList.contains("request-folder-drop")).toBe(true);
    await drag(folder(), "drop");
    expect(folder().textContent).toContain("Drag request QA");
    expect(unfiled().textContent).not.toContain("Drag request QA");
    expect(
      document.querySelector<HTMLInputElement>('[aria-label="Request URL"]')
        ?.value,
    ).toBe("https://example.test/drag");
    await drag(source(), "dragstart");
    await drag(unfiled(), "dragover");
    await drag(unfiled(), "drop");
    expect(unfiled().textContent).toContain("Drag request QA");
    expect(folder().textContent).not.toContain("Drag request QA");
    await drag(source(), "dragstart");
    await drag(folder(), "drop");
    expect(save).not.toHaveBeenCalled();
    await click(
      '[aria-label="API workspace"] .service-toolbar > [aria-label="Save changes"]',
    );
    const saved = save.mock.calls.at(
      -1,
    )![2] as import("./toolTypes").ApiDocument;
    const destination = saved.folders.find(
      (item) => item.name === "Endpoints",
    )!;
    expect(
      saved.requests.find((item) => item.name === "Drag request QA")?.folderId,
    ).toBe(destination.id);
  });

  it("moves API rows with pointer dragging and colors URL variables without losing editable text", async () => {
    await click('[aria-label="New project"]');
    await click('.rail-button[aria-label="API"]');
    await click('[aria-label="API workspace"] button[title="New request"]');
    await type('[aria-label="Request name"]', "Pointer QA");
    await type('[aria-label="Request URL"]', "{{url}}/users/{{id}}?plain=yes");
    expect(
      [...document.querySelectorAll(".request-variable")].map(
        (item) => item.textContent,
      ),
    ).toEqual(["{{url}}", "{{id}}"]);
    await click('[aria-label="API workspace"] button[title="New folder"]');
    await type('[aria-label="Folder name"]', "Pointer destination");
    await act(async () =>
      document
        .querySelector<HTMLInputElement>('[aria-label="Folder name"]')!
        .blur(),
    );
    const folder = document.querySelector<HTMLElement>(
      '[aria-label="Request folder Pointer destination"]',
    )!;
    const row = document.querySelector(
      '[aria-label="Duplicate request Pointer QA"]',
    )!.parentElement!;
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: () => folder,
    });
    const pointer = async (type: string, x: number, y: number) =>
      act(async () => {
        const event = new MouseEvent(type, {
          bubbles: true,
          clientX: x,
          clientY: y,
          button: 0,
        });
        Object.defineProperty(event, "pointerId", { value: 1 });
        row.dispatchEvent(event);
      });
    await pointer("pointerdown", 20, 20);
    await pointer("pointermove", 80, 80);
    expect(folder.classList.contains("request-folder-drop")).toBe(true);
    await pointer("pointerup", 80, 80);
    expect(folder.textContent).toContain("Pointer QA");
    expect(
      document.querySelector<HTMLInputElement>('[aria-label="Request URL"]')
        ?.value,
    ).toBe("{{url}}/users/{{id}}?plain=yes");
    expect(
      document.querySelector(".service-content > .danger-action"),
    ).toBeNull();
    expect(
      document.querySelector(
        '.request-name-row [aria-label="Delete selected request"]',
      ),
    ).not.toBeNull();
    Reflect.deleteProperty(document, "elementFromPoint");
  });
  it("duplicates server profiles from their connection header", async () => {
    await click('[aria-label="New project"]');
    await click('.rail-button[aria-label="Servers"]');
    await click('[aria-label="Servers workspace"] button[title="New server"]');
    await type('input[aria-label="Host"]', "example.test");
    await click('[aria-label="Duplicate server New server"]');
    expect(
      document.querySelector('[aria-label="Delete server New server copy"]'),
    ).not.toBeNull();
    expect(
      document.querySelector<HTMLInputElement>('[aria-label="Host"]')?.value,
    ).toBe("example.test");
  });

  it("opens real connection forms for Servers and Database with explicit Save", async () => {
    await click('[aria-label="New project"]');
    await click('.rail-button[aria-label="Servers"]');
    await click('[aria-label="Servers workspace"] button[title="New server"]');
    await waitFor(() => document.querySelector(".host-fingerprint"));
    expect(
      document.querySelector(
        '[aria-label="Servers workspace"] .service-toolbar',
      ),
    ).not.toBeNull();
    expect(
      document.querySelector(
        '[aria-label="Servers workspace"] .service-toolbar [aria-label="Save changes"]',
      ),
    ).not.toBeNull();
    expect(document.querySelector(".rail-label")).toBeNull();
    expect(document.querySelector(".host-fingerprint")?.textContent).toContain(
      "Not checked yet",
    );
    expect(
      document.querySelector<HTMLButtonElement>(
        '[aria-label="Servers workspace"] [aria-label="Save changes"]',
      )?.disabled,
    ).toBe(false);
    await click('.rail-button[aria-label="Database"]');
    await click(
      '[aria-label="Database workspace"] button[title="New database"]',
    );
    await waitFor(() =>
      document.querySelector(
        '[aria-label="Database workspace"] input[type="checkbox"]',
      ),
    );
    expect(
      document.querySelector<HTMLInputElement>(
        '[aria-label="Database workspace"] input[type="checkbox"]',
      )?.checked,
    ).toBe(true);
    expect(
      document.querySelector('[aria-label="Database workspace"]')?.textContent,
    ).toContain("SQLite database file");
    expect(
      document.querySelector(
        '.rail-button[aria-label="Servers"] .rail-unsaved-dot',
      ),
    ).not.toBeNull();
    expect(
      document.querySelector(
        '.rail-button[aria-label="Database"] .rail-unsaved-dot',
      ),
    ).not.toBeNull();
    await click(
      '[aria-label="Database workspace"] [aria-label="Save changes"]',
    );
    expect(
      document.querySelector(
        '.rail-button[aria-label="Database"] .rail-unsaved-dot',
      ),
    ).toBeNull();
    expect(
      document.querySelector(
        '.rail-button[aria-label="Servers"] .rail-unsaved-dot',
      ),
    ).not.toBeNull();
    await click('.rail-button[aria-label="Servers"]');
    await click('[aria-label="Servers workspace"] [aria-label="Save changes"]');
    expect(
      document.querySelector(
        '.rail-button[aria-label="Servers"] .rail-unsaved-dot',
      ),
    ).toBeNull();
    await click('[aria-label="Back to projects"]');
    expect(window.confirm).not.toHaveBeenCalled();
  });

  it("returns to Projects in the same window after flushing Code edits", async () => {
    const openWindow = vi.spyOn(window, "open");
    await enterCode();
    await click(".tree-root");
    const file = await waitFor(() =>
      [...document.querySelectorAll<HTMLButtonElement>(".tree-row")].find(
        (button) => button.textContent?.includes("README.md"),
      ),
    );
    await act(async () => {
      file.click();
    });
    await type("textarea", "# Saved before Projects\n");
    await click('[aria-label="Back to projects"]');
    expect(document.querySelector(".section-label")?.textContent).toContain(
      "Projects",
    );
    expect(document.querySelector(".hero-heading")).toBeNull();
    expect(document.querySelector(".new-project-card")).toBeNull();
    expect(
      document.querySelectorAll('[aria-label="New project"]'),
    ).toHaveLength(1);
    expect(
      await bridge.readFile(bridge.previewProject, "/welcome/README.md"),
    ).toBe("# Saved before Projects\n");
    expect(openWindow).not.toHaveBeenCalled();
  });
  it("autosaves Code when switching tools and closes saved tabs without a prompt", async () => {
    await enterCode();
    await click(".tree-root");
    const file = await waitFor(() =>
      [...document.querySelectorAll<HTMLButtonElement>(".tree-row")].find(
        (button) => button.textContent?.includes("README.md"),
      ),
    );
    await act(async () => {
      file.click();
    });
    await type("textarea", "# Browser-sandbox edit\n");
    expect(document.querySelector(".dirty-dot")).not.toBeNull();
    await click('[aria-label="API"]');
    await waitFor(() => !document.querySelector(".dirty-dot"));
    await click('[aria-label="Code"]');
    expect(document.querySelector("textarea")?.value).toBe(
      "# Browser-sandbox edit\n",
    );
    expect(
      await bridge.readFile(bridge.previewProject, "/welcome/README.md"),
    ).toBe("# Browser-sandbox edit\n");
    expect(document.querySelector('[aria-label="Save file"]')).toBeNull();
    await click('[aria-label="Close README.md"]');
    expect(window.confirm).not.toHaveBeenCalled();
    expect(document.querySelector(".dirty-dot")).toBeNull();
  });
  it("automatically saves after typing without clicking Save", async () => {
    await enterCode();
    await click(".tree-root");
    const file = await waitFor(() =>
      [...document.querySelectorAll<HTMLButtonElement>(".tree-row")].find(
        (button) => button.textContent?.includes("README.md"),
      ),
    );
    await act(async () => {
      file.click();
    });
    await type("textarea", "# Autosaved after typing\n");
    expect(
      document.querySelector(
        '.rail-button[aria-label="Code"] .rail-unsaved-dot',
      ),
    ).not.toBeNull();
    await waitFor(() => !document.querySelector(".dirty-dot"));
    expect(
      await bridge.readFile(bridge.previewProject, "/welcome/README.md"),
    ).toBe("# Autosaved after typing\n");
    expect(document.body.textContent).toContain("Autosaved");
    expect(
      document.querySelector(
        '.rail-button[aria-label="Code"] .rail-unsaved-dot',
      ),
    ).toBeNull();
  });
  it("flushes pending edits before closing a Code tab", async () => {
    await enterCode();
    await click(".tree-root");
    const file = await waitFor(() =>
      [...document.querySelectorAll<HTMLButtonElement>(".tree-row")].find(
        (button) => button.textContent?.includes("README.md"),
      ),
    );
    await act(async () => {
      file.click();
    });
    await type("textarea", "# Save before tab closes\n");
    await click('[aria-label="Close README.md"]');
    expect(
      await bridge.readFile(bridge.previewProject, "/welcome/README.md"),
    ).toBe("# Save before tab closes\n");
    expect(window.confirm).not.toHaveBeenCalled();
    expect(document.querySelector("textarea")).toBeNull();
  });
  it("keeps a failed autosave buffer open and supports explicit retry", async () => {
    const save = vi
      .spyOn(bridge, "saveFile")
      .mockRejectedValueOnce(new Error("Changed on disk"));
    await enterCode();
    await click(".tree-root");
    const file = await waitFor(() =>
      [...document.querySelectorAll<HTMLButtonElement>(".tree-row")].find(
        (button) => button.textContent?.includes("README.md"),
      ),
    );
    await act(async () => {
      file.click();
    });
    const original = await bridge.readFile(
      bridge.previewProject,
      "/welcome/README.md",
    );
    await type("textarea", "# Keep this buffer\n");
    await waitFor(() =>
      document.querySelector('[aria-label="Retry autosave"]'),
    );
    expect(
      await bridge.readFile(bridge.previewProject, "/welcome/README.md"),
    ).toBe(original);
    await click('[aria-label="Close README.md"]');
    expect(window.confirm).toHaveBeenCalled();
    expect(document.querySelector("textarea")?.value).toBe(
      "# Keep this buffer\n",
    );
    await click('[aria-label="Retry autosave"]');
    await waitFor(() => !document.querySelector(".dirty-dot"));
    expect(save).toHaveBeenCalledTimes(2);
    expect(
      await bridge.readFile(bridge.previewProject, "/welcome/README.md"),
    ).toBe("# Keep this buffer\n");
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });
  it("keeps Find in file separate from Search Everywhere for its button and Cmd+F", async () => {
    await enterCode();
    await click(".tree-root");
    await click('[title="/welcome/README.md"]');
    await click('button[aria-label="Find in file"]');
    await type('input[aria-label="Find in file"]', "Octode");
    expect(
      document.querySelector('[aria-label="Search everywhere"][role="dialog"]'),
    ).toBeNull();
    await click('[aria-label="Close find"]');
    await act(async () =>
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "f",
          metaKey: true,
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    await waitFor(() =>
      document.querySelector('input[aria-label="Find in file"]'),
    );
    expect(
      document.querySelector('[aria-label="Search everywhere"][role="dialog"]'),
    ).toBeNull();
  });

  it("Cmd+W autosaves and closes the active Code tab while keeping the project open", async () => {
    await enterCode();
    await click(".tree-root");
    await click('[title="/welcome/README.md"]');
    await type('[aria-label="Edit README.md"]', "Close tab saved draft");
    const key = () =>
      new KeyboardEvent("keydown", {
        key: "w",
        metaKey: true,
        bubbles: true,
        cancelable: true,
      });
    const event = key();
    await act(async () => {
      window.dispatchEvent(event);
    });
    await waitFor(() => !document.querySelector(".document-tab"));
    expect(event.defaultPrevented).toBe(true);
    expect(
      await bridge.readFile(bridge.previewProject, "/welcome/README.md"),
    ).toBe("Close tab saved draft");
    const emptyClose = key();
    await act(async () => {
      window.dispatchEvent(emptyClose);
    });
    expect(emptyClose.defaultPrevented).toBe(true);
    expect(document.querySelector(".tree-root")).not.toBeNull();
    expect(
      document.querySelector('[aria-label="Project breadcrumb"]'),
    ).not.toBeNull();
  });

  it("opens file context actions and copies, moves, duplicates, renames and copies paths without losing drafts", async () => {
    const clipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    try {
      const project = bridge.previewProject;
      const folder = await bridge.fileAction(project, {
        action: "create-folder",
        path: "/welcome",
        name: `context-${crypto.randomUUID()}`,
      });
      const destination = await bridge.fileAction(project, {
        action: "create-folder",
        path: folder,
        name: "destination",
      });
      const movedFolder = await bridge.fileAction(project, {
        action: "create-folder",
        path: folder,
        name: "moved",
      });
      const source = await bridge.fileAction(project, {
        action: "create-file",
        path: folder,
        name: "one.ts",
      });
      await bridge.saveFile(project, source, "initial content", "");
      await enterCode();
      await click(".tree-root");
      await click(`[title="${folder}"]`);
      await click(`[title="${source}"]`);
      await type('[aria-label="Edit one.ts"]', "new unsaved code");
      const context = async (selector: string) => {
        const item = await waitFor(() =>
          document.querySelector<HTMLElement>(selector),
        );
        await act(async () => {
          item.dispatchEvent(
            new MouseEvent("contextmenu", {
              bubbles: true,
              cancelable: true,
              clientX: 100,
              clientY: 200,
            }),
          );
        });
        await waitFor(() => document.querySelector('[role="menu"]'));
      };
      const action = async (label: string) => {
        const button = [
          ...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
        ].find((item) => item.textContent === label)!;
        expect(button).toBeTruthy();
        expect(button.disabled).toBe(false);
        await act(async () => button.click());
      };
      await context(`.file-tree [title="${source}"]`);
      expect(document.querySelectorAll('[role="menuitem"]')).toHaveLength(10);
      expect(document.activeElement?.textContent).toBe("New File");
      await act(async () =>
        document.activeElement!.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "ArrowDown",
            bubbles: true,
            cancelable: true,
          }),
        ),
      );
      expect(document.activeElement?.textContent).toBe("New Folder");
      await action("New Folder");
      expect(document.querySelector(".file-operation-modal header strong")?.textContent).toBe("New Folder");
      expect(document.querySelector(".file-operation-modal > p")?.textContent).toBe(folder);
      await type('[aria-label="File name or destination"]', "new-sibling-folder");
      await click('.file-operation-modal button[type="submit"]');
      await waitFor(() => !document.querySelector(".file-operation-modal"));
      expect((await bridge.listDirectory(project, folder)).some((entry) => entry.name === "new-sibling-folder" && entry.directory)).toBe(true);
      await context(`.file-tree [title="${source}"]`);
      await action("New File");
      expect(document.querySelector(".file-operation-modal header strong")?.textContent).toBe("New File");
      expect(document.querySelector(".file-operation-modal > p")?.textContent).toBe(folder);
      expect(document.querySelector('[role="menu"]')).toBeNull();
      await type('[aria-label="File name or destination"]', "new-sibling.ts");
      await click('.file-operation-modal button[type="submit"]');
      await waitFor(() => document.querySelector('[aria-label="Edit new-sibling.ts"]'));
      expect(await bridge.readFile(project, `${folder}/new-sibling.ts`)).toBe("");
      await context(`.file-tree [title="${source}"]`);
      await action("Copy");
      await context(`.file-tree [title="${destination}"]`);
      await action("Paste");
      const copied = `${destination}/one.ts`;
      await waitFor(() =>
        document.querySelector(`.document-tab [title="${copied}"]`),
      );
      expect(await bridge.readFile(project, source)).toBe("new unsaved code");
      expect(await bridge.readFile(project, copied)).toBe("new unsaved code");
      await context(`.document-tab [title="${copied}"]`);
      await action("Cut");
      await context(`.file-tree [title="${movedFolder}"]`);
      await action("Paste");
      const moved = `${movedFolder}/one.ts`;
      await waitFor(() =>
        document.querySelector(`.document-tab [title="${moved}"]`),
      );
      await expect(bridge.readFile(project, copied)).rejects.toThrow(
        "unavailable",
      );
      expect(await bridge.readFile(project, moved)).toBe("new unsaved code");
      await context(`.document-tab [title="${moved}"]`);
      await action("Duplicate");
      const duplicate = `${movedFolder}/one copy.ts`;
      await waitFor(() =>
        document.querySelector(`.document-tab [title="${duplicate}"]`),
      );
      expect(await bridge.readFile(project, duplicate)).toBe(
        "new unsaved code",
      );
      await context(`.document-tab [title="${duplicate}"]`);
      await action("Copy Path");
      expect(writeText).toHaveBeenCalledWith(duplicate);
      await context(`.document-tab [title="${duplicate}"]`);
      await action("Rename");
      await type('[aria-label="File name or destination"]', "renamed.ts");
      await click('[aria-label="File operation"] button[type="submit"]');
      const renamed = `${movedFolder}/renamed.ts`;
      await waitFor(() =>
        document.querySelector(`.document-tab [title="${renamed}"]`),
      );
      expect(await bridge.readFile(project, renamed)).toBe("new unsaved code");
      await context(`.document-tab [title="${renamed}"]`);
      await action("Delete File");
      expect(document.querySelector(".file-operation-modal header strong")?.textContent).toBe("Delete File");
      expect(await bridge.readFile(project, renamed)).toBe("new unsaved code");
      await click('[aria-label="Cancel file operation"]');
      expect(await bridge.readFile(project, renamed)).toBe("new unsaved code");
      await context(`.document-tab [title="${renamed}"]`);
      await action("Delete File");
      await click('.file-operation-modal button[type="submit"]');
      await waitFor(() => !document.querySelector(`.document-tab [title="${renamed}"]`));
      await expect(bridge.readFile(project, renamed)).rejects.toThrow("unavailable");
      expect(document.querySelector('[role="alert"]')).toBeNull();
    } finally {
      if (clipboard) Object.defineProperty(navigator, "clipboard", clipboard);
      else Reflect.deleteProperty(navigator, "clipboard");
    }
  });

  it("reveals the open tab in the file list after Collapse All", async () => {
    await enterCode();
    await click('[title="/welcome/app"]');
    await click('[title="/welcome/app/Http"]');
    await click('[title="/welcome/app/Http/Controllers"]');
    await click(
      '[title="/welcome/app/Http/Controllers/WelcomeController.php"]',
    );
    await click('[aria-label="Collapse all folders"]');
    expect(
      document.querySelector(
        '.file-tree [title="/welcome/app/Http/Controllers/WelcomeController.php"]',
      ),
    ).toBeNull();
    const actions = [...document.querySelectorAll(".file-actions button")];
    expect(actions[1].getAttribute("aria-label")).toBe("Reveal active file");
    await click('[aria-label="Reveal active file"]');
    const row = await waitFor(() =>
      document.querySelector(
        '.file-tree [title="/welcome/app/Http/Controllers/WelcomeController.php"]',
      ),
    );
    expect(row.classList.contains("selected")).toBe(true);
    expect(
      document
        .querySelector('[title="/welcome/app/Http/Controllers"]')
        ?.getAttribute("aria-expanded"),
    ).toBe("true");
    expect(document.querySelectorAll(".document-tab")).toHaveLength(1);
  });

  it("uses the folder dropdown to scope the file list and follows file-tab selections across roots", async () => {
    await act(async () => root.unmount());
    const project = {
      ...bridge.previewProject,
      roots: ["/welcome/app", "/welcome"],
    };
    vi.spyOn(bridge, "listProjects").mockResolvedValue([project]);
    root = createRoot(document.getElementById("root")!);
    await act(async () => root.render(<App />));
    await click(".project-card");
    const selector = await waitFor(() =>
      document.querySelector<HTMLSelectElement>(
        '[aria-label="Active project folder"]',
      ),
    );
    const chooseFolder = async (path: string) =>
      act(async () => {
        selector.value = path;
        selector.dispatchEvent(new Event("change", { bubbles: true }));
      });
    expect(selector.value).toBe("/welcome/app");
    await waitFor(
      () =>
        document.querySelector(".root-select .folder-branch-pill")
          ?.textContent === "preview",
    );
    expect(
      document.querySelector(".root-select .folder-name")?.textContent,
    ).toBe("app");
    expect(document.querySelector(".file-tree .folder-branch-pill")).toBeNull();
    expect(document.querySelectorAll(".file-tree .tree-root")).toHaveLength(1);
    expect(
      document.querySelector(".file-tree .tree-root")?.getAttribute("title"),
    ).toBe("/welcome/app");
    await chooseFolder("/welcome");
    await click(".tree-root");
    await click('.file-tree [title="/welcome/README.md"]');
    await chooseFolder("/welcome/app");
    expect(selector.value).toBe("/welcome/app");
    await click('.document-tab [title="/welcome/README.md"]');
    expect(selector.value).toBe("/welcome");
    const key = () =>
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "p",
          metaKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    await act(async () => {
      key();
    });
    await type('[aria-label="Search project files"]', "WelcomeController.php");
    await click('.quick-open-results [role="option"]');
    await waitFor(() => selector.value === "/welcome/app");
    expect(document.querySelectorAll(".file-tree .tree-root")).toHaveLength(1);
    expect(
      document.querySelector(".file-tree .tree-root")?.getAttribute("title"),
    ).toBe("/welcome/app");
    expect(document.querySelector(".file-actions > span")).toBeNull();
  });

  it("quick-opens a file without expanding its parent folders", async () => {
    await enterCode();
    await act(async () =>
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "p",
          metaKey: true,
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    await type('[aria-label="Search project files"]', "controller");
    const option = await waitFor(() =>
      document.querySelector<HTMLButtonElement>(
        '.quick-open-results [role="option"]',
      ),
    );
    expect(option.textContent).toContain("WelcomeController.php");
    await act(async () => {
      option.click();
    });
    const editor = await waitFor(() =>
      document.querySelector<HTMLTextAreaElement>("textarea"),
    );
    expect(editor.value).toContain("final class WelcomeController");
    expect(
      document.querySelector('[aria-label="Quick open file"][role="dialog"]'),
    ).toBeNull();
  });
  it("searches saved project text and jumps to the matching line", async () => {
    await enterCode();
    const search = await waitFor(() =>
      [
        ...document.querySelectorAll<HTMLButtonElement>(
          ".explorer-tabs button",
        ),
      ].find((button) => button.textContent?.includes("Search")),
    );
    await act(async () => {
      search.click();
    });
    await type('[aria-label="Search text in project"]', "RETURN");
    const result = await waitFor(() =>
      document.querySelector<HTMLButtonElement>(".search-results button"),
    );
    expect(result.closest(".search-file-group")?.querySelector("h3")?.textContent).toContain("WelcomeController.php");
    await act(async () => {
      result.click();
    });
    const editor = await waitFor(() =>
      document.querySelector<HTMLTextAreaElement>("textarea"),
    );
    await waitFor(() => editor.selectionStart > 0);
    expect(editor.value.slice(editor.selectionStart)).toMatch(/^\s*return/);
    await click('[aria-label="Match case"]');
    await waitFor(
      () =>
        document.querySelector(".search-summary")?.textContent ===
        "0 matching lines",
    );
    expect(document.querySelectorAll(".search-results button")).toHaveLength(0);
  });
});

it("Cmd+2 opens the terminal even while a settings dialog is open", async () => {
  await enterCode();
  await click('[aria-label="Settings"]');
  expect(document.querySelector('[aria-label="Settings"][role="dialog"]')).not.toBeNull();
  await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", {key:"2",metaKey:true,bubbles:true,cancelable:true})));
  await waitFor(() => document.querySelector(".local-terminal-session"));
  expect(document.querySelector<HTMLElement>(".workspace-terminal-dock")?.style.display).toBe("flex");
  expect(document.querySelector('[aria-label="Settings"][role="dialog"]')).not.toBeNull();
});

it("opens global notes with Cmd+6 from Projects and preserves saved notes and drafts across sections", async () => {
  await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "6", metaKey: true, bubbles: true, cancelable: true })));
  await waitFor(() => document.querySelector('[aria-label="Global notes"]'));
  const newNote = [...document.querySelectorAll<HTMLButtonElement>(".notes-sidebar button")].find((button) => button.textContent?.includes("New note"))!;
  await act(async () => newNote.click());
  await type('[aria-label="Note title"]', "Global scratch");
  await type(".notes-editor textarea", "first line\nsecond line");
  expect(localStorage.getItem("octode-global-notes")).toBeNull();
  await click(".notes-main .primary-button");
  expect(JSON.parse(localStorage.getItem("octode-global-notes")!)[0].text).toBe("first line\nsecond line");
  await click('[aria-label="Workspace home"]');
  await enterCode();
  await click('[aria-label="Notes"]');
  expect(document.querySelector<HTMLInputElement>('[aria-label="Note title"]')?.value).toBe("Global scratch");
  await type(".notes-editor textarea", "unsaved draft");
  await click('[aria-label="API"]');
  await click('[aria-label="Notes"]');
  expect(document.querySelector<HTMLTextAreaElement>(".notes-editor textarea")?.value).toBe("unsaved draft");
  expect(JSON.parse(localStorage.getItem("octode-global-notes")!)[0].text).toBe("first line\nsecond line");
  await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "s", metaKey: true, bubbles: true, cancelable: true })));
  expect(JSON.parse(localStorage.getItem("octode-global-notes")!)[0].text).toBe("unsaved draft");
  const editorSettings = localStorage.getItem("octode-editor-settings");
  await click('[aria-label="Word wrap"]');
  expect(document.querySelector('[aria-label="Word wrap"]')?.getAttribute("aria-pressed")).toBe("true");
  expect(document.querySelector<HTMLTextAreaElement>(".notes-editor textarea")?.style.whiteSpace).toBe("pre-wrap");
  expect(localStorage.getItem("octode-editor-settings")).toBe(editorSettings);
  await click('[aria-label="Find in note"]');
  await waitFor(() => document.querySelector('.notes-editor [aria-label="Find in file"]'));
});

it("opens a home-folder terminal from global Notes without a project and keeps it when switching to Projects", async () => {
  await click('[aria-label="Notes"]');
  await waitFor(() => !document.querySelector<HTMLButtonElement>('[aria-label="Local terminal"]')?.disabled);
  await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "2", metaKey: true, bubbles: true, cancelable: true })));
  await waitFor(() => document.querySelector(".preview-terminal"));
  const session = document.querySelector(".local-terminal-session");
  expect(document.querySelector('.local-terminal-tabs button[title="/home"]')).not.toBeNull();
  expect(document.querySelector<HTMLElement>(".workspace-terminal-dock")?.style.display).toBe("flex");
  await click('[aria-label="Workspace home"]');
  expect(document.querySelector(".dashboard")).not.toBeNull();
  expect(document.querySelector(".local-terminal-session")).toBe(session);
  await click('[aria-label="Notes"]');
  expect(document.querySelector(".local-terminal-session")).toBe(session);
  await click('[aria-label="Hide terminal"]');
  await click('[aria-label="Local terminal"]');
  expect(document.querySelector(".local-terminal-session")).toBe(session);
});
