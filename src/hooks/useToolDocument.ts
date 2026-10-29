import {
  useCallback,
  useEffect,
  useRef,
  useMemo,
  useState,
  type SetStateAction,
} from "react";
import { registerSearchDocument } from "../lib/searchDocuments";
import { loadTool, saveTool } from "../lib/toolsBridge";
import { acknowledgeToolSave } from "../lib/acknowledgeToolSave";
import { toolChanges } from "../lib/toolChanges";
import { dirtyDraft } from "../lib/toolDefaults";
import { registerPendingToolSave } from "../lib/toolSaves";
import type { Project } from "../types";
import type { SavedTool, ToolDocument } from "../toolTypes";

export function useToolDocument<T extends ToolDocument>(
  project: Project,
  tool: SavedTool,
  empty: () => T,
  onError: (error: string) => void,
  onDirty: (dirty: boolean) => void,
) {
  const [document, render] = useState<T>(empty);
  const [saved, setSaved] = useState<T>(empty);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const current = useRef(document);
  const baseline = useRef(saved);
  const loaded = useRef(false);
  const alive = useRef(true);
  const queue = useRef<Promise<boolean> | null>(null);
  const dirtyRef = useRef(onDirty);
  dirtyRef.current = onDirty;
  const errorRef = useRef(onError);
  errorRef.current = onError;
  const dirty = dirtyDraft(document, saved);
  const changes = useMemo(
    () => toolChanges(document, saved),
    [document, saved],
  );
  const save = useCallback((): Promise<boolean> => {
    if (queue.current) return queue.current;
    if (!loaded.current) return Promise.resolve(false);
    const job = (async () => {
      if (alive.current) setSaving(true);
      try {
        if (dirtyDraft(current.current, baseline.current)) {
          const snapshot = current.current;
          const result = await saveTool(project, tool, snapshot);
          baseline.current = result;
          if (alive.current) setSaved(result);
          current.current = acknowledgeToolSave(current.current, snapshot, result);
          if (alive.current) render(current.current);
        }
        if (alive.current) setSaveError("");
        if (alive.current)
          dirtyRef.current(dirtyDraft(current.current, baseline.current));
        return true;
      } catch (reason) {
        if (alive.current) setSaveError(String(reason));
        errorRef.current(
          `Could not save ${tool}: ${String(reason)}. Your changes are still open; use Save to retry.`,
        );
        return false;
      } finally {
        if (alive.current) setSaving(false);
      }
    })();
    queue.current = job;
    void job.finally(() => {
      if (queue.current === job) queue.current = null;
    });
    return job;
  }, [project, tool]);
  const setDocument = useCallback((action: SetStateAction<T>) => {
    const next =
      typeof action === "function"
        ? (action as (previous: T) => T)(current.current)
        : action;
    current.current = next;
    render(next);
    dirtyRef.current(dirtyDraft(next, baseline.current));
  }, []);
  useEffect(() => {
    alive.current = true;
    loaded.current = false;
    setLoading(true);
    let gone = false;
    void loadTool(project, tool, empty)
      .then((value) => {
        if (gone) return;
        current.current = value;
        baseline.current = value;
        loaded.current = true;
        render(value);
        setSaved(value);
        setLoading(false);
      })
      .catch((reason) => {
        if (!gone) {
          setSaveError(`Could not load settings: ${String(reason)}`);
          errorRef.current(`Could not load ${tool}: ${String(reason)}`);
          setLoading(false);
        }
      });
    // Closing waits only for a Save the user already started; it never starts one.
    const unregister = registerPendingToolSave(
      `${project.id}:${tool}`,
      () => queue.current ?? Promise.resolve(true),
    );
    return () => {
      gone = true;
      unregister();
      alive.current = false;
    };
  }, [project, tool, empty, save]);
  useEffect(() => {
    if (!loading && loaded.current)
      return registerSearchDocument(project.id, tool, () => current.current);
  }, [project.id, tool, loading]);
  useEffect(() => {
    onDirty(dirty);
    return () => onDirty(false);
  }, [dirty, onDirty]);
  return {
    document,
    savedDocument: saved,
    changes,
    setDocument,
    loading,
    saving,
    dirty,
    save,
    saveError,
  };
}
