import CustomSelect from "./CustomSelect";
import type { SearchEntry } from "../lib/searchEverywhere";
import { useToolView } from "../hooks/useToolView";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  Copy,
  ArrowUp,
  Download,
  Folder,
  Plus,
  RefreshCw,
  Upload,
  Trash2,
} from "lucide-react";
import { useToolDocument } from "../hooks/useToolDocument";
import { serverDocument, serverConnection } from "../lib/toolDefaults";
import { nativeTool } from "../lib/toolsBridge";
import type { RemoteEntry, ServerConnection } from "../toolTypes";
import {
  ToolLayout,
  Field,
  SecretField,
  EmptyTool,
  chooseLocalFile,
  confirmAction,
  type ToolProps,
} from "./ToolLayout";
import { useTransfers } from "../hooks/useTransfers";
const RemoteTerminal = lazy(() => import("./RemoteTerminal"));
export default function ServersWorkspace({
  project,
  visible,
  searchTarget,
  onError,
  onDirty,
}: ToolProps) {
  const {
    document: doc,
    setDocument: set,
    loading,
    saving,
    saveError,
    changes,
    dirty,
    save,
  } = useToolDocument(project, "servers", serverDocument, onError, onDirty);
  const [selected, select] = useToolView(
    project.id,
    "ServersWorkspace:selected",
    "",
  );
  const [busy, setBusy] = useState(false);
  const working = useRef(false);
  const [sessions, setSessions] = useState<Record<string, string>>({});
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const alive = useRef(true);
  const [tab, setTab] = useState("settings");
  const handledSearch = useRef<SearchEntry | undefined>(undefined);
  useEffect(() => {
    if (
      loading ||
      !searchTarget ||
      searchTarget.target?.tool !== "servers" ||
      handledSearch.current === searchTarget
    )
      return;
    handledSearch.current = searchTarget;
    select(searchTarget.target.id);
    setTab("settings");
  }, [searchTarget, loading]);
  const [path, setPath] = useState(".");
  const [entries, setEntries] = useState<RemoteEntry[]>([]);
  const [file, selectFile] = useState<RemoteEntry | null>(null);
  const [newName, setNewName] = useState("");
  const [message, setMessage] = useState("");
  const listingRef = useRef<() => Promise<void>>(async () => {});
  const transfers = useTransfers(() => {
    void listingRef.current().catch(() => {});
  });
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      for (const session of Object.values(sessionsRef.current))
        void nativeTool("ssh_close", { id: session }).catch(() => {});
    };
  }, []);
  useEffect(() => {
    let gone = false;
    const timer = setInterval(() => {
      for (const [connectionId, session] of Object.entries(
        sessionsRef.current,
      )) {
        void nativeTool<boolean>("ssh_connected", { id: session })
          .then((connected) => {
            if (connected || gone) return;
            transfers.cancelSession(session);
            void nativeTool("ssh_close", { id: session }).catch(() => {});
            setSessions((previous) => {
              const next = { ...previous };
              delete next[connectionId];
              return next;
            });
            onError(
              "SSH connection closed. Open Terminal or SFTP files to reconnect.",
            );
          })
          .catch(() => {});
      }
    }, 5000);
    return () => {
      gone = true;
      clearInterval(timer);
    };
  }, [onError, transfers.cancelSession]);
  const current = doc.connections.find((item) => item.id === selected);
  const session = sessions[selected];
  const patch = (value: Partial<ServerConnection>) =>
    set((previous) => ({
      ...previous,
      connections: previous.connections.map((item) =>
        item.id === selected ? { ...item, ...value } : item,
      ),
    }));
  const add = () => {
    const connection = serverConnection();
    set((previous) => ({
      ...previous,
      connections: [...previous.connections, connection],
    }));
    select(connection.id);
    setTab("settings");
  };
  const task = async (action: () => Promise<void>) => {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setMessage("");
    try {
      await action();
    } catch (error) {
      if (alive.current) onError(String(error));
    } finally {
      working.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const list = async (location: string, sessionId = session) => {
    if (!sessionId) return;
    const value = await nativeTool<{ path: string; entries: RemoteEntry[] }>(
      "sftp_list",
      { id: sessionId, path: location },
    );
    if (alive.current) {
      setPath(value.path);
      setEntries(
        value.entries.sort(
          (a, b) =>
            Number(b.directory) - Number(a.directory) ||
            a.name.localeCompare(b.name),
        ),
      );
      selectFile(null);
    }
  };
  const connect = (destination = "terminal") =>
    task(async () => {
      if (!current) return;
      const value = await nativeTool<string>("ssh_connect", {
        projectId: project.id,
        connection: current,
      });
      if (!alive.current) {
        void nativeTool("ssh_close", { id: value });
        return;
      }
      setSessions((previous) => ({ ...previous, [current.id]: value }));
      setTab(destination);
      if (destination === "files") await list(path, value);
    });
  const disconnect = async () => {
    if (!session) return;
    transfers.cancelSession(session);
    await nativeTool("ssh_close", { id: session });
    setSessions((previous) => {
      const next = { ...previous };
      delete next[selected];
      return next;
    });
    setTab("settings");
    setEntries([]);
  };
  listingRef.current = () =>
    session && tab === "files" ? list(path) : Promise.resolve();
  const transfer = (upload: boolean) =>
    task(async () => {
      if (!session) return;
      let local: string | null = null;
      let remote = "";
      if (upload) {
        local = await chooseLocalFile("Choose a file to upload");
        if (!local) return;
        remote = `${path.replace(/\/$/, "")}/${local.split(/[\\/]/).pop()}`;
        if (
          !(await confirmAction(
            `Upload to ${remote}? An existing remote file at this path will be replaced.`,
          ))
        )
          return;
      } else {
        if (!file || file.directory) return;
        local = await (
          await import("@tauri-apps/plugin-dialog")
        ).save({ title: "Download file", defaultPath: file.name });
        if (!local) return;
        remote = file.path;
      }
      transfers.enqueue({ session, remote, local, upload });
      setMessage("Added to transfer queue");
    });
  const duplicate = () => {
    if (!current || busy) return;
    const copy = structuredClone(current);
    copy.id = crypto.randomUUID();
    copy.name = `${current.name} copy`;
    set((previous) => ({
      ...previous,
      connections: [...previous.connections, copy],
    }));
    select(copy.id);
    setTab("settings");
    setEntries([]);
    selectFile(null);
    setPath(".");
  };
  const remove = () =>
    task(async () => {
      if (!current || session) return;
      if (
        !(await confirmAction(
          `Delete “${current.name}”? Use Save to keep this change.`,
        ))
      )
        return;
      set((previous) => ({
        ...previous,
        connections: previous.connections.filter(
          (item) => item.id !== current.id,
        ),
      }));
      select("");
      setTab("settings");
    });
  return (
    <ToolLayout
      title="Servers"
      toolbarActions={
        <button
          type="button"
          className="secondary-button"
          title="New server"
          disabled={busy}
          onClick={add}
        >
          <Plus size={15} />
          New connection
        </button>
      }
      {...{ loading, dirty, saving, save, saveError, changes }}
      sidebar={
        <>
          {doc.connections.map((item) => (
            <div
              className={`api-request-row ${selected === item.id ? "selected" : ""}`}
              key={item.id}
            >
              <button
                className={`service-list-item ${selected === item.id ? "selected" : ""}`}
                onClick={() => {
                  select(item.id);
                  setTab("settings");
                  setEntries([]);
                  selectFile(null);
                  setPath(".");
                }}
              >
                <span
                  className={`connection-dot ${sessions[item.id] ? "connected" : ""}`}
                />
                <span>
                  {item.name}
                  <small>
                    {item.username}@{item.host || "Host not set"}
                  </small>
                </span>
              </button>
            </div>
          ))}
        </>
      }
    >
      {!current ? (
        <>
          <EmptyTool title="Your servers, close by">
            Add an SSH connection. Verify its fingerprint before opening a
            terminal or transferring files.
          </EmptyTool>
        </>
      ) : (
        <>
          <div className="service-content connection-header">
            <div>
              <div className="connection-title">
                <h2>{current.name}</h2>
                <button
                  title="Duplicate server"
                  aria-label={`Duplicate server ${current.name}`}
                  disabled={busy}
                  onClick={duplicate}
                >
                  <Copy size={18} />
                </button>
                <button
                  title="Delete server"
                  aria-label={`Delete server ${current.name}`}
                  disabled={busy || !!session}
                  onClick={() => void remove()}
                >
                  <Trash2 size={18} />
                </button>
              </div>
              <p className="service-hint">
                {session ? "SSH connected" : "Not connected"} · Changes require
                Save
              </p>
            </div>
            <div className="connection-header-buttons">
              <button
                className="primary-button"
                disabled={busy}
                onClick={() =>
                  session ? void task(disconnect) : void connect()
                }
              >
                {busy ? "Working…" : session ? "Disconnect" : "Connect"}
              </button>
            </div>
          </div>
          <div className="service-tabs server-tabs">
            {["settings", "terminal", "files"].map((value) => (
              <button
                key={value}
                className={tab === value ? "active" : ""}
                disabled={busy}
                onClick={() => {
                  if (value !== "settings" && !session) {
                    void connect(value);
                    return;
                  }
                  setTab(value);
                  if (value === "files") void task(() => list(path));
                }}
              >
                {value === "files" ? "SFTP files" : value}
              </button>
            ))}
          </div>
          <div className="service-content" hidden={tab !== "settings"}>
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
              <Field label="Host">
                <input
                  aria-label="Host"
                  value={current.host}
                  onChange={(e) =>
                    patch({ host: e.target.value, fingerprint: "" })
                  }
                />
              </Field>
              <Field label="Port">
                <input
                  type="number"
                  min="1"
                  max="65535"
                  value={current.port}
                  onChange={(e) =>
                    patch({ port: Number(e.target.value), fingerprint: "" })
                  }
                />
              </Field>
              <Field label="Username">
                <input
                  value={current.username}
                  onChange={(e) => patch({ username: e.target.value })}
                />
              </Field>
              <Field label="Authentication">
                <CustomSelect
                  value={current.auth}
                  onChange={(e) =>
                    patch({ auth: e.target.value as ServerConnection["auth"] })
                  }
                >
                  <option value="agent">SSH agent</option>
                  <option value="key">Private key</option>
                  <option value="password">Password</option>
                </CustomSelect>
              </Field>
              {current.auth === "password" && (
                <SecretField
                  label="Password"
                  value={current.password}
                  onChange={(password) => patch({ password })}
                />
              )}{" "}
              {current.auth === "key" && (
                <>
                  <Field label="Private key file">
                    <span className="input-with-button">
                      <input
                        value={current.keyPath}
                        onChange={(e) => patch({ keyPath: e.target.value })}
                      />
                      <button
                        onClick={() =>
                          void nativeTool<string>("ssh_key_directory", {})
                            .then((directory) =>
                              chooseLocalFile("Select private key", directory),
                            )
                            .then((path) => {
                              if (path) patch({ keyPath: path });
                            })
                            .catch((error) => onError(String(error)))
                        }
                      >
                        Choose
                      </button>
                    </span>
                  </Field>
                  <SecretField
                    label="Key passphrase"
                    value={current.passphrase}
                    onChange={(passphrase) => patch({ passphrase })}
                  />
                </>
              )}
            </fieldset>
            <div className="host-fingerprint">
              <strong>Trusted host fingerprint</strong>
              <code>{current.fingerprint || "Not checked yet"}</code>
              <button
                className="secondary-button"
                disabled={busy || !!session || !current.host}
                onClick={() =>
                  void task(async () => {
                    const fingerprint = await nativeTool<string>(
                      "ssh_fingerprint",
                      { projectId: project.id, connection: current },
                    );
                    if (
                      await confirmAction(
                        `Host: ${current.host}:${current.port}\nFingerprint: ${fingerprint}\n\nCompare this fingerprint with your server provider or a trusted source. Trust this key for this connection?`,
                      )
                    )
                      patch({ fingerprint });
                  })
                }
              >
                Check fingerprint
              </button>
            </div>
            <div className="connection-actions">
              <button
                className="secondary-button danger-outline"
                disabled={!!session || busy}
                onClick={() => void remove()}
              >
                <Trash2 size={17} />
                Delete connection
              </button>
              <button
                className="secondary-button"
                disabled={busy}
                onClick={duplicate}
              >
                <Copy size={17} />
                Duplicate connection
              </button>
            </div>
          </div>
          {Object.entries(sessions).map(([connectionId, sessionId]) => (
            <div
              key={sessionId}
              className="remote-terminal-container"
              style={{
                display:
                  tab === "terminal" && selected === connectionId
                    ? "flex"
                    : "none",
              }}
            >
              <Suspense
                fallback={<div className="loading">Preparing terminal…</div>}
              >
                <RemoteTerminal
                  session={sessionId}
                  visible={
                    visible && tab === "terminal" && selected === connectionId
                  }
                  onError={onError}
                />
              </Suspense>
            </div>
          ))}
          {tab === "files" && (
            <div className="service-content">
              <div className="sftp-toolbar">
                <button
                  title="Parent folder"
                  disabled={busy}
                  onClick={() => void task(() => list(`${path}/..`))}
                >
                  <ArrowUp size={16} />
                </button>
                <input
                  aria-label="Remote folder"
                  value={path}
                  onChange={(e) => setPath(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void task(() => list(path));
                  }}
                />
                <button
                  title="Refresh remote files"
                  disabled={busy}
                  onClick={() => void task(() => list(path))}
                >
                  <RefreshCw size={15} />
                </button>
                <button disabled={busy} onClick={() => void transfer(true)}>
                  <Upload size={14} />
                  Upload
                </button>
                <button
                  disabled={busy || !file || file.directory}
                  onClick={() => void transfer(false)}
                >
                  <Download size={14} />
                  Download
                </button>
              </div>
              {message && <p role="status">{message}</p>}
              {transfers.jobs.length > 0 && (
                <section className="transfer-queue" aria-label="File transfers">
                  <div className="service-subheading">
                    <strong>Transfers</strong>
                    <button onClick={transfers.clear}>Clear finished</button>
                  </div>
                  {transfers.jobs.map((job) => (
                    <div className="transfer-job" key={job.id}>
                      <span title={`${job.local} ↔ ${job.remote}`}>
                        {job.upload ? "↑" : "↓"} {job.remote.split("/").at(-1)}
                      </span>
                      <progress
                        max={job.total ?? undefined}
                        value={job.total ? job.bytes : undefined}
                      />
                      <small>
                        {job.status} · {job.bytes.toLocaleString()}{" "}
                        {job.total ? `/ ${job.total.toLocaleString()}` : ""}{" "}
                        bytes
                      </small>
                      {["queued", "running"].includes(job.status) && (
                        <button onClick={() => transfers.cancel(job.id)}>
                          Cancel
                        </button>
                      )}
                      {job.error && <p>{job.error}</p>}
                    </div>
                  ))}
                </section>
              )}
              <div className="data-grid">
                <table>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Size</th>
                      <th>Modified</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((entry) => (
                      <tr
                        key={entry.path}
                        className={file?.path === entry.path ? "selected" : ""}
                        onClick={() => selectFile(entry)}
                        onDoubleClick={() => {
                          if (entry.directory)
                            void task(() => list(entry.path));
                        }}
                      >
                        <td>
                          {entry.directory && <Folder size={13} />} {entry.name}
                        </td>
                        <td>
                          {entry.directory ? "—" : entry.size.toLocaleString()}
                        </td>
                        <td>
                          {entry.modified
                            ? new Date(entry.modified * 1000).toLocaleString()
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="service-hint">
                Double-click folders to open them. Transfers run only when you
                choose Upload or Download.
              </p>
              <div className="sftp-toolbar">
                <input
                  aria-label="New remote name"
                  placeholder="New folder name or rename target"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                />
                <button
                  disabled={busy || !newName || newName.includes("/")}
                  onClick={() =>
                    void task(async () => {
                      await nativeTool("sftp_mutate", {
                        id: session,
                        action: "mkdir",
                        path: `${path}/${newName}`,
                        destination: "",
                      });
                      setNewName("");
                      await list(path);
                    })
                  }
                >
                  New folder
                </button>
                <button
                  disabled={busy || !file || !newName || newName.includes("/")}
                  onClick={() =>
                    void task(async () => {
                      if (!file) return;
                      await nativeTool("sftp_mutate", {
                        id: session,
                        action: "rename",
                        path: file.path,
                        destination: `${path}/${newName}`,
                      });
                      setNewName("");
                      await list(path);
                    })
                  }
                >
                  Rename selected
                </button>
                <button
                  disabled={busy || !file}
                  onClick={() =>
                    void task(async () => {
                      if (
                        file &&
                        (await confirmAction(
                          `Delete ${file.path}? This cannot be undone. Folders must be empty.`,
                        ))
                      ) {
                        await nativeTool("sftp_mutate", {
                          id: session,
                          action: file.directory ? "rmdir" : "delete",
                          path: file.path,
                          destination: "",
                        });
                        await list(path);
                      }
                    })
                  }
                >
                  Delete selected
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </ToolLayout>
  );
}
