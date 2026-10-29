import { useRootBranches } from "../hooks/useRootBranches";
import CustomSelect from "./CustomSelect";
import FileContextMenu, {
  copyPathToClipboard,
  type FileMenuAction,
} from "./FileContextMenu";
import { registerTabCloser } from "../lib/closeTab";
import {
  lazy,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  Check,
  FoldVertical,
  LocateFixed,
  WandSparkles,
  Code2,
  FileCode2,
  Files,
  GitBranch,
  ArrowLeft,
  ArrowRight,
  FilePlus,
  FolderPlus,
  Pencil,
  Trash2,
  Sparkle,
  Search,
  RefreshCw,
  TerminalSquare,
  X,
} from "lucide-react";
import {
  invoke,
  desktop,
  fileAction,
  inspectFiles,
  navigationTargets,
  readFile,
  saveFile,
} from "../lib/bridge";
import {
  canClose,
  codeModelPath,
  filename,
  language,
  rootForPath,
  folderBranchLabel,
} from "../lib/workspace";
import type {
  Document,
  FileEntry,
  EditorSelection,
  Project,
  WorkspaceSession,
} from "../types";
import FileTree from "./FileTree";
import PanelResize, { usePanelSize } from "./PanelResize";
import { middleClose } from "../lib/middleClose";
import type { NavigationTargets } from "../devTypes";
import { confirmAction } from "./ToolLayout";
import ReadOnlyDiff from "./ReadOnlyDiff";
import {
  loadDrafts,
  saveDrafts,
  recoverySnapshot,
  type CodeDraft,
} from "../lib/recovery";
import "./code-tools.css";
const GitPanel = lazy(() => import("./GitPanel"));
import QuickOpen from "./QuickOpen";
import type { SearchEntry } from "../lib/searchEverywhere";
import ProjectSearch from "./ProjectSearch";
import {
  createCodeAutosave,
  type CodeAutosave,
  type SaveState,
} from "../lib/autosave";

const EditorPane = lazy(() =>
  desktop ? import("./EditorPane") : import("./PreviewEditor"),
);
const FormatPhp = lazy(() => import("./FormatPhp"));
import { TerminalDock, WorkspaceTerminalContext } from "./WorkspaceTerminal";

export default function CodeWorkspace({
  project,
  visible,
  onError,
  initialSession,
  onSessionChange,
  onDirtyChange,
  onAutosaveReady,
  searchTarget,
  onSearch,
  filesRequest = 0,
}: {
  project: Project;
  searchTarget?: SearchEntry;
  onSearch: () => void;
  filesRequest?: number;
  visible: boolean;
  onError: (error: string) => void;
  initialSession: WorkspaceSession;
  onSessionChange: (patch: Partial<WorkspaceSession>) => void;
  onDirtyChange: (dirty: boolean) => void;
  onAutosaveReady: (flush: (() => Promise<boolean>) | null) => void;
}) {
  const initial = useRef(initialSession).current;
  const sidebarRef = useRef<HTMLElement>(null);
  const [sidebarWidth, setSidebarWidth] = usePanelSize(
    "octode-layout:sidebar:Code",
    238,
  );
  const [collapseVersion, setCollapseVersion] = useState(0);
  const [revealTarget, setRevealTarget] = useState<{
    path: string;
    revision: number;
  } | null>(null);
  const revealRevision = useRef(0);
  const revealDone = useCallback(() => setRevealTarget(null), []);
  const [selectedEntry, setSelectedEntry] = useState<FileEntry>({
    path: initial.activeRoot,
    name: filename(initial.activeRoot),
    directory: true,
  });
  const [filePrompt, setFilePrompt] = useState<{
    action: "create-file" | "create-folder" | "rename" | "delete";
    path: string;
    name: string;
    directory: boolean;
  } | null>(null);
  const [fileMenu, setFileMenu] = useState<{
    entry: FileEntry;
    point: { x: number; y: number };
  } | null>(null);
  const [fileClipboard, setFileClipboard] = useState<{
    entry: FileEntry;
    projectId: string;
    cut: boolean;
  } | null>(null);
  const closeFileMenu = useCallback(() => setFileMenu(null), []);
  useEffect(() => {
    setFileClipboard(null);
    setFileMenu(null);
    setRevealTarget(null);
  }, [project.id]);
  const [fileBusy, setFileBusy] = useState(false);
  const [gitBusy, setGitBusy] = useState(false);
  const [external, setExternal] = useState<
    Record<string, { content: string | null; error: string | null }>
  >({});
  const [comparison, setComparison] = useState("");
  const externalRef = useRef(external);
  externalRef.current = external;
  const [targets, setTargets] = useState<NavigationTargets | null>(null);
  const [navigationBusy, setNavigationBusy] = useState(false);
  const history = useRef<{ path: string; line: number }[]>([]);
  const historyIndex = useRef(-1);
  const [historyPosition, setHistoryPosition] = useState({
    index: -1,
    total: 0,
  });
  const stamps = useRef(new Map<string, string>());
  const inspecting = useRef(false);
  const mounted = useRef(true);
  const operationBusy = useRef(false);
  operationBusy.current = fileBusy || gitBusy;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const [documents, setDocuments] = useState<Document[]>([]);
  const [active, setActive] = useState("");
  const [formatter, setFormatter] = useState(false);
  const [root, setRoot] = useState(initial.activeRoot);
  useEffect(() => {
    const owner = rootForPath(project.roots, active);
    if (owner) {
      setRoot(owner);
      setSelectedEntry({
        path: active,
        name: filename(active),
        directory: false,
      });
    }
  }, [active, project.roots]);
  const [tab, setTab] = useState<"files" | "git" | "search">("files");
  useEffect(() => {
    if (filesRequest) setTab("files");
  }, [filesRequest]);
  useEffect(() => {
    setFileMenu(null);
  }, [visible, tab, active]);
  const [findToken, setFindToken] = useState(0);
  const [quickOpen, setQuickOpen] = useState(false);

  const [searchFocus, setSearchFocus] = useState(0);
  const [selection, setSelection] = useState<EditorSelection>();
  const [restoring, setRestoring] = useState(true);
  const [recoveryReview, setRecoveryReview] = useState<CodeDraft | null>(null);
  const [recoveredDrafts, setRecoveredDrafts] = useState<CodeDraft[]>([]);
  const [recoveryReady, setRecoveryReady] = useState(false);
  const recoveryLoaded = useRef(false);
  const recoveryPending = useRef(recoveredDrafts);
  recoveryPending.current = recoveredDrafts;
  const recoveryError = useRef(false);
  const [treeVersion, setTreeVersion] = useState(0);
  const rootBranches = useRootBranches(project, visible, treeVersion);
  // Restoring the layout never starts a shell automatically.
  const terminalDock = useContext(WorkspaceTerminalContext);
  const terminal = terminalDock.visible;
  const [saveStates, setSaveStates] = useState<Record<string, SaveState>>({});
  const autosave = useRef<CodeAutosave | null>(null);
  const documentsRef = useRef(documents);
  documentsRef.current = documents;
  const document = documents.find((item) => item.path === active);
  const dirty = !canClose(documents);
  const pathsKey = JSON.stringify(documents.map((item) => item.path));
  useEffect(
    () => () => {
      if (desktop) {
        const paths = documentsRef.current.map((item) => item.path);
        void import("../editor/runtime").then(({ monaco }) => {
          for (const path of paths)
            monaco.editor
              .getModel(monaco.Uri.parse(codeModelPath(project.id, path)))
              ?.dispose();
        });
      }
    },
    [],
  );
  const updateDocuments = useCallback(
    (update: (items: Document[]) => Document[]) => {
      const next = update(documentsRef.current);
      documentsRef.current = next;
      setDocuments(next);
    },
    [],
  );

  useEffect(() => {
    let disposed = false;
    void (async () => {
      const restored: Document[] = [];
      const failures: string[] = [];
      for (let offset = 0; offset < initial.openFiles.length; offset += 4) {
        const paths = initial.openFiles.slice(offset, offset + 4);
        const results = await Promise.allSettled(
          paths.map(async (path) => {
            const text = await readFile(project, path);
            return { path, name: filename(path), text, saved: text };
          }),
        );
        if (disposed) return;
        results.forEach((result, index) => {
          if (result.status === "fulfilled") restored.push(result.value);
          else failures.push(filename(paths[index]));
        });
      }
      if (disposed) return;
      updateDocuments((previous) => [
        ...restored.filter(
          (item) => !previous.some((open) => open.path === item.path),
        ),
        ...previous,
      ]);
      setActive(
        (previous) =>
          previous ||
          (restored.some((item) => item.path === initial.activeFile)
            ? initial.activeFile
            : (restored[0]?.path ?? "")),
      );
      setRestoring(false);
      try {
        const pending = await loadDrafts(project);
        if (!disposed) {
          setRecoveredDrafts(pending);
          recoveryPending.current = pending;
          recoveryLoaded.current = true;
          setRecoveryReady(true);
        }
      } catch (reason) {
        if (!disposed)
          onError(`Could not load recovery drafts: ${String(reason)}`);
      }
      if (failures.length)
        onError(
          `Could not reopen ${failures.length} file(s): ${failures.slice(0, 5).join(", ")}. Their source files were not changed.`,
        );
    })();
    return () => {
      disposed = true;
    };
  }, [project, initial, onError, updateDocuments]);
  useEffect(() => {
    if (!recoveryReady) return;
    const timer = setTimeout(() => {
      void saveDrafts(
        project,
        recoverySnapshot(documents, recoveredDrafts),
      ).catch((reason) => {
        if (!recoveryError.current) {
          recoveryError.current = true;
          onError(`Code recovery backup failed: ${String(reason)}`);
        }
      });
    }, 250);
    return () => clearTimeout(timer);
  }, [documents, recoveredDrafts, recoveryReady, project, onError]);
  useEffect(
    () => () => {
      if (recoveryLoaded.current)
        void saveDrafts(
          project,
          recoverySnapshot(documentsRef.current, recoveryPending.current),
        ).catch(() => {});
    },
    [project],
  );
  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => {
    if (!restoring)
      onSessionChange({
        openFiles: JSON.parse(pathsKey) as string[],
        activeFile: active,
        activeRoot: root,
        terminalVisible: terminal,
      });
  }, [pathsKey, active, root, terminal, restoring, onSessionChange]);

  useEffect(() => {
    const manager = createCodeAutosave({
      read: () => documentsRef.current,
      write: (snapshot) =>
        saveFile(project, snapshot.path, snapshot.text, snapshot.saved),
      saved: (snapshot) => {
        updateDocuments((previous) =>
          previous.map((item) =>
            item.path === snapshot.path
              ? { ...item, saved: snapshot.text }
              : item,
          ),
        );
      },
      state: setSaveStates,
      error: (path, reason) =>
        onError(`Autosave failed for ${filename(path)}: ${String(reason)}`),
    });
    autosave.current = manager;
    onAutosaveReady(async () => {
      const saved = await manager.flush();
      if (recoveryLoaded.current)
        await saveDrafts(
          project,
          recoverySnapshot(documentsRef.current, recoveryPending.current),
        );
      return (
        saved &&
        !Object.values(externalRef.current).some((value) => !!value.error)
      );
    });
    const blur = () => {
      void manager.flush();
    };
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("blur", blur);
      manager.dispose();
      if (autosave.current === manager) autosave.current = null;
      onAutosaveReady(null);
    };
  }, [project, onError, onAutosaveReady, updateDocuments]);
  useEffect(() => {
    if (!visible) void autosave.current?.flush();
  }, [visible]);
  const checkDisk = useCallback(
    async (force = false) => {
      if (inspecting.current || (!force && operationBusy.current)) return;
      const snapshot = documentsRef.current;
      if (!snapshot.length) return;
      inspecting.current = true;
      try {
        const results = await inspectFiles(
          project,
          snapshot.map((item) => ({
            path: item.path,
            stamp: stamps.current.get(item.path) ?? "",
          })),
        );
        if (!mounted.current) return;
        for (const value of results) {
          const before = snapshot.find((item) => item.path === value.path);
          const current = documentsRef.current.find(
            (item) => item.path === value.path,
          );
          if (!before || !current || before.saved !== current.saved) continue;
          stamps.current.set(value.path, value.stamp);
          if (value.error) {
            autosave.current?.pause(value.path);
            setExternal((previous) => ({
              ...previous,
              [value.path]: { content: null, error: value.error },
            }));
            continue;
          }
          if (value.content === null) continue;
          if (value.content === current.saved) {
            if (externalRef.current[value.path]) {
              autosave.current?.forget(value.path);
              autosave.current?.changed(value.path);
            }
            setExternal((previous) => {
              if (!(value.path in previous)) return previous;
              const next = { ...previous };
              delete next[value.path];
              return next;
            });
            continue;
          }
          if (current.text === current.saved) {
            autosave.current?.forget(value.path);
            updateDocuments((items) =>
              items.map((item) =>
                item.path === value.path
                  ? { ...item, text: value.content!, saved: value.content! }
                  : item,
              ),
            );
            setExternal((previous) => {
              const next = { ...previous };
              delete next[value.path];
              return next;
            });
          } else {
            autosave.current?.pause(value.path);
            setExternal((previous) => ({
              ...previous,
              [value.path]: { content: value.content, error: null },
            }));
          }
        }
      } catch (reason) {
        if (mounted.current) onError(String(reason));
      } finally {
        inspecting.current = false;
      }
    },
    [project, onError, updateDocuments],
  );
  useEffect(() => {
    if (!visible) return;
    void checkDisk();
    let ticks = 0;
    const timer = setInterval(() => {
      void checkDisk();
      if (++ticks % 5 === 0 && !operationBusy.current)
        setTreeVersion((value) => value + 1);
    }, 2000);
    const focus = () => void checkDisk();
    window.addEventListener("focus", focus);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", focus);
    };
  }, [visible, checkDisk]);
  const recordHistory = (path: string, line = 1) => {
    const current = history.current[historyIndex.current];
    if (current?.path === path && current.line === line) return;
    history.current = [
      ...history.current.slice(0, historyIndex.current + 1),
      { path, line },
    ].slice(-100);
    historyIndex.current = history.current.length - 1;
    setHistoryPosition({
      index: historyIndex.current,
      total: history.current.length,
    });
  };
  const open = async (path: string, line?: number, record = true) => {
    const owner = rootForPath(project.roots, path);
    if (owner) setRoot(owner);
    if (record) recordHistory(path, line);

    if (line) setSelection({ path, line, revision: Date.now() });
    if (documentsRef.current.some((item) => item.path === path)) {
      setActive(path);
      return;
    }
    try {
      const text = await readFile(project, path);
      updateDocuments((previous) =>
        previous.some((item) => item.path === path)
          ? previous
          : [...previous, { path, name: filename(path), text, saved: text }],
      );
      setActive(path);
    } catch (reason) {
      onError(String(reason));
    }
  };
  const save = useCallback(async () => {
    if (active && (await autosave.current?.flush(active, true))) onError("");
  }, [active, onError]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (
        visible &&
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "p"
      ) {
        event.preventDefault();
        setQuickOpen(true);
      }
      if (
        visible &&
        (event.metaKey || event.ctrlKey) &&
        event.shiftKey &&
        event.key.toLowerCase() === "f"
      ) {
        event.preventDefault();
        setTab("search");
        setSearchFocus((value) => value + 1);
      }
      if (
        visible &&
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "s"
      ) {
        event.preventDefault();
        void save();
      }
    };
    const unload = (event: BeforeUnloadEvent) => {
      if (!canClose(documentsRef.current)) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("keydown", handler);
    window.addEventListener("beforeunload", unload);
    return () => {
      window.removeEventListener("keydown", handler);
      window.removeEventListener("beforeunload", unload);
    };
  }, [visible, save]);
  useEffect(() => {
    if (!visible) return;
    const find = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        !(event.metaKey || event.ctrlKey) ||
        event.shiftKey ||
        event.altKey ||
        event.key.toLowerCase() !== "f" ||
        window.document.querySelector('[aria-modal="true"]') ||
        !documentsRef.current.length
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      setFindToken((value) => value + 1);
    };
    window.addEventListener("keydown", find, true);
    return () => window.removeEventListener("keydown", find, true);
  }, [visible]);
  const handledSearch = useRef<SearchEntry | undefined>(undefined);
  useEffect(() => {
    if (
      !searchTarget ||
      searchTarget.target ||
      restoring ||
      handledSearch.current === searchTarget
    )
      return;
    handledSearch.current = searchTarget;
    void open(searchTarget.path, searchTarget.line);
  }, [searchTarget, restoring]);
  const close = async (path: string) => {
    const saved = await autosave.current?.flush(path);
    const current = documentsRef.current.find((item) => item.path === path);
    if (!saved && current && current.text !== current.saved) {
      const okay = desktop
        ? await (
            await import("@tauri-apps/plugin-dialog")
          ).confirm(`Discard unsaved changes to ${current.name}?`, {
            title: "Unsaved changes",
            kind: "warning",
          })
        : window.confirm(`Discard unsaved changes to ${current.name}?`);
      if (!okay) return;
    }
    autosave.current?.forget(path);
    if (desktop)
      void import("../editor/runtime").then(({ monaco }) => {
        requestAnimationFrame(() => {
          if (!documentsRef.current.some((item) => item.path === path))
            monaco.editor
              .getModel(monaco.Uri.parse(codeModelPath(project.id, path)))
              ?.dispose();
        });
      });
    const remaining = documentsRef.current.filter((item) => item.path !== path);
    updateDocuments(() => remaining);
    setActive((previous) =>
      previous === path ? (remaining.at(-1)?.path ?? "") : previous,
    );
  };

  useEffect(() =>
    registerTabCloser({
      active: () =>
        visible &&
        !!active &&
        !fileBusy &&
        !gitBusy &&
        !window.document.activeElement?.closest(".terminal-panel"),
      close: () => close(active),
    }),
  );

  const restoreDraft = async (draft: CodeDraft) => {
    try {
      let disk: string | null = null;
      try {
        disk = await readFile(project, draft.path);
      } catch {
        /* Keep missing source text recoverable; do not create files automatically. */
      }
      updateDocuments((items) => [
        ...items.filter((item) => item.path !== draft.path),
        { ...draft, name: filename(draft.path) },
      ]);
      setActive(draft.path);
      setRecoveredDrafts((previous) =>
        previous.filter((item) => item.path !== draft.path),
      );
      if (disk !== draft.saved) {
        autosave.current?.pause(draft.path);
        setExternal((previous) => ({
          ...previous,
          [draft.path]: {
            content: disk,
            error: disk === null ? "The source file is unavailable" : null,
          },
        }));
      } else {
        autosave.current?.changed(draft.path);
      }
    } catch (reason) {
      onError(String(reason));
    }
  };
  const editDocument = (path: string, text: string) => {
    if (documentsRef.current.find((item) => item.path === path)?.text === text)
      return;
    updateDocuments((items) =>
      items.map((item) => (item.path === path ? { ...item, text } : item)),
    );
    autosave.current?.changed(path);
  };
  const travel = (direction: number) => {
    const index = historyIndex.current + direction;
    const target = history.current[index];
    if (!target) return;
    historyIndex.current = index;
    setHistoryPosition({ index, total: history.current.length });
    void open(target.path, target.line, false);
  };
  const navigateTo = async (query: string, line = 1) => {
    if (!document || navigationBusy) return;
    recordHistory(document.path, line);
    setNavigationBusy(true);
    try {
      const result = await navigationTargets(project, document.path, query);
      if (!mounted.current) return;
      if (result.targets.length === 1)
        await open(result.targets[0].path, result.targets[0].line);
      else setTargets(result);
    } catch (reason) {
      onError(String(reason));
    } finally {
      if (mounted.current) setNavigationBusy(false);
    }
  };
  const diskAction = async (keep: boolean) => {
    const item = documentsRef.current.find((item) => item.path === comparison);
    if (!item) return;
    setFileBusy(true);
    try {
      const disk = await readFile(project, item.path);
      if (keep) {
        if (disk !== external[item.path]?.content) {
          setExternal((previous) => ({
            ...previous,
            [item.path]: { content: disk, error: null },
          }));
          throw new Error(
            "The disk version changed again. Review the updated comparison before replacing it.",
          );
        }
        if (
          !(await confirmAction(
            `Replace the disk version of ${item.name} with the editor version?`,
          ))
        )
          return;
        await saveFile(project, item.path, item.text, disk);
        updateDocuments((items) =>
          items.map((latest) =>
            latest.path === item.path
              ? { ...latest, saved: item.text }
              : latest,
          ),
        );
      } else {
        if (
          item.text !== item.saved &&
          !(await confirmAction(
            `Reload ${item.name} from disk and discard its unsaved editor changes?`,
          ))
        )
          return;
        updateDocuments((items) =>
          items.map((latest) =>
            latest.path === item.path
              ? { ...latest, text: disk, saved: disk }
              : latest,
          ),
        );
      }
      autosave.current?.forget(item.path);
      autosave.current?.changed(item.path);
      stamps.current.delete(item.path);
      setExternal((previous) => {
        const next = { ...previous };
        delete next[item.path];
        return next;
      });
      setComparison("");
      onError("");
    } catch (reason) {
      onError(String(reason));
    } finally {
      setFileBusy(false);
    }
  };
  const mutateFiles = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!filePrompt || fileBusy || gitBusy) return;
    setFileBusy(true);
    try {
      if (!(await autosave.current?.flush()))
        throw new Error("Resolve failed Code saves before changing files.");
      const selected = filePrompt;
      const affected = documentsRef.current.filter(
        (item) =>
          item.path === selected.path ||
          item.path.startsWith(selected.path + "/"),
      );
      const expected = documentsRef.current.find(
        (item) => item.path === selected.path,
      )?.saved;
      const path = await fileAction(project, {
        action: selected.action,
        path: selected.path,
        name: selected.name,
        expected,
      });
      if (selected.action === "rename" || selected.action === "delete") {
        for (const item of affected) {
          autosave.current?.forget(item.path);
          stamps.current.delete(item.path);
        }
        updateDocuments((items) =>
          selected.action === "delete"
            ? items.filter(
                (item) => !affected.some((old) => old.path === item.path),
              )
            : items.map((item) =>
                affected.some((old) => old.path === item.path)
                  ? {
                      ...item,
                      path: path + item.path.slice(selected.path.length),
                      name: filename(
                        path + item.path.slice(selected.path.length),
                      ),
                    }
                  : item,
              ),
        );
        setActive((previous) =>
          previous === selected.path || previous.startsWith(selected.path + "/")
            ? selected.action === "delete"
              ? ""
              : path + previous.slice(selected.path.length)
            : previous,
        );
        setExternal((previous) =>
          Object.fromEntries(
            Object.entries(previous).filter(
              ([key]) => !affected.some((item) => item.path === key),
            ),
          ),
        );
        setSelectedEntry({
          path: selected.action === "delete" ? root : path,
          name: filename(selected.action === "delete" ? root : path),
          directory: selected.action === "delete" || selected.directory,
        });
      }
      if (selected.action === "rename" || selected.action === "delete") {
        setFileClipboard((previous) => {
          if (
            !previous ||
            !(
              previous.entry.path === selected.path ||
              previous.entry.path.startsWith(selected.path + "/")
            )
          )
            return previous;
          if (selected.action === "delete") return null;
          const nextPath =
            path + previous.entry.path.slice(selected.path.length);
          return {
            ...previous,
            entry: {
              ...previous.entry,
              path: nextPath,
              name: filename(nextPath),
            },
          };
        });
      }
      if (selected.action.startsWith("create"))
        setSelectedEntry({
          path,
          name: filename(path),
          directory: selected.action === "create-folder",
        });
      if (selected.action === "rename" || selected.action === "delete") {
        history.current = history.current.flatMap((item) =>
          item.path === selected.path ||
          item.path.startsWith(selected.path + "/")
            ? selected.action === "delete"
              ? []
              : [
                  {
                    ...item,
                    path: path + item.path.slice(selected.path.length),
                  },
                ]
            : [item],
        );
        historyIndex.current = Math.min(
          historyIndex.current,
          history.current.length - 1,
        );
        setHistoryPosition({
          index: historyIndex.current,
          total: history.current.length,
        });
      }
      setTreeVersion((value) => value + 1);
      setFilePrompt(null);
      if (selected.action === "create-file") await open(path);
    } catch (reason) {
      onError(String(reason));
    } finally {
      setFileBusy(false);
    }
  };
  const requestFileAction = (
    action: "create-file" | "create-folder" | "rename" | "delete",
    entry = selectedEntry,
  ) => {
    const parent = entry.directory
      ? entry.path
      : entry.path.slice(0, entry.path.lastIndexOf("/"));
    setFilePrompt({
      action,
      path: action.startsWith("create") ? parent : entry.path,
      name: action === "rename" ? entry.name : "",
      directory: entry.directory,
    });
  };
  const showFileMenu = (entry: FileEntry, point: { x: number; y: number }) => {
    if (fileBusy || gitBusy) return;
    window.dispatchEvent(new Event("octode-dismiss-popovers"));
    setSelectedEntry(entry);
    setFileMenu({ entry, point });
  };
  const fileMenuAction = async (action: FileMenuAction) => {
    const entry = fileMenu?.entry;
    setFileMenu(null);
    if (!entry || fileBusy || gitBusy) return;
    if (action === "copy" || action === "cut") {
      setFileClipboard({ entry, projectId: project.id, cut: action === "cut" });
      return;
    }
    if (action === "rename") {
      requestFileAction("rename", entry);
      return;
    }
    setFileBusy(true);
    try {
      if (action === "copy-path") {
        await copyPathToClipboard(entry.path);
        setFileClipboard(null);
        return;
      }
      if (action === "reveal") {
        await fileAction(project, { action: "reveal", path: entry.path });
        return;
      }
      if (
        action === "paste" &&
        (!fileClipboard || fileClipboard.projectId !== project.id)
      )
        return;
      if (!(await autosave.current?.flush()))
        throw new Error("Resolve failed Code saves before changing files.");
      const source = action === "paste" ? fileClipboard!.entry : entry;
      const moving = action === "paste" && fileClipboard!.cut;
      const destination = entry.directory
        ? entry.path
        : entry.path.slice(0, entry.path.lastIndexOf("/"));
      const path = await fileAction(project, {
        action: moving ? "move" : action === "duplicate" ? "duplicate" : "copy",
        path: source.path,
        destination,
        expected: documentsRef.current.find((item) => item.path === source.path)
          ?.saved,
      });
      if (moving) {
        autosave.current?.forget(source.path);
        stamps.current.delete(source.path);
        updateDocuments((items) =>
          items.map((item) =>
            item.path === source.path
              ? { ...item, path, name: filename(path) }
              : item,
          ),
        );
        setActive((previous) => (previous === source.path ? path : previous));
        setExternal((previous) =>
          Object.fromEntries(
            Object.entries(previous).filter(([key]) => key !== source.path),
          ),
        );
        history.current = history.current.map((item) =>
          item.path === source.path ? { ...item, path } : item,
        );
        setFileClipboard(null);
      }
      setSelectedEntry({ path, name: filename(path), directory: false });
      setTreeVersion((value) => value + 1);
      if (
        !moving &&
        documentsRef.current.some((item) => item.path === source.path)
      )
        await open(path);
      onError("");
    } catch (reason) {
      onError(String(reason));
    } finally {
      setFileBusy(false);
    }
  };
  return (
    <div className="code-workspace">
      <aside
        className="explorer"
        ref={sidebarRef}
        style={{ width: sidebarWidth }}
      >
        <div className="explorer-tabs">
          <button
            className={tab === "files" ? "active" : ""}
            disabled={gitBusy || fileBusy}
            onClick={() => setTab("files")}
          >
            <Files size={14} /> Files
          </button>
          <button
            className={tab === "search" ? "active" : ""}
            disabled={gitBusy || fileBusy}
            onClick={() => {
              setTab("search");
              setSearchFocus((value) => value + 1);
            }}
            title="Search project (Cmd/Ctrl+Shift+F)"
          >
            <Search size={14} /> Search
          </button>
          <button
            className={tab === "git" ? "active" : ""}
            onClick={() => {
              setTab("git");
            }}
          >
            <GitBranch size={14} /> Git
          </button>
        </div>
        <label className="root-select">
          <CustomSelect
            aria-label="Active project folder"
            renderLabel={(path, label) => {
              const name = filename(path);
              const branch = label === name ? "" : label.slice(name.length + 3);
              return (
                <span className="folder-branch-label">
                  <span className="folder-name">{name}</span>
                  {branch && (
                    <span
                      className="folder-branch-pill"
                      title={`Branch: ${branch}`}
                    >
                      {branch}
                    </span>
                  )}
                </span>
              );
            }}
            disabled={gitBusy || fileBusy}
            value={root}
            onChange={(event) => {
              setRoot(event.target.value);
              setSelectedEntry({
                path: event.target.value,
                name: filename(event.target.value),
                directory: true,
              });
            }}
          >
            {project.roots.map((item) => (
              <option key={item} value={item}>
                {folderBranchLabel(item, rootBranches[item])}
              </option>
            ))}
          </CustomSelect>
        </label>
        {tab === "files" && (
          <div className="file-actions">
            <button
              title="Collapse all folders"
              aria-label="Collapse all folders"
              onClick={() => setCollapseVersion((value) => value + 1)}
            >
              <FoldVertical size={14} />
            </button>
            <button
              title="Reveal active file in folders"
              aria-label="Reveal active file"
              disabled={!active || fileBusy || gitBusy}
              onClick={() => {
                const owner = rootForPath(project.roots, active);
                if (owner) setRoot(owner);
                setSelectedEntry({
                  path: active,
                  name: filename(active),
                  directory: false,
                });
                setTreeVersion((value) => value + 1);
                setRevealTarget({
                  path: active,
                  revision: ++revealRevision.current,
                });
              }}
            >
              <LocateFixed size={14} />
            </button>
            <button
              title="New file"
              aria-label="New file"
              disabled={fileBusy || gitBusy}
              onClick={() => requestFileAction("create-file")}
            >
              <FilePlus size={14} />
            </button>
            <button
              title="New folder"
              aria-label="New folder"
              disabled={fileBusy || gitBusy}
              onClick={() => requestFileAction("create-folder")}
            >
              <FolderPlus size={14} />
            </button>
            <button
              title="Rename or move selected item"
              aria-label="Rename or move selected item"
              disabled={
                fileBusy ||
                gitBusy ||
                project.roots.includes(selectedEntry.path)
              }
              onClick={() => requestFileAction("rename")}
            >
              <Pencil size={14} />
            </button>
            <button
              title="Delete selected item"
              aria-label="Delete selected item"
              disabled={
                fileBusy ||
                gitBusy ||
                project.roots.includes(selectedEntry.path)
              }
              onClick={() => requestFileAction("delete")}
            >
              <Trash2 size={14} />
            </button>
          </div>
        )}
        {tab === "search" ? (
          <ProjectSearch
            project={project}
            focusToken={searchFocus}
            beforeReplace={async () =>
              (await autosave.current?.flush()) ?? true
            }
            onChanged={async () => {
              stamps.current.clear();
              await checkDisk(true);
              setTreeVersion((value) => value + 1);
            }}
            onOpen={(path, line) => void open(path, line)}
          />
        ) : tab === "files" ? (
          <FileTree
            selectedRoot={root}
            refreshVersion={treeVersion}
            collapseVersion={collapseVersion}
            revealTarget={revealTarget}
            onRevealDone={revealDone}
            visible={visible}
            onSelect={setSelectedEntry}
            onContextMenu={showFileMenu}
            cutPath={fileClipboard?.cut ? fileClipboard.entry.path : undefined}
            project={project}
            active={active}
            onOpen={(path) => void open(path)}
            onError={onError}
          />
        ) : (
          <Suspense fallback={<div className="loading">Opening Git…</div>}>
            <GitPanel
              key={root}
              project={project}
              root={root}
              visible={visible && tab === "git"}
              revision={treeVersion}
              onError={onError}
              onBusy={setGitBusy}
              beforeAction={async () =>
                (await autosave.current?.flush()) ?? true
              }
              onOpen={(path) => open(path)}
              renderMerge={(path) => {
                const item = documents.find((item) => item.path === path);
                return item ? (
                  <Suspense
                    fallback={
                      <div className="loading">Loading result editor…</div>
                    }
                  >
                    <EditorPane
                      key={item.path}
                      document={item}
                      modelPath={`octode-merge:${project.id}:${path}`}
                      readOnly={fileBusy || gitBusy}
                      onChange={(text) => editDocument(path, text)}
                    />
                  </Suspense>
                ) : (
                  <p>Open the result in Code to edit it.</p>
                );
              }}
              onChooseVersion={editDocument}
              onChanged={async () => {
                setTreeVersion((value) => value + 1);
                stamps.current.clear();
                await checkDisk(true);
              }}
            />
          </Suspense>
        )}
      </aside>
      <PanelResize
        target={sidebarRef}
        size={sidebarWidth}
        onResize={setSidebarWidth}
        label="Resize Code sidebar"
      />
      <section className="editor-section">
        <div className="editor-tabs">
          <button
            className="icon-button"
            title="Back"
            aria-label="Navigation back"
            disabled={historyPosition.index <= 0}
            onClick={() => travel(-1)}
          >
            <ArrowLeft size={14} />
          </button>
          <button
            className="icon-button"
            title="Forward"
            aria-label="Navigation forward"
            disabled={historyPosition.index >= historyPosition.total - 1}
            onClick={() => travel(1)}
          >
            <ArrowRight size={14} />
          </button>
          <div className="document-tabs">
            {documents.map((item) => (
              <div
                className={`document-tab ${active === item.path ? "active" : ""}`}
                key={item.path}
                onContextMenu={(event) => {
                  event.preventDefault();
                  showFileMenu(
                    { path: item.path, name: item.name, directory: false },
                    { x: event.clientX, y: event.clientY },
                  );
                }}
                onMouseDown={(event) => {
                  if (event.button === 1) event.preventDefault();
                }}
                onMouseUp={(event) =>
                  middleClose(event, () => {
                    if (!fileBusy && !gitBusy) void close(item.path);
                  })
                }
                onAuxClick={(event) =>
                  middleClose(event, () => {
                    if (!fileBusy && !gitBusy) void close(item.path);
                  })
                }
              >
                <button
                  onClick={() => {
                    recordHistory(item.path);
                    const owner = rootForPath(project.roots, item.path);
                    if (owner) setRoot(owner);
                    setSelectedEntry({
                      path: item.path,
                      name: item.name,
                      directory: false,
                    });
                    setActive(item.path);
                  }}
                  title={item.path}
                >
                  <FileCode2 size={14} />
                  {item.name}
                  {item.text !== item.saved && <span className="dirty-dot" />}
                </button>
                <button
                  aria-label={`Close ${item.name}`}
                  disabled={fileBusy || gitBusy}
                  onClick={() => void close(item.path)}
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
          <button
            className="icon-button"
            aria-label="Search everywhere"
            title="Search all sections (Shift twice)"
            onClick={() => onSearch()}
          >
            <Sparkle size={17} />
          </button>
          <button
            className="icon-button"
            title="Find in file (Cmd/Ctrl+F)"
            aria-label="Find in file"
            disabled={!document}
            onClick={() => setFindToken((value) => value + 1)}
          >
            <Search size={15} />
          </button>
          {saveStates[active] === "error" && (
            <button
              className="icon-button"
              title="Retry autosave"
              aria-label="Retry autosave"
              onClick={() => void save()}
            >
              <RefreshCw size={15} />
            </button>
          )}
          <button
            className="icon-button"
            title="Format PHP in Compose / Sail"
            aria-label="Format PHP in container"
            disabled={fileBusy || gitBusy || !document?.path.endsWith(".php")}
            onClick={() => setFormatter(true)}
          >
            <WandSparkles size={15} />
          </button>
        </div>
        <div className="split-editor-layout">
          <div className="editor-main">
            {document ? (
              <>
                <div className="editor-breadcrumb">
                  {filename(root)} <span>/</span>{" "}
                  {document.path.startsWith(root + "/")
                    ? document.path.slice(root.length + 1)
                    : document.path}
                </div>
                {(external[active] || saveStates[active] === "error") && (
                  <div className="disk-change-banner">
                    <span>
                      {external[active]?.error
                        ? "File unavailable on disk. The editor buffer is preserved."
                        : external[active] &&
                            external[active].content !== document.saved
                          ? "File changed on disk. Autosave is paused for this file."
                          : "Autosave failed. Compare the current disk version before retrying."}
                    </span>
                    <button
                      disabled={fileBusy || gitBusy}
                      onClick={async () => {
                        try {
                          const disk = await readFile(project, active);
                          setExternal((previous) => ({
                            ...previous,
                            [active]: { content: disk, error: null },
                          }));
                          setComparison(active);
                        } catch (reason) {
                          onError(String(reason));
                        }
                      }}
                    >
                      Compare / reload
                    </button>
                  </div>
                )}
                <div className="editor-surface">
                  <Suspense
                    fallback={<div className="loading">Loading editor…</div>}
                  >
                    <EditorPane
                      key={document.path}
                      document={document}
                      modelPath={codeModelPath(project.id, document.path)}
                      findToken={findToken}
                      onFindHandled={() => setFindToken(0)}
                      selection={selection}
                      readOnly={fileBusy || gitBusy}
                      onNavigate={(query, line) => void navigateTo(query, line)}
                      onChange={(text) => editDocument(document.path, text)}
                    />
                  </Suspense>
                </div>
              </>
            ) : (
              <div className="editor-empty">
                <span className="empty-code-icon">
                  <Code2 size={42} strokeWidth={1} />
                </span>
                <h2>A little room to focus.</h2>
                <p>
                  {restoring
                    ? "Restoring your open files…"
                    : "Expand a folder or use quick open to get started."}
                </p>
                <button
                  className="text-button"
                  onClick={() => setQuickOpen(true)}
                >
                  <Search size={14} /> Find a file <kbd>⌘ P</kbd>
                </button>
                <div>
                  <span>Find in file</span>
                  <kbd>⌘ F</kbd>
                </div>
                <div>
                  <span>Code saves automatically</span>
                  <span>600 ms</span>
                </div>
                <button
                  className="text-button"
                  onClick={() => {
                    terminalDock.show();
                  }}
                >
                  <TerminalSquare size={14} /> Open local terminal
                </button>
              </div>
            )}
          </div>
        </div>
        <TerminalDock tool="code" />
        <div className="editor-status">
          <span>
            {document ? (
              saveStates[active] === "error" ? (
                "Autosave failed — edits kept"
              ) : saveStates[active] === "saving" ? (
                "Saving…"
              ) : document.text === document.saved ? (
                <>
                  <Check size={12} /> Autosaved
                </>
              ) : (
                "Autosave pending…"
              )
            ) : (
              "Ready"
            )}
          </span>
          <span>
            {document ? language(document.path).toUpperCase() : "UTF-8"}{" "}
            <span className="muted">·</span>{" "}
            {desktop ? "Local files" : "Preview sandbox"}
          </span>
        </div>
      </section>
      {fileMenu && visible && (
        <FileContextMenu
          entry={fileMenu.entry}
          point={fileMenu.point}
          canPaste={fileClipboard?.projectId === project.id}
          isRoot={project.roots.includes(fileMenu.entry.path)}
          onClose={closeFileMenu}
          onAction={(action) => void fileMenuAction(action)}
        />
      )}
      {quickOpen && (
        <QuickOpen
          project={project}
          onOpen={(path) => void open(path)}
          onClose={() => setQuickOpen(false)}
        />
      )}
      {formatter && document && (
        <Suspense fallback={null}>
          <FormatPhp
            project={project}
            root={root}
            path={document.path}
            onClose={() => setFormatter(false)}
            onFormat={async (options) => {
              setFileBusy(true);
              try {
                if (!(await autosave.current?.flush(document.path)))
                  throw new Error(
                    "Resolve failed Code saves before formatting.",
                  );
                const current = documentsRef.current.find(
                  (item) => item.path === document.path,
                );
                if (!current) throw new Error("The file was closed");
                const formatted = await invoke<string>("format_php_file", {
                  projectId: project.id,
                  root,
                  path: current.path,
                  expected: current.saved,
                  options,
                });
                updateDocuments((items) =>
                  items.map((item) =>
                    item.path === current.path
                      ? { ...item, text: formatted, saved: formatted }
                      : item,
                  ),
                );
                autosave.current?.forget(current.path);
                stamps.current.delete(current.path);
              } finally {
                setFileBusy(false);
              }
            }}
          />
        </Suspense>
      )}
      {!!recoveredDrafts.length && (
        <div className="recovery-banner" role="status">
          <strong>Recovered Code drafts</strong>
          <span>
            {recoveredDrafts.length} unsaved file(s) from the previous session.
            Review before restoring.
          </span>
          {recoveredDrafts.map((draft) => (
            <div key={draft.path}>
              <span title={draft.path}>{filename(draft.path)}</span>
              <button
                onClick={() => {
                  setRecoveryReview(draft);
                }}
              >
                Review
              </button>
              <button onClick={() => void restoreDraft(draft)}>Restore</button>
              <button
                onClick={async () => {
                  if (
                    await confirmAction(
                      `Discard the recovery draft for ${filename(draft.path)}?`,
                    )
                  )
                    setRecoveredDrafts((previous) =>
                      previous.filter((item) => item.path !== draft.path),
                    );
                }}
              >
                Discard
              </button>
            </div>
          ))}
        </div>
      )}
      {recoveryReview && (
        <div className="code-modal-backdrop">
          <section
            className="code-review-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Review recovered draft"
          >
            <header>
              <strong>
                Last saved baseline (left) / recovered draft (right) ·{" "}
                {filename(recoveryReview.path)}
              </strong>
              <button
                aria-label="Close recovery review"
                onClick={() => setRecoveryReview(null)}
              >
                <X size={17} />
              </button>
            </header>
            <ReadOnlyDiff
              before={recoveryReview.saved}
              after={recoveryReview.text}
              path={recoveryReview.path}
            />
            <footer>
              <button
                onClick={() => {
                  void restoreDraft(recoveryReview);
                  setRecoveryReview(null);
                }}
              >
                Restore recovered draft
              </button>
            </footer>
          </section>
        </div>
      )}
      {filePrompt && (
        <div className="code-modal-backdrop">
          <form
            className="file-operation-modal"
            onSubmit={(event) => void mutateFiles(event)}
            role="dialog"
            aria-modal="true"
            aria-label="File operation"
          >
            <header>
              <strong>{filePrompt.action.replaceAll("-", " ")}</strong>
              <button
                type="button"
                aria-label="Cancel file operation"
                disabled={fileBusy}
                onClick={() => setFilePrompt(null)}
              >
                <X size={17} />
              </button>
            </header>
            <p>{filePrompt.path}</p>
            {filePrompt.action === "delete" ? (
              <p>
                Delete this {filePrompt.directory ? "empty folder" : "file"}{" "}
                permanently? Source files are not moved to Trash.
              </p>
            ) : (
              <label>
                Name or relative destination
                <input
                  aria-label="File name or destination"
                  autoFocus
                  value={filePrompt.name}
                  onChange={(event) =>
                    setFilePrompt({ ...filePrompt, name: event.target.value })
                  }
                />
              </label>
            )}
            <footer>
              <button
                type="button"
                disabled={fileBusy}
                onClick={() => setFilePrompt(null)}
              >
                Cancel
              </button>
              <button
                className="primary-button"
                disabled={
                  fileBusy ||
                  (!filePrompt.name && filePrompt.action !== "delete")
                }
                type="submit"
              >
                {fileBusy
                  ? "Working…"
                  : filePrompt.action === "delete"
                    ? "Delete permanently"
                    : "Apply"}
              </button>
            </footer>
          </form>
        </div>
      )}
      {comparison && (
        <div className="code-modal-backdrop">
          <section
            className="code-review-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Compare external changes"
          >
            <header>
              <strong>
                Disk (left) / editor (right) · {filename(comparison)}
              </strong>
              <button
                aria-label="Close comparison"
                onClick={() => setComparison("")}
              >
                <X size={17} />
              </button>
            </header>
            <ReadOnlyDiff
              before={external[comparison]?.content ?? ""}
              after={
                documents.find((item) => item.path === comparison)?.text ?? ""
              }
              path={comparison}
            />
            <footer>
              <button
                disabled={fileBusy}
                onClick={() => void diskAction(false)}
              >
                Reload from disk
              </button>
              <button
                className="secondary-button"
                disabled={fileBusy}
                onClick={() => void diskAction(true)}
              >
                Keep editor version on disk
              </button>
            </footer>
          </section>
        </div>
      )}
      {targets && (
        <div className="code-modal-backdrop">
          <section
            className="navigation-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Navigation targets"
          >
            <header>
              <strong>
                {targets.targets.length
                  ? "Choose a declaration"
                  : "No declaration found"}
              </strong>
              <button
                aria-label="Close navigation"
                onClick={() => setTargets(null)}
              >
                <X size={17} />
              </button>
            </header>
            <p className="git-help">
              Finds declarations and relative file references in project source.
              Dynamic calls and dependency symbols may require Search.
            </p>
            {targets.truncated && (
              <p>Search limit reached. Narrow the project or use Search.</p>
            )}
            {targets.targets.map((item) => (
              <button
                className="navigation-result"
                key={`${item.path}:${item.line}`}
                onClick={() => {
                  void open(item.path, item.line);
                  setTargets(null);
                }}
              >
                <strong>
                  {item.label} · {filename(item.path)}:{item.line}
                </strong>
                <code>{item.preview}</code>
                <small>{item.path}</small>
              </button>
            ))}
          </section>
        </div>
      )}
      {navigationBusy && (
        <span className="navigation-status" role="status">
          Finding declaration…
        </span>
      )}
    </div>
  );
}
