export interface WorkspaceHandle {
  saveCode: () => Promise<boolean>;
  flushLayout: () => Promise<void>;
  hasUnsavedSettings: () => boolean;
}
export interface WorkspaceRuntime {
  register: (id: string, handle: WorkspaceHandle) => () => void;
  saveAllCode: (reportErrors?: boolean) => Promise<boolean>;
  flushAllLayouts: () => Promise<void>;
  hasUnsavedSettings: () => boolean;
}
/** Quit/restart must include parked projects as well as the visible workspace. */
export function createWorkspaceRuntime(): WorkspaceRuntime {
  const handles = new Map<string, WorkspaceHandle>();
  return {
    register(id, handle) {
      handles.set(id, handle);
      return () => {
        if (handles.get(id) === handle) handles.delete(id);
      };
    },
    async saveAllCode(reportErrors = false) {
      const results = await Promise.allSettled(
        [...handles.values()].map((handle) => handle.saveCode()),
      );
      if (reportErrors) {
        const errors = results.flatMap((result) =>
          result.status === "rejected" ? [String(result.reason)] : [],
        );
        if (errors.length) throw new Error(errors.join("\n"));
      }
      return results.every(
        (result) => result.status === "fulfilled" && result.value,
      );
    },
    async flushAllLayouts() {
      await Promise.all(
        [...handles.values()].map((handle) => handle.flushLayout()),
      );
    },
    hasUnsavedSettings() {
      return [...handles.values()].some((handle) =>
        handle.hasUnsavedSettings(),
      );
    },
  };
}
