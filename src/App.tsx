import {
  createWorkspaceRuntime,
  type WorkspaceRuntime,
} from "./lib/workspaceRegistry";
import { installTerminalShortcut } from "./lib/terminalShortcut";
import { installCloseTabShortcut } from "./lib/closeTab";
import { installDoubleShift } from "./lib/doubleShift";
import type { SearchEntry } from "./lib/searchEverywhere";
import { installCaseShortcut } from "./lib/textCase";
import { prepareRestart } from "./lib/restart";
import { waitForPendingToolSaves } from "./lib/toolSaves";
import {
  Fragment,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  RotateCcw,
  ArrowDownUp,
  ArrowRight,
  Code2,
  Database,
  Folder,
  FolderOpen,
  Grid2X2,
  Keyboard,
  Plus,
  Pencil,
  Settings2,
  Search,
  Server,
  TerminalSquare,
  X,
} from "lucide-react";
import {
  createProject,
  desktop,
  invoke,
  listProjects,
  previewProject,
} from "./lib/bridge";
import { projectColors, projectColor } from "./lib/projectColors";
import {
  useProjectTerminal,
  WorkspaceTerminalContext,
} from "./components/WorkspaceTerminal";
import { filename, filterProjects } from "./lib/workspace";
import type { Project, Tool } from "./types";
import { useWorkspaceSession } from "./hooks/useWorkspaceSession";

const SearchEverywhere = lazy(() => import("./components/SearchEverywhere"));
const SettingsModal = lazy(() => import("./components/SettingsModal"));
const ApiWorkspace = lazy(() => import("./components/ApiWorkspace"));
const ServersWorkspace = lazy(() => import("./components/ServersWorkspace"));
const DatabaseWorkspace = lazy(() => import("./components/DatabaseWorkspace"));
const CodeWorkspace = lazy(() => import("./components/CodeWorkspace"));
const tools = [
  {
    id: "code",
    title: "Code",
    subtitle: "A clear space to build.",
    description: "Your files, editor, Git, and local terminal.",
    icon: Code2,
    color: "mint",
    number: 1,
  },
  {
    id: "servers",
    title: "Servers",
    subtitle: "A little closer to remote.",
    description: "SSH connections and file transfers.",
    icon: Server,
    color: "blue",
    number: 3,
  },
  {
    id: "database",
    title: "Database",
    subtitle: "Make sense of your data.",
    description: "Tables, queries, and database connections.",
    icon: Database,
    color: "amber",
    number: 4,
  },
  {
    id: "api",
    title: "API",
    subtitle: "From request to response.",
    description: "Your endpoints, headers, and environments.",
    icon: ArrowDownUp,
    color: "purple",
    number: 5,
  },
] as const;
const modifier = navigator.platform.toLowerCase().includes("mac")
  ? "⌘"
  : "Ctrl";

export default function App() {
  useEffect(installCaseShortcut, []);
  useEffect(installCloseTabShortcut, []);
  const surface = useRef<HTMLDivElement>(null);
  const [slots, setSlots] = useState(() => [
    {
      key: "dashboard",
      project: null as Project | null,
      host: document.createElement("div"),
    },
  ]);
  const [activeKey, setActiveKey] = useState("dashboard");
  const runtime = useMemo(createWorkspaceRuntime, []);
  const open = useCallback((project: Project) => {
    setSlots((previous) =>
      previous.some((slot) => slot.key === project.id)
        ? previous
        : [
            ...previous,
            { key: project.id, project, host: document.createElement("div") },
          ],
    );
    setActiveKey(project.id);
  }, []);
  const projects = useCallback(() => setActiveKey("dashboard"), []);
  const projectChanged = useCallback((next: Project) => {
    setSlots((previous) =>
      previous.flatMap((slot) => {
        if (slot.key !== next.id) return [slot];
        // Editing roots explicitly resets that workspace; metadata preserves it.
        if (JSON.stringify(slot.project?.roots) !== JSON.stringify(next.roots))
          return [];
        return [{ ...slot, project: next }];
      }),
    );
  }, []);
  const projectRemoved = useCallback(
    (id: string) =>
      setSlots((previous) => previous.filter((slot) => slot.key !== id)),
    [],
  );

  useLayoutEffect(() => {
    const host = slots.find((slot) => slot.key === activeKey)?.host;
    // Detaching a portal host preserves React instances, editor models and PTYs.
    if (host && surface.current && surface.current.firstChild !== host)
      surface.current.replaceChildren(host);
  }, [activeKey, slots]);
  return (
    <>
      <div className="workspace-surface" ref={surface} />
      {slots.map((slot) =>
        createPortal(
          <WorkspaceApp
            initialProject={slot.project}
            active={slot.key === activeKey}
            onOpenProject={open}
            onProjects={projects}
            onProjectChanged={projectChanged}
            onProjectRemoved={projectRemoved}
            runtime={runtime}
          />,
          slot.host,
          slot.key,
        ),
      )}
    </>
  );
}
function WorkspaceApp({
  initialProject,
  active,
  onOpenProject,
  onProjects,
  onProjectChanged,
  onProjectRemoved,
  runtime,
}: {
  initialProject: Project | null;
  active: boolean;
  onOpenProject: (project: Project) => void;
  onProjects: () => void;
  onProjectChanged: (project: Project) => void;
  onProjectRemoved: (id: string) => void;
  runtime: WorkspaceRuntime;
}) {
  const [projects, setProjects] = useState<Project[]>([]);
  const projectRoots = JSON.stringify(initialProject?.roots);
  const project = useMemo(
    () => initialProject,
    [initialProject?.id, projectRoots],
  );
  const [everywhere, setEverywhere] = useState(false);
  const [searchTarget, setSearchTarget] = useState<SearchEntry>();
  useEffect(() => {
    setEverywhere(false);
    setSearchTarget(undefined);
    if (!active || !project) return;
    return installDoubleShift(
      window,
      () => {
        window.dispatchEvent(new Event("octode-dismiss-popovers"));
        setEverywhere(true);
      },
      () => !!document.querySelector('[aria-modal="true"]'),
    );
  }, [project, active]);
  const [tool, setTool] = useState<Tool>("home");
  const [codeVisited, setCodeVisited] = useState(false);
  const [codeFilesRequest, setCodeFilesRequest] = useState(0);
  const [visited, setVisited] = useState({
    api: false,
    servers: false,
    database: false,
  });
  const [unsaved, setUnsaved] = useState({
    code: false,
    api: false,
    servers: false,
    database: false,
  });
  const updateUnsaved = useCallback(
    (section: keyof typeof unsaved, value: boolean) => {
      setUnsaved((previous) =>
        previous[section] === value
          ? previous
          : { ...previous, [section]: value },
      );
    },
    [],
  );
  const manualDirty = useRef({ api: false, servers: false, database: false });
  const apiDirty = useCallback(
    (value: boolean) => {
      manualDirty.current.api = value;
      updateUnsaved("api", value);
    },
    [updateUnsaved],
  );
  const serversDirty = useCallback(
    (value: boolean) => {
      manualDirty.current.servers = value;
      updateUnsaved("servers", value);
    },
    [updateUnsaved],
  );
  const databaseDirty = useCallback(
    (value: boolean) => {
      manualDirty.current.database = value;
      updateUnsaved("database", value);
    },
    [updateUnsaved],
  );
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [editingProject, setEditingProject] = useState<string | null>(null);
  const [settings, setSettings] = useState(false);
  const [palette, setPalette] = useState(false);
  const [commandQuery, setCommandQuery] = useState("");
  const [name, setName] = useState("");
  const [roots, setRoots] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [toolErrors, setToolErrors] = useState<Record<string, string>>({});
  const codeError = useCallback(
    (message: string) =>
      setToolErrors((previous) => ({ ...previous, code: message })),
    [],
  );
  const serverError = useCallback(
    (message: string) =>
      setToolErrors((previous) => ({ ...previous, servers: message })),
    [],
  );
  const databaseError = useCallback(
    (message: string) =>
      setToolErrors((previous) => ({ ...previous, database: message })),
    [],
  );
  const apiError = useCallback(
    (message: string) =>
      setToolErrors((previous) => ({ ...previous, api: message })),
    [],
  );
  const [color, setColor] = useState<string>(projectColors[0][1]);
  const [busy, setBusy] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const restartPending = useRef(false);
  const [shortcuts, setShortcuts] = useState(false);
  const dirty = useRef(false);
  const codeAutosave = useRef<(() => Promise<boolean>) | null>(null);
  const onAutosaveReady = useCallback(
    (flush: (() => Promise<boolean>) | null) => {
      codeAutosave.current = flush;
    },
    [],
  );
  const {
    session,
    update: updateSession,
    flush: flushSession,
  } = useWorkspaceSession(project, setError);
  const terminal = useProjectTerminal(
    project,
    tool,
    session?.activeRoot ?? project?.roots[0] ?? "",
    active,
  );
  useEffect(() => {
    if (!project) return;
    return runtime.register(project.id, {
      saveCode: async () =>
        codeAutosave.current ? codeAutosave.current() : !dirty.current,
      flushLayout: flushSession,
      hasUnsavedSettings: () =>
        Object.values(manualDirty.current).some(Boolean),
    });
  }, [project, flushSession, runtime]);
  useEffect(() => {
    if (active && !project)
      void listProjects()
        .then(setProjects)
        .catch((reason) => setError(String(reason)));
  }, [active, project]);
  const restoredSection = useRef(false);
  useEffect(() => {
    if (!session || restoredSection.current || !project) return;
    restoredSection.current = true;
    const next = session.tool === "home" ? "code" : session.tool;
    setTool(next);
    if (next !== "code")
      setVisited((previous) => ({ ...previous, [next]: true }));
  }, [session, project]);
  const activeError = error || (project ? toolErrors[tool] : "");
  const onDirtyChange = useCallback(
    (value: boolean) => {
      dirty.current = value;
      updateUnsaved("code", value);
    },
    [updateUnsaved],
  );
  useEffect(() => {
    setCodeVisited(false);
    setVisited({ api: false, servers: false, database: false });
    manualDirty.current = { api: false, servers: false, database: false };
    setUnsaved({ code: false, api: false, servers: false, database: false });
    dirty.current = false;
    setTool(project ? "code" : "home");
    setToolErrors({});
    setError("");
    if (project) setCodeVisited(true);
  }, [project]);
  useEffect(() => {
    if (!desktop || !active) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void import("@tauri-apps/api/window")
      .then(async ({ getCurrentWindow }) => {
        const current = getCurrentWindow();
        const stop = await current.onCloseRequested(async (event) => {
          event.preventDefault();
          try {
            const saved = await runtime.saveAllCode();
            if (!(await waitForPendingToolSaves())) {
              setError(
                "A settings save failed. This window will stay open so you can retry.",
              );
              return;
            }
            if (!saved || runtime.hasUnsavedSettings()) {
              const { confirm } = await import("@tauri-apps/plugin-dialog");
              if (
                !(await confirm(
                  "Discard unsaved Server, Database, or API settings and pending database row edits in open projects, and close Octode? Code recovery drafts are kept when backup succeeds.",
                  { title: "Unsaved changes", kind: "warning" },
                ))
              )
                return;
            }
            await runtime.flushAllLayouts();
            await current.destroy();
          } catch (reason) {
            setError(`Could not close the workspace: ${String(reason)}`);
          }
        });
        if (disposed) stop();
        else unlisten = stop;
      })
      .catch((reason) => setError(String(reason)));
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [active, runtime]);

  useEffect(() => {
    listProjects()
      .then(async (items) => {
        setProjects(items);
        if (initialProject) return;
        const restartState = desktop
          ? await invoke<{ projectId: string | null } | null>(
              "take_restart_state",
            )
          : null;
        const previous = restartState
          ? restartState.projectId
          : localStorage.getItem("octode-active-project");
        const restore = desktop
          ? items.find((item) => item.id === previous)
          : undefined;
        if (restore) void openProject(restore);
      })
      .catch((reason) => setError(String(reason)));
  }, []);
  useEffect(
    () =>
      installTerminalShortcut(
        window,
        terminal.value.toggle,
        terminal.value.launch,
        () =>
          active && !!project && !document.querySelector('[aria-modal="true"]'),
      ),
    [project, active, terminal.value.toggle, terminal.value.launch],
  );
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!active) return;
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key.toLowerCase() === "p" && event.shiftKey) {
        event.preventDefault();
        event.stopImmediatePropagation();
        setPalette((value) => !value);
        setCommandQuery("");
        return;
      }
      if (event.key === ",") {
        event.preventDefault();
        setSettings(true);
        return;
      }
      if (!project) return;
      const destination = tools.find(
        (item) => item.number === Number(event.key),
      );
      if (destination) {
        event.preventDefault();
        setTool(destination.id);
        updateSession({ tool: destination.id });
        if (destination.id === "code") {
          setCodeVisited(true);
          setCodeFilesRequest((value) => value + 1);
        }
      }
      if (event.key === "0") {
        event.preventDefault();
        void leaveProject().catch((reason) => setError(String(reason)));
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [project, active, updateSession, terminal.value.toggle]);

  useEffect(() => {
    if (tool === "api" || tool === "servers" || tool === "database")
      setVisited((previous) => ({ ...previous, [tool]: true }));
  }, [tool]);
  const navigate = (next: Tool) => {
    setTool(next);
    updateSession({ tool: next });
    if (next === "code") setCodeVisited(true);
  };
  const leaveProject = async () => {
    // Switching parks the live workspace. Nothing is discarded or disconnected.
    if (codeAutosave.current) await codeAutosave.current();
    await flushSession();
    localStorage.removeItem("octode-active-project");
    setEverywhere(false);
    window.dispatchEvent(new Event("octode-dismiss-popovers"));
    onProjects();
  };
  const restartApp = async () => {
    if (!desktop || restartPending.current) return;
    restartPending.current = true;
    setRestarting(true);
    try {
      const ready = await prepareRestart({
        saveCode: runtime.saveAllCode,
        waitForSaves: waitForPendingToolSaves,
        hasUnsavedSettings: runtime.hasUnsavedSettings,
        confirmDiscard: async () =>
          (await import("./components/ToolLayout")).confirmAction(
            "Discard unsaved Server, Database, or API settings and pending database row edits in open projects, and restart Octode?",
          ),
        flushLayout: runtime.flushAllLayouts,
      });
      if (ready)
        await invoke("restart_app", { projectId: project?.id ?? null });
    } catch (reason) {
      setError(`Could not restart: ${String(reason)}`);
    } finally {
      restartPending.current = false;
      setRestarting(false);
    }
  };
  const openProject = async (next: Project) => {
    try {
      if (desktop) await invoke("activate_project", { projectId: next.id });
      localStorage.setItem("octode-active-project", next.id);
      onOpenProject(next);
    } catch (reason) {
      setError(String(reason));
    }
  };
  const chooseFolder = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        directory: true,
        multiple: true,
        title: "Add project folders",
      });
      if (selected) {
        const paths = Array.isArray(selected) ? selected : [selected];
        setRoots((previous) => [...new Set([...previous, ...paths])]);
        if (!name) setName(filename(paths[0]));
      }
    } catch (reason) {
      setError(String(reason));
    }
  };
  const saveProject = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const next = editingProject
        ? await invoke<Project>("update_project", {
            projectId: editingProject,
            name: name.trim(),
            roots,
            color,
          })
        : await createProject(name.trim(), roots, color);
      if (editingProject) onProjectChanged(next);
      setProjects(await listProjects());
      setCreating(false);
      setName("");
      setRoots([]);
      if (!editingProject) await openProject(next);
      setEditingProject(null);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <WorkspaceTerminalContext.Provider value={terminal.value}>
      <div
        className={`app-shell ${desktop && navigator.platform.toLowerCase().includes("mac") ? "native-mac" : ""}`}
      >
        <header className="titlebar" data-tauri-drag-region>
          <div className="brand-navigation">
            <div className="brand">
              <span className="brand-mark">
                <img src="/octode.svg" width={32} height={32} alt="" />
              </span>
              <span>
                octode<span className="brand-dot">.</span>
              </span>
            </div>
            <nav className="project-breadcrumb" aria-label="Project breadcrumb">
              <button
                className="projects-navigation"
                aria-label="Back to projects"
                aria-current={!project ? "page" : undefined}
                onClick={() => {
                  if (project)
                    void leaveProject().catch((reason) =>
                      setError(String(reason)),
                    );
                }}
              >
                <Grid2X2 size={14} />
                Projects
              </button>
              {project && (
                <>
                  <span className="project-nav-separator" aria-hidden="true">
                    /
                  </span>
                  <button
                    className="project-nav-name"
                    title={initialProject?.name ?? project.name}
                    aria-label="Project home"
                    aria-current={tool === "home" ? "page" : undefined}
                    onClick={() => navigate("code")}
                    style={{
                      color: projectColor(
                        initialProject?.color ?? project.color,
                      ),
                    }}
                  >
                    {initialProject?.name ?? project.name}
                  </button>
                  {tool !== "home" && (
                    <>
                      <span
                        className="project-nav-separator"
                        aria-hidden="true"
                      >
                        /
                      </span>
                      <span className="project-nav-tool" aria-current="page">
                        {tools.find((item) => item.id === tool)?.title}
                      </span>
                    </>
                  )}
                </>
              )}
            </nav>
          </div>
          <div
            className="window-drag-space"
            data-tauri-drag-region
            onMouseDown={(event) => {
              if (desktop && event.button === 0 && event.detail !== 2) {
                void import("@tauri-apps/api/window")
                  .then(({ getCurrentWindow }) =>
                    getCurrentWindow().startDragging(),
                  )
                  .catch((reason) => setError(String(reason)));
              }
            }}
          />
        </header>
        <div className="app-body">
          <nav className="rail" aria-label="Main navigation">
            <button
              className={
                !project || tool === "home"
                  ? "rail-button active"
                  : "rail-button"
              }
              title="Workspace home"
              aria-label="Workspace home"
              onClick={() => {
                if (project)
                  void leaveProject().catch((reason) =>
                    setError(String(reason)),
                  );
              }}
            >
              <Grid2X2 size={20} />
            </button>
            <div className="rail-divider" />
            {tools.map((item) => (
              <Fragment key={item.id}>
                <button
                  disabled={!project}
                  aria-label={item.title}
                  aria-describedby={
                    project && unsaved[item.id]
                      ? `rail-unsaved-${item.id}`
                      : undefined
                  }
                  title={`${item.title} (${modifier}${item.number})`}
                  className={`rail-button ${tool === item.id && project ? "active" : ""}`}
                  onClick={() => navigate(item.id)}
                >
                  <span className="rail-icon-box">
                    <item.icon size={20} />
                    {project && unsaved[item.id] && (
                      <span
                        id={`rail-unsaved-${item.id}`}
                        className="rail-unsaved-dot"
                        role="img"
                        aria-label="Unsaved changes"
                        title="Unsaved changes"
                      />
                    )}
                  </span>
                </button>
                {item.id === "code" && (
                  <button
                    className={`rail-button ${terminal.value.visible ? "active" : ""}`}
                    disabled={!project}
                    aria-label="Local terminal"
                    title={`Local terminal (${modifier}2)`}
                    onClick={terminal.value.toggle}
                  >
                    <span className="rail-icon-box">
                      <TerminalSquare size={20} />
                    </span>
                  </button>
                )}
              </Fragment>
            ))}
            <div className="rail-bottom">
              <button
                className="rail-button"
                title="Settings (Cmd/Ctrl+,)"
                aria-label="Settings"
                onClick={() => setSettings(true)}
              >
                <Settings2 size={18} />
              </button>
              <button
                className="rail-button"
                title="Keyboard shortcuts"
                aria-label="Keyboard shortcuts"
                onClick={() => setShortcuts(true)}
              >
                <Keyboard size={19} />
              </button>
            </div>
          </nav>
          <main
            className={
              project && tool !== "home" ? "main-workspace" : "main-home"
            }
          >
            {activeError && (
              <div role="alert" className="error-banner">
                <span>{activeError}</span>
                <button
                  aria-label="Dismiss error"
                  onClick={() => {
                    if (error) setError("");
                    else
                      setToolErrors((previous) => ({
                        ...previous,
                        [tool]: "",
                      }));
                  }}
                >
                  <X size={16} />
                </button>
              </div>
            )}
            {!project ? (
              <div className="dashboard">
                <div className="section-toolbar">
                  <div className="section-label">
                    Projects <span className="count">{projects.length}</span>
                  </div>
                  <div className="toolbar-actions">
                    <label className="search">
                      <Search size={15} />
                      <input
                        aria-label="Find a project"
                        placeholder="Find a project…"
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                      />
                    </label>
                    <button
                      className="primary-button"
                      aria-label="New project"
                      onClick={() => {
                        if (desktop) {
                          setEditingProject(null);
                          setName("");
                          setColor(projectColors[0][1]);
                          setRoots([]);
                          setCreating(true);
                        } else void openProject(previewProject);
                      }}
                    >
                      <Plus size={16} /> New project
                    </button>
                  </div>
                </div>
                <div className="projects-grid">
                  {filterProjects(projects, query).map((item) => (
                    <div className="project-card-wrapper" key={item.id}>
                      <button
                        className="project-card"
                        style={
                          {
                            "--project-color": projectColor(item.color),
                          } as React.CSSProperties
                        }
                        onClick={() => void openProject(item)}
                      >
                        <span className="project-icon">
                          <FolderOpen size={24} />
                        </span>
                        <ArrowRight className="card-arrow" size={18} />
                        <h3>{item.name}</h3>
                        <span className="project-path">{item.roots[0]}</span>
                        <div className="project-card-footer">
                          <span>
                            {item.roots.length}{" "}
                            {item.roots.length === 1 ? "folder" : "folders"}
                          </span>
                          <span>Open workspace →</span>
                        </div>
                      </button>
                      <button
                        className="edit-project-button"
                        aria-label={`Edit project ${item.name}`}
                        title="Edit project"
                        onClick={() => {
                          setEditingProject(item.id);
                          setName(item.name);
                          setColor(projectColor(item.color));
                          setRoots(item.roots);
                          setCreating(true);
                        }}
                      >
                        <Pencil size={14} />
                      </button>
                    </div>
                  ))}
                </div>
                {query && !filterProjects(projects, query).length && (
                  <div className="empty-search">
                    No projects match “{query}”.
                  </div>
                )}
              </div>
            ) : !session ? (
              <div className="loading">Opening workspace…</div>
            ) : (
              <>
                {codeVisited && (
                  <div
                    className="code-container"
                    style={{ display: tool === "code" ? "flex" : "none" }}
                  >
                    <Suspense
                      fallback={
                        <div className="loading">Preparing your editor…</div>
                      }
                    >
                      <CodeWorkspace
                        project={project}
                        filesRequest={codeFilesRequest}
                        searchTarget={searchTarget}
                        onSearch={() => {
                          window.dispatchEvent(
                            new Event("octode-dismiss-popovers"),
                          );
                          setEverywhere(true);
                        }}
                        initialSession={session}
                        onSessionChange={updateSession}
                        onDirtyChange={onDirtyChange}
                        onAutosaveReady={onAutosaveReady}
                        visible={active && tool === "code"}
                        onError={codeError}
                      />
                    </Suspense>
                  </div>
                )}
                {visited.api && (
                  <div
                    className="code-container"
                    style={{ display: tool === "api" ? "flex" : "none" }}
                  >
                    <Suspense
                      fallback={<div className="loading">Opening API…</div>}
                    >
                      <ApiWorkspace
                        searchTarget={searchTarget}
                        project={project}
                        visible={active && tool === "api"}
                        onError={apiError}
                        onDirty={apiDirty}
                      />
                    </Suspense>
                  </div>
                )}
                {visited.servers && (
                  <div
                    className="code-container"
                    style={{ display: tool === "servers" ? "flex" : "none" }}
                  >
                    <Suspense
                      fallback={<div className="loading">Opening Servers…</div>}
                    >
                      <ServersWorkspace
                        searchTarget={searchTarget}
                        project={project}
                        visible={active && tool === "servers"}
                        onError={serverError}
                        onDirty={serversDirty}
                      />
                    </Suspense>
                  </div>
                )}
                {visited.database && (
                  <div
                    className="code-container"
                    style={{ display: tool === "database" ? "flex" : "none" }}
                  >
                    <Suspense
                      fallback={
                        <div className="loading">Opening Database…</div>
                      }
                    >
                      <DatabaseWorkspace
                        searchTarget={searchTarget}
                        project={project}
                        visible={active && tool === "database"}
                        onError={databaseError}
                        onDirty={databaseDirty}
                      />
                    </Suspense>
                  </div>
                )}
              </>
            )}
          </main>
        </div>
        {project && everywhere && (
          <Suspense fallback={null}>
            <SearchEverywhere
              project={project}
              onClose={() => setEverywhere(false)}
              onOpen={(entry) => {
                setSearchTarget({ ...entry });
                navigate(entry.target?.tool ?? "code");
              }}
            />
          </Suspense>
        )}
        <footer className="statusbar">
          <span>
            <button
              className="footer-restart"
              aria-label="Restart app"
              disabled={!desktop || restarting}
              title={
                desktop
                  ? "Restart Octode to load the latest build"
                  : "Available in the desktop app"
              }
              onClick={() => void restartApp()}
            >
              <RotateCcw size={12} />
              {restarting ? "Restarting…" : "Restart"}
            </button>
            {!desktop && "Browser preview"}
          </span>
          <span>
            Octode <span className="muted">/</span> a calmer place to build
          </span>
          <span>v0.1.0</span>
        </footer>
        {settings && (
          <Suspense fallback={null}>
            <SettingsModal onClose={() => setSettings(false)} />
          </Suspense>
        )}
        {palette && (
          <div className="modal-backdrop" onClick={() => setPalette(false)}>
            <section
              className="modal command-palette"
              role="dialog"
              aria-modal="true"
              aria-label="Command palette"
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => {
                if (event.key === "Escape") setPalette(false);
              }}
            >
              <input
                aria-label="Find a command"
                placeholder="Find a command…"
                autoFocus
                value={commandQuery}
                onChange={(event) => setCommandQuery(event.target.value)}
              />
              {[
                ...tools.map((item) => ({
                  label: `Open ${item.title}`,
                  disabled: !project,
                  run: () => navigate(item.id),
                })),
                {
                  label: "Code",
                  disabled: !project,
                  run: () => navigate("code"),
                },
                {
                  label: "Projects",
                  disabled: false,
                  run: () => {
                    void leaveProject().catch((reason) =>
                      setError(String(reason)),
                    );
                  },
                },
                {
                  label: "Settings",
                  disabled: false,
                  run: () => setSettings(true),
                },
                {
                  label: "Keyboard shortcuts",
                  disabled: false,
                  run: () => setShortcuts(true),
                },
              ]
                .filter((command) =>
                  command.label
                    .toLowerCase()
                    .includes(commandQuery.toLowerCase()),
                )
                .map((command) => (
                  <button
                    key={command.label}
                    disabled={command.disabled}
                    onClick={() => {
                      setPalette(false);
                      command.run();
                    }}
                  >
                    {command.label}
                  </button>
                ))}
            </section>
          </div>
        )}
        {creating && (
          <div className="modal-backdrop" onClick={() => setCreating(false)}>
            <form
              className="modal"
              onSubmit={(event) => void saveProject(event)}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="modal-heading">
                <span className="project-icon">
                  <FolderOpen size={24} />
                </span>
                <button
                  type="button"
                  aria-label="Close"
                  onClick={() => setCreating(false)}
                >
                  <X size={20} />
                </button>
              </div>
              <h2>
                {editingProject ? "Edit project" : "A new place to build."}
              </h2>
              <p>Group your code folders into one workspace.</p>
              <label className="field-label">
                Project name
                <input
                  autoFocus
                  required
                  maxLength={100}
                  placeholder="My next idea"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
              <span className="field-label">Project color</span>
              <div
                className="project-colors"
                role="group"
                aria-label="Project color"
              >
                {projectColors.map(([label, value]) => (
                  <button
                    key={value}
                    type="button"
                    title={label}
                    aria-label={label}
                    aria-pressed={color === value}
                    style={{ "--project-color": value } as React.CSSProperties}
                    onClick={() => setColor(value)}
                  />
                ))}
              </div>
              <label className="field-label">Folders</label>
              <div className="root-list">
                {roots.map((root) => (
                  <div key={root}>
                    <Folder size={15} />
                    <span>{root}</span>
                    <button
                      type="button"
                      aria-label={`Remove ${root}`}
                      onClick={() =>
                        setRoots((previous) =>
                          previous.filter((item) => item !== root),
                        )
                      }
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
              <button
                type="button"
                className="secondary-button folder-picker"
                onClick={() => void chooseFolder()}
              >
                <Plus size={16} /> Add folders
              </button>
              {editingProject && (
                <>
                  <p className="service-hint">
                    Folder changes reset the saved file layout and close this
                    project's parked workspace. Source folders stay on disk.
                  </p>
                  <button
                    className="danger-action"
                    type="button"
                    disabled={busy}
                    onClick={async () => {
                      const { confirmAction } = await import(
                        "./components/ToolLayout"
                      );
                      if (
                        !(await confirmAction(
                          "Remove this project and its saved connections, requests, and Code recovery drafts from Octode? Its open terminals and connections will close. Source files and folders will stay on disk.",
                        ))
                      )
                        return;
                      try {
                        setBusy(true);
                        await invoke("remove_project", {
                          projectId: editingProject,
                        });
                        onProjectRemoved(editingProject);
                        setProjects(await listProjects());
                        setCreating(false);
                        setEditingProject(null);
                      } catch (reason) {
                        setError(String(reason));
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Remove project from Octode…
                  </button>
                </>
              )}
              <div className="modal-footer">
                <button
                  type="button"
                  className="text-button"
                  onClick={() => setCreating(false)}
                >
                  Cancel
                </button>
                <button
                  disabled={busy || !name.trim() || !roots.length}
                  className="primary-button"
                >
                  {busy
                    ? "Saving…"
                    : editingProject
                      ? "Save project"
                      : "Create project"}{" "}
                  <ArrowRight size={15} />
                </button>
              </div>
            </form>
          </div>
        )}
        {shortcuts && (
          <div className="modal-backdrop" onClick={() => setShortcuts(false)}>
            <section
              role="dialog"
              aria-modal="true"
              aria-label="Keyboard shortcuts"
              className="modal shortcut-modal"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="modal-heading">
                <Keyboard size={25} />
                <button aria-label="Close" onClick={() => setShortcuts(false)}>
                  <X size={20} />
                </button>
              </div>
              <h2>Keep your hands on the keys.</h2>
              {[
                ["Projects", "0"],
                ["Local terminal", "2"],
                ...tools.map((item) => [item.title, String(item.number)]),
                ["Save Code immediately", "S"],
                ["Cycle selected text case", "Option Shift U"],
                ["Find in file", "F"],
                ["Quick open file", "P"],
                ["Search project", "Shift F"],
                ["Search all sections", "Shift Shift"],
                ["Close active tab", "W"],
                ["New tab in focused terminal", "T"],
                ["Run terminal launch command", "2 2"],
              ].map(([title, key]) => (
                <div className="shortcut-row" key={title}>
                  <span>{title}</span>
                  <kbd>
                    {key === "Shift Shift"
                      ? "Shift ⇧ Shift"
                      : key === "Option Shift U"
                        ? navigator.platform.toLowerCase().includes("mac")
                          ? "⌥ ⇧ U"
                          : "Alt Shift U"
                        : `${modifier} ${key}`}
                  </kbd>
                </div>
              ))}
            </section>
          </div>
        )}
      </div>
      {terminal.portal}
    </WorkspaceTerminalContext.Provider>
  );
}
