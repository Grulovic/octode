import { lazy, Suspense, useEffect, useId, useRef, useState } from "react";
import { X, Check, Copy, Plus, Trash2, RotateCcw } from "./DesignIcons";
import { confirmAction } from "./ToolLayout";
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
import type { RowPlan, TableMetadata } from "../lib/databaseRows";
const JsonEditor = lazy(() => import("./EditorPane"));
interface PendingRow {
  key: string;
  kind: "insert" | "update-cells" | "delete";
  original: Record<string, string | null>;
  values: Record<string, string | null>;
}
interface Edit {
  row: number;
  key: string;
  insert: boolean;
  initialValue: string | null | undefined;
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
        "thead th.database-data-column",
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
      rows: displayRows.filter((_, index) => selected.has(index)),
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
  const [changes, setChanges] = useState<PendingRow[]>([]);
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
      edit.initialValue;
  useEffect(() => {
    callbacks.current.onEditing(!!edit || busy);
    return () => callbacks.current.onEditing(false);
  }, [!!edit, busy]);
  useEffect(() => {
    callbacks.current.onDirty(changed || changes.length > 0);
    return () => callbacks.current.onDirty(false);
  }, [changed, changes.length]);
  useEffect(() => {
    if (edit && !edit.json) {
      input.current?.focus();
      input.current?.select();
    }
  }, [edit]);
  const close = () => {
    if (working.current) return;
    setEdit(null);
    setPlan(null);
    setError("");
  };
  const inserts = changes.filter((item) => item.kind === "insert");
  useEffect(() => {
    if (inserts.length) gridTable.current?.querySelector('tbody tr:last-child')?.scrollIntoView?.({ block: "nearest" });
  }, [inserts.length]);
  const rowKey = (row: number) => row < result.rows.length ? `row:${row}` : inserts[row - result.rows.length].key;
  const changesByKey = new Map(changes.map((item) => [item.key, item]));
  const pendingRow = (row: number) => changesByKey.get(rowKey(row));
  const originalRow = (row: number) => Object.fromEntries(result.columns.flatMap((column, index) => {
    const cell = result.rows[row]?.[index];
    return cell && (cell.kind === "text" || cell.kind === "null") ? [[column.name, cell.kind === "null" ? null : cell.value]] : [];
  }));
  const displayRows = [...result.rows, ...inserts.map(() => result.columns.map(() => ({ kind: "text" as const, value: "" })))].map((row, index) => {
    const pending = pendingRow(index);
    return row.map((cell, column) => {
      const name = result.columns[column].name;
      if (!pending || pending.kind === "delete" || !Object.hasOwn(pending.values, name)) return cell;
      const value = pending.values[name];
      return value === null ? { kind: "null" as const, value: "" } : { kind: "text" as const, value };
    });
  });
  const canWrite = !!session && !!table && !!metadata?.editable;
  const rowCanDelete = (row: number) => {
    const original = originalRow(row);
    return canWrite && Object.keys(original).length === metadata!.columns.length && metadata!.columns.some((column) => column.primaryKey) && metadata!.columns.filter((column) => column.primaryKey).every((column) => original[column.name] != null);
  };
  const canEdit = (row: number, column: number) => {
    if (!canWrite || pendingRow(row)?.kind === "delete") return false;
    if (row >= result.rows.length) return !metadata!.columns.find((item) => item.name === result.columns[column].name)?.generated;
    return editableCell(result, metadata, row, column);
  };
  const addRow = () => {
    if (disabled || edit || working.current || !canWrite) return;
    if (changes.length >= 100) { setError("Apply or discard this batch before adding more rows (100 row limit)."); return; }
    setChanges((previous) => [...previous, { key: crypto.randomUUID(), kind: "insert", original: {}, values: {} }]);
    setPlan(null); setError("");
  };
  const deleteRow = (row: number) => {
    if (disabled || edit || working.current || !canWrite) return;
    const key = rowKey(row), pending = pendingRow(row);
    if (pending?.kind === "insert") setChanges((previous) => previous.filter((item) => item.key !== key));
    else if (pending?.kind === "delete") setChanges((previous) => Object.keys(pending.values).length ? previous.map((item) => item.key === key ? { ...item, kind: "update-cells" } : item) : previous.filter((item) => item.key !== key));
    else {
      if (!rowCanDelete(row)) return;
      if (!pending && changes.length >= 100) { setError("Apply or discard this batch first (100 row limit)."); return; }
      const next: PendingRow = { key, kind: "delete", original: originalRow(row), values: pending?.values ?? {} };
      setChanges((previous) => pending ? previous.map((item) => item.key === key ? next : item) : [...previous, next]);
    }
    setPlan(null); setError("");
  };
  const open = (row: number, column: number) => {
    if (disabled || edit || working.current || pendingRow(row)?.kind === "delete") return;
    const cell = displayRows[row][column];
    if (cell.kind !== "text" && cell.kind !== "null") { setError("This cell cannot be edited because its full value is unavailable."); return; }
    const name = result.columns[column].name, field = metadata?.columns.find((item) => item.name === name);
    const json = cellJson(cell.value, field?.dataType ?? result.columns[column].dataType);
    const writable = canEdit(row, column), insert = row >= result.rows.length;
    const reason = !session ? "Connect to a database before editing." : insert ? "Generated columns cannot be edited." : cellEditReason(result, metadata, row, column);
    if (!writable && !json) { setError(reason); return; }
    let initial = cell.kind === "null" ? "" : cell.value;
    if (json && initial) { try { initial = formatCellJson(initial); } catch { /* Keep invalid existing JSON editable. */ } }
    if (!json && writable) {
      const widths = columnWidths ?? measuredWidths();
      const minimum = insert || Object.hasOwn(pendingRow(row)?.values ?? {}, name) ? 440 : 360;
      if (widths.length === result.columns.length && widths[column] < minimum) resizeColumn(column, minimum, widths);
    }
    setText(initial); setNull(cell.kind === "null"); setError("");
    setEdit({ row, key: rowKey(row), insert, column: name, initial,
      initialValue: insert && !Object.hasOwn(pendingRow(row)!.values, name) ? undefined : cell.kind === "null" ? null : initial,
      json, nullable: !!field?.nullable, writable, reason,
      dateKind: cellDateKind(field?.dataType ?? result.columns[column].dataType, cell.value),
      original: insert ? {} : originalRow(row),
    });
  };
  const review = () => {
    if (!edit?.writable || working.current) return;
    if (!changed) { close(); return; }
    if (edit.json && !isNull) {
      try { formatCellJson(text); } catch { setError("Enter valid JSON before queuing this change."); return; }
    }
    if (!changes.some((item) => item.key === edit.key) && changes.length >= 100) { setError("Apply or discard this batch first (100 row limit)."); return; }
    const value = isNull ? null : text;
    setChanges((previous) => {
      const existing = previous.find((item) => item.key === edit.key);
      const values = { ...existing?.values, [edit.column]: value };
      if (!edit.insert && value === edit.original[edit.column]) delete values[edit.column];
      const remaining = previous.filter((item) => item.key !== edit.key);
      if (!edit.insert && !Object.keys(values).length) return remaining;
      const next: PendingRow = { key: edit.key, kind: edit.insert ? "insert" : "update-cells", original: edit.original, values };
      return existing ? previous.map((item) => item.key === edit.key ? next : item) : [...previous, next];
    });
    close();
  };
  const requestChanges = (snapshot: PendingRow[]) => snapshot.map(({ key: _, ...item }) => ({ ...item, values: item.kind === "delete" ? {} : item.values }));
  const reviewBatch = async () => {
    if (!session || !changes.length || working.current || edit) return;
    working.current = true; setBusy(true); setError("");
    try { setPlan(await nativeTool<RowPlan>("database_row_plan", { id: session, request: { schema, table, changes: requestChanges(changes) } })); }
    catch (reason) { setError(String(reason)); }
    finally { working.current = false; setBusy(false); }
  };
  const apply = async () => {
    if (!session || !changes.length || working.current || edit) return;
    working.current = true; setBusy(true); setError("");
    const snapshot = changes, payload = requestChanges(snapshot);
    try {
      const reviewed = await nativeTool<RowPlan>("database_row_plan", { id: session, request: { schema, table, changes: payload } });
      setPlan(reviewed);
      const counts = ["insert", "update-cells", "delete"].map((kind) => `${snapshot.filter((item) => item.kind === kind).length} ${kind === "update-cells" ? "update" : kind}(s)`).join(", ");
      if (!(await confirmAction(`Apply ${counts} to ${schema}.${table}? All queued changes use one transaction and check original values.`, "Apply changes"))) return;
      await nativeTool("database_apply_rows", { id: session, request: { schema, table, changes: payload, reviewed } });
      setChanges([]); setPlan(null); callbacks.current.onDirty(false);
      try { await onApplied(); } catch (reason) { setError(`Changes saved, but rows could not refresh: ${String(reason)}`); }
    } catch (reason) { setError(String(reason)); setPlan(null); }
    finally { working.current = false; setBusy(false); }
  };
  const defaultControl = edit?.writable && (edit.insert || changesByKey.get(edit.key)?.values[edit.column] !== undefined) && <button
    className="database-reset-cell"
    title={edit.insert ? "Leave this column unset so the database supplies its default" : "Discard this cell’s queued change"}
    disabled={busy}
    onMouseDown={(event) => event.preventDefault()}
    onClick={() => {
      setChanges((previous) => previous.flatMap((item) => {
        if (item.key !== edit.key) return [item];
        const values = { ...item.values }; delete values[edit.column];
        return item.kind !== "insert" && !Object.keys(values).length ? [] : [{ ...item, values }];
      }));
      close();
    }}>{edit.insert ? "Use default" : "Revert cell"}</button>;
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
      {canWrite && <div className="database-pending-toolbar" role="toolbar" aria-label="Pending row changes">
        <button className="secondary-button" disabled={disabled || busy || !!edit || changes.length >= 100} onClick={addRow}><Plus size={14} />Insert row</button>
        <span aria-live="polite">{changes.length ? `${changes.length} pending row change${changes.length === 1 ? "" : "s"}` : "No pending changes"}</span>
        {changes.length > 0 && <>
          <button className="secondary-button" disabled={disabled || busy || !!edit} onClick={() => { setChanges([]); setPlan(null); setError(""); }}>Discard changes</button>
          <button className="secondary-button" disabled={disabled || busy || !!edit} onClick={() => void reviewBatch()}>Review SQL</button>
          <button className="primary-button" disabled={disabled || busy || !!edit} onClick={() => void apply()}>{busy ? "Working…" : "Apply changes"}</button>
        </>}
      </div>}
      {plan && <details className="database-pending-sql"><summary>SQL and parameters ({plan.statements.length})</summary>{plan.statements.map((statement, index) => <pre key={index}>{statement.sql}{"\n"}{JSON.stringify(statement.parameters)}</pre>)}</details>}
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
              disabled={disabled || busy || !!edit}
              onClick={() => void copySelected()}
              title="Copy selected rows as CSV with column headers (Cmd/Ctrl+C)"
            >
              <Copy size={13} />
              Copy CSV
            </button>
            <button
              type="button"
              disabled={disabled || busy || !!edit}
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
                    width: columnWidths.reduce((sum, width) => sum + width, canWrite ? 114 : 38),
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
                {canWrite && <col style={{ width: 76 }} />}
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
                      disabled={disabled || busy || !!edit || changes.length > 0 || !table}
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
                {canWrite && <th className="database-row-actions" scope="col">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {displayRows.map((row, rowIndex) => (
                <tr
                  key={rowKey(rowIndex)}
                  className={`${selected.has(rowIndex) ? "selected" : ""} ${pendingRow(rowIndex) ? `database-row-${pendingRow(rowIndex)!.kind}` : ""}`}
                  aria-selected={selected.has(rowIndex)}
                >
                  <th scope="row" className="database-row-selector">
                    <button
                      type="button"
                      aria-label={`Select row ${rowIndex + 1}`}
                      aria-pressed={selected.has(rowIndex)}
                      disabled={disabled || busy || !!edit}
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
                      !edit.json;
                    const writable = canEdit(rowIndex, column);
                    const pending = pendingRow(rowIndex);
                    const name = result.columns[column].name;
                    const queued = !!pending && Object.hasOwn(pending.values, name);
                    const defaultCell = pending?.kind === "insert" && !queued;
                    return (
                      <td
                        key={column}
                        className={`${cell.kind === "null" ? "null-cell" : ""} ${writable ? "editable-cell" : ""} ${queued && pending?.kind !== "delete" ? "database-cell-pending" : ""}`}
                        tabIndex={writable && !disabled && !busy ? 0 : undefined}
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
                              title="Enter to queue; Shift+Enter for a new line"
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
                            {defaultControl}{nullControl}
                            <button
                              aria-label="Queue cell change"
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
                        ) : defaultCell ? (
                          <span className="database-default" title="Leave unset to use the database default or generated value">DEFAULT</span>
                        ) : cell.kind === "null" ? (
                          <span className="database-null">NULL</span>
                        ) : cell.kind === "binary" ? (
                          `base64: ${cell.value}`
                        ) : (
                          <span className={`database-value ${cellDateKind(result.columns[column].dataType, cell.value) ? "database-date-value" : /^(bigint|int|integer|smallint|tinyint|numeric|decimal|real|float|double|bool)/i.test(result.columns[column].dataType) ? "database-number-value" : "database-text-value"} ${/^\s*[\[{]/.test(cell.value) && cell.value.length < 4096 && cellJson(cell.value, result.columns[column].dataType) ? "database-json-value" : ""}`}>
                            {/^\s*[\[{]/.test(cell.value) && cell.value.length < 4096 && cellJson(cell.value, result.columns[column].dataType) && <span className="database-json-tag" aria-hidden="true"/>}{cell.value}
                          </span>
                        )}
                      </td>
                    );
                  })}
                  {canWrite && <td className="database-row-actions"><button
                    aria-label={pendingRow(rowIndex)?.kind === "delete" ? `Undo delete row ${rowIndex + 1}` : `Delete row ${rowIndex + 1}`}
                    title={rowIndex < result.rows.length && !rowCanDelete(rowIndex) ? "Deleting requires the complete row and primary key" : pendingRow(rowIndex)?.kind === "delete" ? "Undo queued deletion" : rowIndex >= result.rows.length ? "Remove draft row" : "Queue row deletion"}
                    disabled={disabled || busy || !!edit || (rowIndex < result.rows.length && !rowCanDelete(rowIndex))}
                    onClick={() => deleteRow(rowIndex)}>{pendingRow(rowIndex)?.kind === "delete" ? <RotateCcw size={14} /> : <Trash2 size={14} />}</button>{pendingRow(rowIndex)?.kind === "update-cells" && <button aria-label={`Revert row ${rowIndex + 1}`} title="Discard this row’s queued edits" disabled={disabled || busy || !!edit} onClick={() => { setChanges((previous) => previous.filter((item) => item.key !== rowKey(rowIndex))); setPlan(null); }}><RotateCcw size={14} /></button>}</td>}
                </tr>
              ))}
            </tbody>
          </table>
          {!displayRows.length && (
            <p className="service-hint">No rows returned.</p>
          )}
        </div>
      </div>
      {!edit && error && (
        <p role="alert" className="database-error">
          {error}
        </p>
      )}
      {edit?.json && (
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
              {defaultControl}{nullControl}
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
                  Queue change
                </button>
              )}
            </footer>
          </section>
        </div>
      )}
    </>
  );
}
