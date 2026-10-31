import SqlFilterInput from "./SqlFilterInput";
import { changedIds } from "../lib/toolChanges";
import CustomSelect from "./CustomSelect";
import DatabaseDataGrid from "./DatabaseDataGrid";
import { registerSearchList } from "../lib/searchDocuments";
import type { SearchEntry } from "../lib/searchEverywhere";
import DatabaseTableInfo from "./DatabaseTableInfo";
import { useToolView } from "../hooks/useToolView";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { Play, Table2 } from "./DesignIcons";
import { ChevronLeft, ArrowLeft, ChevronRight, Plus, Copy, Save, Search, X, Trash2 } from "./DesignIcons";
import { useToolDocument } from "../hooks/useToolDocument";
import {
  databaseDocument,
  databaseConnection,
  serverDocument,
  id,
} from "../lib/toolDefaults";
import { loadTool, nativeTool } from "../lib/toolsBridge";
import type {
  DatabaseConnection,
  DbResult,
  DbTable,
  ServerConnection,
} from "../toolTypes";
import {
  ToolLayout,
  Field,
  SecretField,
  EmptyTool,
  chooseLocalFile,
  confirmAction,
  type ToolProps,
} from "./ToolLayout";
import { exportText, resultCsv } from "../lib/export";
import type { TableMetadata } from "../lib/databaseRows";
import { desktop } from "../lib/bridge";
const DatabaseCsvImport = lazy(() => import("./DatabaseCsvImport"));
const SqlEditor = lazy(() => import("./EditorPane"));
export default function DatabaseWorkspace({
  project,
  visible,
  searchTarget,
  onError,
  onDirty,
}: ToolProps) {
  const rowDirty = useRef(false);
  const [pendingRows, setPendingRows] = useState(false);
  const docDirty = useRef(false);
  const documentDirty = useCallback(
    (value: boolean) => {
      docDirty.current = value;
      onDirty(value || rowDirty.current);
    },
    [onDirty],
  );
  const rowDirtyChange = useCallback(
    (value: boolean) => {
      rowDirty.current = value;
      setPendingRows(value);
      onDirty(value || docDirty.current);
    },
    [onDirty],
  );
  const {
    document: doc,
    savedDocument = doc,
    setDocument: set,
    loading,
    saving,
    saveError,
    changes,
    dirty,
    save,
  } = useToolDocument(
    project,
    "database",
    databaseDocument,
    onError,
    documentDirty,
  );
  const [selected, select] = useToolView(
    project.id,
    "DatabaseWorkspace:selected",
    "",
  );
  const [session, setSession] = useState<string | null>(null);
  const [screen, setScreen] = useState<"connections" | "workspace">(
    "connections",
  );
  const sessionRef = useRef<string | null>(null);
  const sshRef = useRef<string | null>(null);
  const alive = useRef(true);
  const browseVersion = useRef(0);
  const [queryError, setQueryError] = useState("");
  const dirtyConnections = changedIds(doc.connections, savedDocument.connections);
  const [browseError, setBrowseError] = useState("");
  const [metadataError, setMetadataError] = useState("");
  const [loadingRows, setLoadingRows] = useState(false);
  const [metadata, setMetadata] = useState<TableMetadata | null>(null);
  const [tableInfo, setTableInfo] = useState(false);
  const [csvImport, setCsvImport] = useState(false);
  const [history, setHistory] = useState<
    { sql: string; time: string; rows: number; error?: string }[]
  >([]);
  const [operationBusy, setBusy] = useState(false);
  const [cellEditing, setCellEditing] = useState(false);
  const busy = operationBusy || cellEditing || pendingRows;
  const operation = useRef<string | null>(null);
  const [servers, setServers] = useState<ServerConnection[]>([]);
  const [tables, setTables] = useState<DbTable[]>([]);
  const [tableSearch, setTableSearch] = useState("");
  const tableSearchInput = useRef<HTMLInputElement>(null);
  const filteredTables = tables.filter((item) =>
    item.name
      .toLocaleLowerCase()
      .includes(tableSearch.trim().toLocaleLowerCase()),
  );
  const [table, setTable] = useState<DbTable | null>(null);
  const [tab, setTab] = useToolView(
    project.id,
    "DatabaseWorkspace:tab",
    "settings",
  );
  const [tableFilters, setTableFilters] = useToolView<Record<string, { draft: string; applied: string }>>(
    project.id, "DatabaseWorkspace:tableFilters", {},
  );
  const filterKey = (item: DbTable) => JSON.stringify([selected, item.schema, item.name]);
  const currentFilter = table ? tableFilters[filterKey(table)] : undefined;
  const filter = currentFilter?.draft ?? "";
  const appliedFilter = currentFilter?.applied ?? "";
  const setFilter = (draft: string) => {
    if (!table) return;
    const key = filterKey(table);
    setTableFilters((previous) => ({ ...previous, [key]: { applied: previous[key]?.applied ?? "", draft } }));
  };
  const [sort, setSort] = useState("");
  const [descending, setDescending] = useState(false);
  const [page, setPage] = useState(0);
  const [result, setResult] = useState<DbResult | null>(null);
  useEffect(() => {
    if (metadata)
      setResult((previous) =>
        previous && !previous.columns.length
          ? {
              ...previous,
              columns: metadata.columns.map((column) => ({
                name: column.name,
                dataType: column.dataType,
              })),
            }
          : previous,
      );
  }, [metadata, result?.columns.length]);
  const [sql, setSql] = useState("SELECT 1;");
  const [queryId, setQueryId] = useToolView(
    project.id,
    "DatabaseWorkspace:queryId",
    "",
  );
  useEffect(
    () =>
      registerSearchList(
        project.id,
        session
          ? tables.map((item) => ({
              path: `database:table:${selected}:${item.schema}:${item.name}`,
              label: item.name,
              relative: `${doc.connections.find((c) => c.id === selected)?.name ?? ""} / ${item.schema} / Tables`,
              root: "Database",
              kind: "table",
              line: 1,
              target: {
                tool: "database",
                id: item.name,
                schema: item.schema,
                connectionId: selected,
              },
            }))
          : [],
      ),
    [project.id, session, tables, selected, doc.connections],
  );
  const [queryName, setQueryName] = useState("Untitled query");
  const handledSearch = useRef<SearchEntry | undefined>(undefined);
  useEffect(() => {
    if (
      loading ||
      !searchTarget ||
      searchTarget.target?.tool !== "database" ||
      handledSearch.current === searchTarget
    )
      return;
    if (rowDirty.current || cellEditing) { onError("Apply or discard pending row edits before navigating to another database result."); return; }
    handledSearch.current = searchTarget;
    const connectionId =
      searchTarget.target.connectionId ?? searchTarget.target.id;
    if (session && selected !== connectionId) {
      onError(
        "Disconnect the current database before opening another connection.",
      );
      return;
    }
    select(connectionId);
    if (searchTarget.kind === "table") {
      const item = tables.find(
        (item) =>
          item.name === searchTarget.target?.id &&
          item.schema === searchTarget.target?.schema,
      );
      if (item && session) {
        setScreen("workspace");
        void browse(item, 0);
      }
    } else if (searchTarget.kind === "query") {
      const query = doc.queries.find(
        (item) => item.id === searchTarget.target?.id,
      );
      if (query) {
        setQueryId(query.id);
        setQueryName(query.name);
        setSql(query.sql);
        setResult(null);
        setScreen("workspace");
        setTab("console");
      }
    } else {
      setScreen("connections");
      setTab("settings");
    }
  }, [searchTarget, loading]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (sessionRef.current)
        void nativeTool("database_close", { id: sessionRef.current }).catch(
          () => {},
        );
      if (sshRef.current)
        void nativeTool("ssh_close", { id: sshRef.current }).catch(() => {});
      if (operation.current)
        void nativeTool("cancel_operation", {
          operationId: operation.current,
        }).catch(() => {});
    };
  }, []);
  useEffect(() => {
    if (visible)
      void loadTool(project, "servers", serverDocument)
        .then((value) => setServers(value.connections))
        .catch((error) => onError(String(error)));
  }, [visible, project, onError]);
  const current = doc.connections.find((item) => item.id === selected);
  const patch = (value: Partial<DatabaseConnection>) =>
    set((previous) => ({
      ...previous,
      connections: previous.connections.map((item) =>
        item.id === selected ? { ...item, ...value } : item,
      ),
    }));
  const task = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await action();
    } catch (error) {
      if (alive.current) onError(String(error));
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  const disconnect = async () => {
    setTableInfo(false);
    browseVersion.current++;
    setLoadingRows(false);
    setBrowseError("");
    setMetadataError("");
    setMetadata(null);
    if (operation.current)
      await nativeTool("cancel_operation", { operationId: operation.current });
    if (sessionRef.current)
      await nativeTool("database_close", { id: sessionRef.current });
    if (sshRef.current) await nativeTool("ssh_close", { id: sshRef.current });
    sessionRef.current = null;
    sshRef.current = null;
    setSession(null);
    setScreen("connections");
    setTab("settings");
    setTables([]);
    setTable(null);
    setResult(null);
  };
  const connect = () =>
    task(async () => {
      if (!current) return;
      if (current.engine !== "sqlite" && !current.database.trim()) {
        throw new Error("Enter a database name before connecting.");
      }
      let sshSession: string | null = null;
      let databaseSession: string | null = null;
      try {
        if (current.sshId) {
          const server = servers.find((item) => item.id === current.sshId);
          if (!server)
            throw new Error("Save the SSH connection in Servers first.");
          sshSession = await nativeTool<string>("ssh_connect", {
            projectId: project.id,
            connection: server,
          });
        }
        databaseSession = await nativeTool<string>("database_connect", {
          projectId: project.id,
          connection: current,
          sshSession,
        });
        const metadata = await nativeTool<DbResult>("database_tables", {
          id: databaseSession,
        });
        if (!alive.current) {
          await nativeTool("database_close", { id: databaseSession });
          if (sshSession) await nativeTool("ssh_close", { id: sshSession });
          return;
        }
        sessionRef.current = databaseSession;
        sshRef.current = sshSession;
        setSession(databaseSession);
        setTables(
          metadata.rows.map((row) => ({
            schema: row[0].value,
            name: row[1].value,
          })),
        );
        setTab("tables");
        setScreen("workspace");
      } catch (error) {
        if (databaseSession)
          await nativeTool("database_close", { id: databaseSession }).catch(
            () => {},
          );
        if (sshSession)
          await nativeTool("ssh_close", { id: sshSession }).catch(() => {});
        throw error;
      }
    });
  const browse = async (
    nextTable = table,
    nextPage = page,
    nextSort = sort,
    nextDescending = descending,
    nextFilter = nextTable ? tableFilters[filterKey(nextTable)]?.applied ?? "" : "",
  ) => {
    if (!session || !nextTable) return;
    const version = ++browseVersion.current;
    const isCurrent = () => alive.current && version === browseVersion.current;
    setTableInfo(false);
    setTable(nextTable);
    setTab("tables");
    const sameTable =
      tab === "tables" &&
      table?.schema === nextTable.schema &&
      table?.name === nextTable.name;
    if (!sameTable) {
      setResult(null);
      setMetadata(null);
    }
    setBrowseError("");
    setMetadataError("");
    setLoadingRows(true);
    // Schema information is optional for reading rows. A denied or slow metadata
    // query must never hide a successful SELECT or block table pagination.
    void nativeTool<TableMetadata>("database_metadata", {
      id: session,
      schema: nextTable.schema,
      table: nextTable.name,
    })
      .then((info) => {
        if (!isCurrent()) return;
        setMetadata(info);
        setResult((previous) =>
          previous && !previous.columns.length
            ? {
                ...previous,
                columns: info.columns.map((column) => ({
                  name: column.name,
                  dataType: column.dataType,
                })),
              }
            : previous,
        );
      })
      .catch((error) => {
        if (isCurrent())
          setMetadataError(
            `Rows can still be browsed. Column/index metadata could not be loaded: ${String(error)}`,
          );
      });
    try {
      const value = await nativeTool<DbResult>("database_browse", {
        id: session,
        request: {
          schema: nextTable.schema,
          table: nextTable.name,
          filter: nextFilter,
          sort: nextSort,
          descending: nextDescending,
          page: nextPage,
        },
      });
      if (!isCurrent()) return;
      const key = filterKey(nextTable);
      setTableFilters((previous) => ({ ...previous, [key]: { draft: previous[key]?.draft ?? nextFilter, applied: nextFilter } }));
      setPage(nextPage);
      setSort(nextSort);
      setDescending(nextDescending);
      setResult(value);
    } catch (error) {
      if (isCurrent())
        setBrowseError(
          `Could not load ${nextTable.schema}.${nextTable.name}: ${String(error)}`,
        );
    } finally {
      if (isCurrent()) setLoadingRows(false);
    }
  };
  const showDataTab = (value: string) => {
    setTableInfo(false);
    browseVersion.current++;
    setLoadingRows(false);
    setTab(value);
    setResult(null);
    if (value === "tables" && table) void task(() => browse(table));
  };
  const run = (statement = sql) =>
    task(async () => {
      setQueryError("");
      if (!session) return;
      browseVersion.current++;
      setMetadata(null);
      setLoadingRows(false);
      if (
        !current?.readOnly &&
        !(await confirmAction(
          "Run this SQL against the connected database? Writes take effect immediately.",
          "Run SQL",
        ))
      )
        return;
      const operationId = id();
      operation.current = operationId;
      setResult(null);
      try {
        const value = await nativeTool<DbResult>("database_query", {
          id: session,
          request: { sql: statement, operationId },
        });
        if (alive.current) {
          setResult(value);
          if (/^\s*(?:ALTER|DROP|CREATE|RENAME)\b/i.test(statement)) {
            // Refresh metadata after successful DDL without turning a refresh error into a failed write.
            void nativeTool<DbResult>("database_tables", { id: session }).then((info) => {
              if (!alive.current || sessionRef.current !== session) return;
              const next = info.rows.map((row) => ({ schema: row[0].value, name: row[1].value }));
              setTables(next);
              setTable((previous) => previous && next.some((item) => item.schema === previous.schema && item.name === previous.name) ? previous : null);
            }).catch((reason) => { if (alive.current) setMetadataError(`SQL completed; could not refresh tables: ${String(reason)}`); });
          }
          setHistory((previous) =>
            [
              {
                sql: statement,
                time: new Date().toLocaleTimeString(),
                rows: value.rows.length,
              },
              ...previous,
            ].slice(0, 20),
          );
        }
      } catch (reason) {
        setHistory((previous) =>
          [
            {
              sql: statement,
              time: new Date().toLocaleTimeString(),
              rows: 0,
              error: String(reason),
            },
            ...previous,
          ].slice(0, 20),
        );
        setQueryError(String(reason));
      } finally {
        operation.current = null;
      }
    });
  useEffect(() => {
    if (loading) return;
    const query = doc.queries.find((item) => item.id === queryId);
    if (query) {
      setSql(query.sql);
      setQueryName(query.name);
    }
  }, [loading, queryId]);
  const editQuery = (value: Partial<{ sql: string; name: string }>) => {
    const query = {
      id: queryId || id(),
      name: value.name ?? queryName,
      connectionId: selected,
      sql: value.sql ?? sql,
    };
    set((previous) => ({
      ...previous,
      queries: [
        ...previous.queries.filter((item) => item.id !== query.id),
        query,
      ],
    }));
    setQueryId(query.id);
    if (value.sql !== undefined) setSql(value.sql);
    if (value.name !== undefined) setQueryName(value.name);
  };

  const addConnection = () => {
    const connection = databaseConnection();
    set((previous) => ({
      ...previous,
      connections: [...previous.connections, connection],
    }));
    setQueryId("");
    setQueryName("Untitled query");
    setSql("SELECT 1;");
    select(connection.id);
    setTab("settings");
    setScreen("connections");
  };
  const duplicateConnection = () => {
    if (!current || session || busy) return;
    const copy = structuredClone(current);
    copy.id = id();
    copy.name = `${current.name} copy`;
    set((previous) => ({
      ...previous,
      connections: [...previous.connections, copy],
    }));
    select(copy.id);
    setQueryId("");
    setQueryName("Untitled query");
    setSql("SELECT 1;");
    setTab("settings");
    setScreen("connections");
  };
  return (
    <ToolLayout
      title="Database"
      mainClassName={
        screen === "workspace" && tab === "tables" && !tableInfo
          ? "database-table-main"
          : ""
      }
      showToolbar={screen === "connections"}
      toolbarActions={
        <button
          type="button"
          className="secondary-button"
          title="New database"
          disabled={busy || !!session}
          onClick={addConnection}
        >
          <Plus size={15} />
          New connection
        </button>
      }
      {...{ loading, saving, dirty, save, saveError, changes }}
      sidebar={
        <>
          {screen === "workspace" && (
            <div className="database-connection-nav">
              <button
                className="database-connection-back"
                title="Back to connections"
                disabled={busy}
                onClick={() => setScreen("connections")}
              >
                <ArrowLeft size={16} />
                <span className="connection-dot connected" aria-hidden="true"/><span>{current?.name}</span><span className="connection-engine">{current?.engine}</span>
              </button>
              <div className="service-tabs">
                {["tables", "console"].map((value) => (
                  <button
                    key={value}
                    className={tab === value ? "active" : ""}
                    disabled={busy}
                    onClick={() => {
                      showDataTab(value);
                    }}
                  >
                    {value === "tables" ? `Tables ${tables.length}` : "Console"}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div
            hidden={screen !== "connections" && !!session}
            className="database-connections-list"
            aria-label="Connections"
          >
            {doc.connections.map((item) => (
              <button
                key={item.id}
                disabled={busy || (!!session && selected !== item.id)}
                className={`service-list-item ${selected === item.id ? "selected" : ""}`}
                onClick={() => {
                  setQueryId("");
                  setQueryName("Untitled query");
                  setSql("SELECT 1;");
                  select(item.id);
                  setTab("settings");
                }}
              >
                <span
                  className={`connection-dot ${selected === item.id && session ? "connected" : ""}`}
                />
                <span>
                  {item.name}
                  <small>{item.engine}</small>
                </span>
                {dirtyConnections.has(item.id) && <span className="tool-unsaved-dot" role="img" aria-label={`Unsaved changes in ${item.name}`}/>}
              </button>
            ))}
          </div>
          {session && screen === "workspace" && tab !== "console" && (
            <div className="database-table-list" aria-label="Tables">
              <div className="database-table-search">
                <Search size={14} aria-hidden="true" />
                <input
                  ref={tableSearchInput}
                  aria-label="Search tables"
                  placeholder="Search tables…"
                  value={tableSearch}
                  onChange={(event) => setTableSearch(event.target.value)}
                />
                <span className="search-count">{filteredTables.length}</span>
                {tableSearch && (
                  <button
                    type="button"
                    className="database-search-clear"
                    aria-label="Clear table search"
                    title="Clear table search"
                    onClick={() => {
                      setTableSearch("");
                      tableSearchInput.current?.focus();
                    }}
                  >
                    <X size={14} aria-hidden="true" />
                  </button>
                )}
              </div>
              <div className="database-table-scroll">
                {filteredTables.map((item) => (
                  <button
                    key={`${item.schema}.${item.name}`}
                    disabled={busy}
                    className={`service-list-item ${table?.name === item.name && table.schema === item.schema && tab === "tables" ? "selected" : ""}`}
                    onClick={() => {
                      setResult(null);
                      void task(() => browse(item, 0, "", false));
                    }}
                  >
                    <Table2 size={13} />
                    <span>
                      {item.name}
                      <small>{item.schema}</small>
                    </span>
                  </button>
                ))}
                {tableSearch.trim() && !filteredTables.length && (
                  <div className="database-table-search-empty">No matching tables.<button className="search-empty-clear" onClick={() => setTableSearch("")}>Clear search</button></div>
                )}
              </div>
            </div>
          )}
          <div
            hidden={screen !== "workspace" || tab !== "console"}
            className="database-query-list"
            aria-label="Saved queries"
          >
            <div className="service-subheading">
              <strong>Saved queries</strong>
            </div>
            <button
              title="New query"
              className="sidebar-add"
              disabled={busy}
              onClick={(event) => {
                event.preventDefault();
                setQueryId("");
                setQueryName("Untitled query");
                setSql("SELECT 1;");
                setTab("console");
                setResult(null);
              }}
            >
              <Plus size={18} /> New query
            </button>
            {doc.queries
              .filter((query) => query.connectionId === selected)
              .map((query) => (
                <button
                  key={query.id}
                  className="service-list-item"
                  disabled={busy}
                  onClick={() => {
                    browseVersion.current++;
                    setLoadingRows(false);
                    setQueryId(query.id);
                    setQueryName(query.name);
                    setSql(query.sql);
                    setTab("console");
                    setResult(null);
                  }}
                >
                  {query.name}
                </button>
              ))}
          </div>
        </>
      }
    >
      {!current ? (
        <>
          <EmptyTool title="A clear view of your data">
            Add a local SQLite file or a MySQL / PostgreSQL connection.
            Connections start in read-only mode.
          </EmptyTool>
        </>
      ) : (
        <>
          <div
            className="service-content connection-header"
            hidden={screen !== "connections" && !!session}
          >
            <div>
              <h2>{current.name}</h2>
              <span className="service-hint">
                {session ? "Connected" : "Not connected"} ·{" "}
                {current.readOnly ? "Read-only connection" : "Writes enabled"}
              </span>
            </div>
            <div className="connection-header-buttons">
              <button
                title="Duplicate database"
                aria-label={`Duplicate database ${current.name}`}
                disabled={!!session || busy}
                onClick={duplicateConnection}
              >
                <Copy size={18} />
              </button>
              <button
                title="Delete database"
                aria-label={`Delete database ${current.name}`}
                disabled={!!session || busy}
                onClick={() =>
                  void task(async () => {
                    if (
                      await confirmAction(
                        `Delete “${current.name}” and its saved queries?`,
                      )
                    ) {
                      set((previous) => ({
                        ...previous,
                        connections: previous.connections.filter(
                          (item) => item.id !== current.id,
                        ),
                        queries: previous.queries.filter(
                          (item) => item.connectionId !== current.id,
                        ),
                      }));
                      select("");
                    }
                  })
                }
              >
                <Trash2 size={18} />
              </button>
              <button
                className="primary-button"
                disabled={
                  busy ||
                  (!session &&
                    current.engine !== "sqlite" &&
                    !current.database.trim())
                }
                title={
                  !session &&
                  current.engine !== "sqlite" &&
                  !current.database.trim()
                    ? "Enter a database name before connecting"
                    : undefined
                }
                onClick={() => {
                  if (session) {
                    setScreen("workspace");
                    if (tab === "settings") setTab("tables");
                  } else void connect();
                }}
              >
                {busy ? "Working…" : session ? "Open connection" : "Connect"}
              </button>
            </div>
          </div>
          {session && (
            <div className="database-workspace-actions">
              {screen === "connections" && (
                <button
                  className="secondary-button"
                  onClick={() => void task(disconnect)}
                >
                  Disconnect {current.name}
                </button>
              )}
              {screen === "workspace" && (
                <>
                  <nav
                    className="database-breadcrumb"
                    aria-label="Database breadcrumb"
                  >
                    <span>{current.name}</span>
                    <span aria-hidden="true">/</span>
                    <span>{tab === "console" ? "Console" : "Tables"}</span>
                    {tab === "tables" && table && (
                      <>
                        <span aria-hidden="true">/</span>
                        <strong
                          aria-current="page"
                          title={`${table.schema}.${table.name}`}
                        >
                          {table.name}
                        </strong>
                      </>
                    )}
                  </nav>
                  <div className="database-header-buttons">
                    {tab === "tables" && (
                      <button
                        className={`secondary-button ${tableInfo ? "active" : ""}`}
                        disabled={busy || !table}
                        aria-pressed={tableInfo}
                        onClick={() => setTableInfo((value) => !value)}
                      >
                        {tableInfo ? "Table data" : "Table info"}
                      </button>
                    )}
                    <button
                      className="secondary-button"
                      disabled={busy}
                      onClick={() => void task(disconnect)}
                    >
                      Disconnect
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
          {screen === "connections" && (
            <div className="service-content">
              <fieldset
                disabled={!!session || busy}
                className="service-form-grid"
              >
                <Field label="Connection name">
                  <input
                    value={current.name}
                    onChange={(e) => patch({ name: e.target.value })}
                  />
                </Field>
                <Field label="Engine">
                  <CustomSelect
                    value={current.engine}
                    onChange={(e) =>
                      patch({
                        engine: e.target.value as DatabaseConnection["engine"],
                        port: e.target.value === "mysql" ? 3306 : 5432,
                        sshId: "",
                      })
                    }
                  >
                    <option value="sqlite">SQLite</option>
                    <option value="mysql">MySQL / MariaDB</option>
                    <option value="postgres">PostgreSQL</option>
                  </CustomSelect>
                </Field>
                {current.engine === "sqlite" ? (
                  <Field label="SQLite database file">
                    <span className="input-with-button">
                      <input
                        value={current.file}
                        onChange={(e) => patch({ file: e.target.value })}
                      />
                      <button
                        onClick={() =>
                          void chooseLocalFile("Select SQLite database")
                            .then((file) => {
                              if (file) patch({ file });
                            })
                            .catch((error) => onError(String(error)))
                        }
                      >
                        Choose
                      </button>
                    </span>
                  </Field>
                ) : (
                  <>
                    <Field label="Host">
                      <input
                        value={current.host}
                        onChange={(e) => patch({ host: e.target.value })}
                      />
                    </Field>
                    <Field label="Port">
                      <input
                        type="number"
                        min="1"
                        max="65535"
                        value={current.port}
                        onChange={(e) =>
                          patch({ port: Number(e.target.value) })
                        }
                      />
                    </Field>
                    <Field label="Database">
                      <input
                        value={current.database}
                        onChange={(e) => patch({ database: e.target.value })}
                      />
                    </Field>
                    <Field label="Username">
                      <input
                        value={current.username}
                        onChange={(e) => patch({ username: e.target.value })}
                      />
                    </Field>
                    <SecretField
                      label="Password"
                      value={current.password}
                      onChange={(password) => patch({ password })}
                    />
                    <Field label="TLS">
                      <CustomSelect
                        value={current.tls}
                        onChange={(e) =>
                          patch({
                            tls: e.target.value as DatabaseConnection["tls"],
                          })
                        }
                      >
                        <option value="verify">
                          Verify certificate and hostname
                        </option>
                        <option value="require">
                          Require TLS (certificate not verified)
                        </option>
                        <option value="disable">TLS disabled</option>
                      </CustomSelect>
                    </Field>
                    <Field label="SSH tunnel">
                      <CustomSelect
                        value={current.sshId}
                        onChange={(e) => patch({ sshId: e.target.value })}
                      >
                        <option value="">Direct connection</option>
                        {servers.map((server) => (
                          <option key={server.id} value={server.id}>
                            {server.name}
                          </option>
                        ))}
                      </CustomSelect>
                    </Field>
                    {current.sshId && (
                      <p className="service-hint">
                        Uses the saved Server connection and its trusted
                        fingerprint. Host is resolved from that server. TLS
                        hostname verification through tunnels is pending; choose
                        a TLS mode explicitly.
                      </p>
                    )}
                  </>
                )}
                <label className="inline-check">
                  <input
                    type="checkbox"
                    checked={current.readOnly}
                    onChange={(e) => patch({ readOnly: e.target.checked })}
                  />
                  Read-only connection
                </label>
              </fieldset>
              <p className="service-hint">
                Changes require Save. Connect uses the current settings.
                Disconnect to change connection settings.
              </p>

            </div>
          )}
          {screen === "workspace" && tab === "tables" && !tableInfo && (
            <div className="service-content database-browse-controls">
              {table ? (
                <>
                  <div className="sftp-toolbar">
                    <label className="database-filter-field">
                      <span>WHERE</span>
                      <SqlFilterInput value={filter} disabled={busy} onChange={setFilter} onSubmit={() => void task(() => browse(table, 0, sort, descending, filter))} />
                    </label>
                    <button
                      className="secondary-button"
                      disabled={busy}
                      onClick={() => void task(() => browse(table, 0, sort, descending, filter))}
                    >
                      Load rows
                    </button>
                    <button
                      aria-label="Previous page"
                      disabled={busy || !result || page === 0}
                      onClick={() => void task(() => browse(table, page - 1))}
                    >
                      <ChevronLeft size={16} />
                    </button>
                    <span>Page {page + 1}</span>
                    <button
                      aria-label="Next page"
                      disabled={busy || !result?.truncated}
                      onClick={() => void task(() => browse(table, page + 1))}
                    >
                      <ChevronRight size={16} />
                    </button>
                  </div>
                </>
              ) : (
                <EmptyTool title="Select a table">
                  Choose a table from the sidebar to load its first page.
                </EmptyTool>
              )}
            </div>
          )}
          {screen === "workspace" && tab === "console" && (
            <div className="service-content">
              <div className="sftp-toolbar">
                <input
                  aria-label="Query name"
                  value={queryName}
                  onChange={(e) => editQuery({ name: e.target.value })}
                />
                <button
                  onClick={() => {
                    setSql("");
                    setQueryId("");
                    setQueryName("Untitled query");
                    setResult(null);
                  }}
                >
                  New
                </button>
                {queryId && (
                  <button
                    onClick={() => {
                      set((previous) => ({
                        ...previous,
                        queries: previous.queries.filter(
                          (item) => item.id !== queryId,
                        ),
                      }));
                      setQueryId("");
                    }}
                  >
                    Remove query
                  </button>
                )}
                <button
                  className="primary-button"
                  disabled={busy || !session || !sql.trim()}
                  onClick={() => void run()}
                >
                  <Play size={14} />
                  Run SQL
                </button>
                <button
                  className="secondary-button"
                  aria-label="Save query"
                  disabled={!dirty || saving || loading}
                  onClick={() => void save()}
                >
                  <Save size={14} />
                  {saving ? "Saving…" : saveError ? "Retry save" : "Save query"}
                </button>
                {busy && operation.current && (
                  <button
                    onClick={() =>
                      void nativeTool("cancel_operation", {
                        operationId: operation.current,
                      }).catch((error) => onError(String(error)))
                    }
                  >
                    Stop
                  </button>
                )}
              </div>
              {desktop ? (
                <div className="sql-editor-surface">
                  <Suspense
                    fallback={
                      <div className="loading">Loading SQL editor…</div>
                    }
                  >
                    <SqlEditor
                      key={selected}
                      document={{
                        path: `octode-query:${selected}.sql`,
                        name: "Query.sql",
                        text: sql,
                        saved: sql,
                      }}
                      modelPath={`octode-query:${project.id}:${selected}.sql`}
                      onChange={(value) => editQuery({ sql: value })}
                      onExecute={(statement) => void run(statement)}
                      readOnly={busy}
                    />
                  </Suspense>
                </div>
              ) : (
                <textarea
                  className="service-code-input sql-input"
                  aria-label="SQL query"
                  value={sql}
                  onChange={(event) => editQuery({ sql: event.target.value })}
                />
              )}
              {queryError && <div className="sql-inline-error" role="alert"><strong>Query failed</strong><p>{queryError}</p></div>}
              <p className="service-hint">
                Cmd/Ctrl+Enter runs the selected SQL, or the full query when
                nothing is selected.
              </p>
              <details className="query-history">
                <summary>Session query history ({history.length})</summary>
                {history.map((item, index) => (
                  <button
                    key={index}
                    onClick={() => editQuery({ sql: item.sql })}
                  >
                    <span>
                      {item.time} ·{" "}
                      {item.error ? "Failed" : `${item.rows} rows`}
                    </span>
                    <code>{item.sql.slice(0, 180)}</code>
                  </button>
                ))}
              </details>
              <p className="service-hint">
                Run executes one statement. Use Save to keep query edits.
                Results are capped at 1,000 rows. Each run uses a new
                connection; session variables and transactions do not span runs.
              </p>
            </div>
          )}
          {screen === "workspace" && tab === "tables" && loadingRows && (
            <p className="database-notice" role="status">
              Loading rows…
            </p>
          )}
          {screen === "workspace" && tab === "tables" && browseError && (
            <p className="database-notice database-error" role="alert">
              {browseError} Use Load rows to retry.
            </p>
          )}
          {screen === "workspace" && tab === "tables" && metadataError && (
            <p className="database-notice" role="status">
              {metadataError}
            </p>
          )}
          {screen === "workspace" &&
            tab === "tables" &&
            table &&
            tableInfo &&
            (metadata ? (
              <DatabaseTableInfo metadata={metadata} />
            ) : !metadataError ? (
              <p className="database-notice" role="status">
                Loading table info…
              </p>
            ) : null)}
          {result &&
            screen === "workspace" &&
            tab !== "settings" &&
            !tableInfo && (
              <div
                className="database-results"
                aria-busy={tab === "tables" && loadingRows}
              >
                <div className="service-subheading">
                  <strong>
                    {result.rows.length} rows · {result.rowsAffected} affected
                  </strong>
                {tab === "tables" && metadata && (
                  <div className="database-table-edit-actions">
                    <button
                      className="secondary-button"
                      disabled={busy || !metadata.editable}
                      onClick={() => setCsvImport(true)}
                    >
                      Import CSV…
                    </button>

                  </div>
                )}
                  <span>
                    <button
                      disabled={busy}
                      onClick={() =>
                        void exportText(
                          resultCsv(result),
                          `${table?.name ?? "query-result"}.csv`,
                        ).catch((reason) => onError(String(reason)))
                      }
                    >
                      Export CSV
                    </button>{" "}
                    · {result.elapsedMs} ms
                    {result.truncated
                      ? " · More rows available / display limit reached"
                      : ""}
                  </span>
                </div>
                <DatabaseDataGrid
                  key={`${session}:${tab}:${table?.schema}:${table?.name}`}
                  session={session}
                  selectionKey={JSON.stringify([
                    session,
                    tab,
                    table?.schema,
                    table?.name,
                    page,
                    sort,
                    descending,
                    appliedFilter,
                  ])}
                  schema={tab === "tables" ? (table?.schema ?? "") : ""}
                  table={tab === "tables" ? (table?.name ?? "") : ""}
                  result={result}
                  metadata={tab === "tables" ? metadata : null}
                  disabled={operationBusy || loadingRows || csvImport}
                  sort={sort}
                  descending={descending}
                  onSort={(column) =>
                    void task(() =>
                      browse(
                        table,
                        0,
                        column,
                        sort === column ? !descending : false,
                      ),
                    )
                  }
                  onApplied={() => browse()}
                  onEditing={setCellEditing}
                  onDirty={rowDirtyChange}
                />
                {tab === "tables" && metadata && <div className="database-grid-footer">                    <span className="service-hint">
                      {metadata.editable
                        ? "Double-click cells to queue edits. Insert rows or mark rows for deletion, then Apply changes submits the whole batch."
                        : metadata.reason}
                    </span><span><i className="database-null">NULL</i> SQL NULL <span className="empty-string-key"/> empty string</span></div>}
              </div>
            )}
        </>
      )}
      {csvImport && session && table && metadata && (
        <Suspense fallback={null}>
          <DatabaseCsvImport
            session={session}
            schema={table.schema}
            table={table.name}
            metadata={metadata}
            onClose={() => setCsvImport(false)}
            onApplied={() => browse()}
            onDirty={rowDirtyChange}
          />
        </Suspense>
      )}
    </ToolLayout>
  );
}
