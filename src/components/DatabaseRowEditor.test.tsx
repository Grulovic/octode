// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import DatabaseRowEditor from "./DatabaseRowEditor";
import * as bridge from "../lib/toolsBridge";
import type { DbResult } from "../toolTypes";
vi.mock("./ToolLayout", () => ({ confirmAction: vi.fn(async () => true) }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
beforeEach(() => {
  document.body.innerHTML = '<div id="test"></div>';
  root = createRoot(document.getElementById("test")!);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.restoreAllMocks();
});
const result: DbResult = {
  columns: [
    { name: "id", dataType: "INTEGER" },
    { name: "name", dataType: "TEXT" },
  ],
  rows: [
    [
      { kind: "text", value: "9007199254740993" },
      { kind: "text", value: "before" },
    ],
  ],
  rowsAffected: 0,
  elapsedMs: 1,
  truncated: false,
};
const metadata = {
  columns: [
    {
      name: "id",
      dataType: "integer",
      nullable: false,
      primaryKey: true,
      defaultValue: null,
      generated: false,
    },
    {
      name: "name",
      dataType: "text",
      nullable: true,
      primaryKey: false,
      defaultValue: null,
      generated: false,
    },
  ],
  indexes: { ...result, rows: [] },
  foreignKeys: { ...result, rows: [] },
  editable: true,
  reason: "",
};
const click = async (text: string) => {
  const button = [
    ...document.querySelectorAll<HTMLButtonElement>("button"),
  ].find((button) => button.textContent?.includes(text));
  expect(button).toBeDefined();
  await act(async () => button!.click());
};
describe("explicit database row Apply", () => {
  it("keeps edits local until SQL review and Apply, preserving exact original values", async () => {
    const plan = {
      statements: [
        {
          sql: 'UPDATE "things" SET "name"=? WHERE "id" IS ?',
          parameters: ["after", "9007199254740993"],
          checkSql: "SELECT COUNT(*)",
          checkParameters: ["9007199254740993", "before"],
        },
      ],
    };
    const invoke = vi
      .spyOn(bridge, "nativeTool")
      .mockImplementation(async (command) =>
        command === "database_row_plan" ? plan : (1 as any),
      );
    const applied = vi.fn(async () => {});
    const close = vi.fn();
    await act(async () =>
      root.render(
        <DatabaseRowEditor
          session="session"
          schema="main"
          table="things"
          result={result}
          metadata={metadata}
          onClose={close}
          onApplied={applied}
          onDirty={() => {}}
        />,
      ),
    );
    await click("Row 1");
    const include = document.querySelectorAll<HTMLInputElement>(
      '.row-field input[type="checkbox"]',
    )[2];
    await act(async () => include.click());
    const input = document.querySelector<HTMLInputElement>(
      '[aria-label="Value for name"]',
    )!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(input, "after");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click("Add to pending");
    expect(invoke).not.toHaveBeenCalled();
    await click("Review SQL");
    expect(invoke.mock.calls[0][0]).toBe("database_row_plan");
    expect(document.querySelector(".row-plan")?.textContent).toContain(
      "9007199254740993",
    );
    expect(
      invoke.mock.calls.some((call) => call[0] === "database_apply_rows"),
    ).toBe(false);
    await click("Apply reviewed");
    const request = invoke.mock.calls.find(
      (call) => call[0] === "database_apply_rows",
    )![1] as any;
    expect(request.request.changes[0].original.id).toBe("9007199254740993");
    expect(request.request.changes[0].values.name).toBe("after");
    expect(applied).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });
});
