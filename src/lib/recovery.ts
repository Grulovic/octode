import { desktop, invoke } from "./bridge";
import type { Document, Project } from "../types";
export interface CodeDraft {
  path: string;
  text: string;
  saved: string;
}
const memory = new Map<string, CodeDraft[]>();
const queues = new Map<string, Promise<void>>();
export async function loadDrafts(project: Project): Promise<CodeDraft[]> {
  await queues.get(project.id)?.catch(() => {});
  return desktop
    ? invoke("load_code_drafts", { projectId: project.id })
    : structuredClone(memory.get(project.id) ?? []);
}
export function saveDrafts(
  project: Project,
  drafts: CodeDraft[],
): Promise<void> {
  const snapshot = drafts.map(({ path, text, saved }) => ({
    path,
    text,
    saved,
  }));
  const task = (queues.get(project.id) ?? Promise.resolve())
    .catch(() => {})
    .then(async () => {
      if (desktop)
        await invoke("save_code_drafts", {
          projectId: project.id,
          drafts: snapshot,
        });
      else memory.set(project.id, structuredClone(snapshot));
    });
  queues.set(project.id, task);
  void task
    .finally(() => {
      if (queues.get(project.id) === task) queues.delete(project.id);
    })
    .catch(() => {});
  return task;
}
export function recoverySnapshot(documents: Document[], pending: CodeDraft[]) {
  const paths = new Set(pending.map((item) => item.path));
  return [
    ...pending,
    ...documents.filter(
      (item) => item.text !== item.saved && !paths.has(item.path),
    ),
  ].map(({ path, text, saved }) => ({ path, text, saved }));
}
