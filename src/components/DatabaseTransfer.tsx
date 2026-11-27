import { useEffect, useRef, useState } from "react";
import { Channel } from "@tauri-apps/api/core";
import type { DbTable } from "../toolTypes";
import { nativeTool } from "../lib/toolsBridge";
import { tableKey, transferSize, type ImportPreview, type TransferProgress, type TransferSummary } from "../lib/databaseTransfer";
import type { TableMetadata } from "../lib/databaseRows";
import CustomSelect from "./CustomSelect";
import { Field, confirmAction } from "./ToolLayout";
import { Download, Upload } from "./DesignIcons";

export default function DatabaseTransfer({ session, name, readOnly, tables, disabled, onBusy, onImported, initialTable, importTarget }: {
  session: string; name: string; readOnly: boolean; tables: DbTable[]; disabled: boolean; initialTable?: DbTable | null;
  onBusy: (busy: boolean) => void; onImported: () => Promise<void>;
  importTarget?: { table: DbTable; columns: TableMetadata["columns"]; nonce: number } | null;
}) {
  const [mode, setMode] = useState("export");
  const [format, setFormat] = useState("sql");
  const [importFormat, setImportFormat] = useState("sql");
  const [selected, setSelected] = useState(() => new Set(tables.map(tableKey)));
  const [headers, setHeaders] = useState(true);
  const [search, setSearch] = useState("");
  const [target, setTarget] = useState(initialTable ? tableKey(initialTable) : tables[0] ? tableKey(tables[0]) : "");
  const [source, setSource] = useState<ImportPreview | null>(null);
  const [columns, setColumns] = useState<TableMetadata["columns"]>([]);
  const [mapping, setMapping] = useState<string[]>([]);
  const [emptyNull, setEmptyNull] = useState(false);
  const [working, setWorking] = useState(false);
  const [progress, setProgress] = useState<TransferProgress | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  useEffect(() => {
    if (!importTarget) return;
    setMode("import"); setImportFormat("csv"); setTarget(tableKey(importTarget.table));
    setColumns(importTarget.columns); setMapping([]); setSource(null); setError(""); setStatus("");
  }, [importTarget]);
  const activeOperation = useRef<string | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (activeOperation.current) void nativeTool("cancel_operation", { operationId: activeOperation.current }).catch(() => {});
    };
  }, []);
  useEffect(() => () => {
    if (source) void nativeTool("database_release_import", { token: source.token }).catch(() => {});
  }, [source]);
  const chosen = tables.filter((table) => selected.has(tableKey(table)));
  const filtered = tables.filter((table) => `${table.schema}.${table.name}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  const locked = disabled || working;
  const run = async (action: () => Promise<void>) => {
    if (locked) return;
    setWorking(true); onBusy(true); setError(""); setStatus(""); setProgress(null);
    try { await action(); } catch (reason) { if (alive.current) setError(String(reason)); }
    finally { activeOperation.current = null; if (alive.current) { setWorking(false); onBusy(false); } }
  };
  const transfer = async <T,>(command: string, args: Record<string, unknown>, inRequest = true): Promise<T> => {
    const operationId = crypto.randomUUID();
    activeOperation.current = operationId;
    setProgress({ phase: "Starting transfer", rows: 0, bytes: 0, totalBytes: null, table: "" });
    const channel = new Channel<TransferProgress>();
    channel.onmessage = (value) => { if (alive.current && activeOperation.current === operationId) setProgress(value); };
    return nativeTool<T>(command, inRequest
      ? { id: session, request: { ...args, operationId }, progress: channel }
      : { id: session, ...args, operationId, progress: channel });
  };
  const exportData = () => run(async () => {
    const filename = format === "csv" ? chosen[0].name : name;
    const path = await (await import("@tauri-apps/plugin-dialog")).save({ title: "Export database table data", defaultPath: `${filename.replace(/[/\\:]/g, "-")}-data.${format}` });
    if (!path) return;
    const result = await transfer<TransferSummary>("database_export", { tables: chosen, path, format, headers });
    setStatus(`Exported ${result.rows.toLocaleString()} rows from ${result.tables} ${result.tables === 1 ? "table" : "tables"} · ${transferSize(result.bytes)}.`);
  });
  const chooseFile = () => run(async () => {
    const path = await (await import("@tauri-apps/plugin-dialog")).open({ title: `Choose ${importFormat.toUpperCase()} import file`, multiple: false, filters: [{ name: importFormat.toUpperCase(), extensions: [importFormat] }] });
    if (typeof path !== "string") return;
    const preview = await transfer<ImportPreview>("database_prepare_import", { path, format: importFormat }, false);
    if (!alive.current) { void nativeTool("database_release_import", { token: preview.token }).catch(() => {}); return; }
    setSource(preview); setMapping(preview.headers.map((header) => columns.find((c) => c.name === header && !c.generated)?.name ?? ""));
  });
  const chooseTarget = async (value: string) => {
    setTarget(value); setColumns([]); setMapping([]); setError("");
    const table = tables.find((t) => tableKey(t) === value);
    if (!table) return;
    await run(async () => {
      const metadata = await nativeTool<TableMetadata>("database_metadata", { id: session, schema: table.schema, table: table.name });
      setColumns(metadata.columns);
      setMapping(source?.headers.map((header) => metadata.columns.find((c) => c.name === header && !c.generated)?.name ?? "") ?? []);
    });
  };
  const changeImportFormat = (value: string) => {
    setImportFormat(value); setSource(null); setError(""); setStatus(""); setProgress(null);
    if (value === "csv") void chooseTarget(target);
  };
  const importData = () => run(async () => {
    if (!source || readOnly) return;
    const table = tables.find((t) => tableKey(t) === target);
    const message = importFormat === "sql"
      ? `Run all ${source.statements.toLocaleString()} SQL statements in “${source.name}” against “${name}”? The script can change or delete data and structure. Errors or cancellation may leave partial changes.`
      : `Insert ${source.rows.toLocaleString()} CSV rows from “${source.name}” into “${table?.schema}.${table?.name}” with the reviewed column mapping? The file is imported in one transaction.`;
    if (!await confirmAction(message, importFormat === "sql" ? "Import SQL" : "Import CSV")) return;
    const result = await transfer<TransferSummary>("database_import_file", { token: source.token, table: importFormat === "csv" ? table : undefined, mapping, emptyNull });
    setSource(null);
    setStatus(`Import completed · ${result.rows.toLocaleString()} ${result.rows === 1 ? "row" : "rows"} affected · ${transferSize(result.bytes)}.`);
    try { await onImported(); } catch (reason) { setError(`Import completed, but table refresh failed: ${String(reason)}`); }
  });
  const mapped = mapping.filter(Boolean);
  const validMapping = !!mapped.length && new Set(mapped).size === mapped.length && mapping.length === source?.headers.length;
  return <div className="database-transfer service-content">
    <div className="database-transfer-heading"><h2>Import & export</h2><p className="service-hint">Transfer table data or run a SQL file against this connection.</p></div>
    <div className="service-tabs database-transfer-tabs" role="tablist" aria-label="Database transfer">
      {["export", "import"].map((value) => <button role="tab" aria-selected={mode === value} className={mode === value ? "active" : ""} disabled={locked} key={value} onClick={() => { setMode(value); setError(""); setStatus(""); setProgress(null); }}>{value === "export" ? <Download size={14} /> : <Upload size={14} />}{value === "export" ? "Export" : "Import"}</button>)}
    </div>
    {mode === "export" ? <fieldset disabled={locked} className="database-transfer-form">
      <Field label="Format"><CustomSelect value={format} onChange={(e) => { setFormat(e.target.value); setStatus(""); }}><option value="sql">SQL · INSERT statements</option><option value="json">JSON · typed table data</option><option value="csv">CSV · single table</option></CustomSelect></Field>
      <p className="service-hint">Exports all rows from the selected tables, independent of grid filters and pagination. Structure, indexes, triggers and sequences are not included; destination tables must already exist. Generated columns are omitted.</p>
      <div className="database-transfer-table-heading"><strong>Tables <span className="service-hint">{chosen.length} / {tables.length} selected</span></strong><div><button type="button" className="secondary-button" onClick={() => setSelected(new Set(tables.map(tableKey)))}>Select all</button><button type="button" className="secondary-button" onClick={() => setSelected(new Set())}>Clear</button></div></div>
      <input aria-label="Filter export tables" placeholder="Filter tables…" value={search} onChange={(e) => setSearch(e.target.value)} spellCheck={false} />
      <div className="database-transfer-tables" aria-label="Tables to export">{filtered.map((table) => <label className="inline-check" key={tableKey(table)}><input type="checkbox" checked={selected.has(tableKey(table))} onChange={(e) => setSelected((previous) => { const next = new Set(previous); if (e.target.checked) next.add(tableKey(table)); else next.delete(tableKey(table)); return next; })} /><span>{table.name}<small>{table.schema}</small></span></label>)}{!filtered.length && <p className="service-hint">{tables.length ? "No matching tables." : "No tables in this connection."}</p>}</div>
      {format === "csv" && <><label className="inline-check"><input type="checkbox" checked={headers} onChange={(e) => setHeaders(e.target.checked)} />Include column headers</label><p className="service-hint">Select one table. CSV represents NULL as an empty field and binary values as base64; use SQL or JSON to preserve value types.</p></>}
      {format === "json" && <p className="service-hint">JSON preserves NULL, binary data and exact numeric strings with type labels. JSON import is not supported.</p>}
      <p className="service-hint">Files stream directly to disk, with no fixed file size, table count or row limits. An existing destination file is replaced only after a complete export.</p>
      <div><button className="primary-button" disabled={locked || !chosen.length || (format === "csv" && chosen.length !== 1)} onClick={() => void exportData()}><Download size={14} />{working ? "Exporting…" : "Export selected tables…"}</button></div>
    </fieldset> : <fieldset disabled={locked} className="database-transfer-form">
      <Field label="Format"><CustomSelect value={importFormat} onChange={(e) => changeImportFormat(e.target.value)}><option value="sql">SQL file</option><option value="csv">CSV · mapped table import</option></CustomSelect></Field>
      {readOnly && <p className="database-error" role="status">This connection is read-only. Reconnect with writes enabled to import.</p>}
      {importFormat === "sql" ? <p className="service-hint">Choose a UTF-8 SQL file of any size. Review the preview, then Import SQL streams every statement. Scripts control their own transactions; errors or cancellation may leave partial changes. Use server SQL without DELIMITER, psql backslash commands or COPY FROM STDIN.</p> : <>
        <Field label="Destination table"><CustomSelect value={target} onChange={(e) => void chooseTarget(e.target.value)}><option value="">Select a table</option>{tables.map((table) => <option key={tableKey(table)} value={tableKey(table)}>{table.schema}.{table.name}</option>)}</CustomSelect></Field>
        <p className="service-hint">The first CSV row contains column headers. Map destination columns below, then import every data row in one transaction. Unmapped columns use their database defaults.</p>
      </>}
      <div><button className="secondary-button" disabled={locked || readOnly || (importFormat === "csv" && !columns.length)} onClick={() => void chooseFile()}>Choose {importFormat.toUpperCase()} file…</button></div>
      {source && <>
        <div className="database-transfer-table-heading"><strong>{source.name} <span className="service-hint">{transferSize(source.bytes)} · {importFormat === "sql" ? `${source.statements.toLocaleString()} statements` : `${source.rows.toLocaleString()} rows`}</span></strong><button className="secondary-button" onClick={() => setSource(null)}>Clear file</button></div>
        {importFormat === "sql" ? <><pre className="database-transfer-preview" tabIndex={0} aria-label="SQL import preview">{source.preview}</pre>{source.truncated && <p className="service-hint">Preview shows the beginning of the file. The entire reviewed file will be imported.</p>}</> : <>
          <div className="csv-mapping">{source.headers.map((header, index) => <Field label={header || `Column ${index + 1}`} key={index}><CustomSelect value={mapping[index] ?? ""} onChange={(e) => setMapping((previous) => { const next = [...previous]; next[index] = e.target.value; return next; })}><option value="">Skip column</option>{columns.filter((c) => !c.generated).map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}</CustomSelect></Field>)}</div>
          <label className="inline-check"><input type="checkbox" checked={emptyNull} onChange={(e) => setEmptyNull(e.target.checked)} />Treat empty CSV fields as NULL</label>
          <pre className="database-transfer-preview" aria-label="CSV import preview">{source.sample.map((row) => JSON.stringify(row)).join("\n")}</pre><p className="service-hint">Preview shows up to five rows with shortened values; the full values and every row will be imported.</p>
        </>}
        <div><button className="primary-button" disabled={locked || readOnly || (importFormat === "csv" && !validMapping)} onClick={() => void importData()}><Upload size={14} />{working ? "Importing…" : `Import ${importFormat.toUpperCase()}`}</button></div>
      </>}
    </fieldset>}
    {working && <div className="database-transfer-progress" role="status"><span>{progress ? `${progress.phase} · ${progress.rows.toLocaleString()} rows · ${transferSize(progress.bytes)}${progress.totalBytes ? ` / ${transferSize(progress.totalBytes)}` : ""}${progress.table ? ` · ${progress.table}` : ""}` : "Preparing transfer…"}</span>{activeOperation.current && <button className="secondary-button" onClick={() => void nativeTool("cancel_operation", { operationId: activeOperation.current }).catch((reason) => setError(String(reason)))}>Cancel transfer</button>}</div>}
    {error && <div className="sql-inline-error" role="alert"><strong>Transfer stopped</strong><p>{error}</p>{mode === "import" && importFormat === "sql" && <p>Verify the database before retrying; SQL statements may have partially applied.</p>}</div>}
    {status && <p className="database-transfer-status" role="status">{status}</p>}
  </div>;
}
