// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import DatabaseDataGrid from "./DatabaseDataGrid";
import type { DbResult } from "../toolTypes";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const text = (value: string) => ({ kind: "text" as const, value });
const result: DbResult = {
  columns: [
    { name: "id", dataType: "BIGINT" },
    { name: "name", dataType: "TEXT" },
    { name: "note", dataType: "TEXT" },
  ],
  rows: [
    [text("9007199254740993"), text('O"Brien, team'), text("line 1\nline 2")],
    [text("9007199254740994"), text("second"), text("normal")],
    [text("9007199254740995"), text("third"), { kind: "null", value: "" }],
    [text("9007199254740996"), text("fourth"), text("last")],
  ],
  rowsAffected: 0,
  elapsedMs: 1,
  truncated: false,
};
const props = {
  session: "s",
  schema: "main",
  table: "things",
  result,
  metadata: {
    columns: result.columns.map((column, index) => ({
      ...column,
      primaryKey: index === 0,
      nullable: index !== 0,
      generated: false,
      defaultValue: null,
    })),
    indexes: result,
    foreignKeys: result,
    editable: true,
    reason: "",
  },
  disabled: false,
  sort: "",
  descending: false,
  onSort: vi.fn(),
  onApplied: vi.fn(async () => {}),
  onEditing: vi.fn(),
  onDirty: vi.fn(),
};
let root: Root;
const writeText = vi.fn();
let oldClipboard: PropertyDescriptor | undefined;
beforeEach(async () => {
  document.body.innerHTML = '<div id="root"></div>';
  window.getSelection()?.removeAllRanges();
  oldClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  writeText.mockReset().mockResolvedValue(undefined);
  root = createRoot(document.getElementById("root")!);
  await act(async () => root.render(<DatabaseDataGrid {...props} />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  window.getSelection()?.removeAllRanges();
  if (oldClipboard) Object.defineProperty(navigator, "clipboard", oldClipboard);
  else Reflect.deleteProperty(navigator, "clipboard");
  vi.restoreAllMocks();
});
const select = async (row: number, modifiers: MouseEventInit = {}) =>
  act(async () => {
    document
      .querySelector(`[aria-label="Select row ${row}"]`)!
      .dispatchEvent(new MouseEvent("click", { bubbles: true, ...modifiers }));
  });
const selected = () =>
  [
    ...document.querySelectorAll<HTMLButtonElement>(
      '.database-row-selector button[aria-pressed="true"]',
    ),
  ].map((button) => button.textContent);
const copy = async (target: Element = document.activeElement!) => {
  const setData = vi.fn();
  const event = new Event("copy", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", { value: { setData } });
  await act(async () => {
    target.dispatchEvent(event);
  });
  return { event, setData };
};
it("selects rows by number with ranges and Cmd/Ctrl toggles, highlights them and clears", async () => {
  await select(1);
  await select(3, { shiftKey: true });
  expect(selected()).toEqual(["1", "2", "3"]);
  await select(2, { metaKey: true });
  expect(selected()).toEqual(["1", "3"]);
  await select(4, { ctrlKey: true });
  expect(selected()).toEqual(["1", "3", "4"]);
  expect(
    document.querySelector('[aria-label="Selected rows"]')?.textContent,
  ).toContain("3 rows selected");
  expect(document.querySelectorAll("tbody tr.selected")).toHaveLength(3);
  await select(2);
  expect(selected()).toEqual(["2"]);
  const clear = [...document.querySelectorAll("button")].find(
    (button) => button.textContent === "Clear",
  )!;
  await act(async () => clear.click());
  expect(selected()).toEqual([]);
  expect(document.querySelector('[aria-label="Selected rows"]')).toBeNull();
});
it("copies selected rows as CSV with headers in displayed order via the native copy event", async () => {
  await select(3);
  await select(1, { metaKey: true });
  const key = new KeyboardEvent("keydown", {
    key: "c",
    metaKey: true,
    bubbles: true,
    cancelable: true,
  });
  document.activeElement!.dispatchEvent(key);
  expect(key.defaultPrevented).toBe(false);
  const { event, setData } = await copy();
  expect(event.defaultPrevented).toBe(true);
  expect(setData).toHaveBeenCalledWith(
    "text/plain",
    'id,name,note\r\n9007199254740993,"O""Brien, team","line 1\nline 2"\r\n9007199254740995,third,""\r\n',
  );
  expect(document.querySelector('[role="status"]')?.textContent).toBe(
    "Copied 2 rows as CSV",
  );
  expect(writeText).not.toHaveBeenCalled();
});
it("provides Copy CSV using the clipboard API without adding row numbers to the export", async () => {
  await select(2);
  await select(4, { metaKey: true });
  const button = [...document.querySelectorAll("button")].find(
    (button) => button.textContent === "Copy CSV",
  )!;
  await act(async () => button.click());
  expect(writeText).toHaveBeenCalledWith(
    "id,name,note\r\n9007199254740994,second,normal\r\n9007199254740996,fourth,last\r\n",
  );
  expect(result.rows[0][0].value).toBe("9007199254740993");
});
it("preserves normal selected-text copy and copying in a cell editor", async () => {
  await select(1);
  const cell = document.querySelectorAll("td")[1];
  const range = document.createRange();
  range.selectNodeContents(cell);
  window.getSelection()!.addRange(range);
  const plain = await copy(cell);
  expect(plain.event.defaultPrevented).toBe(false);
  expect(plain.setData).not.toHaveBeenCalled();
  window.getSelection()!.removeAllRanges();
  await act(async () =>
    cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })),
  );
  const editor = document.querySelector('[aria-label="Edit name row 1"]')!;
  const typing = await copy(editor);
  expect(typing.event.defaultPrevented).toBe(false);
  expect(typing.setData).not.toHaveBeenCalled();
  expect(
    document.querySelector<HTMLButtonElement>('[aria-label="Select row 2"]')
      ?.disabled,
  ).toBe(true);
});
it("resets selection on new results and page/filter/sort context changes", async () => {
  await select(1);
  const refreshed = { ...result, rows: [...result.rows] };
  await act(async () =>
    root.render(<DatabaseDataGrid {...props} result={refreshed} />),
  );
  expect(selected()).toEqual([]);
  for (const selectionKey of ["filter=id=1", "page=2", "sort=name"]) {
    await select(2);
    await act(async () =>
      root.render(
        <DatabaseDataGrid
          {...props}
          result={refreshed}
          selectionKey={selectionKey}
        />,
      ),
    );
    expect(selected()).toEqual([]);
  }
  const empty = await copy(document.querySelector("td")!);
  expect(empty.event.defaultPrevented).toBe(false);
});
it("falls back to the WebView copy command and restores focus when clipboard API is blocked", async () => {
  const old = Object.getOwnPropertyDescriptor(document, "execCommand");
  const copied = vi.fn();
  const exec = vi.fn(() => {
    expect(
      document.querySelector<HTMLTextAreaElement>("body > textarea")?.value,
    ).toContain("id,name,note\n");
    const event = new Event("copy", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", {
      value: { setData: copied },
    });
    document.querySelector("body > textarea")!.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    return true;
  });
  Object.defineProperty(document, "execCommand", {
    configurable: true,
    value: exec,
  });
  writeText.mockRejectedValue(new Error("Clipboard API unavailable"));
  try {
    await select(1);
    const previous = document.activeElement;
    const button = [...document.querySelectorAll("button")].find(
      (button) => button.textContent === "Copy CSV",
    )!;
    await act(async () => button.click());
    expect(exec).toHaveBeenCalledWith("copy");
    expect(copied).toHaveBeenCalledWith(
      "text/plain",
      'id,name,note\r\n9007199254740993,"O""Brien, team","line 1\nline 2"\r\n',
    );
    expect(document.activeElement).toBe(previous);
    expect(document.querySelector("body > textarea")).toBeNull();
    expect(document.querySelector('[role="status"]')?.textContent).toBe(
      "Copied 1 row as CSV",
    );
  } finally {
    if (old) Object.defineProperty(document, "execCommand", old);
    else Reflect.deleteProperty(document, "execCommand");
  }
});

it("resizes columns with drag and keyboard while keeping sorting and row copy separate", async () => {
  const handle = document.querySelector<HTMLElement>(
    '[aria-label="Resize name column"]',
  )!;
  const pointer = async (type: string, x: number) =>
    act(async () => {
      const event = new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        button: 0,
        clientX: x,
      });
      Object.defineProperty(event, "pointerId", { value: 1 });
      handle.dispatchEvent(event);
    });
  await pointer("pointerdown", 100);
  await pointer("pointermove", 180);
  await pointer("pointerup", 180);
  expect(handle.getAttribute("aria-valuenow")).toBe("240");
  expect(document.querySelectorAll("col")[2].getAttribute("style")).toContain(
    "240px",
  );
  expect(props.onSort).not.toHaveBeenCalled();
  await act(async () =>
    handle.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }),
    ),
  );
  expect(handle.getAttribute("aria-valuenow")).toBe("230");
  await select(1);
  const copied = await copy();
  expect(copied.event.defaultPrevented).toBe(true);
  await act(async () =>
    root.render(
      <DatabaseDataGrid
        {...props}
        result={{ ...result, rows: [...result.rows] }}
      />,
    ),
  );
  expect(handle.getAttribute("aria-valuenow")).toBe("230");
  const columns = [...result.columns, { name: "new_column", dataType: "TEXT" }];
  await act(async () =>
    root.render(
      <DatabaseDataGrid {...props} result={{ ...result, columns }} />,
    ),
  );
  expect(document.querySelector("colgroup")).toBeNull();
});
