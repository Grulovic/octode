import { desktop, invoke } from "./bridge";
import type { Project } from "../types";
import type { SavedTool, ToolDocument } from "../toolTypes";

const preview = new Map<string, ToolDocument>();
export async function loadTool<T extends ToolDocument>(
  project: Project,
  tool: SavedTool,
  fallback: () => T,
): Promise<T> {
  const value = desktop
    ? await invoke<T | null>("load_tool_document", {
        projectId: project.id,
        tool,
      })
    : preview.get(`${project.id}:${tool}`);
  return value ? structuredClone(value as T) : fallback();
}
export async function saveTool<T extends ToolDocument>(
  project: Project,
  tool: SavedTool,
  document: T,
): Promise<T> {
  if (desktop)
    return invoke("save_tool_document", {
      projectId: project.id,
      tool,
      document,
    });
  preview.set(`${project.id}:${tool}`, structuredClone(document));
  return structuredClone(document);
}
export const nativeTool = <T>(
  command: string,
  args: Record<string, unknown>,
): Promise<T> =>
  desktop
    ? invoke(command, args)
    : Promise.reject(
        new Error(
          "Run the desktop app to connect to local or remote services.",
        ),
      );
