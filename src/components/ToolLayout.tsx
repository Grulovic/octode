import { createContext, useContext, useRef, useState, type ReactNode } from "react";
import PanelResize, { usePanelSize } from "./PanelResize";
import { Save, Plus, Trash2, X, Lock, Check, Database, Server, ArrowDownUp } from "./DesignIcons";
import type { SecretValue, ValueRow } from "../toolTypes";
import { row } from "../lib/toolDefaults";
import { desktop } from "../lib/bridge";
import "./tools.css";
const ChangedFields = createContext<string[]>([]);
export interface ToolProps {
  project: import("../types").Project;
  visible: boolean;
  searchTarget?: import("../lib/searchEverywhere").SearchEntry;
  onError: (error: string) => void;
  onDirty: (dirty: boolean) => void;
}
export function ToolLayout({
  title,
  dirty,
  saving,
  save,
  sidebar,
  toolbarActions,
  showToolbar = true,
  mainClassName = "",
  children,
  loading = false,
  saveError = "",
  changes = [],
}: {
  title: string;
  dirty: boolean;
  saving: boolean;
  save: () => Promise<boolean>;
  sidebar: ReactNode;
  toolbarActions?: ReactNode;
  showToolbar?: boolean;
  mainClassName?: string;
  children: ReactNode;
  loading?: boolean;
  saveError?: string;
  changes?: string[];
}) {
  const sidebarRef = useRef<HTMLElement>(null);
  const [sidebarWidth, setSidebarWidth] = usePanelSize(
    `octode-layout:sidebar:${title}`,
    268,
  );
  return (
    <ChangedFields.Provider value={changes}><section className={`service-tool service-${title.toLowerCase()}`} aria-label={`${title} workspace`}>
      {showToolbar && (
        <header
          className={`service-toolbar ${toolbarActions ? "service-toolbar-with-actions" : ""}`}
        >
          {toolbarActions && (
            <div className="service-toolbar-actions">{toolbarActions}</div>
          )}
          <ToolSaveControls
            {...{ dirty, saving, save, loading, saveError, changes }}
          />
        </header>
      )}
      <div className="service-body">
        <aside
          className="service-sidebar"
          ref={sidebarRef}
          style={{ width: sidebarWidth }}
        >
          {sidebar}
        </aside>
        <PanelResize
          target={sidebarRef}
          size={sidebarWidth}
          onResize={setSidebarWidth}
          label={`Resize ${title} sidebar`}
        />
        <div className="service-right">
          <div className={`service-main ${mainClassName}`}>
            {loading ? (
              <div className="loading">Opening {title}…</div>
            ) : (
              children
            )}
          </div>
        </div>
      </div>
    </section></ChangedFields.Provider>
  );
}
function ToolSaveControls({
  dirty,
  saving,
  save,
  loading = false,
  saveError = "",
  changes = [],
}: {
  dirty: boolean;
  saving: boolean;
  save: () => Promise<boolean>;
  loading?: boolean;
  saveError?: string;
  changes?: string[];
}) {
  const [review, setReview] = useState(false);
  return (
    <>
      {dirty && !loading && !saving ? (
        <button
          className="service-state unsaved-changes-button"
          title="Review unsaved changes"
          onClick={() => setReview(true)}
        >
          <span className="tool-unsaved-dot" aria-hidden="true" />{saveError ? "Not saved" : `${changes.length || 1} unsaved change${changes.length === 1 ? "" : "s"}`}
        </button>
      ) : (
        <span className="service-state">
          {!dirty && !saving && !loading && !saveError && <Check size={13} />}
          {saveError
            ? "Not saved"
            : loading
              ? "Loading…"
              : saving
                ? "Saving…"
                : dirty
                  ? "Unsaved changes"
                  : "Saved"}
        </span>
      )}
      {review && (
        <div className="code-modal-backdrop">
          <section
            className="tool-changes-review"
            role="dialog"
            aria-modal="true"
            aria-label="Unsaved changes"
            onKeyDown={(event) => {
              if (event.key === "Escape") setReview(false);
            }}
          >
            <header>
              <strong>Unsaved changes</strong>
              <button
                autoFocus
                aria-label="Close changes review"
                onClick={() => setReview(false)}
              >
                <X size={17} />
              </button>
            </header>
            {changes.length ? (
              <ul>
                {changes.map((change, index) => (
                  <li key={index}>{change}</li>
                ))}
              </ul>
            ) : (
              <p>No unsaved settings changes.</p>
            )}
            <footer>
              <button
                className="secondary-button"
                onClick={() => setReview(false)}
              >
                Close
              </button>
              <button
                className="primary-button"
                disabled={!dirty || saving || loading}
                onClick={() =>
                  void save().then((ok) => {
                    if (ok) setReview(false);
                  })
                }
              >
                {saving ? "Saving…" : "Save changes"}
              </button>
            </footer>
          </section>
        </div>
      )}
      <button
        className={dirty ? "primary-button" : "secondary-button"}
        aria-label="Save changes"
        disabled={!dirty || saving || loading}
        onClick={() => void save()}
      >
        <Save size={14} />
        {saving ? "Saving…" : saveError ? "Retry save" : "Save"}
      </button>
    </>
  );
}
export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const changes = useContext(ChangedFields);
  const field = label.replace(/^(Connection|Request|Environment) /, "").toLowerCase();
  const changed = changes.some((change) => change.split(" › ").at(-1)?.toLowerCase().replace(/ changed.*$/, "") === field);
  return (
    <label className="service-field">
      <span>{label}{changed && <span className="tool-unsaved-dot" aria-label="Changed field"/>}</span>
      {children}
    </label>
  );
}
export function SecretField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: SecretValue;
  onChange: (value: SecretValue) => void;
}) {
  return (
    <Field label={label}>
      <span className="secret-input">
        <input
          aria-label={label}
          type="password"
          autoComplete="off"
          title={
            value.hasSecret
              ? "Saved in the system credential store. Type to replace."
              : undefined
          }
          placeholder={value.hasSecret ? "••••••••" : "Enter a value"}
          value={value.value}
          onChange={(e) =>
            onChange({ ...value, value: e.target.value, hasSecret: false })
          }
        />
        {value.hasSecret && (
          <span className="secret-saved" role="status">
            Saved
          </span>
        )}
        {value.hasSecret && (
          <button
            title="Clear stored value for this field"
            onClick={(e) => {
              e.preventDefault();
              onChange({ ...value, value: "", hasSecret: false });
            }}
          >
            Clear
          </button>
        )}
      </span>
    </Field>
  );
}
export function ValueRows({
  label,
  values,
  onChange,
  files = false,
}: {
  label: string;
  values: ValueRow[];
  onChange: (rows: ValueRow[]) => void;
  files?: boolean;
}) {
  const update = (id: string, patch: Partial<ValueRow>) =>
    onChange(
      values.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
  return (
    <div className="value-rows">
      <div className="service-subheading">
        <strong>{label}</strong>
        <button onClick={() => onChange([...values, row()])}>
          <Plus size={14} />
          Add
        </button>
      </div>
      {values.length === 0 && (
        <p className="service-hint">No {label.toLowerCase()} yet.</p>
      )}
      {values.length > 0 && <div className="value-row-labels" aria-hidden="true"><span/><span>Key</span><span>Value</span></div>}
      {values.map((item, index) => (
        <div className="value-row" key={item.id}>
          <input
            aria-label={`${label} ${index + 1} enabled`}
            type="checkbox"
            checked={item.enabled}
            onChange={(e) => update(item.id, { enabled: e.target.checked })}
          />
          <input
            aria-label={`${label} ${index + 1} name`}
            placeholder="Name"
            value={item.name}
            onChange={(e) => update(item.id, { name: e.target.value })}
          />
          <input
            aria-label={`${label} ${index + 1} value`}
            type={item.secret ? "password" : "text"}
            placeholder={
              item.hasSecret ? "Stored secret" : "Value or {{variable}}"
            }
            value={item.value}
            onChange={(e) =>
              update(item.id, { value: e.target.value, hasSecret: false })
            }
          />
          <button type="button" className="secret-toggle" aria-label={`${label} ${index + 1} secret`} title={item.secret ? "Secret value (hidden)" : "Store as secret"} aria-pressed={!!item.secret} onClick={() => update(item.id, { secret: !item.secret, ...(!item.secret ? {} : {hasSecret: false}) })}><Lock size={13}/></button>
          {files && (
            <label className="inline-check">
              <input
                type="checkbox"
                checked={!!item.file}
                onChange={(e) => update(item.id, { file: e.target.checked })}
              />
              File path
            </label>
          )}
          <button
            title="Remove row"
            aria-label={`Remove ${label} ${index + 1}`}
            onClick={() =>
              onChange(values.filter((value) => value.id !== item.id))
            }
          >
            <Trash2 size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}
export async function confirmAction(message: string, okLabel?: string) {
  return desktop
    ? (await import("@tauri-apps/plugin-dialog")).confirm(message, {
        title: "Octode",
        kind: "warning",
        ...(okLabel ? { okLabel } : {}),
      })
    : window.confirm(message);
}
export async function chooseLocalFile(title: string, defaultPath?: string) {
  if (!desktop) return null;
  const path = await (
    await import("@tauri-apps/plugin-dialog")
  ).open({ title, multiple: false, directory: false, defaultPath });
  return typeof path === "string" ? path : null;
}
export function EmptyTool({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="service-empty">
      <span className="empty-state-icon" aria-hidden="true">{title.toLowerCase().includes("server") ? <Server size={24}/> : title.toLowerCase().includes("data") ? <Database size={24}/> : <ArrowDownUp size={24}/>}</span>
      <h2>{title}</h2>
      <p>{children}</p>
    </div>
  );
}
