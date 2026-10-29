import { terminalPathsType } from "../lib/terminalDrop";
import { rootForPath, filename } from "../lib/workspace";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  FileCode2,
  FileText,
  Folder,
  FolderOpen,
} from "lucide-react";
import { listDirectory } from "../lib/bridge";
import type { FileEntry, Project } from "../types";

export default function FileTree({
  project,
  selectedRoot,
  onOpen,
  active,
  onError,
  onSelect,
  onContextMenu,
  cutPath,
  revealTarget,
  onRevealDone,
  refreshVersion = 0,
  collapseVersion = 0,
  visible = true,
}: {
  project: Project;
  selectedRoot?: string;
  onOpen: (path: string) => void;
  active?: string;
  onError: (error: string) => void;
  onSelect?: (entry: FileEntry) => void;
  onContextMenu?: (entry: FileEntry, point: { x: number; y: number }) => void;
  cutPath?: string;
  revealTarget?: { path: string; revision: number } | null;
  onRevealDone?: () => void;
  refreshVersion?: number;
  collapseVersion?: number;
  visible?: boolean;
}) {
  const chosenRoot =
    (selectedRoot && project.roots.includes(selectedRoot)
      ? selectedRoot
      : undefined) ??
    (revealTarget
      ? rootForPath(project.roots, revealTarget.path)
      : undefined) ??
    project.roots[0];
  const roots = chosenRoot ? [chosenRoot] : [];
  const revealRoot = revealTarget
    ? rootForPath(roots, revealTarget.path)
    : undefined;
  return (
    <div className="file-tree">
      {roots.map((root) => (
        <TreeNode
          key={root}
          contentsOnly
          project={project}
          entry={{
            name: root.split(/[\\/]/).at(-1) ?? root,
            path: root,
            directory: true,
          }}
          depth={-1}
          active={active}
          onOpen={onOpen}
          onError={onError}
          onSelect={onSelect}
          onContextMenu={onContextMenu}
          cutPath={cutPath}
          revealTarget={root === revealRoot ? revealTarget : null}
          onRevealDone={onRevealDone}
          refreshVersion={refreshVersion}
          collapseVersion={collapseVersion}
          visible={visible}
        />
      ))}
    </div>
  );
}

function TreeNode({
  project,
  entry,
  contentsOnly = false,
  depth,
  onOpen,
  active,
  onError,
  onSelect,
  onContextMenu,
  cutPath,
  revealTarget,
  onRevealDone,
  refreshVersion = 0,
  collapseVersion = 0,
  visible = true,
}: {
  project: Project;
  entry: FileEntry;
  contentsOnly?: boolean;
  depth: number;
  onOpen: (path: string) => void;
  active?: string;
  onError: (error: string) => void;
  onSelect?: (entry: FileEntry) => void;
  onContextMenu?: (entry: FileEntry, point: { x: number; y: number }) => void;
  cutPath?: string;
  revealTarget?: { path: string; revision: number } | null;
  onRevealDone?: () => void;
  refreshVersion?: number;
  collapseVersion?: number;
  visible?: boolean;
}) {
  const row = useRef<HTMLButtonElement>(null);
  const [expanded, setExpanded] = useState(contentsOnly);
  const [children, setChildren] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  async function toggle() {
    if (!entry.directory) {
      onOpen(entry.path);
      return;
    }
    if (expanded) {
      setExpanded(false);
      return;
    }
    setExpanded(true);
  }
  useEffect(() => {
    if (!contentsOnly) setExpanded(false);
  }, [collapseVersion, contentsOnly]);
  useEffect(() => {
    if (!revealTarget || !entry.directory) return;
    const path = revealTarget.path.replaceAll("\\", "/");
    const folder = entry.path.replaceAll("\\", "/").replace(/\/$/, "");
    if (path.startsWith(folder + "/")) setExpanded(true);
  }, [revealTarget, entry.path, entry.directory]);
  useLayoutEffect(() => {
    if (
      !revealTarget ||
      entry.directory ||
      entry.path !== revealTarget.path ||
      !row.current
    )
      return;
    const container = row.current.closest<HTMLElement>(".file-tree");
    if (!container) return;
    const viewport = container.getBoundingClientRect();
    const bounds = row.current.getBoundingClientRect();
    const top = viewport.top + container.clientTop;
    const bottom = top + container.clientHeight;
    if (bounds.top < top) container.scrollTop += bounds.top - top;
    else if (bounds.bottom > bottom)
      container.scrollTop += bounds.bottom - bottom;
    onRevealDone?.();
  }, [revealTarget, entry.path, entry.directory, onRevealDone]);
  useEffect(() => {
    let gone = false;
    let inFlight = false;
    let lastError = "";
    if (!expanded || !visible) return;
    const refresh = (initial = false) => {
      if (inFlight || document.visibilityState === "hidden") return;
      inFlight = true;
      if (initial) setLoading(true);
      void listDirectory(project, entry.path)
        .then((items) => {
          if (!gone) {
            lastError = "";
            setChildren((previous) =>
              JSON.stringify(previous) === JSON.stringify(items)
                ? previous
                : items,
            );
          }
        })
        .catch((reason) => {
          if (!gone && String(reason) !== lastError) {
            lastError = String(reason);
            onError(lastError);
          }
        })
        .finally(() => {
          inFlight = false;
          if (!gone) setLoading(false);
        });
    };
    refresh(true);
    const timer = setInterval(() => refresh(), 2000);
    const focus = () => refresh();
    window.addEventListener("focus", focus);
    document.addEventListener("visibilitychange", focus);
    return () => {
      gone = true;
      clearInterval(timer);
      window.removeEventListener("focus", focus);
      document.removeEventListener("visibilitychange", focus);
    };
  }, [refreshVersion, expanded, visible, project, entry.path, onError]);
  const Icon = entry.directory
    ? expanded
      ? FolderOpen
      : Folder
    : /\.(php|tsx?|jsx?|rs)$/.test(entry.name)
      ? FileCode2
      : FileText;
  return (
    <div
      className={contentsOnly ? "tree-root tree-contents" : undefined}
      data-root={contentsOnly ? entry.path : undefined}
      title={contentsOnly ? entry.path : undefined}
      role={contentsOnly ? "group" : undefined}
      aria-label={contentsOnly ? `${filename(entry.path)} files` : undefined}
      onContextMenu={
        contentsOnly
          ? (event) => {
              if (event.target !== event.currentTarget) return;
              event.preventDefault();
              onSelect?.(entry);
              onContextMenu?.(entry, { x: event.clientX, y: event.clientY });
            }
          : undefined
      }
    >
      {!contentsOnly && (
        <button
          ref={row}
          draggable
          onDragStart={(event) => {
            event.dataTransfer.effectAllowed = "copy";
            event.dataTransfer.setData(
              terminalPathsType,
              JSON.stringify([entry.path]),
            );
            event.dataTransfer.setData("text/plain", entry.path);
          }}
          className={`tree-row ${active === entry.path ? "selected" : ""} ${cutPath === entry.path ? "cut-file" : ""}`}
          style={{ paddingLeft: 12 + depth * 14 }}
          onClick={() => {
            onSelect?.(entry);
            void toggle();
          }}
          onContextMenu={(event) => {
            event.preventDefault();
            event.currentTarget.focus();
            onSelect?.(entry);
            onContextMenu?.(entry, { x: event.clientX, y: event.clientY });
          }}
          onKeyDown={(event) => {
            if (
              event.key !== "ContextMenu" &&
              !(event.shiftKey && event.key === "F10")
            )
              return;
            event.preventDefault();
            const bounds = event.currentTarget.getBoundingClientRect();
            onSelect?.(entry);
            onContextMenu?.(entry, { x: bounds.left + 20, y: bounds.bottom });
          }}
          title={entry.path}
          aria-expanded={entry.directory ? expanded : undefined}
        >
          {entry.directory ? (
            expanded ? (
              <ChevronDown size={16} />
            ) : (
              <ChevronRight size={16} />
            )
          ) : (
            <span className="tree-indent" />
          )}
          <Icon size={15} />
          <span>{entry.name}</span>
          {loading && <span className="muted">…</span>}
        </button>
      )}
      {expanded &&
        children.map((child) => (
          <TreeNode
            key={child.path}
            project={project}
            entry={child}
            depth={depth + 1}
            active={active}
            onOpen={onOpen}
            onError={onError}
            onSelect={onSelect}
            onContextMenu={onContextMenu}
            cutPath={cutPath}
            revealTarget={revealTarget}
            onRevealDone={onRevealDone}
            refreshVersion={refreshVersion}
            collapseVersion={collapseVersion}
            visible={visible}
          />
        ))}
      {expanded && !children.length && (
        <div className="tree-empty" style={{ paddingLeft: 32 + depth * 14 }}>
          Empty folder
        </div>
      )}
    </div>
  );
}
