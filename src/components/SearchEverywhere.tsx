import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { FileCode2, Braces, FunctionSquare, Globe, FileJson } from "lucide-react";
import { Table2 } from "./DesignIcons";
import { Search, X, Server, Database, Folder, TerminalSquare } from "./DesignIcons";
import {
  cachedSearchIndex,
  loadSearchIndex,
  matchingEntries,
  type SearchEntry,
} from "../lib/searchEverywhere";
import { loadSectionEntries } from "../lib/sectionSearch";
import type { Project } from "../types";
import { filename } from "../lib/workspace";
import "./search.css";
export default function SearchEverywhere({
  project,
  onOpen,
  onClose,
}: {
  project: Project;
  onOpen: (entry: SearchEntry) => void;
  onClose: () => void;
}) {
  const [sections, setSections] = useState<SearchEntry[]>([]);
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState("");
  const scopes = ["", ...project.roots];
  const rootsKey = JSON.stringify(project.roots);
  const tabs = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setScope("");
    setSelected(0);
  }, [project.id, rootsKey]);
  const [index, setIndex] = useState(() => cachedSearchIndex(project));
  const [filesLoading, setLoading] = useState(true);
  const [sectionsLoading, setSectionsLoading] = useState(true);
  const loading = filesLoading || sectionsLoading;
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef(document.activeElement);
  useEffect(() => {
    let gone = false;
    input.current?.focus();
    void loadSectionEntries(project).then((result) => {
      if (!gone) {
        setSections(result.entries);
        setSectionsLoading(false);
        if (result.errors.length) setError(result.errors.join(" · "));
      }
    });
    void loadSearchIndex(project)
      .then((value) => {
        if (!gone) {
          setIndex(value);
          setLoading(false);
        }
      })
      .catch((reason) => {
        if (!gone) {
          setError(String(reason));
          setLoading(false);
        }
      });
    return () => {
      gone = true;
      if (
        previousFocus.current instanceof HTMLElement &&
        previousFocus.current.isConnected
      )
        previousFocus.current.focus();
    };
  }, [project]);
  const matches = useMemo(
    () =>
      matchingEntries(
        [...(index?.entries ?? []), ...sections].filter(
          (entry) => !scope || (!entry.target && entry.root === scope),
        ),
        query,
      ),
    [index, sections, query, scope],
  );
  useLayoutEffect(() => {
    const container = list.current;
    const row = container?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!container || !row) return;
    const viewport = container.getBoundingClientRect();
    const bounds = row.getBoundingClientRect();
    const top = viewport.top + container.clientTop;
    const bottom = top + container.clientHeight;
    if (bounds.top < top) container.scrollTop += bounds.top - top;
    else if (bounds.bottom > bottom)
      container.scrollTop += bounds.bottom - bottom;
  }, [selected, matches]);
  useEffect(
    () =>
      setSelected((value) => Math.min(value, Math.max(0, matches.length - 1))),
    [matches],
  );
  const changeScope = (next: string, focusInput = true) => {
    setScope(next);
    setSelected(0);
    if (list.current) list.current.scrollTop = 0;
    if (focusInput) input.current?.focus();
  };
  useLayoutEffect(() => {
    const container = tabs.current;
    const tab = container?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!container || !tab) return;
    const viewport = container.getBoundingClientRect(),
      bounds = tab.getBoundingClientRect();
    if (bounds.left < viewport.left)
      container.scrollLeft += bounds.left - viewport.left;
    else if (bounds.right > viewport.right)
      container.scrollLeft += bounds.right - viewport.right;
  }, [scope, rootsKey]);
  const choose = (entry: SearchEntry) => {
    onOpen(entry);
    onClose();
  };
  return (
    <div className="modal-backdrop quick-open-backdrop" onClick={onClose}>
      <section
        className="quick-open search-everywhere"
        role="dialog"
        aria-modal="true"
        aria-label="Search everywhere"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (
            (event.key === "ArrowLeft" || event.key === "ArrowRight") &&
            !event.altKey &&
            !event.ctrlKey &&
            !event.metaKey &&
            !event.shiftKey &&
            !event.nativeEvent.isComposing
          ) {
            event.preventDefault();
            const position = Math.max(0, scopes.indexOf(scope));
            const next =
              (position +
                (event.key === "ArrowRight" ? 1 : -1) +
                scopes.length) %
              scopes.length;
            const tabFocused =
              event.target instanceof Element &&
              !!event.target.closest('[role="tablist"]');
            changeScope(scopes[next], !tabFocused);
            if (tabFocused)
              tabs.current
                ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
                [next]?.focus();
            return;
          }
          if (
            event.target instanceof Element &&
            event.target.closest('[role="tablist"]') &&
            ["Enter", " "].includes(event.key)
          ) {
            event.preventDefault();
            input.current?.focus();
            return;
          }
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onClose();
          }
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setSelected((value) =>
              Math.max(
                0,
                Math.min(
                  value + (event.key === "ArrowDown" ? 1 : -1),
                  matches.length - 1,
                ),
              ),
            );
          }
          if (event.key === "Enter" && matches[selected]) {
            event.preventDefault();
            choose(matches[selected]);
          }
          if (event.key === "Tab") {
            event.preventDefault();
            const activeTab = tabs.current?.querySelector<HTMLButtonElement>(
              '[aria-selected="true"]',
            );
            const controls = [
              activeTab,
              input.current,
              closeButton.current,
            ].filter(
              (element): element is HTMLButtonElement | HTMLInputElement =>
                !!element,
            );
            const position = controls.indexOf(
              document.activeElement as HTMLButtonElement | HTMLInputElement,
            );
            controls[
              (position + (event.shiftKey ? -1 : 1) + controls.length) %
                controls.length
            ]?.focus();
          }
        }}
      >
        <div
          ref={tabs}
          className="search-scope-tabs"
          role="tablist"
          aria-label="Search scope"
        >
          {scopes.map((root, i) => (
            <button
              key={root || "all"}
              type="button"
              role="tab"
              aria-selected={scope === root}
              tabIndex={scope === root ? 0 : -1}
              title={root || "Search all folders and sections"}
              onClick={() => changeScope(root)}
            >
              {i === 0 ? "All" : filename(root)}
            </button>
          ))}
        </div>
        <div className="quick-open-input">
          <Search size={17} />
          <input
            ref={input}
            aria-label="Search all sections"
            placeholder={
              scope ? `Search ${filename(scope)}…` : "Search all sections…"
            }
            value={query}
            maxLength={256}
            autoComplete="off"
            role="combobox"
            aria-expanded="true"
            aria-controls="everywhere-results"
            aria-activedescendant={
              matches[selected] ? `everywhere-${selected}` : undefined
            }
            onChange={(event) => {
              setQuery(event.target.value);
              setSelected(0);
            }}
          />
          <button
            ref={closeButton}
            aria-label="Close search everywhere"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </div>
        <div className="search-everywhere-summary" role="status">
          {loading
            ? "Looking through project files and declarations…"
            : scope
              ? `Files · Classes · Functions · ${filename(scope)}`
              : "Files · Classes · Functions · Servers · Database · API"}
          {error && <span role="alert">{error}</span>}
        </div>
        <div
          ref={list}
          className="quick-open-results"
          id="everywhere-results"
          role="listbox"
          aria-label="Matching results"
        >
          {!matches.length ? (
            <p>
              {loading
                ? "Preparing search…"
                : query
                  ? "No matching results."
                  : "No searchable project files."}
            </p>
          ) : (
            matches.map((entry, i) => {
              const Icon = {
                file: FileCode2,
                class: Braces,
                function: FunctionSquare,
                server: Server,
                database: Database,
                request: Globe,
                folder: Folder,
                environment: FileJson,
                query: TerminalSquare,
                table: Table2,
              }[entry.kind];
              return (
                <button
                  type="button"
                  id={`everywhere-${i}`}
                  key={`${entry.path}:${entry.kind}:${entry.line}:${entry.label}`}
                  role="option"
                  aria-selected={i === selected}
                  className={i === selected ? "selected" : ""}
                  onMouseMove={() => setSelected(i)}
                  onClick={() => choose(entry)}
                  tabIndex={-1}
                >
                  <Icon size={16} />
                  <span>
                    {entry.label}
                    <small>
                      {entry.relative}
                      {["class", "function"].includes(entry.kind)
                        ? `:${entry.line}`
                        : ""}{" "}
                      · {entry.root}
                    </small>
                  </span>
                  <span className="search-result-kind">{entry.kind}</span>
                  <kbd>↵</kbd>
                </button>
              );
            })
          )}
        </div>
        <footer>
          {index?.truncated
            ? "Search limited to part of this project · dependencies excluded"
            : matches.length === 100
              ? "First 100 matches · keep typing to narrow"
              : scope
                ? `Searching ${filename(scope)}`
                : "Search all sections in this project"}
          <span>← → scope · ↑ ↓ navigate · ↵ open · esc close</span>
        </footer>
      </section>
    </div>
  );
}
