import { exportAppData, importAppData } from "../lib/appData";
import CustomSelect from "./CustomSelect";
import { useRef, useState } from "react";
import { X } from "./DesignIcons";
import { defaultSettings, loadSettings, saveSettings } from "../lib/settings";
export default function SettingsModal({ onClose }: { onClose: () => void }) {
  const [value, setValue] = useState(loadSettings);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [includeCredentials, setIncludeCredentials] = useState(false);
  const [message, setMessage] = useState("");
  const importInput = useRef<HTMLInputElement>(null);
  return (
    <div className="modal-backdrop">
      <form
        className="modal settings-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        onSubmit={(event) => {
          event.preventDefault();
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
          <button type="button" aria-label="Close settings" onClick={onClose}>
            <X size={17} />
          </button>
        </div>
        <div className="settings-body"><h3 className="settings-section">Editor</h3>
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
        <h3 className="settings-section">App data</h3>
        <p className="settings-note">Back up global Notes (including open drafts), all projects, saved connections, API environments, workspace state, recovery drafts, and preferences. Credentials are excluded by default, so exporting does not request Keychain access. Re-enter them after restoring. Source files and running sessions are not included. Save tool changes before exporting.</p>
        <label><input type="checkbox" checked={includeCredentials} disabled={busy} onChange={(event) => setIncludeCredentials(event.target.checked)} /> Include saved passwords and secrets</label>
        {includeCredentials && <p className="settings-note">Keychain may request access for each saved credential. Keep this export private. Canceling a Keychain prompt stops the export.</p>}
        <div className="settings-data-actions">
          <button type="button" disabled={busy} onClick={async () => {
            setBusy(true); setError(""); setMessage("");
            try { await exportAppData(includeCredentials); } catch (reason) { setError(String(reason)); }
            finally { setBusy(false); }
          }}>Export app data</button>
          <button type="button" disabled={busy} onClick={() => importInput.current?.click()}>Import app data</button>
        </div>
        <p className="settings-note">Import adds projects and Notes as new copies and restores preferences. Existing projects are kept. Project folders must be available at their saved paths or relinked through Edit project.</p>
        <input ref={importInput} type="file" accept=".json,application/json" aria-label="App data file" hidden onChange={async (event) => {
          const file = event.target.files?.[0]; event.target.value = "";
          if (!file) return;
          setBusy(true); setError(""); setMessage("");
          try {
            if (file.size > 20 * 1024 * 1024) throw new Error("App data exceeds 20 MB.");
            const raw = await file.text();
            const count = await importAppData(raw);
            const backup = JSON.parse(raw);
            const noteCount = (backup.notes?.length ?? 0);
            setValue(loadSettings()); setMessage(`Imported ${count} project${count === 1 ? "" : "s"} and ${noteCount} note${noteCount === 1 ? "" : "s"}.`);
          } catch (reason) { setError(String(reason)); }
          finally { setBusy(false); }
        }} />
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
            onClick={() => setValue({ ...defaultSettings })}
          >
            Reset defaults
          </button>
          <button className="primary-button" type="submit">
            Save settings
          </button>
        </div>
      </form>
    </div>
  );
}
