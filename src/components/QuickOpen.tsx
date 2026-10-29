import { useEffect, useRef, useState } from "react";
import { FileCode2, Search, X } from "lucide-react";
import { cancelSearch, searchWorkspace } from "../lib/bridge";
import type { FileMatch, Project } from "../types";
import "./search.css";

export default function QuickOpen({
  project,
  onOpen,
  onClose,
}: {
  project: Project;
  onOpen: (path: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [files, setFiles] = useState<FileMatch[]>([]);
  const [selected, setSelected] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [truncated, setTruncated] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
    return () => {
      void cancelSearch("files").catch(() => {});
    };
  }, []);
  useEffect(() => {
    let disposed = false;
    setLoading(true);
    setSelected(0);
    setError("");
    const timeout = setTimeout(() => {
      void searchWorkspace(project, query, "files")
        .then((result) => {
          if (!disposed) {
            setFiles(result.files);
            setTruncated(result.truncated);
            setLoading(false);
          }
        })
        .catch((reason) => {
          if (!disposed) {
            setError(String(reason));
            setFiles([]);
            setLoading(false);
          }
        });
    }, 120);
    return () => {
      disposed = true;
      clearTimeout(timeout);
    };
  }, [project, query]);
  const choose = (path: string) => {
    onOpen(path);
    onClose();
  };
  return (
    <div className="modal-backdrop quick-open-backdrop" onClick={onClose}>
      <section
        className="quick-open"
        role="dialog"
        aria-modal="true"
        aria-label="Quick open file"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          }
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setSelected((value) =>
              Math.max(0, Math.min(value + 1, files.length - 1)),
            );
          }
          if (event.key === "ArrowUp") {
            event.preventDefault();
            setSelected((value) => Math.max(0, value - 1));
          }
          if (event.key === "Enter" && !loading && files[selected]) {
            event.preventDefault();
            choose(files[selected].path);
          }
        }}
      >
        <div className="quick-open-input">
          <Search size={17} />
          <input
            ref={input}
            aria-label="Search project files"
            placeholder="Find a file by name or path…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            maxLength={256}
          />
          <button aria-label="Close quick open" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div
          className="quick-open-results"
          role="listbox"
          aria-label="Matching files"
        >
          {loading ? (
            <p>Looking through your files…</p>
          ) : error ? (
            <p role="alert">{error}</p>
          ) : !files.length ? (
            <p>No matching files.</p>
          ) : (
            files.map((file, index) => (
              <button
                key={file.path}
                role="option"
                aria-selected={index === selected}
                className={index === selected ? "selected" : ""}
                onMouseEnter={() => setSelected(index)}
                onClick={() => choose(file.path)}
              >
                <FileCode2 size={16} />
                <span>
                  {file.relative}
                  <small>{file.root}</small>
                </span>
                <kbd>↵</kbd>
              </button>
            ))
          )}
        </div>
        <footer>
          {truncated
            ? "First 200 matches · keep typing to narrow your search"
            : "Type part of a filename or path"}
          <span>↑ ↓ navigate · ↵ open · esc close</span>
        </footer>
      </section>
    </div>
  );
}
