import { useEffect, useMemo, useState } from "react";
import { gitFileStatus } from "../lib/bridge";
import type { GitEntry } from "../devTypes";
import type { Project } from "../types";

export type FileTreeChange = "added" | "modified";

export function useFileTreeChanges(
  project: Project,
  root: string | undefined,
  visible: boolean,
  revision: number,
  localChanges: readonly string[],
) {
  const [snapshot, setSnapshot] = useState<{
    projectId: string;
    root: string;
    entries: GitEntry[];
  } | null>(null);
  useEffect(() => {
    if (!visible || !root) return;
    let gone = false;
    let running = false;
    const refresh = async () => {
      if (running || document.visibilityState === "hidden") return;
      running = true;
      try {
        const entries = await gitFileStatus(project, root);
        if (!gone)
          setSnapshot((previous) =>
            previous?.projectId === project.id && previous.root === root &&
            JSON.stringify(previous.entries) === JSON.stringify(entries)
              ? previous
              : { projectId: project.id, root, entries },
          );
      } catch {
        // Ordinary folders work without Git. Keep local draft indicators available.
        if (!gone) setSnapshot(null);
      } finally {
        running = false;
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 2000);
    const focus = () => void refresh();
    window.addEventListener("focus", focus);
    document.addEventListener("visibilitychange", focus);
    return () => {
      gone = true;
      clearInterval(timer);
      window.removeEventListener("focus", focus);
      document.removeEventListener("visibilitychange", focus);
    };
  }, [project, root, visible, revision]);

  return useMemo(() => {
    const changes = new Map<string, FileTreeChange>();
    if (!root) return changes;
    const prefix = root.replaceAll("\\", "/").replace(/\/$/, "") + "/";
    if (snapshot?.projectId === project.id && snapshot.root === root) {
      for (const entry of snapshot.entries) {
        changes.set(
          prefix + entry.path,
          entry.index === "?" || entry.index === "A" || entry.worktree === "A"
            ? "added"
            : "modified",
        );
      }
    }
    for (const path of localChanges) {
      const normalized = path.replaceAll("\\", "/");
      if (normalized.startsWith(prefix) && !changes.has(normalized))
        changes.set(normalized, "modified");
    }
    // Include every ancestor so collapsed folders still reveal pending changes.
    for (const path of [...changes.keys()]) {
      let slash = path.lastIndexOf("/");
      while (slash >= prefix.length) {
        const folder = path.slice(0, slash);
        changes.set(folder, "modified");
        slash = path.lastIndexOf("/", slash - 1);
      }
    }
    return changes;
  }, [project.id, root, snapshot, localChanges]);
}
