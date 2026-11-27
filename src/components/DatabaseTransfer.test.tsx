// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ native: vi.fn(), open: vi.fn(), save: vi.fn(), confirm: vi.fn() }));
vi.mock("../lib/toolsBridge", () => ({ nativeTool: (...args: unknown[]) => mocks.native(...args) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: mocks.open, save: mocks.save }));
vi.mock("@tauri-apps/api/core", () => ({ Channel: class { onmessage = (_value: unknown) => {}; } }));
vi.mock("./ToolLayout", async (original) => ({ ...await original<object>(), confirmAction: mocks.confirm }));
import DatabaseTransfer from "./DatabaseTransfer";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
const props = { session: "s", name: "Fixture", readOnly: false, tables: [{ schema: "main", name: "items" }], disabled: false, onBusy: vi.fn(), onImported: vi.fn(async () => {}) };
const buttons = () => [...document.querySelectorAll<HTMLButtonElement>("button")];
const click = async (name: string) => {
  const button = buttons().find((b) => b.textContent?.trim() === name);
  if (!button) throw new Error(`Missing ${name}`);
  await act(async () => button.click());
};
const changeFormat = async (value: string) => {
  await act(async () => {
    const select = document.querySelector<HTMLSelectElement>("select")!;
    select.value = value; select.dispatchEvent(new Event("change", { bubbles: true }));
  });
};
beforeEach(async () => {
  vi.clearAllMocks();
  mocks.native.mockReset(); mocks.confirm.mockResolvedValue(true); mocks.open.mockResolvedValue("/tmp/large.sql"); mocks.save.mockResolvedValue("/tmp/export.sql");
  document.body.innerHTML = '<div id="root"></div>'; root = createRoot(document.getElementById("root")!);
  await act(async () => root.render(<DatabaseTransfer {...props} />));
});
afterEach(async () => { await act(async () => root.unmount()); });
it("exports through a native file request and exposes progress and cancellation without transporting table rows", async () => {
  let finish!: (value: unknown) => void;
  mocks.native.mockImplementation((command, args) => {
    if (command === "database_export") {
      args.progress.onmessage({ phase: "Exporting", rows: 150001, bytes: 30 * 1024 * 1024, totalBytes: null, table: "main.items" });
      return new Promise((resolve) => { finish = resolve; });
    }
    return Promise.resolve();
  });
  await click("Export selected tables…");
  const request = mocks.native.mock.calls.find(([command]) => command === "database_export")![1];
  expect(request.request).toEqual(expect.objectContaining({ tables: props.tables, path: "/tmp/export.sql", format: "sql", operationId: expect.any(String) }));
  expect(request.request).not.toHaveProperty("rows");
  expect(document.querySelector('[role="status"]')?.textContent).toContain("150,001");
  await click("Cancel transfer");
  expect(mocks.native).toHaveBeenCalledWith("cancel_operation", { operationId: request.request.operationId });
  await act(async () => finish({ rows: 150001, tables: 1, bytes: 30 * 1024 * 1024 }));
  expect(document.body.textContent).toContain("Exported 150,001 rows");
});
it("imports an immutable native review token rather than sending the file contents back through the UI", async () => {
  mocks.native.mockImplementation(async (command) => {
    if (command === "database_prepare_import") return { token: "review-token", name: "large.sql", bytes: 30 * 1024 * 1024, preview: "INSERT INTO items VALUES (1);", truncated: true, statements: 150001, rows: 0, headers: [], sample: [] };
    if (command === "database_import_file") return { rows: 150001, tables: 0, bytes: 30 * 1024 * 1024 };
  });
  await click("Import"); await click("Choose SQL file…");
  expect(document.body.textContent).toContain("150,001 statements");
  expect(document.body.textContent).toContain("entire reviewed file");
  expect(mocks.native.mock.calls.some(([command]) => command === "database_import_file")).toBe(false);
  await click("Import SQL");
  const request = mocks.native.mock.calls.find(([command]) => command === "database_import_file")![1];
  expect(request.request.token).toBe("review-token"); expect(request.request).not.toHaveProperty("sql");
  expect(mocks.confirm).toHaveBeenCalled(); expect(props.onImported).toHaveBeenCalled();
  expect(mocks.native).toHaveBeenCalledWith("database_release_import", { token: "review-token" });
});
it("requires CSV mapping and confirmation, with no batch row cap", async () => {
  mocks.native.mockImplementation(async (command) => {
    if (command === "database_metadata") return { columns: [{ name: "id", generated: false }, { name: "value", generated: false }] };
    if (command === "database_prepare_import") return { token: "csv-token", name: "large.csv", bytes: 40 * 1024 * 1024, preview: "", truncated: true, statements: 0, rows: 200001, headers: ["id", "value"], sample: [["1", "sample"]] };
    if (command === "database_import_file") return { rows: 200001, tables: 1, bytes: 40 * 1024 * 1024 };
  });
  await click("Import"); await changeFormat("csv"); await click("Choose CSV file…");
  expect(document.body.textContent).toContain("200,001 rows");
  await click("Import CSV");
  const request = mocks.native.mock.calls.find(([command]) => command === "database_import_file")![1];
  expect(request.request).toEqual(expect.objectContaining({ token: "csv-token", table: props.tables[0], mapping: ["id", "value"] }));
});
it("does not start an import when confirmation is cancelled", async () => {
  mocks.native.mockResolvedValue({ token: "review-token", name: "test.sql", bytes: 25, preview: "SELECT 1;", statements: 1, truncated: false, rows: 0, headers: [], sample: [] });
  mocks.confirm.mockResolvedValue(false);
  await click("Import"); await click("Choose SQL file…"); await click("Import SQL");
  expect(mocks.native.mock.calls.some(([command]) => command === "database_import_file")).toBe(false);
});
