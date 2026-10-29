import { loadSettings } from "../lib/settings";
import type { TerminalLaunch } from "./TerminalPanel";
import {
  createContext,
  lazy,
  Suspense,
  useContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import type { Project, Tool } from "../types";
const TerminalPanel = lazy(() => import("./TerminalPanel"));
export const WorkspaceTerminalContext = createContext({
  visible: false,
  hasOutput: false,
  active: "code" as Tool,
  toggle: () => {},
  show: () => {},
  launch: () => {},
  host: null as HTMLDivElement | null,
});
export function useProjectTerminal(
  project: Project | null,
  active: Tool,
  root: string,
  workspaceActive = true,
) {
  const [visible, setVisible] = useState(false);
  const [hasOutput, setHasOutput] = useState(false);
  const [visited, visit] = useState(false);
  const [error, setError] = useState("");
  const [launches, setLaunches] = useState<TerminalLaunch[]>([]);
  const launchId = useRef(0);
  const host = useMemo(() => {
    const element = document.createElement("div");
    element.className = "workspace-terminal-host";
    return element;
  }, [project?.id]);
  useEffect(() => {
    setVisible(false);
    setHasOutput(false);
    visit(false);
    setError("");
    setLaunches([]);
    return () => {
      host.remove();
    };
  }, [host]);
  const toggle = useCallback(() => {
    visit(true);
    setVisible((previous) => !previous);
  }, []);
  const show = useCallback(() => {
    visit(true);
    setVisible(true);
  }, []);
  const launch = useCallback(() => {
    if (!project) return;
    visit(true);
    setVisible(true);
    setLaunches((previous) => [
      ...previous,
      { id: ++launchId.current, root, command: loadSettings().terminalCommand },
    ]);
  }, [project?.id, root]);
  const launchHandled = useCallback(
    (id: number) =>
      setLaunches((previous) => previous.filter((item) => item.id !== id)),
    [],
  );
  return {
    value: { visible, hasOutput, active, toggle, show, launch, host },
    portal:
      project && visited
        ? createPortal(
            <Suspense fallback={null}>
              {error && (
                <div className="error-banner" role="alert">
                  <span>{error}</span>
                  <button
                    aria-label="Dismiss terminal error"
                    onClick={() => setError("")}
                  >
                    ×
                  </button>
                </div>
              )}
              <TerminalPanel
                key={project.id}
                project={project}
                initialRoot={root}
                launchRequest={launches[0]}
                onLaunchHandled={launchHandled}
                visible={visible && workspaceActive}
                onActivityChange={setHasOutput}
                onError={setError}
                onHide={() => setVisible(false)}
              />
            </Suspense>,
            host,
          )
        : null,
  };
}
export function TerminalDock() {
  const { host, visible } = useContext(WorkspaceTerminalContext);
  const dock = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (host && dock.current) dock.current.append(host);
  }, [host]);
  return (
    <div
      ref={dock}
      className="workspace-terminal-dock"
      style={{ display: visible ? "flex" : "none" }}
    />
  );
}
