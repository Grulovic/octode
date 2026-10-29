export type Tool = "home" | "code" | "servers" | "database" | "api";
export interface Project {
  color?: string;
  id: string;
  name: string;
  roots: string[];
  updatedAt: number;
}
export interface FileEntry {
  name: string;
  path: string;
  directory: boolean;
}
export interface Document {
  path: string;
  name: string;
  text: string;
  saved: string;
}
export interface GitStatus {
  branch: string;
  files: string[];
}
export interface FileMatch {
  path: string;
  relative: string;
  root: string;
}
export interface TextMatch {
  path: string;
  relative: string;
  line: number;
  preview: string;
}
export interface SearchResults {
  files: FileMatch[];
  matches: TextMatch[];
  truncated: boolean;
  cancelled: boolean;
  skipped: number;
  warnings: string[];
}
export interface EditorSelection {
  path: string;
  line: number;
  revision: number;
}
export interface WorkspaceSession {
  version: 1;
  tool: Tool;
  openFiles: string[];
  activeFile: string;
  activeRoot: string;
  terminalVisible: boolean;
}
export type TerminalEvent =
  | { event: "data"; data: number[] }
  | { event: "exit"; data: string };
