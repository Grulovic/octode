import { useEffect, useState } from "react";
import { desktop, invoke, gitStatus } from "../lib/bridge";
import type { Project } from "../types";
export function useRootBranches(
  project: Project,
  visible: boolean,
  revision: number,
) {
  const [branches, setBranches] = useState<Record<string, string>>({});
  const rootsKey = JSON.stringify(project.roots);
  useEffect(() => {
    setBranches({});
  }, [project.id, rootsKey]);
  useEffect(() => {
    if (!visible) return;
    let gone = false,
      running = false;
    const roots = JSON.parse(rootsKey) as string[];
    const refresh = async () => {
      if (running) return;
      running = true;
      try {
        const values = await Promise.allSettled(
          roots.map((root) =>
            desktop
              ? invoke<string>("git_branch_name", {
                  projectId: project.id,
                  root,
                })
              : gitStatus(project, root).then((value) => value.branch),
          ),
        );
        if (gone) return;
        const next = Object.fromEntries(
          roots.map((root, i) => [
            root,
            values[i].status === "fulfilled" ? values[i].value : "",
          ]),
        );
        setBranches((previous) =>
          JSON.stringify(previous) === JSON.stringify(next) ? previous : next,
        );
      } finally {
        running = false;
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 5000);
    const focus = () => void refresh();
    window.addEventListener("focus", focus);
    return () => {
      gone = true;
      clearInterval(timer);
      window.removeEventListener("focus", focus);
    };
  }, [project.id, rootsKey, visible, revision]);
  return branches;
}
