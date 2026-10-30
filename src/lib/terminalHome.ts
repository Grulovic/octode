import { desktop, invoke } from "./bridge";
import type { Project } from "../types";
// A terminal context only; never stored as a project or granted file-editor access.
export const HOME_TERMINAL_ID = "octode:home-terminal";
export async function homeTerminalProject(): Promise<Project> {
  const home = desktop ? await invoke<string>("terminal_home") : "/home";
  return { id: HOME_TERMINAL_ID, name: "Home", roots: [home], updatedAt: 0 };
}
