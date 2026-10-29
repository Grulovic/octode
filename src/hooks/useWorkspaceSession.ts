import { useCallback, useEffect, useRef, useState } from "react";
import { loadSession, saveSession } from "../lib/bridge";
import { normalizeSession } from "../lib/workspace";
import type { Project, WorkspaceSession } from "../types";

export function useWorkspaceSession(
  project: Project | null,
  onError: (message: string) => void,
) {
  const [session, setSession] = useState<WorkspaceSession | null>(null);
  const current = useRef<{ id: string; value: WorkspaceSession } | null>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());
  useEffect(() => {
    let disposed = false;
    current.current = null;
    setSession(null);
    if (project)
      void loadSession(project)
        .then((value) => {
          if (!disposed) {
            current.current = { id: project.id, value };
            setSession(value);
          }
        })
        .catch((reason) => {
          if (!disposed) {
            onError(`Could not restore the workspace: ${String(reason)}`);
            const value = normalizeSession(null, project);
            current.current = { id: project.id, value };
            setSession(value);
          }
        });
    return () => {
      disposed = true;
    };
  }, [project, onError]);
  const update = useCallback(
    (patch: Partial<WorkspaceSession>) => {
      if (!project || current.current?.id !== project.id) return;
      const next = normalizeSession(
        { ...current.current.value, ...patch },
        project,
      );
      if (JSON.stringify(next) === JSON.stringify(current.current.value))
        return;
      current.current = { id: project.id, value: next };
      setSession(next);
      const task = queue.current
        .catch(() => {})
        .then(() => saveSession(project, next));
      queue.current = task;
      void task.catch((reason) =>
        onError(`Could not save workspace layout: ${String(reason)}`),
      );
    },
    [project, onError],
  );
  const flush = useCallback(() => queue.current, []);
  return { session, update, flush };
}
