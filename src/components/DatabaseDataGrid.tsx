import { lazy, Suspense, useEffect, useId, useRef, useState } from "react";
import { X, Check, Copy } from "lucide-react";
import DatabaseDatePicker from "./DatabaseDatePicker";
import { cellDateKind, type CellDateKind } from "../lib/databaseDate";
import { resultCsv } from "../lib/export";
import { copyTextToClipboard } from "../lib/clipboard";
import { nativeTool } from "../lib/toolsBridge";
import {
  cellJson,
  cellEditReason,
  editableCell,
  formatCellJson,
} from "../lib/databaseCell";
import type { DbResult } from "../toolTypes";
import type { RowPlan, TableMetadata } from "./DatabaseRowEditor";
const JsonEditor = lazy(() => import("./EditorPane"));
interface Edit {
  row: number;
  column: string;
  original: Record<string, string | null>;
  initial: string;
  json: boolean;
  nullable: boolean;
  writable: boolean;
  reason: string;
  dateKind: CellDateKind | null;
}
export default function DatabaseDataGrid({
  session,
  schema,
  table,
  result,
  metadata,
  disabled,
  sort,
  descending,
  onSort,
  onApplied,
  onEditing,
  onDirty,
  selectionKey = "",
}: {
  session: string | null;
  schema: string;
  table: string;
  result: DbResult;
  metadata: TableMetadata | null;
  disabled: boolean;
  sort: string;
  descending: boolean;
  onSort: (column: string) => void;
  onApplied: () => Promise<void>;
  onEditing: (value: boolean) => void;
  onDirty: (value: boolean) => void;
  selectionKey?: string;
}) {
  const editorId = useId();
  const gridTable = useRef<HTMLTableElement>(null);
  const [columnWidths, setColumnWidths] = useState<number[] | null>(null);
  const columnsKey = JSON.stringify(
    result.columns.map((column) => column.name),
  );
  useEffect(() => {
    setColumnWidths(null);
  }, [columnsKey]);
  const columnDrag = useRef<{
    index: number;
    start: number;
    widths: number[];
    pointer: number;
  } | null>(null);
  const measuredWidths = () =>
    [
      ...(gridTable.current?.querySelectorAll<HTMLTableCellElement>(
        "thead th:not(.database-row-selector)",
      ) ?? []),
    ].map((cell) =>
      Math.max(64, Math.round(cell.getBoundingClientRect().width) || 160),
    );
  const resizeColumn = (index: number, width: number, baseline: number[]) =>
    setColumnWidths(
      baseline.map((value, i) =>
        i === index ? Math.max(64, Math.min(2000, width)) : value,
      ),
    );

  const [selection, setSelection] = useState<{
    result: DbResult;
    key: string;
    rows: number[];
    anchor: number;
  }>({ result, key: selectionKey, rows: [], anchor: -1 });
  const selectedRows =
    selection.result === result && selection.key === selectionKey
      ? selection.rows
      : [];
  const selected = new Set(selectedRows);
  const [copyNotice, setCopyNotice] = useState("");
  const [copyError, setCopyError] = useState(false);
  useEffect(() => {
    setSelection({ result, key: selectionKey, rows: [], anchor: -1 });
    setCopyNotice("");
    setCopyError(false);
  }, [result, selectionKey]);
  const selectRow = (index: number, range: boolean, toggle: boolean) => {
    const anchor =
      selection.result === result && selection.key === selectionKey
        ? selection.anchor
        : -1;
    let rows: number[];
    if (range && anchor >= 0) {
      const interval = Array.from(
        { length: Math.abs(index - anchor) + 1 },
        (_, offset) => Math.min(index, anchor) + offset,
      );
      rows = toggle ? [...new Set([...selectedRows, ...interval])] : interval;
    } else if (toggle)
      rows = selected.has(index)
        ? selectedRows.filter((row) => row !== index)
        : [...selectedRows, index];
    else rows = [index];
    setSelection({
      result,
      key: selectionKey,
      rows,
      anchor: range && anchor >= 0 ? anchor : index,
    });
    setCopyNotice("");
    setCopyError(false);
    window.getSelection()?.removeAllRanges();
  };
  const selectedCsv = () =>
    resultCsv({
      ...result,
      rows: result.rows.filter((_, index) => selected.has(index)),
    });
  const copied = () => {
    setCopyError(false);
    setCopyNotice(
      `Copied ${selectedRows.length} ${selectedRows.length === 1 ? "row" : "rows"} as CSV`,
    );
  };
  const copySelected = async () => {
    try {
      await copyTextToClipboard(selectedCsv());
      copied();
    } catch (reason) {
      setCopyError(true);
      setCopyNotice(String(reason).replace(/^Error: /, ""));
    }
  };
  const [edit, setEdit] = useState<Edit | null>(null);
  const [text, setText] = useState("");
  const [isNull, setNull] = useState(false);
  const [plan, setPlan] = useState<RowPlan | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const working = useRef(false);
  const datePickerOpen = useRef(false);
  const focusingControl = useRef(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const callbacks = useRef({ onEditing, onDirty });
  callbacks.current = { onEditing, onDirty };
  const changed =
    !!edit &&
    edit.writable &&
    (isNull ? null : text) !==
      (edit.original[edit.column] === null ? null : edit.initial);
  useEffect(() => {
    callbacks.current.onEditing(!!edit);
    return () => callbacks.current.onEditing(false);
  }, [!!edit]);
  useEffect(() => {
    callbacks.current.onDirty(changed);
    return () => callbacks.current.onDirty(false);
  }, [changed]);
  useEffect(() => {
    if (edit && !edit.json && !reviewing) {
      input.current?.focus();
      input.current?.select();
    }
  }, [edit, reviewing]);
  const close = () => {
    if (working.current) return;
    setEdit(null);
    setPlan(null);
    setReviewing(false);
    setError("");
  };
  const open = (row: number, column: number) => {
    if (disabled || edit) return;
    const cell = result.rows[row][column];
    if (cell.kind !== "text" && cell.kind !== "null") {
      setError(
        "This cell cannot be edited because its full value is unavailable.",
      );
      return;
    }
    const name = result.columns[column].name;
    const field = metadata?.columns.find((item) => item.name === name);
    const json = cellJson(
      cell.value,
      field?.dataType ?? result.columns[column].dataType,
    );
    const writable = !!session && editableCell(result, metadata, row, column);
    const reason = !session
      ? "Connect to a database before editing."
      : cellEditReason(result, metadata, row, column);
    if (!writable && !json) {
      setError(reason);
      return;
    }
    let initial = cell.kind === "null" ? "" : cell.value;
    if (json && initial) {
      try {
        initial = formatCellJson(initial);
      } catch {
        /* Invalid existing JSON stays editable. */
      }
    }
    setText(initial);
    setNull(cell.kind === "null");
    setError("");
    setEdit({
      row,
      column: name,
      initial,
      json,
      nullable: !!field?.nullable,
      writable,
      reason,
      dateKind: cellDateKind(
        field?.dataType ?? result.columns[column].dataType,
        cell.value,
      ),
      original: Object.fromEntries(
        result.columns.flatMap((item, index) => {
          const cell = result.rows[row][index];
          return cell.kind === "text" || cell.kind === "null"
            ? [[item.name, cell.kind === "null" ? null : cell.value]]
            : [];
        }),
      ),
    });
  };
  const change = () => ({
    kind: "update-cell",
    original: edit!.original,
    values: { [edit!.column]: isNull ? null : text },
  });
  const review = async () => {
    if (!edit?.writable || !session || working.current) return;
    if (!changed) {
      close();
      return;
    }
    if (edit.json && !isNull) {
      try {
        formatCellJson(text);
      } catch {
        setError("Enter valid JSON before applying this change.");
        return;
      }
    }
    working.current = true;
    setBusy(true);
    setError("");
    setReviewing(true);
    try {
      setPlan(
        await nativeTool<RowPlan>("database_row_plan", {
          id: session,
          request: { schema, table, changes: [change()] },
        }),
      );
    } catch (reason) {
      setError(String(reason));
      setReviewing(false);
    } finally {
      working.current = false;
      setBusy(false);
    }
  };
  const apply = async () => {
    if (!plan || !edit || !session || working.current) return;
    working.current = true;
    setBusy(true);
    setError("");
    try {
      await nativeTool("database_apply_rows", {
        id: session,
        request: { schema, table, changes: [change()], reviewed: plan },
      });
      setEdit(null);
      setPlan(null);
      setReviewing(false);
      callbacks.current.onDirty(false);
      try {
        await onApplied();
      } catch (reason) {
        setError(`Change saved, but rows could not refresh: ${String(reason)}`);
      }
    } catch (reason) {
      setError(String(reason));
      setPlan(null);
      setReviewing(false);
    } finally {
      working.current = false;
      setBusy(false);
    }
  };
  const nullControl = edit?.nullable && edit.writable && (
    <label
      className="inline-check"
      onMouseDown={(event) => {
        // WebKit can blur a text field to body before a checkbox click runs.
        event.preventDefault();
        focusingControl.current = true;
        try {
          event.currentTarget.querySelector("input")?.focus();
        } finally {
          focusingControl.current = false;
        }
      }}
    >
      <input
        type="checkbox"
        aria-label="Set cell to NULL"
        checked={isNull}
        disabled={busy}
        onChange={(event) => setNull(event.target.checked)}
      />
      NULL
    </label>
  );
  return (
    <>
      <div
        className="database-selectable-results"
        onCopy={(event) => {
          if (
            !event.currentTarget.isConnected ||
            !selectedRows.length ||
            edit ||
            disabled
          )
            return;
          const target = event.target instanceof Element ? event.target : null;
          if (
            target?.closest(
              'input, textarea, [contenteditable="true"], .monaco-editor, .xterm',
            ) ||
            window.getSelection()?.toString()
          )
            return;
          event.clipboardData.setData("text/plain", selectedCsv());
          event.preventDefault();
          copied();
        }}
      >
        {selectedRows.length > 0 && (
          <div
            className="database-row-selection"
            role="toolbar"
            aria-label="Selected rows"
          >
            <span>
              {selectedRows.length} {selectedRows.length === 1 ? "row" : "rows"}{" "}
              selected
            </span>
            <button
              type="button"
              disabled={disabled || !!edit}
              onClick={() => void copySelected()}
              title="Copy selected rows as CSV with column headers (Cmd/Ctrl+C)"
            >
              <Copy size={13} />
              Copy CSV
            </button>
            <button
              type="button"
              disabled={disabled || !!edit}
              onClick={() => {
                setSelection({
                  result,
                  key: selectionKey,
                  rows: [],
                  anchor: -1,
                });
                setCopyNotice("");
              }}
            >
              Clear
            </button>
            {copyNotice && (
              <span role={copyError ? "alert" : "status"}>{copyNotice}</span>
            )}
          </div>
        )}
        <div className="data-grid">
          <table
            ref={gridTable}
            className={columnWidths ? "database-sized-columns" : undefined}
            style={
              columnWidths
                ? {
                    width: columnWidths.reduce((sum, width) => sum + width, 38),
                  }
                : undefined
            }
          >
            {columnWidths && (
              <colgroup>
                <col style={{ width: 38 }} />
                {columnWidths.map((width, index) => (
                  <col key={index} style={{ width }} />
                ))}
              </colgroup>
            )}
            <thead>
              <tr>
                <th
                  scope="col"
                  className="database-row-selector"
                  title="Click a row number to select; Shift-click a range; Cmd/Ctrl-click to toggle"
                >
                  #
                </th>
                {result.columns.map((column, index) => (
                  <th key={index} className="database-data-column">
                    <button
                      disabled={disabled || !table}
                      title={column.dataType}
                      onClick={() => onSort(column.name)}
                    >
                      {column.name}
                      {sort === column.name ? (descending ? " ↓" : " ↑") : ""}
                      <small>{column.dataType}</small>
                    </button>
                    <span
                      className="database-column-resize"
                      role="separator"
                      aria-orientation="vertical"
                      aria-label={`Resize ${column.name} column`}
                      tabIndex={0}
                      aria-valuemin={64}
                      aria-valuemax={2000}
                      aria-valuenow={columnWidths?.[index] ?? 160}
                      onPointerDown={(event) => {
                        if (event.button !== 0) return;
                        event.preventDefault();
                        event.stopPropagation();
                        const widths = columnWidths ?? measuredWidths();
                        columnDrag.current = {
                          index,
                          start: event.clientX,
                          widths,
                          pointer: event.pointerId,
                        };
                        event.currentTarget.setPointerCapture?.(
                          event.pointerId,
                        );
                        setColumnWidths(widths);
                      }}
                      onPointerMove={(event) => {
                        const drag = columnDrag.current;
                        if (!drag || drag.pointer !== event.pointerId) return;
                        event.preventDefault();
                        resizeColumn(
                          drag.index,
                          drag.widths[drag.index] + event.clientX - drag.start,
                          drag.widths,
                        );
                      }}
                      onPointerUp={(event) => {
                        columnDrag.current = null;
                        if (
                          event.currentTarget.hasPointerCapture?.(
                            event.pointerId,
                          )
                        )
                          event.currentTarget.releasePointerCapture(
                            event.pointerId,
                          );
                      }}
                      onPointerCancel={() => {
                        columnDrag.current = null;
                      }}
                      onLostPointerCapture={() => {
                        columnDrag.current = null;
                      }}
                      onClick={(event) => event.stopPropagation()}
                      onKeyDown={(event) => {
                        if (
                          event.key !== "ArrowLeft" &&
                          event.key !== "ArrowRight"
                        )
                          return;
                        event.preventDefault();
                        event.stopPropagation();
                        const widths = columnWidths ?? measuredWidths();
                        resizeColumn(
                          index,
                          widths[index] +
                            (event.key === "ArrowRight" ? 1 : -1) *
                              (event.shiftKey ? 40 : 10),
                          widths,
                        );
                      }}
                    />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.rows.map((row, rowIndex) => (
                <tr
                  key={rowIndex}
                  className={selected.has(rowIndex) ? "selected" : ""}
                  aria-selected={selected.has(rowIndex)}
                >
                  <th scope="row" className="database-row-selector">
                    <button
                      type="button"
                      aria-label={`Select row ${rowIndex + 1}`}
                      aria-pressed={selected.has(rowIndex)}
                      disabled={disabled || !!edit}
                      onClick={(event) => {
                        event.currentTarget.focus();
                        selectRow(
                          rowIndex,
                          event.shiftKey,
                          event.metaKey || event.ctrlKey,
                        );
                      }}
                    >
                      {rowIndex + 1}
                    </button>
                  </th>
                  {row.map((cell, column) => {
                    const inline =
                      edit?.row === rowIndex &&
                      edit.column === result.columns[column].name &&
                      !edit.json &&
                      !reviewing;
                    const writable =
                      !!session &&
                      editableCell(result, metadata, rowIndex, column);
                    return (
                      <td
                        key={column}
                        className={`${cell.kind === "null" ? "null-cell" : ""} ${writable ? "editable-cell" : ""}`}
                        tabIndex={writable && !disabled ? 0 : undefined}
                        title={
                          cell.kind === "binary"
                            ? "Binary value (base64)"
                            : cell.value
                        }
                        onDoubleClick={() => open(rowIndex, column)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" && !edit) {
                            event.preventDefault();
                            open(rowIndex, column);
                          }
                        }}
                      >
                        {inline ? (
                          <div
                            className="database-inline-edit"
                            onBlur={(event) => {
                              if (
                                datePickerOpen.current ||
                                focusingControl.current
                              )
                                return;
                              if (
                                !event.currentTarget.contains(
                                  event.relatedTarget as Node | null,
                                ) &&
                                (!(event.relatedTarget instanceof Element) ||
                                  event.relatedTarget
                                    .closest("[data-db-date-picker]")
                                    ?.getAttribute("data-db-date-picker") !==
                                    editorId)
                              )
                                void review();
                            }}
                          >
                            <textarea
                              ref={input}
                              rows={Math.min(5, text.split("\n").length)}
                              title="Enter to review; Shift+Enter for a new line"
                              aria-label={`Edit ${edit.column} row ${rowIndex + 1}`}
                              value={isNull ? "" : text}
                              placeholder={isNull ? "NULL" : undefined}
                              readOnly={isNull}
                              disabled={busy}
                              onChange={(event) => setText(event.target.value)}
                              onKeyDown={(event) => {
                                if (
                                  event.key === "Enter" &&
                                  !event.shiftKey &&
                                  !event.nativeEvent.isComposing
                                ) {
                                  event.preventDefault();
                                  void review();
                                } else if (event.key === "Escape") {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  close();
                                }
                              }}
                            />
                            {edit.dateKind && (
                              <DatabaseDatePicker
                                kind={edit.dateKind}
                                value={isNull ? "" : text}
                                disabled={busy}
                                owner={editorId}
                                onOpenChange={(open) => {
                                  datePickerOpen.current = open;
                                }}
                                onChange={(value) => {
                                  setText(value);
                                  setNull(false);
                                }}
                                onDone={() =>
                                  queueMicrotask(() => input.current?.focus())
                                }
                              />
                            )}
                            {nullControl}
                            <button
                              aria-label="Review cell change"
                              disabled={busy}
                              onMouseDown={(event) => event.preventDefault()}
                              onClick={() => void review()}
                            >
                              <Check size={14} />
                            </button>
                            <button
                              aria-label="Cancel cell edit"
                              disabled={busy}
                              onMouseDown={(event) => event.preventDefault()}
                              onClick={close}
                            >
                              <X size={14} />
                            </button>
                            {error && <span role="alert">{error}</span>}
                          </div>
                        ) : cell.kind === "null" ? (
                          "NULL"
                        ) : cell.kind === "binary" ? (
                          `base64: ${cell.value}`
                        ) : (
                          cell.value
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          {!result.rows.length && (
            <p className="service-hint">No rows returned.</p>
          )}
        </div>
      </div>
      {!edit && error && (
        <p role="alert" className="database-error">
          {error}
        </p>
      )}
      {edit?.json && !reviewing && (
        <div className="code-modal-backdrop database-cell-backdrop">
          <section
            className="database-json-drawer"
            role="dialog"
            aria-modal="true"
            aria-label={`JSON cell ${edit.column}`}
            onKeyDown={(event) => {
              if (event.key === "Escape" && !busy && !changed) close();
            }}
          >
            <header>
              <div>
                <strong>
                  {schema}.{table} · {edit.column}
                </strong>
                <small>
                  Row {edit.row + 1}
                  {edit.writable ? " · JSON" : " · Read-only JSON"}
                </small>
                {!edit.writable && <small>{edit.reason}</small>}
              </div>
              <button
                aria-label="Close JSON editor"
                disabled={busy}
                onClick={() => {
                  if (!changed) close();
                  else void review();
                }}
              >
                <X size={17} />
              </button>
            </header>
            <div className="database-json-editor">
              <Suspense
                fallback={<div className="loading">Loading JSON editor…</div>}
              >
                <JsonEditor
                  modelPath={`octode-cell:${encodeURIComponent(editorId)}.json`}
                  document={{
                    path: "cell.json",
                    name: "cell.json",
                    text,
                    saved: edit.initial,
                  }}
                  onChange={setText}
                  readOnly={!edit.writable || busy || isNull}
                />
              </Suspense>
            </div>
            <footer>
              {error && (
                <p role="alert" className="database-error">
                  {error}
                </p>
              )}
              {nullControl}
              <button
                className="secondary-button"
                disabled={busy}
                onClick={() => {
                  try {
                    setText(formatCellJson(text));
                    setError("");
                  } catch {
                    setError("Enter valid JSON to format.");
                  }
                }}
              >
                Format JSON
              </button>
              <button
                className="secondary-button"
                disabled={busy}
                onClick={close}
              >
                {changed ? "Discard" : "Close"}
              </button>
              {edit.writable && (
                <button
                  className="primary-button"
                  disabled={busy || !changed}
                  onClick={() => void review()}
                >
                  Review change
                </button>
              )}
            </footer>
          </section>
        </div>
      )}
      {edit && reviewing && (
        <div className="code-modal-backdrop">
          <section
            className="database-cell-review"
            role="dialog"
            aria-modal="true"
            aria-label="Apply database change"
            onKeyDown={(event) => {
              if (event.key === "Escape" && !busy) {
                setReviewing(false);
                setPlan(null);
              }
            }}
          >
            <header>
              <strong>
                Apply this change to {schema}.{table}?
              </strong>
            </header>
            <p>
              Row {edit.row + 1} · {edit.column}
              {metadata?.columns
                .filter((column) => column.primaryKey)
                .map((column) => (
                  <span key={column.name}>
                    {" "}
                    · {column.name} = {edit.original[column.name]}
                  </span>
                ))}
            </p>
            <dl className="database-cell-values">
              <div>
                <dt>Before</dt>
                <dd>
                  <pre>
                    {edit.original[edit.column] === null
                      ? "NULL"
                      : edit.original[edit.column] === ""
                        ? '"" (empty string)'
                        : edit.json
                          ? edit.initial
                          : edit.original[edit.column]}
                  </pre>
                </dd>
              </div>
              <div>
                <dt>After</dt>
                <dd>
                  <pre>
                    {isNull ? "NULL" : text === "" ? '"" (empty string)' : text}
                  </pre>
                </dd>
              </div>
            </dl>
            {plan && (
              <details>
                <summary>SQL and parameters</summary>
                {plan.statements.map((statement, index) => (
                  <pre key={index}>
                    {statement.sql}
                    {"\n"}
                    {JSON.stringify(statement.parameters)}
                  </pre>
                ))}
              </details>
            )}
            {error && <p role="alert">{error}</p>}
            <footer>
              <button
                autoFocus
                className="secondary-button"
                disabled={busy}
                onClick={() => {
                  setReviewing(false);
                  setPlan(null);
                }}
              >
                Keep editing
              </button>
              <button
                className="secondary-button"
                disabled={busy}
                onClick={close}
              >
                Discard
              </button>
              <button
                className="primary-button"
                disabled={busy || !plan}
                onClick={() => void apply()}
              >
                {busy ? "Working…" : "Apply update"}
              </button>
            </footer>
          </section>
        </div>
      )}
    </>
  );
}
