import { exportAppData, importAppData, parseAppData, type ImportMode } from "../lib/appData";
import CustomSelect from "./CustomSelect";
import { useRef, useState } from "react";
import { Plus, Trash2, X, ChevronDown, ArrowDownUp } from "./DesignIcons";
import { defaultSettings, loadSettings, saveSettings } from "../lib/settings";
export default function SettingsModal({ onClose, beforeReplace }: { onClose: () => void; beforeReplace: () => Promise<void> }) {
  const [value, setValue] = useState(loadSettings);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [includeCredentials, setIncludeCredentials] = useState(true);
  const [pendingImport, setPendingImport] = useState<{ raw: string; name: string; projects: number; notes: number } | null>(null);
  const [importMode, setImportMode] = useState<ImportMode>("merge");
  const [message, setMessage] = useState("");
  const importInput = useRef<HTMLInputElement>(null);
  const moveCommand = (index: number, direction: -1 | 1) => {
    setValue((previous) => {
      const next = index + direction;
      if (next < 0 || next >= previous.terminalCommands.length) return previous;
      const terminalCommands = [...previous.terminalCommands];
      [terminalCommands[index], terminalCommands[next]] = [terminalCommands[next], terminalCommands[index]];
      return { ...previous, terminalCommands };
    });
  };
  return (
    <div className="modal-backdrop">
      <form
        className="modal settings-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        onSubmit={(event) => {
          event.preventDefault();
          if (busy || pendingImport) return;
          try {
            saveSettings(value);
            onClose();
          } catch (reason) {
            setError(String(reason));
          }
        }}
      >
        <div className="modal-heading">
          <h2>Settings</h2>
          <button type="button" aria-label="Close settings" disabled={busy} onClick={onClose}>
            <X size={17} />
          </button>
        </div>
        <div className="settings-body">{!pendingImport && <><h3 className="settings-section">Editor</h3>
        <label>
          Font size
          <input
            aria-label="Editor font size"
            type="number"
            min="10"
            max="22"
            value={value.fontSize}
            onChange={(event) =>
              setValue({
                ...value,
                fontSize: Math.max(
                  10,
                  Math.min(22, Number(event.target.value) || 13),
                ),
              })
            }
          />
        </label>
        <label>
          Indent size
          <CustomSelect
            aria-label="Indent size"
            value={value.tabSize}
            onChange={(event) =>
              setValue({ ...value, tabSize: Number(event.target.value) })
            }
          >
            {[2, 4, 8].map((value) => (
              <option key={value} value={value}>
                {value} spaces
              </option>
            ))}
          </CustomSelect>
        </label>
        <label className="settings-check">
          <input
            type="checkbox"
            checked={value.wordWrap === "on"}
            onChange={(event) =>
              setValue({
                ...value,
                wordWrap: event.target.checked ? "on" : "off",
              })
            }
          />
          Wrap long lines
        </label>
        <h3 className="settings-section">Terminal</h3>
        <label>
          <span className="settings-command-label">Launch command<small>Runs when you press {navigator.platform.toLowerCase().includes("mac") ? "⌘2" : "Ctrl+2"} twice</small></span>
          <input
            aria-label="Terminal launch command"
            type="text"
            value={value.terminalCommand}
            maxLength={4096}
            placeholder="codex"
            onChange={(event) =>
              setValue({ ...value, terminalCommand: event.target.value })
            }
          />
        </label>
        <div className="settings-saved-commands" role="group" aria-label="Saved terminal commands">
          <div className="settings-command-heading"><strong>Saved commands</strong><div className="settings-command-actions">
            <button type="button" aria-label="Sort commands alphabetically" title="Sort by name or command (A–Z)" disabled={value.terminalCommands.length < 2} onClick={() => setValue((previous) => ({ ...previous, terminalCommands: [...previous.terminalCommands].sort((a, b) => (a.name?.trim() || a.command).localeCompare(b.name?.trim() || b.command, undefined, { numeric: true, sensitivity: "base" })) }))}><ArrowDownUp size={14} /></button>
            <button type="button" disabled={value.terminalCommands.length >= 100} onClick={() => setValue({ ...value, terminalCommands: [...value.terminalCommands, { id: crypto.randomUUID(), name: "", command: "" }] })}><Plus size={14} />Add command</button>
          </div></div>
          <p className="settings-note">Run in the current terminal tab. Save settings to keep edits and order.</p>
          {!value.terminalCommands.length && <p className="settings-note">No saved commands yet.</p>}
          {!!value.terminalCommands.length && <div className="settings-command-columns" aria-hidden="true"><span>Name (optional)</span><span>Command</span></div>}
          <div className="settings-command-list">
          {value.terminalCommands.map((command, index) => <div className="settings-saved-command" key={command.id}>
            <input aria-label={`Command ${index + 1} name`} title="Name (optional)" type="text" maxLength={100} placeholder="Optional name" value={command.name ?? ""} onChange={(event) => setValue({ ...value, terminalCommands: value.terminalCommands.map((item) => item.id === command.id ? { ...item, name: event.target.value } : item) })} />
            <input aria-label={`Command ${index + 1} text`} title={command.command || "Command"} type="text" maxLength={4096} placeholder="npm run dev" spellCheck={false} autoCorrect="off" autoCapitalize="off" value={command.command} onChange={(event) => setValue({ ...value, terminalCommands: value.terminalCommands.map((item) => item.id === command.id ? { ...item, command: event.target.value } : item) })} />
            <div className="settings-command-row-actions">
              <button type="button" aria-label={`Move command ${index + 1} up`} title="Move up" disabled={index === 0} onClick={() => moveCommand(index, -1)}><ChevronDown className="settings-command-up" size={12} /></button>
              <button type="button" aria-label={`Move command ${index + 1} down`} title="Move down" disabled={index === value.terminalCommands.length - 1} onClick={() => moveCommand(index, 1)}><ChevronDown size={12} /></button>
              <button type="button" className="settings-command-delete" aria-label={`Delete command ${index + 1}`} title="Delete command" onClick={() => setValue({ ...value, terminalCommands: value.terminalCommands.filter((item) => item.id !== command.id) })}><Trash2 size={13} /></button>
            </div>
          </div>)}
          </div>
        </div>
        <h3 className="settings-section">App data</h3>
        <p className="settings-note">Back up global Notes (including open drafts), projects, saved connections, API environments, workspace state, recovery drafts, and preferences. Source files and running sessions are not included. Save tool changes before exporting.</p>
        <label className="settings-check"><input type="checkbox" checked={includeCredentials} disabled={busy || !!pendingImport} onChange={(event) => setIncludeCredentials(event.target.checked)} /> Include saved passwords and secrets</label>
        {includeCredentials && <p className="settings-note">Passwords are included in this readable backup, so keep it private. Older passwords may require a one-time Keychain approval per item. After migration, Octode uses one unlock per app session. Canceling access stops the export.</p>}
        <div className="settings-data-actions">
          <button type="button" disabled={busy || !!pendingImport} onClick={async () => {
            setBusy(true); setError(""); setMessage("Choose where to save the backup. Passwords are gathered after you choose a file.");
            try {
              const path = await exportAppData(includeCredentials);
              setMessage(path ? "App data exported." : "Export canceled.");
            } catch (reason) { setMessage(""); setError(String(reason)); }
            finally { setBusy(false); }
          }}>{busy && !pendingImport ? "Exporting…" : "Export app data"}</button>
          <button type="button" disabled={busy || !!pendingImport} onClick={() => importInput.current?.click()}>Import app data</button>
        </div>
        <p className="settings-note">Choose Merge or Replace after selecting a backup. Project folders must be available at their saved paths or relinked through Edit project.</p>
        <input ref={importInput} type="file" accept=".json,application/json" aria-label="App data file" hidden onChange={async (event) => {
          const file = event.target.files?.[0]; event.target.value = "";
          if (!file) return;
          setBusy(true); setError(""); setMessage("");
          try {
            if (file.size > 20 * 1024 * 1024) throw new Error("App data exceeds 20 MB.");
            const raw = await file.text();
            const backup = parseAppData(raw);
            setImportMode("merge");
            setPendingImport({ raw, name: file.name, projects: backup.projects.length, notes: backup.notes?.length ?? 0 });
          } catch (reason) { setError(String(reason)); }
          finally { setBusy(false); }
        }} />
        </>}
        {pendingImport && <div className="settings-note" role="group" aria-label="Review app data import">
          <strong>{pendingImport.name}</strong>
          <p>{pendingImport.projects} projects and {pendingImport.notes} notes in this backup.</p>
          <CustomSelect className="settings-import-mode" aria-label="Import mode" value={importMode} disabled={busy} onChange={(event) => setImportMode(event.target.value as ImportMode)}>
            <option value="merge">Merge with current data</option>
            <option value="replace">Replace current data</option>
          </CustomSelect>
          <p>{importMode === "merge" ? "Adds projects and Notes as new copies. Keeps existing projects, Notes, live drafts, and preferences; adds missing preferences." : "Replaces all saved projects, Notes, workspace settings, recovery drafts, and preferences with this backup. Closes open project workspaces and their connections. Source files stay on disk. Save or discard unsaved tool changes first. This cannot be undone without another backup."}</p>
          <div className="settings-data-actions">
            <button type="button" disabled={busy} onClick={() => { setPendingImport(null); setError(""); }}>Cancel import</button>
            <button type="button" className="primary-button" disabled={busy} onClick={async () => {
              setBusy(true); setError(""); setMessage("");
              try {
                if (importMode === "replace") await beforeReplace();
                const count = await importAppData(pendingImport.raw, importMode);
                setValue(loadSettings()); setMessage(`Imported ${count} project${count === 1 ? "" : "s"} and ${pendingImport.notes} note${pendingImport.notes === 1 ? "" : "s"}.`);
                setPendingImport(null);
              } catch (reason) { setError(String(reason)); }
              finally { setBusy(false); }
            }}>{busy ? "Importing…" : importMode === "replace" ? "Import and replace" : "Import and merge"}</button>
          </div>
        </div>}
        {message && <p role="status">{message}</p>}
        <p className="settings-note">
          Code autosaves. Server, Database, and API settings require Save.
          Requests, SQL, and database Apply stay explicit. Autocomplete is
          disabled throughout.
        </p>
        {error && <p role="alert">{error}</p>}
        </div>
        <div className="modal-footer">
          <button
            type="button"
            disabled={busy || !!pendingImport}
            onClick={() => setValue({ ...defaultSettings })}
          >
            Reset defaults
          </button>
          <button data-save-shortcut className="primary-button" disabled={busy || !!pendingImport} type="submit">
            Save settings
          </button>
        </div>
      </form>
    </div>
  );
}
