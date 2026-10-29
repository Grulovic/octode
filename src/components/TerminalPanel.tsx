import CustomSelect from "./CustomSelect";
import "./terminal.css";
import { registerTabCloser } from "../lib/closeTab";
import { lazy, Suspense, useState, useRef, useEffect } from "react";
import { Plus, RotateCcw, X, TerminalSquare, Folder, ChevronDown } from "./DesignIcons";
import PanelResize, { usePanelSize } from "./PanelResize";
import { middleClose } from "../lib/middleClose";
import { desktop } from "../lib/bridge";
import { filename } from "../lib/workspace";
import { confirmAction } from "./ToolLayout";
import type { Project } from "../types";
const LocalTerminal = lazy(() =>
  desktop ? import("./LocalTerminal") : import("./PreviewTerminal"),
);
export interface TerminalLaunch {
  id: number;
  root: string;
  command: string;
}
export default function TerminalPanel({
  project,
  initialRoot,
  launchRequest,
  onLaunchHandled,
  visible,
  onError,
  onHide,
  onActivityChange,
}: {
  project: Project;
  initialRoot: string;
  launchRequest?: TerminalLaunch;
  onLaunchHandled?: (id: number) => void;
  visible: boolean;
  onError: (error: string) => void;
  onHide: () => void;
  onActivityChange?: (active: boolean) => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = usePanelSize(
    "octode-layout:terminal-height",
    368,
  );
  const [tabs, setTabs] = useState<
    { id: string; root: string; generation: number; startupCommand?: string }[]
  >(() => [{ id: crypto.randomUUID(), root: initialRoot, generation: 0 }]);
  const [active, setActive] = useState<string>(() => tabs[0].id);
  const [newRoot, setNewRoot] = useState(initialRoot);
  const [statuses, setStatuses] = useState<Record<string, string>>({});
  const [activity, setActivity] = useState<Record<string, boolean>>({});
  const hasOutput = tabs.some((tab) => activity[tab.id]);
  useEffect(() => { onActivityChange?.(hasOutput); }, [hasOutput, onActivityChange]);
  const current = tabs.find((item) => item.id === active);
  const add = () => {
    if (tabs.length >= 6) return;
    const tab = { id: crypto.randomUUID(), root: newRoot, generation: 0 };
    setTabs((previous) => [...previous, tab]);
    setActive(tab.id);
  };
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (
        !(event.metaKey || event.ctrlKey) ||
        event.altKey ||
        event.shiftKey ||
        event.isComposing ||
        event.key.toLowerCase() !== "t" ||
        !visible ||
        (tabs.length > 0 &&
          !panelRef.current?.contains(document.activeElement)) ||
        document.querySelector('[aria-modal="true"]')
      )
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.repeat) return;
      window.dispatchEvent(new Event("octode-dismiss-popovers"));
      if (tabs.length >= 6) {
        onError(
          "All six terminal tabs are in use. Close a tab before opening another.",
        );
        return;
      }
      add();
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  });
  useEffect(() => {
    if (visible && !tabs.length)
      panelRef.current?.focus({ preventScroll: true });
  }, [visible, tabs.length]);
  const handledLaunch = useRef<number | null>(null);
  useEffect(() => {
    if (!launchRequest || handledLaunch.current === launchRequest.id) return;
    handledLaunch.current = launchRequest.id;
    if (tabs.length >= 6)
      onError(
        "All six terminal tabs are in use. Close a tab before launching the command.",
      );
    else if (!project.roots.includes(launchRequest.root))
      onError(
        "Choose an available project folder before launching the terminal command.",
      );
    else {
      const tab = {
        id: crypto.randomUUID(),
        root: launchRequest.root,
        generation: 0,
        startupCommand: launchRequest.command,
      };
      setTabs((previous) => [...previous, tab]);
      setActive(tab.id);
    }
    onLaunchHandled?.(launchRequest.id);
  }, [launchRequest, onLaunchHandled, tabs.length, project, onError]);
  const close = async (id: string) => {
    if (
      !(await confirmAction(
        "Close this terminal and stop its shell? Commands running in it will be interrupted.",
      ))
    )
      return;
    const remaining = tabs.filter((tab) => tab.id !== id);
    setTabs(remaining);
    if (active === id) setActive(remaining.at(-1)?.id ?? "");
  };
  useEffect(() =>
    registerTabCloser({
      priority: 10,
      active: () =>
        visible &&
        !!current &&
        !!panelRef.current?.contains(document.activeElement),
      close: () => close(active),
    }),
  );
  return (
    <div
      className="terminal-panel"
      tabIndex={-1}
      ref={panelRef}
      style={{ display: visible ? "flex" : "none", height }}
    >
      <PanelResize
        target={panelRef}
        size={height}
        axis="y"
        onResize={setHeight}
        label="Resize local terminal"
        className="terminal-resize"
      />
      <div className="terminal-toolbar">
        <span className="terminal-heading"><TerminalSquare size={14} />Terminal</span>
        <div className="local-terminal-tabs">
          {tabs.map((tab, index) => (
            <div
              key={tab.id}
              className={active === tab.id ? "selected" : ""}
              onMouseDown={(event) => {
                if (event.button === 1) event.preventDefault();
              }}
              onMouseUp={(event) =>
                middleClose(event, () => {
                  void close(tab.id);
                })
              }
              onAuxClick={(event) =>
                middleClose(event, () => {
                  void close(tab.id);
                })
              }
            >
              <button title={tab.root} onClick={() => setActive(tab.id)}>
                <span className={`terminal-tab-dot ${activity[tab.id] ? "terminal-output-dot" : ""}`} title={activity[tab.id] ? "New terminal output" : undefined} data-connected={statuses[tab.id] === "Connected"} aria-label={statuses[tab.id] ?? "Starting shell"} />
                <span className="terminal-tab-label">
                  {filename(tab.root)} {index + 1}
                </span>
              </button>
              <button
                aria-label={`Close terminal ${index + 1}`}
                onClick={() => void close(tab.id)}
              >
                <X size={11} />
              </button>
            </div>
          ))}
        </div>
        <button
          className="terminal-add"
          aria-label="New terminal"
          title="New terminal (Cmd/Ctrl+T while terminal is focused; up to six)"
          disabled={tabs.length >= 6}
          onClick={add}
        >
          <Plus size={14} />
        </button>
        <div className="terminal-toolbar-actions">
          <CustomSelect
            aria-label="Folder for new terminal"
            value={newRoot}
            onChange={(event) => setNewRoot(event.target.value)}
            renderLabel={(_path, label) => <span className="terminal-folder-label"><Folder size={12} />{label}</span>}
          >
            {project.roots.map((root) => (
              <option key={root} value={root}>
                {filename(root)}
              </option>
            ))}
          </CustomSelect>
          <button
            title="Restart current terminal"
            aria-label="Restart terminal"
            disabled={!current}
            onClick={async () => {
              if (
                current &&
                (await confirmAction(
                  "Restart this terminal? Commands running in it will be interrupted.",
                ))
              )
                setTabs((previous) =>
                  previous.map((tab) =>
                    tab.id === active
                      ? { ...tab, generation: tab.generation + 1 }
                      : tab,
                  ),
                );
            }}
          >
            <RotateCcw size={13} />
          </button>
          <button aria-label="Hide terminal" title="Hide terminal (Cmd/Ctrl+2)" onClick={onHide}>
            <ChevronDown size={14} />
          </button>
        </div>
      </div>
      {tabs.map((tab) => (
        <div
          key={`${tab.id}:${tab.generation}`}
          className="local-terminal-session"
          style={{ display: active === tab.id ? "flex" : "none" }}
        >
          <Suspense
            fallback={<div className="loading">Preparing terminal…</div>}
          >
            <LocalTerminal
              project={project}
              root={tab.root}
              startupCommand={tab.startupCommand}
              visible={visible && active === tab.id}
              onError={onError}
              onActivityChange={(active) => setActivity((previous) => previous[tab.id] === active ? previous : { ...previous, [tab.id]: active })}
              onStatusChange={(status) => setStatuses((previous) => previous[tab.id] === status ? previous : { ...previous, [tab.id]: status })}
            />
          </Suspense>
        </div>
      ))}
      {!tabs.length && (
        <div className="terminal-empty">
          <span>No terminal sessions.</span>
          <button onClick={add}>Open terminal</button>
        </div>
      )}
    </div>
  );
}
