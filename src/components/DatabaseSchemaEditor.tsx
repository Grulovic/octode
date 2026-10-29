import CustomSelect from "./CustomSelect";
import "./code-tools.css";
import { useState } from "react";
import { Plus, Trash2, X } from "lucide-react";
import {
  createTableSql,
  addColumnSql,
  createIndexSql,
  newColumn,
  type SchemaColumn,
  type Engine,
} from "../lib/schema";
export default function DatabaseSchemaEditor({
  engine,
  schema,
  table,
  existingColumns,
  onClose,
  onUseSql,
}: {
  engine: Engine;
  schema: string;
  table: string;
  existingColumns: string[];
  onClose: () => void;
  onUseSql: (sql: string) => void;
}) {
  const [mode, setMode] = useState(table ? "add" : "create");
  const [tableName, setTableName] = useState(table || "new_table");
  const [schemaName, setSchemaName] = useState(schema || "main");
  const [columns, setColumns] = useState<SchemaColumn[]>([
    {
      ...newColumn(),
      name: table ? "new_column" : "id",
      type: table ? "text" : "integer",
      primaryKey: !table,
      nullable: !!table,
    },
  ]);
  const [indexName, setIndexName] = useState("new_index");
  const [indexColumns, setIndexColumns] = useState<string[]>([]);
  const [unique, setUnique] = useState(false);
  const [sql, setSql] = useState("");
  const [error, setError] = useState("");
  const update = (index: number, patch: Partial<SchemaColumn>) => {
    setColumns((previous) =>
      previous.map((column, i) =>
        i === index ? { ...column, ...patch } : column,
      ),
    );
    setSql("");
  };
  const generate = () => {
    try {
      setSql(
        mode === "create"
          ? createTableSql(engine, schemaName, tableName, columns)
          : mode === "add"
            ? addColumnSql(engine, schemaName, tableName, columns[0])
            : createIndexSql(
                engine,
                schemaName,
                tableName,
                indexName,
                indexColumns,
                unique,
              ),
      );
      setError("");
    } catch (reason) {
      setError(String(reason));
    }
  };
  return (
    <div className="code-modal-backdrop">
      <section
        className="code-review-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Table designer"
      >
        <header>
          <strong>Table designer · {engine}</strong>
          <button aria-label="Close table designer" onClick={onClose}>
            <X size={17} />
          </button>
        </header>
        <div className="schema-designer">
          <div className="service-form-grid">
            <label className="service-field">
              Action
              <CustomSelect
                value={mode}
                onChange={(event) => {
                  setMode(event.target.value);
                  setSql("");
                }}
              >
                <option value="create">Create table</option>
                {table && (
                  <>
                    <option value="add">Add column</option>
                    <option value="index">Create index</option>
                  </>
                )}
              </CustomSelect>
            </label>
            <label className="service-field">
              Schema / database
              <input
                value={schemaName}
                onChange={(event) => {
                  setSchemaName(event.target.value);
                  setSql("");
                }}
              />
            </label>
            <label className="service-field">
              Table name
              <input
                value={tableName}
                onChange={(event) => {
                  setTableName(event.target.value);
                  setSql("");
                }}
              />
            </label>
          </div>
          {mode === "index" ? (
            <>
              <label className="service-field">
                Index name
                <input
                  value={indexName}
                  onChange={(event) => {
                    setIndexName(event.target.value);
                    setSql("");
                  }}
                />
              </label>
              <label className="inline-check">
                <input
                  type="checkbox"
                  checked={unique}
                  onChange={(event) => {
                    setUnique(event.target.checked);
                    setSql("");
                  }}
                />
                Unique index
              </label>
              <p className="service-hint">
                Index column order follows the selection order below.
              </p>
              {existingColumns.map((column) => (
                <label className="inline-check" key={column}>
                  <input
                    type="checkbox"
                    checked={indexColumns.includes(column)}
                    onChange={(event) => {
                      setIndexColumns((previous) =>
                        event.target.checked
                          ? [...previous, column]
                          : previous.filter((value) => value !== column),
                      );
                      setSql("");
                    }}
                  />
                  {column}
                </label>
              ))}
            </>
          ) : (
            <>
              <div className="service-subheading">
                <strong>Columns</strong>
                {mode === "create" && (
                  <button
                    onClick={() => {
                      setColumns((previous) => [...previous, newColumn()]);
                      setSql("");
                    }}
                  >
                    <Plus size={13} />
                    Add column
                  </button>
                )}
              </div>
              {(mode === "add" ? columns.slice(0, 1) : columns).map(
                (column, index) => (
                  <div className="schema-column" key={index}>
                    <input
                      aria-label={`Column ${index + 1} name`}
                      placeholder="Column name"
                      value={column.name}
                      onChange={(event) =>
                        update(index, { name: event.target.value })
                      }
                    />
                    <CustomSelect
                      value={column.type}
                      onChange={(event) =>
                        update(index, {
                          type: event.target.value as SchemaColumn["type"],
                        })
                      }
                    >
                      {[
                        "integer",
                        "bigint",
                        "text",
                        "varchar",
                        "boolean",
                        "decimal",
                        "date",
                        "timestamp",
                        "json",
                      ].map((type) => (
                        <option key={type}>{type}</option>
                      ))}
                    </CustomSelect>
                    <label className="inline-check">
                      <input
                        type="checkbox"
                        checked={column.nullable}
                        onChange={(event) =>
                          update(index, { nullable: event.target.checked })
                        }
                      />
                      Nullable
                    </label>
                    <label className="inline-check">
                      <input
                        type="checkbox"
                        checked={column.primaryKey}
                        disabled={mode === "add"}
                        onChange={(event) =>
                          update(index, { primaryKey: event.target.checked })
                        }
                      />
                      Primary
                    </label>
                    <input
                      placeholder="Default literal (optional)"
                      value={column.defaultValue}
                      onChange={(event) =>
                        update(index, { defaultValue: event.target.value })
                      }
                    />
                    {mode === "create" && (
                      <button
                        title="Remove column"
                        onClick={() => {
                          setColumns((previous) =>
                            previous.filter((_, i) => i !== index),
                          );
                          setSql("");
                        }}
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                ),
              )}
            </>
          )}
          {error && <p role="alert">{error}</p>}
          {sql && <pre className="schema-sql">{sql}</pre>}
          <p className="service-hint">
            Generate and review SQL, then open it in the query console. Run SQL
            explicitly to execute it. Schema changes can commit independently of
            other changes, depending on the engine.
          </p>
        </div>
        <footer>
          <button onClick={generate}>Generate SQL</button>
          <button
            className="primary-button"
            disabled={!sql}
            onClick={() => onUseSql(sql)}
          >
            Open reviewed SQL in console
          </button>
        </footer>
      </section>
    </div>
  );
}
