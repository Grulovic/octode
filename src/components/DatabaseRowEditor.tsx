import SyntaxCode from "./SyntaxCode";
import "./code-tools.css";
import { useEffect, useState } from "react";
import { X } from "./DesignIcons";
import { nativeTool } from "../lib/toolsBridge";
import { confirmAction } from "./ToolLayout";
import type { DbResult } from "../toolTypes";
export interface ColumnMetadata {
  name: string;
  dataType: string;
  nullable: boolean;
  primaryKey: boolean;
  defaultValue: string | null;
  generated: boolean;
  fullType?: string;
  extra?: string;
  collation?: string;
  comment?: string;
}
export interface TableMetadata {
  columns: ColumnMetadata[];
  indexes: DbResult;
  foreignKeys: DbResult;
  editable: boolean;
  reason: string;
}
interface Change {
  key: string;
  kind: "update" | "insert" | "delete";
  original: Record<string, string | null>;
  values: Record<string, string | null>;
}
export interface RowPlan {
  statements: {
    sql: string;
    parameters: (string | null)[];
    checkSql: string | null;
    checkParameters: (string | null)[];
  }[];
}
export default function DatabaseRowEditor({
  session,
  schema,
  table,
  result,
  metadata,
  onClose,
  onApplied,
  onDirty,
}: {
  session: string;
  schema: string;
  table: string;
  result: DbResult;
  metadata: TableMetadata;
  onClose: () => void;
  onApplied: () => Promise<void>;
  onDirty: (value: boolean) => void;
}) {
  const [changes, setChanges] = useState<Change[]>([]);
  const [selected, setSelected] = useState(-1);
  const [form, setForm] = useState<Record<string, string | null>>({});
  const [included, setIncluded] = useState<string[]>([]);
  const [plan, setPlan] = useState<RowPlan | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    onDirty(changes.length > 0 || included.length > 0);
    return () => onDirty(false);
  }, [changes, included, onDirty]);
  const original = (index: number) =>
    Object.fromEntries(
      result.columns.map((column, i) => [
        column.name,
        result.rows[index][i].kind === "null"
          ? null
          : result.rows[index][i].value,
      ]),
    );
  const editableRow = (index: number) =>
    result.rows[index]?.every(
      (cell) => cell.kind === "text" || cell.kind === "null",
    );
  const choose = async (index: number) => {
    if (
      included.length &&
      !(await confirmAction(
        "Discard fields that have not been added to pending changes?",
      ))
    )
      return;
    setSelected(index);
    const pending = changes.find((change) => change.key === String(index));
    setForm(index < 0 ? {} : { ...original(index), ...pending?.values });
    setIncluded(pending ? Object.keys(pending.values) : []);
    setPlan(null);
  };
  const pending = () => {
    const baseline = selected < 0 ? {} : original(selected);
    const values = Object.fromEntries(
      Object.entries(form).filter(
        ([name, value]) =>
          included.includes(name) && (selected < 0 || value !== baseline[name]),
      ),
    );
    return {
      key: selected < 0 ? crypto.randomUUID() : String(selected),
      kind: selected < 0 ? ("insert" as const) : ("update" as const),
      original: baseline,
      values,
    };
  };
  const add = () => {
    const change = pending();
    if (change.kind === "update" && !Object.keys(change.values).length) {
      setError("Change at least one value.");
      return;
    }
    setChanges((previous) => [
      ...previous.filter((item) => item.key !== change.key),
      change,
    ]);
    setIncluded([]);
    setPlan(null);
    setError("");
  };
  const remove = (index: number) => {
    setChanges((previous) => [
      ...previous.filter((item) => item.key !== String(index)),
      {
        key: String(index),
        kind: "delete",
        original: original(index),
        values: {},
      },
    ]);
    setPlan(null);
  };
  const preview = async () => {
    setBusy(true);
    setError("");
    try {
      setPlan(
        await nativeTool<RowPlan>("database_row_plan", {
          id: session,
          request: {
            schema,
            table,
            changes: changes.map(({ key: _, ...change }) => change),
          },
        }),
      );
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  };
  const apply = async () => {
    if (!plan) return;
    setBusy(true);
    setError("");
    try {
      if (
        !(await confirmAction(
          `Apply ${changes.length} reviewed row changes to ${schema}.${table}? The batch uses a transaction and checks original row values.`,
        ))
      )
        return;
      await nativeTool("database_apply_rows", {
        id: session,
        request: {
          schema,
          table,
          changes: changes.map(({ key: _, ...change }) => change),
          reviewed: plan,
        },
      });
      setChanges([]);
      setIncluded([]);
      onDirty(false);
      await onApplied();
      onClose();
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="code-modal-backdrop">
      <section
        className="code-review-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Edit database rows"
      >
        <header>
          <strong>
            {schema}.{table} · pending row edits
          </strong>
          <button
            aria-label="Close row editor"
            disabled={busy}
            onClick={async () => {
              if (
                (changes.length || included.length) &&
                !(await confirmAction("Discard pending row edits?"))
              )
                return;
              onClose();
            }}
          >
            <X size={17} />
          </button>
        </header>
        {!metadata.editable ? (
          <p>{metadata.reason}</p>
        ) : (
          <div className="row-editor-body">
            <aside>
              <button disabled={busy} onClick={() => void choose(-1)}>
                + Insert row
              </button>
              {result.rows.map((row, index) => (
                <div key={index}>
                  <button
                    disabled={busy || !editableRow(index)}
                    onClick={() => void choose(index)}
                  >
                    Row {index + 1} ·{" "}
                    {metadata.columns
                      .filter((column) => column.primaryKey)
                      .map(
                        (column) =>
                          row[
                            result.columns.findIndex(
                              (item) => item.name === column.name,
                            )
                          ]?.value,
                      )
                      .join(", ")}
                  </button>
                  <button
                    disabled={busy || !editableRow(index)}
                    onClick={() => remove(index)}
                  >
                    Delete
                  </button>
                </div>
              ))}
              <strong>{changes.length} pending</strong>
              {changes.map((change) => (
                <div key={change.key}>
                  <span>
                    {change.kind}{" "}
                    {change.kind === "insert"
                      ? "new row"
                      : `row ${Number(change.key) + 1}`}
                  </span>
                  <button
                    disabled={busy}
                    onClick={() => {
                      setChanges((previous) =>
                        previous.filter((item) => item.key !== change.key),
                      );
                      setPlan(null);
                    }}
                  >
                    Discard
                  </button>
                </div>
              ))}
            </aside>
            <main>
              <h3>
                {selected < 0 ? "Insert a new row" : `Edit row ${selected + 1}`}
              </h3>
              <p className="service-hint">
                Check the columns to include. Unchecked insert columns use
                database defaults. NULL is different from an empty string.
              </p>
              {metadata.columns
                .filter((column) => !column.generated)
                .map((column) => (
                  <div className="row-field" key={column.name}>
                    <label>
                      <input
                        type="checkbox"
                        checked={included.includes(column.name)}
                        disabled={busy}
                        onChange={(event) => {
                          setIncluded((previous) =>
                            event.target.checked
                              ? [...previous, column.name]
                              : previous.filter((name) => name !== column.name),
                          );
                          if (event.target.checked && !(column.name in form))
                            setForm((previous) => ({
                              ...previous,
                              [column.name]: "",
                            }));
                          setPlan(null);
                        }}
                      />
                      {column.name}{included.includes(column.name) && (selected < 0 || form[column.name] !== original(selected)[column.name]) && <span className="tool-unsaved-dot" aria-label="Changed field"/>}
                      <small>
                        {column.dataType}
                        {column.primaryKey ? " · Primary key" : ""}
                      </small>
                    </label>
                    <input
                      aria-label={`Value for ${column.name}`}
                      disabled={
                        busy ||
                        !included.includes(column.name) ||
                        form[column.name] === null
                      }
                      value={form[column.name] ?? ""}
                      onChange={(event) => {
                        setForm((previous) => ({
                          ...previous,
                          [column.name]: event.target.value,
                        }));
                        setPlan(null);
                      }}
                    />
                    <label>
                      <input
                        type="checkbox"
                        checked={form[column.name] === null}
                        disabled={
                          busy ||
                          !included.includes(column.name) ||
                          !column.nullable
                        }
                        onChange={(event) => {
                          setForm((previous) => ({
                            ...previous,
                            [column.name]: event.target.checked ? null : "",
                          }));
                          setPlan(null);
                        }}
                      />
                      NULL
                    </label>
                  </div>
                ))}
              <button
                className="secondary-button"
                disabled={busy}
                onClick={add}
              >
                Add to pending changes
              </button>
              {plan && (
                <div className="row-plan">
                  <h3>SQL review</h3>
                  {plan.statements.map((statement, index) => (
                    <div key={index}><SyntaxCode text={statement.sql}/><pre>Parameters: {JSON.stringify(statement.parameters)}</pre></div>
                  ))}
                </div>
              )}
            </main>
          </div>
        )}
        <footer>
          {error && (
            <span role="alert" className="row-error">
              {error}
            </span>
          )}
          <button
            disabled={busy || !changes.length}
            onClick={() => void preview()}
          >
            Review SQL
          </button>
          <button
            className="primary-button"
            disabled={busy || !plan}
            onClick={() => void apply()}
          >
            {busy ? "Working…" : "Apply reviewed changes"}
          </button>
        </footer>
      </section>
    </div>
  );
}
