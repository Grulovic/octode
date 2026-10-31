export interface NavigationTarget {
  path: string;
  line: number;
  label: string;
  preview: string;
}
export interface NavigationTargets {
  targets: NavigationTarget[];
  truncated: boolean;
}
export interface FileInspection {
  path: string;
  stamp: string;
  content: string | null;
  error: string | null;
}
export interface GitEntry {
  path: string;
  originalPath: string | null;
  index: string;
  worktree: string;
  conflict: boolean;
}
export interface GitSnapshot {
  branch: string;
  head: string;
  entries: GitEntry[];
  branches: string[];
  remotes: string[];
  stagedRevision: string;
  merging: boolean;
  reverting?: boolean;
  stashes?: { reference: string; hash: string; subject: string }[];
  history: { hash: string; subject: string; author: string; date: string }[];
}
export interface GitConflict {
  base: string;
  ours: string;
  theirs: string;
  current: string;
}
export interface FileAction {
  action:
    | "create-file"
    | "create-folder"
    | "rename"
    | "delete"
    | "copy"
    | "move"
    | "duplicate"
    | "reveal";
  destination?: string;
  path: string;
  name?: string;
  expected?: string;
}
