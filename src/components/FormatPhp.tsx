import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { desktop, invoke } from "../lib/bridge";
import type { Project } from "../types";
export interface FormatOptions {
  service: string;
  containerRoot: string;
  formatter: string;
}
export default function FormatPhp({
  project,
  root,
  path,
  onClose,
  onFormat,
}: {
  project: Project;
  root: string;
  path: string;
  onClose: () => void;
  onFormat: (options: FormatOptions) => Promise<void>;
}) {
  const [options, setOptions] = useState<FormatOptions>({
    service: "laravel.test",
    containerRoot: "/var/www/html",
    formatter: "./vendor/bin/pint",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  useEffect(() => {
    let gone = false;
    if (desktop)
      void invoke<FormatOptions | null>("load_format_options", {
        projectId: project.id,
        root,
      })
        .then((value) => {
          if (value && !gone) setOptions(value);
        })
        .catch((reason) => {
          if (!gone) setError(String(reason));
        });
    return () => {
      gone = true;
    };
  }, [project.id, root]);
  return (
    <div className="modal-backdrop">
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="Format PHP in container"
      >
        <div className="modal-heading">
          <h2>Format PHP</h2>
          <button
            aria-label="Close formatter settings"
            disabled={busy}
            onClick={onClose}
          >
            <X size={17} />
          </button>
        </div>
        <p>
          {path.split("/").at(-1)} · {root}
        </p>
        <label>
          Compose service
          <input
            value={options.service}
            onChange={(event) =>
              setOptions({ ...options, service: event.target.value })
            }
          />
        </label>
        <label>
          Container project directory
          <input
            value={options.containerRoot}
            onChange={(event) =>
              setOptions({ ...options, containerRoot: event.target.value })
            }
          />
        </label>
        <label>
          Formatter executable
          <input
            value={options.formatter}
            onChange={(event) =>
              setOptions({ ...options, formatter: event.target.value })
            }
          />
        </label>
        <p>
          Runs the formatter on a temporary copy inside your running service.
          The original is updated only after formatting succeeds and its disk
          contents are checked. Services are never started automatically.
        </p>
        {error && <p role="alert">{error}</p>}
        {message && <p role="status">{message}</p>}
        <div className="modal-footer">
          <button
            disabled={busy || !desktop}
            onClick={async () => {
              setBusy(true);
              try {
                await invoke("save_format_options", {
                  projectId: project.id,
                  root,
                  options,
                });
                setMessage("Formatter settings saved for this folder.");
                setError("");
              } catch (reason) {
                setError(String(reason));
              } finally {
                setBusy(false);
              }
            }}
          >
            Save settings
          </button>
          <button
            className="primary-button"
            disabled={busy || !desktop}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await onFormat(options);
                onClose();
              } catch (reason) {
                setError(String(reason));
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Working…" : "Format file"}
          </button>
        </div>
      </section>
    </div>
  );
}
