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
export interface GitCommit {
  hash: string;
  subject: string;
  author: string;
  date: string;
}
export interface GitHistoryPage {
  commits: GitCommit[];
  hasMore: boolean;
}
export interface GitComparison {
  name: string;
  reference: string;
  baseHead: string;
  baseBranch: string;
  targetHead: string;
  ahead: number;
  behind: number;
  stat: string;
}
export interface GitSnapshot {
  branch: string;
  head: string;
  entries: GitEntry[];
  branches: string[];
  tracking?: { name: string; reference: string; remote: string; remoteRef: string; ahead: number | null; behind: number | null; gone: boolean } | null;
  remoteBranches?: { name: string; localName: string }[];
  remotes: string[];
  stagedRevision: string;
  merging: boolean;
  reverting?: boolean;
  rebasing?: boolean;
  cherryPicking?: boolean;
  stashes?: { reference: string; hash: string; subject: string }[];
  history: GitCommit[];
  historyHasMore?: boolean;
}
export interface GitConflict {
  base: string;
  ours: string;
  theirs: string;
  current: string;
  rebasing?: boolean;
  cherryPicking?: boolean;
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
