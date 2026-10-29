import CustomSelect from "./CustomSelect";
import { useEffect, useState } from "react";
import { X } from "./DesignIcons";
import { parseCsv, csvInserts } from "../lib/csv";
import { invoke } from "../lib/bridge";
import { nativeTool } from "../lib/toolsBridge";
import { confirmAction } from "./ToolLayout";
import type { TableMetadata } from "./DatabaseRowEditor";
import "./code-tools.css";
interface Plan {
  statements: {
    sql: string;
    parameters: (string | null)[];
    checkSql: string | null;
    checkParameters: (string | null)[];
  }[];
}
export default function DatabaseCsvImport({
  session,
  schema,
  table,
  metadata,
  onClose,
  onApplied,
  onDirty,
}: {
  session: string;
  schema: string;
  table: string;
  metadata: TableMetadata;
  onClose: () => void;
  onApplied: () => Promise<void>;
  onDirty: (value: boolean) => void;
}) {
  const [rows, setRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<string[]>([]);
  const [emptyNull, setEmptyNull] = useState(false);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    onDirty(rows.length > 0);
    return () => onDirty(false);
  }, [rows, onDirty]);
  const choose = async () => {
    try {
      const file = await (
        await import("@tauri-apps/plugin-dialog")
      ).open({
        title: "Import CSV (up to 100 rows)",
        multiple: false,
        filters: [{ name: "CSV", extensions: ["csv", "txt"] }],
      });
      if (typeof file !== "string") return;
      const parsed = parseCsv(
        await invoke<string>("read_import_file", { path: file }),
      );
      setRows(parsed);
      setMapping(
        parsed[0].map(
          (header) =>
            metadata.columns.find(
              (column) => column.name === header && !column.generated,
            )?.name ?? "",
        ),
      );
      setPlan(null);
      setError("");
    } catch (reason) {
      setError(String(reason));
    }
  };
  const preview = async () => {
    setBusy(true);
    try {
      setPlan(
        await nativeTool<Plan>("database_row_plan", {
          id: session,
          request: {
            schema,
            table,
            changes: csvInserts(rows, mapping, emptyNull),
          },
        }),
      );
      setError("");
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  };
  const apply = async () => {
    if (!plan) return;
    setBusy(true);
    try {
      if (
        !(await confirmAction(
          `Insert ${rows.length - 1} reviewed CSV rows into ${schema}.${table}?`,
        ))
      )
        return;
      await nativeTool("database_apply_rows", {
        id: session,
        request: {
          schema,
          table,
          changes: csvInserts(rows, mapping, emptyNull),
          reviewed: plan,
        },
      });
      setRows([]);
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
        aria-label="Import CSV rows"
      >
        <header>
          <strong>
            Import CSV · {schema}.{table}
          </strong>
          <button
            aria-label="Close CSV import"
            disabled={busy}
            onClick={async () => {
              if (
                rows.length &&
                !(await confirmAction("Discard this CSV import draft?"))
              )
                return;
              onClose();
            }}
          >
            <X size={17} />
          </button>
        </header>
        <div className="schema-designer">
          <button
            className="secondary-button"
            disabled={busy}
            onClick={() => void choose()}
          >
            Choose CSV file
          </button>
          <p className="service-hint">
            First row contains headers. Up to 100 data rows per transactional
            import. Map the destination columns, review SQL, then Apply.
          </p>
          {rows.length > 0 && (
            <>
              <label className="inline-check">
                <input
                  type="checkbox"
                  checked={emptyNull}
                  disabled={busy}
                  onChange={(event) => {
                    setEmptyNull(event.target.checked);
                    setPlan(null);
                  }}
                />
                Treat empty CSV fields as NULL
              </label>
              <div className="csv-mapping">
                {rows[0].map((header, index) => (
                  <label className="service-field" key={index}>
                    {header || `Column ${index + 1}`}
                    <CustomSelect
                      disabled={busy}
                      value={mapping[index]}
                      onChange={(event) => {
                        setMapping((previous) =>
                          previous.map((column, i) =>
                            i === index ? event.target.value : column,
                          ),
                        );
                        setPlan(null);
                      }}
                    >
                      <option value="">Skip</option>
                      {metadata.columns
                        .filter((column) => !column.generated)
                        .map((column) => (
                          <option key={column.name} value={column.name}>
                            {column.name} · {column.dataType}
                          </option>
                        ))}
                    </CustomSelect>
                  </label>
                ))}
              </div>
              <div className="data-grid">
                <table>
                  <thead>
                    <tr>
                      {rows[0].map((header, index) => (
                        <th key={index}>{header}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(1, 11).map((row, index) => (
                      <tr key={index}>
                        {row.map((value, index) => (
                          <td key={index}>{value}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="service-hint">
                Showing the first 10 of {rows.length - 1} rows.
              </p>
            </>
          )}
          {plan && (
            <div className="row-plan">
              <h3>Review SQL · {plan.statements.length} inserts</h3>
              {plan.statements.map((statement, index) => (
                <pre key={index}>
                  {statement.sql}
                  {"\n"}Parameters: {JSON.stringify(statement.parameters)}
                </pre>
              ))}
            </div>
          )}
        </div>
        <footer>
          {error && (
            <span role="alert" className="row-error">
              {error}
            </span>
          )}
          <button
            disabled={busy || rows.length < 2}
            onClick={() => void preview()}
          >
            Review import SQL
          </button>
          <button
            className="primary-button"
            disabled={busy || !plan}
            onClick={() => void apply()}
          >
            {busy ? "Working…" : "Apply reviewed import"}
          </button>
        </footer>
      </section>
    </div>
  );
}
