import CustomSelect from "./CustomSelect";
import { useState } from "react";
import { X } from "lucide-react";
import { defaultSettings, loadSettings, saveSettings } from "../lib/settings";
export default function SettingsModal({ onClose }: { onClose: () => void }) {
  const [value, setValue] = useState(loadSettings);
  const [error, setError] = useState("");
  return (
    <div className="modal-backdrop">
      <form
        className="modal"
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
        <label>
          Editor font size
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
        <label>
          Terminal launch command (Cmd/Ctrl+2 twice)
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
        <p>
          Code autosaves. Server, Database, and API settings require Save.
          Requests, SQL, and database Apply stay explicit. Autocomplete is
          disabled throughout.
        </p>
        {error && <p role="alert">{error}</p>}
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
