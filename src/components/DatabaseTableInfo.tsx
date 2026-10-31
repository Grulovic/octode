import { useState } from "react";
import { X, Pencil, Trash2, Plus } from "./DesignIcons";
import { renameTableSql, renameColumnSql, dropTableSql, dropColumnSql, editColumnSql, addColumnSql, newColumn, type Engine } from "../lib/schema";
import { Field } from "./ToolLayout";
import type { DbResult } from "../toolTypes";
import type { TableMetadata } from "./DatabaseRowEditor";
function MetadataGrid({
  title,
  result,
  empty,
}: {
  title: string;
  result: DbResult;
  empty: string;
}) {
  return (
    <section>
      <h3>{title}</h3>
      {result.rows.length ? (
        <div className="data-grid">
          <table>
            <thead>
              <tr>
                {result.columns.map((column, index) => (
                  <th key={index}>{column.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.rows.map((row, index) => (
                <tr key={index}>
                  {row.map((cell, column) => (
                    <td key={column}>
                      {cell.kind === "null" ? "NULL" : cell.value}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="service-hint">{empty}</p>
      )}
      {result.truncated && (
        <p className="service-hint">Metadata display limit reached.</p>
      )}
    </section>
  );
}
export default function DatabaseTableInfo({
  metadata, engine = "sqlite", schema = "main", table = "", readOnly = true, onUseSql,
}: {
  metadata: TableMetadata;
  engine?: Engine;
  schema?: string;
  table?: string;
  readOnly?: boolean;
  onUseSql?: (sql: string) => void;
}) {
  const [action, setAction] = useState("");
  const [column, setColumn] = useState("");
  const [name, setName] = useState("");
  const [dataType, setDataType] = useState("TEXT");
  const [nullable, setNullable] = useState(true);
  const [defaultValue, setDefaultValue] = useState("");
  const [defaultIsSql, setDefaultIsSql] = useState(false);
  const [keepDefault, setKeepDefault] = useState(true);
  const [preview, setPreview] = useState("");
  const [error, setError] = useState("");
  const open = (action: string, column = "") => {
    const info = metadata.columns.find((item) => item.name === column);
    setAction(action); setColumn(column); setName(column || table); setDataType(info?.fullType || info?.dataType || "TEXT"); setNullable(info?.nullable ?? true);
    // A missing default means DROP DEFAULT; existing expressions are shown for reference rather than silently rewritten.
    setDefaultValue(""); setDefaultIsSql(false); setKeepDefault(true); setPreview(""); setError("");
  };
  const generate = () => {
    try {
      setError("");
      setPreview(action === "rename-table" ? renameTableSql(engine, schema, table, name) : action === "drop-table" ? dropTableSql(engine, schema, table) : action === "rename-column" ? renameColumnSql(engine, schema, table, column, name) : action === "drop-column" ? dropColumnSql(engine, schema, table, column) : action === "add-column" ? addColumnSql(engine, schema, table, { ...newColumn(), name, nullable, type: "text" }) : editColumnSql(engine, schema, table, column, dataType, nullable, defaultValue, defaultIsSql, keepDefault, metadata.columns.find((item) => item.name === column)?.defaultValue ?? null, metadata.columns.find((item) => item.name === column)));
    } catch (reason) { setError(String(reason)); }
  };
  return (
    <div
      className="service-content database-table-info"
      role="region"
      aria-label="Table info"
    >
      <div className="table-info-actions"><strong>{schema}.{table}</strong><button className="secondary-button" disabled={readOnly || !onUseSql} onClick={() => open("rename-table")}><Pencil size={14} />Rename table</button><button className="secondary-button" disabled={readOnly || !onUseSql} onClick={() => { open("add-column"); setName("new_column"); }}><Plus size={14} />Add column</button><button className="danger-outline" disabled={readOnly || !onUseSql} onClick={() => open("drop-table")}><Trash2 size={14} />Drop table…</button></div>
      {readOnly && <p className="service-hint">Schema actions require a connection with writes enabled.</p>}
      <section>
        <h3>Columns</h3>
        <div className="data-grid">
          <table>
            <thead>
              <tr>
                <th>Column</th>
                <th>Type</th>
                <th>Nullable</th>
                <th>Key / default</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {metadata.columns.map((column) => (
                <tr key={column.name}>
                  <td>{column.name}</td>
                  <td>{column.fullType || column.dataType}</td>
                  <td>{column.nullable ? "YES" : "NO"}</td>
                  <td>
                    {column.primaryKey ? "PRIMARY KEY · " : ""}
                    {column.generated ? "Generated · " : ""}
                    {column.defaultValue ?? ""}
                  </td>
                  <td><div className="table-column-actions"><button disabled={readOnly} onClick={() => open("rename-column", column.name)}>Rename</button><button disabled={readOnly || column.primaryKey || column.generated || /auto_increment/i.test(column.extra ?? "") || engine === "sqlite"} title={engine === "sqlite" ? "SQLite property edits require a table-rebuild migration" : column.primaryKey || column.generated ? "Key/generated columns require a migration" : "Edit type, nullability and default"} onClick={() => open("edit-column", column.name)}>Edit</button><button className="danger-action" disabled={readOnly} onClick={() => open("drop-column", column.name)}>Drop…</button></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {action && <div className="code-modal-backdrop"><section className="file-operation-modal" role="dialog" aria-modal="true" aria-label="Review schema change"><header><strong>{action.replaceAll("-", " ")} · {column || table}</strong><button aria-label="Close schema change" onClick={() => setAction("")}><X size={17} /></button></header>
        <div className="schema-change-fields" onChange={() => setPreview("")}>
          {(action.startsWith("rename") || action === "add-column") && <Field label="New name"><input value={name} onChange={(event) => setName(event.target.value)} /></Field>}
          {action === "edit-column" && <><Field label="SQL type"><input value={dataType} onChange={(event) => setDataType(event.target.value)} /></Field><label className="inline-check"><input type="checkbox" checked={nullable} onChange={(event) => setNullable(event.target.checked)} />Nullable</label><p className="service-hint">Current default: {metadata.columns.find((item) => item.name === column)?.defaultValue ?? "none"}. Set the desired default below; blank removes it.</p><label className="inline-check"><input type="checkbox" checked={keepDefault} onChange={(event) => setKeepDefault(event.target.checked)} />Keep current default</label><Field label="New default"><input disabled={keepDefault} value={defaultValue} onChange={(event) => setDefaultValue(event.target.value)} /></Field><label className="inline-check"><input type="checkbox" disabled={keepDefault} checked={defaultIsSql} onChange={(event) => setDefaultIsSql(event.target.checked)} />Use SQL value instead of text</label></>}
          {action.startsWith("drop") && <p className="error-banner">Dropping {action === "drop-table" ? "this table removes all of its rows" : "this column removes its stored values"}. This cannot be undone by Octode. Review dependencies and the SQL before running it.</p>}
          {error && <p className="error-banner" role="alert">{error}</p>}{preview && <pre className="schema-sql-preview">{preview}</pre>}
        </div><footer><button className="secondary-button" onClick={generate}>Preview SQL</button><button className="primary-button" disabled={!preview || readOnly} onClick={() => { onUseSql?.(preview); setAction(""); }}>Open SQL for review</button></footer></section></div>}
      <MetadataGrid
        title="Indexes"
        result={metadata.indexes}
        empty="No indexes."
      />
      <MetadataGrid
        title="Relationships"
        result={metadata.foreignKeys}
        empty="No relationships."
      />
    </div>
  );
}
