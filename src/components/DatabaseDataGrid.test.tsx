// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  afterEach,
  beforeEach,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";
import DatabaseDataGrid from "./DatabaseDataGrid";
import * as bridge from "../lib/toolsBridge";
import { editableCell, formatCellJson } from "../lib/databaseCell";
import type { DbResult } from "../toolTypes";
vi.mock("./EditorPane", () => ({
  default: ({ document, onChange, readOnly, modelPath }: any) => (
    <textarea
      aria-label="JSON code editor"
      data-model={modelPath}
      value={document.text}
      readOnly={readOnly}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
const result: DbResult = {
  columns: [
    { name: "id", dataType: "INTEGER" },
    { name: "name", dataType: "TEXT" },
    { name: "settings", dataType: "JSON" },
  ],
  rows: [
    [
      { kind: "text", value: "9007199254740993" },
      { kind: "text", value: "before" },
      {
        kind: "text",
        value: '{"id":9007199254740993,"scale":1.2300,"enabled":true}',
      },
    ],
  ],
  rowsAffected: 0,
  elapsedMs: 1,
  truncated: false,
};
const metadata = {
  columns: result.columns.map((column, index) => ({
    ...column,
    nullable: index !== 0,
    primaryKey: index === 0,
    defaultValue: null,
    generated: false,
  })),
  indexes: result,
  foreignKeys: result,
  editable: true,
  reason: "",
};
const plan = {
  statements: [
    {
      sql: "UPDATE things SET name=? WHERE id IS ?",
      parameters: ["after", "9007199254740993"],
      checkSql: "SELECT COUNT(*)",
      checkParameters: ["9007199254740993", "before"],
    },
  ],
};
const props = {
  session: "session",
  schema: "main",
  table: "things",
  result,
  metadata,
  disabled: false,
  sort: "",
  descending: false,
  onSort: vi.fn(),
  onApplied: vi.fn(async () => {}),
  onEditing: vi.fn(),
  onDirty: vi.fn(),
};
let invoke: MockInstance<typeof bridge.nativeTool>;
beforeEach(() => {
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById("root")!);
  vi.clearAllMocks();
  invoke = vi
    .spyOn(bridge, "nativeTool")
    .mockImplementation(async (command) =>
      command === "database_row_plan" ? plan : (1 as any),
    );
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.restoreAllMocks();
});
const open = async (column = 1) =>
  act(async () => {
    document
      .querySelectorAll("td")
      [column].dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
  });
const type = async (value: string, selector = '[aria-label^="Edit "]') => {
  const input = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(
    selector,
  )!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      input instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const click = async (label: string) => {
  const button = [...document.querySelectorAll("button")].find(
    (button) =>
      button.textContent === label ||
      button.getAttribute("aria-label") === label,
  )!;
  expect(button).toBeDefined();
  await act(async () => button.click());
};
it("edits a cell on double-click and writes only after reviewing and explicitly applying", async () => {
  await act(async () => root.render(<DatabaseDataGrid {...props} />));
  await open();
  await type("after");
  expect(invoke).not.toHaveBeenCalled();
  expect(props.onDirty).toHaveBeenLastCalledWith(true);
  await act(async () =>
    document
      .querySelector('[aria-label^="Edit "]')!
      .dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      ),
  );
  expect(
    document.querySelector('[aria-label="Apply database change"]')?.textContent,
  ).toContain("BeforebeforeAfterafter");
  expect(invoke).toHaveBeenCalledTimes(1);
  const change = {
    kind: "update-cell",
    original: {
      id: "9007199254740993",
      name: "before",
      settings: result.rows[0][2].value,
    },
    values: { name: "after" },
  };
  expect(invoke).toHaveBeenCalledWith("database_row_plan", {
    id: "session",
    request: { schema: "main", table: "things", changes: [change] },
  });
  await click("Apply update");
  expect(invoke).toHaveBeenCalledWith("database_apply_rows", {
    id: "session",
    request: {
      schema: "main",
      table: "things",
      changes: [change],
      reviewed: plan,
    },
  });
  expect(props.onApplied).toHaveBeenCalledOnce();
  expect(
    document.querySelector('[aria-label="Apply database change"]'),
  ).toBeNull();
});
it("supports blur review, returning to edit, Escape and discard without writing", async () => {
  await act(async () => root.render(<DatabaseDataGrid {...props} />));
  await open();
  await type("draft");
  await act(async () =>
    document
      .querySelector<HTMLTextAreaElement>('[aria-label^="Edit "]')!
      .blur(),
  );
  expect(
    document.querySelector('[aria-label="Apply database change"]'),
  ).not.toBeNull();
  await click("Keep editing");
  expect(
    document.querySelector<HTMLTextAreaElement>('[aria-label^="Edit "]')?.value,
  ).toBe("draft");
  await act(async () =>
    document
      .querySelector('[aria-label^="Edit "]')!
      .dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      ),
  );
  expect(document.querySelector('[aria-label^="Edit "]')).toBeNull();
  expect(
    invoke.mock.calls.some(([command]) => command === "database_apply_rows"),
  ).toBe(false);
  await open();
  await type("again");
  await click("Review cell change");
  await click("Discard");
  expect(props.onDirty).toHaveBeenLastCalledWith(false);
});
it("opens formatted JSON in its own code editor, preserves number spelling and validates before review", async () => {
  await act(async () => root.render(<DatabaseDataGrid {...props} />));
  await open(2);
  const editor = document.querySelector<HTMLTextAreaElement>(
    '[aria-label="JSON code editor"]',
  )!;
  expect(editor.value).toContain('\n  "id": 9007199254740993,');
  expect(editor.value).toContain("1.2300");
  expect(editor.dataset.model).toMatch(/^octode-cell:/);
  expect(
    document.querySelector<HTMLButtonElement>(
      ".database-json-drawer .primary-button",
    )?.disabled,
  ).toBe(true);
  await type("{invalid", '[aria-label="JSON code editor"]');
  await click("Review change");
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(
    "valid JSON",
  );
  expect(invoke).not.toHaveBeenCalled();
  await type(
    '{"id":9007199254740993,"scale":1.2300,"enabled":false}',
    '[aria-label="JSON code editor"]',
  );
  await click("Review change");
  expect(
    document.querySelector('[aria-label="Apply database change"]')?.textContent,
  ).toContain("enabled");
  expect(invoke).toHaveBeenCalledTimes(1);
  await click("Apply update");
  expect(
    (invoke.mock.calls[1][1] as any).request.changes[0].values.settings,
  ).toContain("9007199254740993");
});
it("keeps NULL distinct from empty strings and preserves the draft when applying fails", async () => {
  await act(async () => root.render(<DatabaseDataGrid {...props} />));
  await open();
  await act(async () =>
    document.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click(),
  );
  await click("Review cell change");
  expect(
    (invoke.mock.calls[0][1] as any).request.changes[0].values.name,
  ).toBeNull();
  invoke.mockImplementation(async (command) => {
    if (command === "database_apply_rows")
      throw new Error("Row changed externally");
    return plan;
  });
  await click("Apply update");
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(
    "Row changed externally",
  );
  expect(
    document.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked,
  ).toBe(true);
  expect(props.onApplied).not.toHaveBeenCalled();
  expect(props.onDirty).toHaveBeenLastCalledWith(true);
});
it("rejects read-only, generated and binary row edits but allows read-only JSON inspection", async () => {
  expect(editableCell(result, { ...metadata, editable: false }, 0, 1)).toBe(
    false,
  );
  expect(
    editableCell(
      result,
      {
        ...metadata,
        columns: metadata.columns.map((column) => ({
          ...column,
          generated: true,
        })),
      },
      0,
      1,
    ),
  ).toBe(false);
  expect(
    editableCell(
      {
        ...result,
        rows: [[{ kind: "binary", value: "AAA=" }, ...result.rows[0].slice(1)]],
      },
      metadata,
      0,
      1,
    ),
  ).toBe(false);
  await act(async () =>
    root.render(
      <DatabaseDataGrid
        {...props}
        metadata={{ ...metadata, editable: false }}
      />,
    ),
  );
  await open();
  expect(document.querySelector('[aria-label^="Edit "]')).toBeNull();
  await open(2);
  expect(
    document.querySelector<HTMLTextAreaElement>("textarea")?.readOnly,
  ).toBe(true);
  expect(
    document.querySelector(".database-json-drawer .primary-button"),
  ).toBeNull();
  expect(invoke).not.toHaveBeenCalled();
});
it("formats JSON without rewriting escaped strings, duplicate keys or precise numeric tokens", () => {
  const raw =
    '{"a":9007199254740993,"a":-0,"nested":[{},[],1.2300,1e+40],"text":"a \\\"b\\\" \\n c"}';
  const pretty = formatCellJson(raw);
  expect(pretty).toContain("9007199254740993");
  expect(pretty).toContain("1.2300");
  expect(pretty).toContain("1e+40");
  expect(pretty).toContain('"a": -0');
  expect(JSON.parse(pretty)).toEqual(JSON.parse(raw));
  expect(() => formatCellJson("{bad")).toThrow();
});

it("preserves multiline cell text and leaves unchanged edits local", async () => {
  const multiline = {
    ...result,
    rows: [
      [
        result.rows[0][0],
        { kind: "text" as const, value: "first\nsecond" },
        result.rows[0][2],
      ],
    ],
  };
  await act(async () =>
    root.render(<DatabaseDataGrid {...props} result={multiline} />),
  );
  await open();
  expect(
    document.querySelector<HTMLTextAreaElement>('[aria-label^="Edit "]')?.value,
  ).toBe("first\nsecond");
  await click("Review cell change");
  expect(invoke).not.toHaveBeenCalled();
  await open();
  await type("first\nupdated");
  await click("Review cell change");
  expect((invoke.mock.calls[0][1] as any).request.changes[0].values.name).toBe(
    "first\nupdated",
  );
});

it("allows normal and JSON cell edits when a different column is too large to display", async () => {
  const largeRow = {
    ...result,
    columns: [...result.columns, { name: "payload", dataType: "TEXT" }],
    rows: [
      [
        ...result.rows[0],
        {
          kind: "unsupported" as const,
          value: "Value exceeds the 64 KB cell display limit",
        },
      ],
    ],
  };
  const info = {
    ...metadata,
    columns: [
      ...metadata.columns,
      {
        name: "payload",
        dataType: "TEXT",
        nullable: true,
        primaryKey: false,
        defaultValue: null,
        generated: false,
      },
    ],
  };
  expect(editableCell(largeRow, info, 0, 1)).toBe(true);
  expect(editableCell(largeRow, info, 0, 2)).toBe(true);
  expect(editableCell(largeRow, info, 0, 3)).toBe(false);
  await act(async () =>
    root.render(
      <DatabaseDataGrid {...props} result={largeRow} metadata={info} />,
    ),
  );
  await open(2);
  expect(
    document.querySelector<HTMLTextAreaElement>(
      '[aria-label="JSON code editor"]',
    )?.readOnly,
  ).toBe(false);
  await type('{"enabled":false}', '[aria-label="JSON code editor"]');
  await click("Review change");
  const request = (invoke.mock.calls[0][1] as any).request;
  expect(request.changes[0].kind).toBe("update-cell");
  expect(request.changes[0].original).not.toHaveProperty("payload");
  expect(request.changes[0].original.id).toBe("9007199254740993");
  await click("Apply update");
  expect(props.onApplied).toHaveBeenCalledOnce();
});

it("offers a calendar alongside timestamp text and waits for review after picking", async () => {
  const value = "2026-10-28 11:28:29.123456+02:00";
  const dates = {
    ...result,
    columns: [result.columns[0], { name: "created_at", dataType: "TIMESTAMP" }],
    rows: [[result.rows[0][0], { kind: "text" as const, value }]],
  };
  const info = {
    ...metadata,
    columns: [
      metadata.columns[0],
      {
        ...metadata.columns[1],
        name: "created_at",
        dataType: "timestamp with time zone",
      },
    ],
  };
  await act(async () =>
    root.render(<DatabaseDataGrid {...props} result={dates} metadata={info} />),
  );
  await open(1);
  await click("Choose date");
  expect(
    document.querySelector('[aria-label="Choose cell date"]'),
  ).not.toBeNull();
  expect(invoke).not.toHaveBeenCalled();
  await click("Choose 2026-10-29");
  await click("Use date");
  const editor = document.querySelector<HTMLTextAreaElement>(
    '[aria-label^="Edit "]',
  )!;
  expect(editor.value).toBe("2026-10-29 11:28:29.123456+02:00");
  expect(document.querySelector('[aria-label="Choose cell date"]')).toBeNull();
  expect(invoke).not.toHaveBeenCalled();
  await click("Choose date");
  expect(
    document
      .querySelector<HTMLButtonElement>('[aria-label="Choose 2026-10-29"]')
      ?.getAttribute("aria-pressed"),
  ).toBe("true");
  await click("Cancel");
  expect(editor.value).toBe("2026-10-29 11:28:29.123456+02:00");
  await click("Review cell change");
  expect(
    (invoke.mock.calls[0][1] as any).request.changes[0].values.created_at,
  ).toBe(editor.value);
});
it("lets the calendar fill a NULL date and clears NULL without writing", async () => {
  const dates = {
    ...result,
    columns: [result.columns[0], { name: "day", dataType: "DATE" }],
    rows: [[result.rows[0][0], { kind: "null" as const, value: "" }]],
  };
  const info = {
    ...metadata,
    columns: [
      metadata.columns[0],
      { ...metadata.columns[1], name: "day", dataType: "date" },
    ],
  };
  await act(async () =>
    root.render(<DatabaseDataGrid {...props} result={dates} metadata={info} />),
  );
  await open(1);
  await click("Choose date");
  const selected = document
    .querySelector<HTMLButtonElement>(
      '.database-calendar-grid [aria-pressed="true"]',
    )!
    .getAttribute("aria-label")!
    .slice("Choose ".length);
  expect(document.querySelector('[aria-label="Date picker time"]')).toBeNull();
  await click("Use date");
  expect(
    document.querySelector<HTMLTextAreaElement>('[aria-label^="Edit "]')?.value,
  ).toBe(selected);
  expect(
    document.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked,
  ).toBe(false);
  expect(invoke).not.toHaveBeenCalled();
});

it.each([false, true])(
  "keeps the calendar edit open through WebKit mouse blur (NULL=%s)",
  async (nullValue) => {
    const dates = {
      ...result,
      columns: [result.columns[0], { name: "day", dataType: "DATE" }],
      rows: [
        [
          result.rows[0][0],
          {
            kind: nullValue ? ("null" as const) : ("text" as const),
            value: nullValue ? "" : "2026-10-28",
          },
        ],
      ],
    };
    const info = {
      ...metadata,
      columns: [
        metadata.columns[0],
        { ...metadata.columns[1], name: "day", dataType: "date" },
      ],
    };
    await act(async () =>
      root.render(
        <DatabaseDataGrid {...props} result={dates} metadata={info} />,
      ),
    );
    const mouseClick = async (label: string) => {
      const button = [
        ...document.querySelectorAll<HTMLButtonElement>("button"),
      ].find(
        (button) =>
          button.getAttribute("aria-label") === label ||
          button.textContent === label,
      )!;
      expect(button).toBeDefined();
      await act(async () => {
        button.dispatchEvent(
          new MouseEvent("pointerdown", { bubbles: true, cancelable: true }),
        );
        const down = new MouseEvent("mousedown", {
          bubbles: true,
          cancelable: true,
        });
        button.dispatchEvent(down);
        // WebKit's default mouse action may blur to body without focusing buttons.
        if (
          !down.defaultPrevented &&
          document.activeElement instanceof HTMLElement
        )
          document.activeElement.blur();
        button.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
        button.click();
      });
    };
    await open(1);
    await mouseClick("Choose date");
    expect(
      document.querySelector('[aria-label="Choose cell date"]'),
    ).not.toBeNull();
    const editor = document.querySelector<HTMLTextAreaElement>(
      '[aria-label^="Edit "]',
    )!;
    await act(async () =>
      editor.dispatchEvent(
        new FocusEvent("focusout", { bubbles: true, relatedTarget: null }),
      ),
    );
    expect(
      document.querySelector('[aria-label="Choose cell date"]'),
    ).not.toBeNull();
    const day = document
      .querySelector<HTMLButtonElement>(
        '.database-calendar-grid button:not([aria-pressed="true"]):not(.other-month)',
      )!
      .getAttribute("aria-label")!;
    await mouseClick(day);
    await mouseClick("Use date");
    expect(
      document.querySelector<HTMLTextAreaElement>('[aria-label^="Edit "]')
        ?.value,
    ).toBe(day.slice("Choose ".length));
    expect(
      document.querySelector<HTMLInputElement>('input[type="checkbox"]')
        ?.checked,
    ).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
  },
);

it.each(["label", "checkbox"])(
  "sets a timestamp to NULL through a WebKit mouse click on the %s",
  async (target) => {
    const original = "2026-10-28 00:00:00";
    const dates = {
      ...result,
      columns: [
        result.columns[0],
        { name: "deleted_at", dataType: "TIMESTAMP" },
      ],
      rows: [[result.rows[0][0], { kind: "text" as const, value: original }]],
    };
    const info = {
      ...metadata,
      columns: [
        metadata.columns[0],
        { ...metadata.columns[1], name: "deleted_at", dataType: "timestamp" },
      ],
    };
    await act(async () =>
      root.render(
        <DatabaseDataGrid {...props} result={dates} metadata={info} />,
      ),
    );
    await open(1);
    const toggle = async () =>
      act(async () => {
        const checkbox = document.querySelector<HTMLInputElement>(
          '[aria-label="Set cell to NULL"]',
        )!;
        const element =
          target === "label" ? checkbox.closest("label")! : checkbox;
        const down = new MouseEvent("mousedown", {
          bubbles: true,
          cancelable: true,
        });
        element.dispatchEvent(down);
        if (
          !down.defaultPrevented &&
          document.activeElement instanceof HTMLElement
        )
          document.activeElement.blur();
        element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
        element.click();
      });
    await toggle();
    const editor = () =>
      document.querySelector<HTMLTextAreaElement>(
        '[aria-label="Edit deleted_at row 1"]',
      );
    expect(
      document.querySelector<HTMLInputElement>(
        '[aria-label="Set cell to NULL"]',
      )?.checked,
    ).toBe(true);
    expect(editor()?.readOnly).toBe(true);
    expect(editor()?.value).toBe("");
    expect(editor()?.placeholder).toBe("NULL");
    expect(invoke).not.toHaveBeenCalled();
    await toggle();
    expect(editor()?.value).toBe(original);
    expect(editor()?.readOnly).toBe(false);
    await toggle();
    await click("Review cell change");
    expect(
      (invoke.mock.calls[0][1] as any).request.changes[0].values.deleted_at,
    ).toBeNull();
    await click("Apply update");
    expect(
      (invoke.mock.calls[1][1] as any).request.changes[0].values.deleted_at,
    ).toBeNull();
    expect(props.onApplied).toHaveBeenCalledOnce();
  },
);
