import GitBranchMenu, { type GitMenuAction } from "./GitBranchMenu";
import { createPortal } from "react-dom";
import { filename } from "../lib/workspace";
import CustomSelect from "./CustomSelect";
import GitDiffHunk from "./GitDiffHunk";
import { parseCommitDiff, type CommitDiffFile } from "../lib/gitDiff";
import {
  type ReactNode,
  useCallback,
  useId,
  useEffect,
  useRef,
  useState,
} from "react";
import { Minus } from "lucide-react";
import { GitBranch, Plus, RefreshCw, X, RotateCcw, ArrowRight, ChevronDown, ChevronRight, AlertTriangle } from "./DesignIcons";
import { desktop, invoke } from "../lib/bridge";
import { registerTabCloser } from "../lib/closeTab";
import { confirmAction } from "./ToolLayout";
import type { GitEntry, GitSnapshot, GitConflict, GitCommit, GitComparison, GitHistoryPage } from "../devTypes";
import type { Project } from "../types";
import "./code-tools.css";

const gitFailureTitles: Record<string, string> = {
  switch: "Couldn’t switch branches",
  merge: "Couldn’t merge the branch",
  pull: "Couldn’t pull changes",
  push: "Couldn’t push commits",
  fetch: "Couldn’t fetch updates",
  "create-branch": "Couldn’t create the branch",
  "rename-branch": "Couldn’t rename the branch",
  "delete-branch": "Couldn’t delete the branch",
  "track-branch": "Couldn’t track the remote branch",
  resolve: "Couldn’t stage the conflict resolution",
  "merge-upstream": "Couldn’t merge the upstream",
  "rebase-upstream": "Rebase needs attention",
  "continue-rebase": "Couldn’t continue the rebase",
  "abort-rebase": "Couldn’t abort the rebase",
  "cherry-pick": "Cherry-pick needs attention",
  "continue-cherry-pick": "Couldn’t continue the cherry-pick",
  "abort-cherry-pick": "Couldn’t abort the cherry-pick",
};

type SidebarView = "changes" | "history" | "branches";
type BranchSelection = { kind: "local" | "remote"; name: string };
type BranchForm = { kind: "create"; value: string } | { kind: "rename"; name: string; value: string };

type CompareTarget = { kind: "local" | "remote" | "upstream"; name: string };
type ComparisonView = GitComparison & {
  target: CompareTarget;
  incoming: GitHistoryPage;
  outgoing: GitHistoryPage;
};
type HistoryView = GitHistoryPage & { head: string; query: string };

export default function GitPanel({
  project,
  overlayHost,
  branchHost,
  branchVisible = false,
  branchDisabled = false,
  onActionError,
  onShowGit,
  root,
  visible,
  revision,
  beforeAction,
  onChanged,
  onOpen,
  onOpenInCode,
  onBusy,
  onCount,
  renderMerge,
}: {
  project: Project;
  overlayHost?: Element;
  branchHost?: Element | null;
  branchVisible?: boolean;
  branchDisabled?: boolean;
  onActionError?: (error: string) => void;
  onShowGit?: () => void;
  root: string;
  visible: boolean;
  revision: number;
  beforeAction: () => Promise<boolean>;
  onChanged: () => Promise<void>;
  onBusy: (busy: boolean) => void;
  onCount?: (count: number) => void;
  onOpen: (path: string) => Promise<void>;
  onOpenInCode?: (path: string) => Promise<void>;
  renderMerge: (path: string, conflict: GitConflict) => ReactNode;
}) {
  const [state, setState] = useState<GitSnapshot | null>(null);
  useEffect(() => { if (state) onCount?.(state.entries.length); }, [state, onCount]);
  const [repositoryError, setRepositoryError] = useState("");
  const [actionError, setActionError] = useState<{ title: string; detail: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [commit, setCommit] = useState("");
  const commitInitialized = useRef(false);
  const [pushPrompt, setPushPrompt] = useState(false);
  const [pendingMenuAction, setPendingMenuAction] = useState<GitMenuAction | null>(null);
  const [commitIntent, setCommitIntent] = useState(false);
  const commitInput = useRef<HTMLTextAreaElement>(null);
  const [focusCommit, setFocusCommit] = useState(false);
  const [selectedBranch, setSelectedBranch] = useState<BranchSelection | null>(null);
  const [branchForm, setBranchForm] = useState<BranchForm | null>(null);
  const [remote, setRemote] = useState("");
  const [view, setView] = useState<{
    path: string;
    text: string;
    staged: boolean;
    hunks?: { header: string; hunks: string[]; supported: boolean };
    historical?: boolean;
    stash?: { hash: string; subject: string; fileIndex: number };
    compared?: boolean;
    commitDiff?: { header: string; files: CommitDiffFile[] };
  } | null>(null);
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [chosenHunks, setChosenHunks] = useState<number[]>([]);
  const [merge, setMerge] = useState<{
    path: string;
    data: GitConflict;
  } | null>(null);
  const [comparison, setComparison] = useState<ComparisonView | null>(null);
  const [historyQuery, setHistoryQuery] = useState("");
  const [historyView, setHistoryView] = useState<HistoryView | null>(null);
  const [sidebarView, setSidebarView] = useState<SidebarView>("changes");
  const mounted = useRef(true);
  const working = useRef(false);
  const epoch = useRef(0);
  const pendingRefresh = useRef<{ root: string; job: Promise<void> } | null>(
    null,
  );
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      epoch.current++;
    };
  }, []);
  const readSnapshot = useCallback(async () => {
    const version = ++epoch.current;
    if (!desktop) return;
    try {
      const snapshot = await invoke<GitSnapshot>("git_snapshot", {
        projectId: project.id,
        root,
      });
      if (mounted.current && epoch.current === version) {
        setState(snapshot);
        if (!commitInitialized.current) {
          commitInitialized.current = true;
          setCommit(snapshot.history[0]?.subject ?? "");
        }
        setRepositoryError("");
        setRemote((previous) =>
          snapshot.remotes.includes(previous)
            ? previous
            : (snapshot.remotes[0] ?? ""),
        );
      }
    } catch (reason) {
      if (mounted.current && epoch.current === version)
        setRepositoryError(reason instanceof Error ? reason.message : String(reason));
    }
  }, [project.id, root]);
  const refresh = useCallback(() => {
    if (pendingRefresh.current?.root === root)
      return pendingRefresh.current.job;
    const job = readSnapshot();
    pendingRefresh.current = { root, job };
    void job.finally(() => {
      if (pendingRefresh.current?.job === job) pendingRefresh.current = null;
    });
    return job;
  }, [root, readSnapshot]);
  useEffect(() => {
    setState(null);
    setRepositoryError("");
    setActionError(null);
    setMessage("");
    commitInitialized.current = false;
    setCommit("");
    setPushPrompt(false);
    setView(null);
    setMerge(null);
    setSidebarView("changes");
    setComparison(null);
    setHistoryQuery("");
    setHistoryView(null);
    setSelectedBranch(null);
    setBranchForm(null);
    void refresh();
  }, [refresh]);
  useEffect(() => {
    if (!visible && !branchVisible) return;
    void refresh();
    const timer = setInterval(() => {
      if (!working.current) void refresh();
    }, 5000);
    return () => clearInterval(timer);
  }, [visible, branchVisible, revision, refresh]);
  const task = async (failureTitle: string, job: () => Promise<void>) => {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    onBusy(true);
    setMessage("");
    setActionError(null);
    try {
      await job();
    } catch (reason) {
      if (mounted.current) {
        if (!visible) onActionError?.(`${failureTitle}: ${reason instanceof Error ? reason.message : String(reason)}`);
        setActionError({
          title: failureTitle,
          detail: reason instanceof Error ? reason.message : String(reason),
        });
      }
    } finally {
      await refresh();
      working.current = false;
      onBusy(false);
      if (mounted.current) setBusy(false);
    }
  };
  const tracking = state?.tracking;
  const syncRemote = tracking?.remote || remote;
  const syncRef = tracking?.remoteRef ?? "";
  const syncDestination = tracking?.name ?? (remote && state ? `${remote}/${state.branch}` : "");
  const sequencer = state?.rebasing ? "rebase" : state?.cherryPicking ? "cherry-pick" : null;
  const inProgress = !!(sequencer || state?.merging || state?.reverting);
  const hasConflicts = !!state?.entries.some(({ conflict }) => conflict);
  const diverged = (tracking?.ahead ?? 0) > 0 && (tracking?.behind ?? 0) > 0;
  const showOperation = () => {
    setSidebarView("changes");
    setComparison(null);
    setView(null);
    setMerge(null);
    setBranchForm(null);
  };
  const act = (action: string, path = "", value = "", reviewedDiff?: string) =>
    task(gitFailureTitles[action] ?? "Git couldn’t complete this action", async () => {
      if (!state) return;
      if (!(await beforeAction()))
        throw new Error("Save or resolve Code conflicts before changing Git.");
      if (action === "rollback") {
        const data = await invoke<{ patch: string }>("git_hunks", {
          projectId: project.id,
          root,
          path,
          staged: false,
        });
        reviewedDiff = data.patch;
      }
      const confirm = [
        "rollback",
        "abort-merge",
        "commit",
        "track-branch",
        "merge",
        "pull",
        "push",
        "stash",
        "stash-apply",
        "resolve", "delete-branch", "revert", "abort-revert", "stash-drop",
        "merge-upstream", "rebase-upstream", "cherry-pick", "abort-rebase", "abort-cherry-pick",
      ].includes(action);
      if (
        confirm &&
        !(await confirmAction(
          action === "rollback"
            ? `Discard unstaged changes to ${path}? The file will be restored from the index; staged changes are kept. This cannot be undone.`
            : action === "abort-merge"
              ? "Abort this merge and discard edits to its result? Git will restore the state before the merge."
              : action === "commit"
                ? `Commit the reviewed staged changes?\n\n${value}`
                : action === "merge"
                  ? `Merge ${value} into ${state.branch}? The merge will stop before committing so you can review the result.`
                  : action === "track-branch" ? `Create local branch “${state.remoteBranches?.find((branch) => branch.name === value)?.localName}” tracking “${value}” and switch to it?`
                  : action === "delete-branch" ? `Delete local branch “${path}”? Unmerged branches will be refused.`
                  : action === "revert" ? `Apply the inverse of commit ${value.slice(0, 8)}? Changes will be staged for review; no commit is created automatically.`
                  : action === "stash-drop" ? `Drop ${path}? Its saved changes will be removed from the stash list.`
                  : action === "abort-revert" ? "Abort this revert and discard its result edits?"
                  : action === "pull" ? `Pull changes from ${syncDestination}?`
                  : action === "push" ? `Push ${state.branch} to ${syncDestination}?`
                  : action === "merge-upstream" ? `Merge ${syncDestination} into ${state.branch}? You can review the result before committing.`
                  : action === "rebase-upstream" ? `Rebase ${state.branch} onto ${syncDestination}? Git will rewrite the local commits. This won’t push them.`
                  : action === "cherry-pick" ? `Apply commit ${value.slice(0, 8)} to ${state.branch}? Git will create a commit if it applies cleanly.`
                  : action === "abort-rebase" ? "Abort the rebase and discard changes made while resolving it?"
                  : action === "abort-cherry-pick" ? "Abort the cherry-pick and discard changes made while resolving it?"
                  : `${action} ${value || path || remote}?`,
        ))
      )
        return;
      const syncing = action === "pull" || action === "push";
      const startingOperation = ["merge", "merge-upstream", "rebase-upstream", "cherry-pick"].includes(action);
      const integrating = action === "merge-upstream" || action === "rebase-upstream";
      if (integrating && (!comparison || comparison.baseHead !== state.head || comparison.baseBranch !== state.branch)) {
        throw new Error("The current branch changed. Refresh the comparison before continuing.");
      }
      if (startingOperation) showOperation();
      let result: string;
      try {
        result = await invoke<string>("git_action", {
          projectId: project.id,
          root,
          request: {
            action,
            path: syncing ? "sync-destination" : path,
            value: syncing ? syncRef : value,
            remote: syncing ? syncRemote : remote,
            expectedHead: state.head,
            expectedBranch: state.branch,
            expectedStaged: state.stagedRevision,
            reviewedDiff,
          },
        });
      } finally {
        // A paused rebase or cherry-pick can change files even when Git exits with an error.
        if (startingOperation || action.startsWith("continue-")) await onChanged();
      }
      if (mounted.current) {
        setMessage(result || `${action} completed`);
        if (action === "resolve") setMerge(null);
        if (action === "stash-drop" && view?.stash?.hash === value) setView(null);
        if (action === "stage" || action === "unstage" || action === "rollback")
          setView(null);
        if (action === "create-branch" || action === "rename-branch") {
          setBranchForm(null);
          setSelectedBranch({ kind: "local", name: value });
        }
        if (action === "track-branch" && selectedBranch?.kind === "remote" && selectedBranch.name === value) {
          const tracked = state.remoteBranches?.find(({ name }) => name === value);
          if (tracked) setSelectedBranch({ kind: "local", name: tracked.localName });
        }
      }
      if (!startingOperation && !action.startsWith("continue-")) await onChanged();
    });
  const changeAll = (entries: GitEntry[], staged: boolean) =>
    task("Couldn’t update staging", async () => {
      if (!state || !entries.length) return;
      if (!(await beforeAction()))
        throw new Error("Save or resolve Code conflicts before changing Git.");
      await invoke<string>("git_action", {
        projectId: project.id,
        root,
        request: {
          action: staged ? "unstage-many" : "stage-many",
          paths: entries.map((entry) => entry.path),
          expectedHead: state.head,
          expectedStaged: state.stagedRevision,
        },
      });
      setView(null);
      setMessage(
        staged ? "All staged files deselected" : "All unstaged files selected",
      );
      await onChanged();
    });
  const commitAndPush = () =>
    task("Couldn’t commit and push", async () => {
      if (
        !state ||
        !commit.trim() ||
        !syncRemote || !!sequencer || hasConflicts ||
        state.branch === "Detached HEAD"
      )
        return;
      setPushPrompt(false);
      if (!(await beforeAction()))
        throw new Error("Save or resolve Code conflicts before changing Git.");
      await invoke<string>("git_action", {
        projectId: project.id,
        root,
        request: {
          action: "commit",
          path: "",
          value: commit,
          remote: syncRemote,
          expectedHead: state.head,
          expectedBranch: state.branch,
          expectedStaged: state.stagedRevision,
        },
      });
      setMessage("Committed locally. Pushing…");
      try {
        const committed = await invoke<GitSnapshot>("git_snapshot", {
          projectId: project.id,
          root,
        });
        if (committed.branch !== state.branch || !committed.head)
          throw new Error(
            "The active branch changed. Review it before pushing.",
          );
        await invoke<string>("git_action", {
          projectId: project.id,
          root,
          request: {
            action: "push",
            path: "sync-destination",
            value: syncRef,
            remote: syncRemote,
            expectedHead: committed.head,
            expectedBranch: committed.branch,
            expectedStaged: committed.stagedRevision,
          },
        });
        setMessage(`Committed and pushed ${state.branch} to ${tracking ? syncDestination : syncRemote}.`);
      } catch (reason) {
        setMessage("Commit saved locally.");
        throw new Error(
          `Commit succeeded locally, but push failed: ${String(reason)}. Use Push in the Git toolbar to retry; you do not need to commit again.`,
        );
      } finally {
        await onChanged();
      }
    });
  const showDiff = (entry: GitEntry, staged: boolean) =>
    task("Couldn’t load the diff", async () => {
      if (!(await beforeAction()))
        throw new Error(
          "Resolve Code save conflicts before reviewing the disk diff.",
        );
      const data = await invoke<{
        patch: string;
        header: string;
        hunks: string[];
        supported: boolean;
      }>("git_hunks", {
        projectId: project.id,
        root,
        path: entry.path,
        staged,
      });
      setChosenHunks([]);
      if (
        !data.hunks.length &&
        data.patch.startsWith(`New file: ${entry.path}\n\n`)
      ) {
        const content = data.patch.slice(`New file: ${entry.path}\n\n`.length);
        if (content) {
          const lines = content.split("\n");
          if (content.endsWith("\n")) lines.pop();
          data.hunks = [
            `@@ -0,0 +1,${lines.length} @@\n${lines.map((line) => `+${line}`).join("\n")}\n`,
          ];
        }
      }
      setMerge(null);
      setComparison(null);
      setView({ path: entry.path, text: data.patch, staged, hunks: data });
    });
  const applyChosenHunks = () =>
    task("Couldn’t update the selected hunks", async () => {
      if (!view || !state || !chosenHunks.length) return;
      if (!(await beforeAction()))
        throw new Error("Resolve failed Code saves first.");
      await invoke("git_apply_hunks", {
        projectId: project.id,
        root,
        request: {
          path: view.path,
          staged: view.staged,
          reviewedPatch: view.text,
          selected: chosenHunks,
          expectedHead: state.head,
          expectedStaged: state.stagedRevision,
        },
      });
      setView(null);
      setChosenHunks([]);
      await onChanged();
    });
  const readHistory = (head: string, exclude: string | null, offset: number, query: string) =>
    invoke<GitHistoryPage>("git_history", { projectId: project.id, root, head, exclude, offset, query });
  const currentHistory = historyView?.head === state?.head ? historyView : null;
  const historyCommits = currentHistory?.commits ?? state?.history ?? [];
  const hasOlderCommits = currentHistory?.hasMore ?? state?.historyHasMore;
  const loadHistory = (query: string, append = false) =>
    task("Couldn’t load history", async () => {
      if (!state?.head) return;
      if (!query && !append) {
        setHistoryView(null);
        return;
      }
      const page = await readHistory(state.head, null, append ? historyCommits.length : 0, query);
      setHistoryView({
        head: state.head,
        query,
        commits: append ? [...historyCommits, ...page.commits] : page.commits,
        hasMore: page.hasMore,
      });
    });
  const openComparison = (target: CompareTarget) =>
    task("Couldn’t compare branches", async () => {
      const data = await invoke<GitComparison>("git_compare", { projectId: project.id, root, ...target });
      const empty = { commits: [], hasMore: false };
      const [incoming, outgoing] = await Promise.all([
        data.behind ? readHistory(data.targetHead, data.baseHead, 0, "") : empty,
        data.ahead ? readHistory(data.baseHead, data.targetHead, 0, "") : empty,
      ]);
      setView(null);
      setMerge(null);
      setBranchForm(null);
      setComparison({ ...data, target, incoming, outgoing });
    });
  const inspectComparisonDiff = () =>
    task("Couldn’t load the branch diff", async () => {
      if (!comparison) return;
      const { baseHead, targetHead, name, baseBranch } = comparison;
      const text = await invoke<string>("git_compare_diff", { projectId: project.id, root, baseHead, targetHead });
      setView({ path: `${baseBranch} → ${name}`, text, staged: false, compared: true, commitDiff: parseCommitDiff(text) });
    });
  const loadComparisonPage = (direction: "incoming" | "outgoing") =>
    task("Couldn’t load more commits", async () => {
      if (!comparison) return;
      const incoming = direction === "incoming";
      const existing = comparison[direction].commits;
      const page = await readHistory(
        incoming ? comparison.targetHead : comparison.baseHead,
        incoming ? comparison.baseHead : comparison.targetHead,
        existing.length,
        "",
      );
      setComparison({
        ...comparison,
        [direction]: { commits: [...existing, ...page.commits], hasMore: page.hasMore },
      });
    });
  const renderCommit = (item: GitCommit) => (
    <button
      className="git-history"
      aria-pressed={view?.historical === true && view.path === item.hash}
      key={item.hash}
      disabled={busy}
      onClick={() => void inspectCommit(item.hash)}
    >
      <code>{item.hash.slice(0, 8)}</code>
      <strong>{item.subject}</strong>
      <small>{item.author} · {item.date.slice(0, 10)}</small>
    </button>
  );
  const inspectCommit = (hash: string) =>
    task("Couldn’t open the commit", async () => {
      const text = await invoke<string>("git_show_commit", {
        projectId: project.id,
        root,
        hash,
      });
      setMerge(null);
      setView({ path: hash, text, staged: false, historical: true, commitDiff: parseCommitDiff(text) });
    });
  const inspectStash = (stash: NonNullable<GitSnapshot["stashes"]>[number]) =>
    task("Couldn’t open the stash", async () => {
      const text = await invoke<string>("git_show_stash", {
        projectId: project.id, root, hash: stash.hash,
      });
      setMerge(null);
      setComparison(null);
      setView({ path: stash.reference, text, staged: false,
        stash: { hash: stash.hash, subject: stash.subject, fileIndex: 0 },
        commitDiff: parseCommitDiff(text) });
    });
  const conflict = (entry: GitEntry) =>
    task("Couldn’t open the conflict", async () => {
      if (!(await beforeAction()))
        throw new Error(
          "Resolve Code save conflicts before opening this merge.",
        );
      const data = await invoke<GitConflict>("git_conflict", {
        projectId: project.id,
        root,
        path: entry.path,
      });
      await onOpen(`${root}/${entry.path}`);
      setView(null);
      setComparison(null);
      setMerge({ path: entry.path, data });
    });
  useEffect(() => {
    if (!visible || busy || (!view && !merge && !comparison)) return;
    return registerTabCloser({
      active: () => !document.activeElement?.closest(".terminal-panel"),
      close: () => {
        setView(null);
        setMerge(null);
        if (!view && !merge) setComparison(null);
      },
    });
  }, [visible, busy, view, merge, comparison]);
  const pushDialogId = useId();
  const stagedCount = state?.entries.filter((entry) => !entry.conflict && entry.index !== " " && entry.index !== "?").length ?? 0;
  const selectSidebarView = (next: SidebarView) => {
    if (next === sidebarView) return;
    setSidebarView(next);
    setView(null);
    setMerge(null);
    setBranchForm(null);
    setComparison(null);
  };
  const selectBranch = (kind: BranchSelection["kind"], name: string) => {
    setSelectedBranch({ kind, name });
    setComparison(null);
    setView(null);
    setBranchForm(null);
    setActionError(null);
  };
  const localBranches = state?.branches ?? [];
  const remoteBranches = state?.remoteBranches ?? [];
  const selectedRemote = selectedBranch?.kind === "remote"
    ? remoteBranches.find(({ name }) => name === selectedBranch.name)
    : undefined;
  const selectedLocal = selectedBranch?.kind === "local" && localBranches.includes(selectedBranch.name)
    ? selectedBranch.name
    : state?.branch && localBranches.includes(state.branch)
      ? state.branch
      : undefined;
  const currentBranch = !selectedRemote && selectedLocal === state?.branch;
  const existingTrackingBranch = selectedRemote && localBranches.includes(selectedRemote.localName);
  const canChangeBranch = !busy && !inProgress;
  const hasChanges = !!state?.entries.length;
  const openInCode = (path: string) => (onOpenInCode ?? onOpen)(`${root}/${path}`);
  const comparisonStale = !!comparison && (comparison.baseHead !== state?.head || comparison.baseBranch !== state?.branch);
  const feedback = actionError ?? (repositoryError ? {
    title: state ? "Couldn’t refresh the repository" : "Couldn’t open the repository",
    detail: repositoryError,
  } : null);
  const requestMenuAction = (action: GitMenuAction) => {
    if (busy || branchDisabled) return;
    window.dispatchEvent(new Event("octode-dismiss-popovers"));
    onShowGit?.();
    setPendingMenuAction(action);
  };
  useEffect(() => {
    if (!visible || !pendingMenuAction || !state) return;
    const action = pendingMenuAction;
    setPendingMenuAction(null);
    if (action === "push" || action === "update" || action === "fetch") {
      showOperation();
      void act(action === "update" ? "pull" : action);
    } else if (action === "new-branch") {
      setSidebarView("branches");
      setView(null);
      setMerge(null);
      setComparison(null);
      setBranchForm({ kind: "create", value: "" });
    } else {
      showOperation();
      setCommitIntent(action === "commit-push");
      const ready = !!commit.trim() && (!!state.stagedRevision || state.merging) && !sequencer && !hasConflicts && !!syncRemote && state.branch !== "Detached HEAD";
      if (action === "commit-push" && ready) setPushPrompt(true);
      else setFocusCommit(true);
    }
  });
  useEffect(() => {
    if (visible && sidebarView === "changes" && focusCommit) {
      commitInput.current?.focus();
      setFocusCommit(false);
    }
  }, [visible, sidebarView, focusCommit]);
  useEffect(() => {
    if (!branchVisible || !state || repositoryError) return;
    const key = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.repeat || !(event.metaKey || event.ctrlKey) ||
        document.querySelector('[aria-modal="true"]') ||
        (document.activeElement instanceof Element && document.activeElement.closest(".terminal-panel, .local-terminal-panel, .xterm"))) return;
      const name = event.code === "KeyK" ? "k" : event.key.toLowerCase();
      let action: GitMenuAction | undefined;
      if (name === "t" && !event.shiftKey && !event.altKey) action = "update";
      else if (name === "k" && !(event.shiftKey && event.altKey)) action = event.shiftKey ? "push" : event.altKey ? "commit-push" : "commit";
      if (!action) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (busy || branchDisabled || ((action === "push" || action === "update") && (!syncRemote || !!sequencer))) return;
      requestMenuAction(action);
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  });
  const branchSelect = (className: string, label: string) => state && (
          <CustomSelect
            className={className}
            aria-label={label}
            title={`Switch branch in ${root}`}
            value={state.branch}
            disabled={!canChangeBranch || branchDisabled}
            onChange={(event) => {
              const value = event.target.value;
              if (value.startsWith("remote:"))
                void act("track-branch", "", value.slice("remote:".length));
              else if (value !== state.branch)
                void act("switch", "", value);
            }}
          >
            {!state.branches.includes(state.branch) && (
              <option value={state.branch}>
                {state.branch}
              </option>
            )}
            {state.branches.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
            {(state.remoteBranches ?? []).map(({ name, localName }) => (
              <option key={`remote:${name}`} value={`remote:${name}`} disabled={state.branches.includes(localName)}>
                {name} — {state.branches.includes(localName) ? `local ${localName} exists` : `track as ${localName}`}
              </option>
            ))}
          </CustomSelect>
  );
  const toolbar = (
    <header className="git-workspace-toolbar" aria-label="Repository controls">
      <div className="git-heading">
        <GitBranch size={14} />
        {state ? (
          branchSelect("git-branch-switch", `Switch branch in ${filename(root)}`)
        ) : (
          <strong>Repository</strong>
        )}
        <button
          title="Refresh Git"
          disabled={busy}
          onClick={() => void refresh()}
        >
          <RefreshCw size={13} />
        </button>
        {state && <p
          className="git-help git-repository-summary"
          aria-label="Branch tracking status"
          title="Compared with the locally fetched upstream. Fetch to update remote information."
        >
          {state.branch === "Detached HEAD"
            ? "Detached HEAD · no upstream comparison"
            : !state.head
              ? "No commits yet · no upstream comparison"
              : !state.tracking
                ? "No upstream configured"
                : state.tracking.gone
                  ? `${state.tracking.name} · upstream missing`
                  : state.tracking.ahead === null || state.tracking.behind === null
                    ? `${state.tracking.name} · comparison unavailable`
                    : <>
                        <span>{state.tracking.name}</span>{" · "}
                        <button
                          type="button"
                          className="git-tracking-counts"
                          aria-label={`${state.tracking.ahead} commits ahead, ${state.tracking.behind} commits behind`}
                          title="Compare with upstream"
                          disabled={busy}
                          onClick={() => void openComparison({ kind: "upstream", name: "" })}
                        >
                          ↑{state.tracking.ahead} ↓{state.tracking.behind}
                        </button>
                        {state.tracking.ahead === 0 && state.tracking.behind === 0 ? " · up to date" : ""}
                      </>}
        </p>}
      </div>
      {state && (!!state.remotes.length || !!tracking?.remote) && (
        <div className="git-sync-controls">
          {!!state.remotes.length && <CustomSelect
            aria-label={tracking?.remote ? "Fetch remote" : "Git remote"}
            value={remote}
            onChange={(event) => setRemote(event.target.value)}
          >
            <option value="">Select remote…</option>
            {state.remotes.map((name) => (
              <option key={name}>{name}</option>
            ))}
          </CustomSelect>}
          <div className="git-action-row">
            {(["fetch", "pull", "push"] as const).map((action) => (
              <button
                key={action}
                disabled={busy || (action === "fetch" ? !remote : !syncRemote || state.branch === "Detached HEAD" || !!sequencer || (action === "pull" && inProgress))}
                title={action === "fetch" ? undefined : `${action === "pull" ? "Pull from" : "Push to"} ${syncDestination}`}
                onClick={() => action === "pull" && diverged
                  ? void openComparison({ kind: "upstream", name: "" })
                  : void act(action)}
              >
                {action === "pull" ? diverged ? "Review divergence" : "Pull" : action === "fetch" ? "Fetch" : "Push"}
              </button>
            ))}
          </div>
        </div>
      )}
    </header>
  );
  return (
    <div className="git-tools">
      {branchHost && state && !repositoryError && createPortal(<>
        <span className="project-nav-separator" aria-hidden="true">/</span>
        <GitBranchMenu state={state} folder={root} disabled={busy || branchDisabled}
          canSwitch={canChangeBranch && !branchDisabled} canSync={!!syncRemote && !sequencer}
          onAction={requestMenuAction}
          onSwitch={(name, remote) => void act(remote ? "track-branch" : "switch", "", name)} />
      </>, branchHost)}
      {busy && (
        <p className="git-help" role="status">
          Working…
        </p>
      )}
      {state && (
        <>
          <div className="git-sidebar-views" role="group" aria-label="Git sidebar view">
            {(["changes", "history", "branches"] as const).map((item) => (
              <button key={item} aria-pressed={sidebarView === item} disabled={busy} onClick={() => selectSidebarView(item)}>
                {item[0].toUpperCase() + item.slice(1)}
              </button>
            ))}
          </div>
          <div hidden={sidebarView !== "changes"}>
            {state.merging && (
              <button
                className="secondary-button git-wide"
                disabled={busy}
                onClick={() => void act("abort-merge")}
              >
                Abort merge…
              </button>
            )}
            {state.reverting && <button className="secondary-button git-wide" disabled={busy} onClick={() => void act("abort-revert")}>Abort revert…</button>}
            {["conflicts", "unstaged", "staged"].map((group) => {
              const entries = state.entries.filter((entry) =>
                group === "conflicts"
                  ? entry.conflict
                  : !entry.conflict &&
                    (group === "staged"
                      ? entry.index !== " " && entry.index !== "?"
                      : entry.worktree !== " " || entry.index === "?"),
              );
              return (
                <div className="git-group" key={group}>
                  <div className="git-group-heading">
                    <button aria-expanded={!collapsed.includes(group)} onClick={() => setCollapsed((old) => old.includes(group) ? old.filter((name) => name !== group) : [...old, group])}>{collapsed.includes(group) ? <ChevronRight size={16} /> : <ChevronDown size={16} />}{group[0].toUpperCase() + group.slice(1)} <span>{entries.length}</span></button>
                    {group !== "conflicts" && (
                      <button
                        disabled={busy || !entries.length}
                        title={
                          group === "staged"
                            ? "Unstage all staged files"
                            : "Stage all unstaged files"
                        }
                        onClick={() =>
                          void changeAll(entries, group === "staged")
                        }
                      >
                        {group === "staged" ? "Deselect all" : "Select all"}
                      </button>
                    )}
                  </div>
                  {!collapsed.includes(group) && entries.map((entry) => (
                    <div className="git-change" key={entry.path}>
                      <button
                        disabled={busy}
                        aria-pressed={group === "conflicts" ? merge?.path === entry.path : view?.path === entry.path && !view.historical && view.staged === (group === "staged")}
                        title={
                          entry.originalPath
                            ? `${entry.originalPath} → ${entry.path}`
                            : entry.path
                        }
                        onClick={() =>
                          group === "conflicts"
                            ? void conflict(entry)
                            : void showDiff(entry, group === "staged")
                        }
                      >
                        <code>
                          {entry.index}
                          {entry.worktree}
                        </code>
                        <span className={`git-change-name${entry.index === "?" || entry.index === "A" || entry.worktree === "A" ? " git-change-name-added" : ""}`}>
                          {filename(entry.path)}
                        </span>
                        {/[\\/]/.test(entry.path) && (
                          <span className="git-change-path">
                            {entry.path
                              .replaceAll("\\", "/")
                              .split("/")
                              .slice(0, -1)
                              .join("/")}
                          </span>
                        )}
                      </button>
                      {group === "unstaged" && (
                        <button
                          disabled={busy || entry.index === "?"}
                          title={
                            entry.index === "?"
                              ? "Untracked files have no saved Git version"
                              : "Roll back unstaged changes to this file"
                          }
                          aria-label={`Roll back ${entry.path}`}
                          onClick={() => void act("rollback", entry.path)}
                        >
                          <RotateCcw size={16} />
                        </button>
                      )}
                      {group === "conflicts" ? (
                        <button
                          disabled={busy}
                          onClick={() => void openInCode(entry.path)}
                          title="Edit conflict in Code"
                        >
                          Edit
                        </button>
                      ) : (
                        <button
                          disabled={busy}
                          title={
                            group === "staged" ? "Unstage file" : "Stage file"
                          }
                          aria-label={`${group === "staged" ? "Unstage" : "Stage"} ${entry.path}`}
                          onClick={() =>
                            void act(
                              group === "staged" ? "unstage" : "stage",
                              entry.path,
                            )
                          }
                        >
                          {group === "staged" ? (
                            <Minus size={13} />
                          ) : (
                            <Plus size={13} />
                          )}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              );
            })}
            <label className="git-control">
              Commit message
              <textarea
                ref={commitInput}
                aria-label="Commit message"
                value={commit}
                onChange={(e) => {
                  commitInitialized.current = true;
                  setCommit(e.target.value);
                }}
                placeholder="Describe these staged changes"
              />
            </label>
            {commitIntent && <p className="git-help">Stage the changes and enter a message, then choose Commit &amp; Push to review the destination.</p>}
            <div className="git-commit-actions">
              <button
                className="secondary-button"
                disabled={
                  busy ||
                  !!sequencer ||
                  hasConflicts ||
                  !commit.trim() ||
                  (!state.stagedRevision && !state.merging)
                }
                onClick={() => void act("commit", "", commit)}
              >
                Commit
              </button>
              <button
                disabled={
                  busy ||
                  !!sequencer ||
                  hasConflicts ||
                  !commit.trim() ||
                  (!state.stagedRevision && !state.merging) ||
                  !syncRemote ||
                  state.branch === "Detached HEAD"
                }
                title={
                  !syncRemote
                    ? "Configure a Git remote before pushing"
                    : "Review the destination, commit, and push"
                }
                className={commitIntent ? "primary-button" : "secondary-button"}
                onClick={() => setPushPrompt(true)}
              >
                Commit & Push…
              </button>
            </div>
            <section className="git-stash-section" aria-label="Stashes">
              <div className="git-list-heading">
                <strong>Stashes</strong>
                <button className="secondary-button" disabled={!hasChanges || !canChangeBranch} onClick={() => void act("stash")}>
                  Stash changes…
                </button>
              </div>
              {(state.stashes ?? []).map((stash) => (
                <div key={stash.hash}>
                  <div className="git-stash-row">
                    <button className="git-stash-open" disabled={busy}
                      aria-label={`Browse ${stash.reference}: ${stash.subject}`}
                      aria-expanded={view?.stash?.hash === stash.hash}
                      title={stash.subject}
                      onClick={() => view?.stash?.hash === stash.hash ? setView(null) : void inspectStash(stash)}>
                      {view?.stash?.hash === stash.hash ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      <span><code>{stash.reference}</code> {stash.subject}</span>
                    </button>
                    <button title={hasChanges ? "Commit or stash local changes first" : "Apply and keep this stash"} disabled={hasChanges || !canChangeBranch} onClick={() => void act("stash-apply", stash.reference, stash.hash)}>Apply</button>
                    <button className="danger-outline" disabled={!canChangeBranch} onClick={() => void act("stash-drop", stash.reference, stash.hash)}>Drop</button>
                  </div>
                  {view?.stash?.hash === stash.hash && <div className="git-stash-files" aria-label={`Files in ${stash.reference}`}>
                    {view.commitDiff?.files.length ? view.commitDiff.files.map((file, fileIndex) => (
                      <div className="git-change" key={fileIndex}>
                        <button disabled={busy} title={file.path} aria-pressed={view.stash?.fileIndex === fileIndex}
                          onClick={() => setView((current) => current?.stash?.hash === stash.hash
                            ? { ...current, stash: { ...current.stash, fileIndex } } : current)}>
                          <span className="git-change-name">{filename(file.path)}</span>
                          {/[\\/]/.test(file.path) && <span className="git-change-path">{file.path.slice(0, file.path.lastIndexOf("/"))}</span>}
                        </button>
                      </div>
                    )) : <p className="git-help">No file changes in this stash.</p>}
                  </div>}
                </div>
              ))}
            </section>
          </div>
          {sidebarView === "history" && (
            <>
              {state.head && (
                <form className="git-history-search" onSubmit={(event) => {
                  event.preventDefault();
                  if (!busy) void loadHistory(historyQuery.trim());
                }}>
                  <input type="search" aria-label="Search commit history" placeholder="Message or commit hash" value={historyQuery}
                    maxLength={250}
                    onChange={(event) => {
                      setHistoryQuery(event.target.value);
                      if (!event.target.value) setHistoryView(null);
                    }} />
                  <button className="secondary-button" type="submit" disabled={busy}>Search</button>
                </form>
              )}
              {!historyCommits.length && <p className="git-help">{currentHistory?.query ? "No matching commits." : "No commits yet."}</p>}
              {historyCommits.map(renderCommit)}
              {hasOlderCommits && <button className="secondary-button git-load-older" disabled={busy} onClick={() => void loadHistory(currentHistory?.query ?? "", true)}>Load older commits</button>}
            </>
          )}
          {sidebarView === "branches" && (
            <div className="git-branch-list">
              <div className="git-list-heading">
                <strong>Local</strong>
                <button
                  className="secondary-button"
                  disabled={!canChangeBranch || hasChanges}
                  title={hasChanges ? "Commit or stash local changes first" : undefined}
                  onClick={() => {
                    setActionError(null);
                    setComparison(null);
                    setView(null);
                    setBranchForm({ kind: "create", value: "" });
                  }}
                >
                  <Plus size={13} /> New branch
                </button>
              </div>
              {!localBranches.length && <p className="git-help">No local branches yet.</p>}
              {localBranches.map((name) => (
                <button
                  className="git-branch-row"
                  key={name}
                  title={name}
                  aria-pressed={!branchForm && !selectedRemote && name === selectedLocal}
                  disabled={busy}
                  onClick={() => selectBranch("local", name)}
                >
                  <GitBranch size={14} />
                  <span>{name}</span>
                  {name === state.branch && <small>Current</small>}
                </button>
              ))}
              {!!remoteBranches.length && <div className="git-list-heading"><strong>Remote</strong></div>}
              {remoteBranches.map(({ name }) => (
                <button
                  className="git-branch-row"
                  key={name}
                  title={name}
                  aria-pressed={!branchForm && selectedRemote?.name === name}
                  disabled={busy}
                  onClick={() => selectBranch("remote", name)}
                >
                  <GitBranch size={14} />
                  <span>{name}</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {pushPrompt && state && (
        <div className="code-modal-backdrop">
          <form
            className="file-operation-modal git-push-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Commit and push"
            onSubmit={(event) => {
              event.preventDefault();
              void commitAndPush();
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                setPushPrompt(false);
              }
            }}
          >
            <header>
              <strong>Commit and push</strong>
              <button
                type="button"
                aria-label="Close commit and push"
                onClick={() => setPushPrompt(false)}
              >
                <X size={17} />
              </button>
            </header>
            <div className="git-push-options">
              <div className="git-push-summary">
                <code>{filename(root)}</code>
                <ArrowRight size={14} aria-hidden="true" />
                <span>push <strong>{state.branch}</strong> · {stagedCount} staged {stagedCount === 1 ? "file" : "files"}</span>
              </div>
              <div className="git-push-fields">
                {tracking?.remote ? (
                  <>
                    <span className="git-push-field-label">Destination</span>
                    <strong>{syncDestination}</strong>
                  </>
                ) : (
                  <>
                    <label htmlFor={`${pushDialogId}-remote`}>Remote</label>
                    <CustomSelect
                      id={`${pushDialogId}-remote`}
                      aria-label="Commit push remote"
                      value={remote}
                      onChange={(event) => setRemote(event.target.value)}
                    >
                      {state.remotes.map((name) => (
                        <option key={name}>{name}</option>
                      ))}
                    </CustomSelect>
                  </>
                )}
                <span className="git-push-field-label" id={`${pushDialogId}-message`}>Message</span>
                <pre aria-labelledby={`${pushDialogId}-message`}>{commit}</pre>
              </div>
            </div>
            <footer>
              <button className="secondary-button" type="button" onClick={() => setPushPrompt(false)}>
                Cancel
              </button>
              <button
                className="primary-button"
                type="submit"
                disabled={busy || !syncRemote || !!sequencer}
              >
                Commit and push
              </button>
            </footer>
          </form>
        </div>
      )}
      {createPortal(
        <div className="git-main">
          {toolbar}
          {feedback ? (
            <div className="git-feedback">
              <AlertTriangle size={17} aria-hidden="true" />
              <div className="git-feedback-content" role="alert">
                <strong>{feedback.title}</strong>
                <p tabIndex={0}>{feedback.detail}</p>
              </div>
              {actionError ? (
                <button className="icon-button" type="button" aria-label="Dismiss Git message" onClick={() => setActionError(null)}>
                  <X size={15} />
                </button>
              ) : (
                <button className="secondary-button" type="button" disabled={busy} onClick={() => void refresh()}>
                  Retry
                </button>
              )}
            </div>
          ) : message && <p className="git-message" role="status">{message}</p>}
          {sequencer && (
            <div className="git-operation" role="group" aria-label="Git operation in progress">
              <div>
                <strong>{sequencer === "rebase" ? "Rebase in progress" : "Cherry-pick in progress"}</strong>
                <p className="git-help">{hasConflicts ? "Open a conflicted file in Changes, then resolve and stage it." : "Review staged changes before continuing."}</p>
              </div>
              {sidebarView !== "changes" && <button className="secondary-button" disabled={busy} onClick={showOperation}>Show Changes</button>}
              <button className="primary-button" disabled={busy || hasConflicts} onClick={() => void act(`continue-${sequencer}`)}>Continue</button>
              <button className="secondary-button" disabled={busy} onClick={() => void act(`abort-${sequencer}`)}>Abort…</button>
            </div>
          )}
          {view && (
            <section
              className="code-review-modal git-inline-review"
              aria-label="Git diff"
            >
              <header>
                <strong>
                  {view.stash ? "Stash" : view.compared ? "Branch diff" : view.historical
                    ? "Commit"
                    : view.staged
                      ? "Staged"
                      : "Working tree"}{" "}
                  · {view.path}
                </strong>
                <button aria-label="Close Git diff" onClick={() => setView(null)}>
                  <X size={17} />
                </button>
              </header>
              {(view.stash || view.historical || view.compared) && view.commitDiff?.files.length ? (
                <div className="git-hunk-review">
                  {view.stash ? <p className="git-help">{view.stash.subject}</p> : <details className="git-patch-details">
                    <summary>{view.compared ? "Diff summary" : "Commit details"}</summary>
                    <pre className="git-patch-header">{view.commitDiff.header}</pre>
                  </details>}
                  {(view.stash ? view.commitDiff.files.filter((_, index) => index === view.stash!.fileIndex) : view.commitDiff.files).map((file, fileIndex) => <section className="git-commit-file" key={fileIndex}>
                    <h3>{file.path}</h3>
                    {file.hunks.length ? <>
                      <details className="git-patch-details"><summary>File details</summary><pre className="git-patch-header">{file.header}</pre></details>
                      {file.hunks.map((hunk, index) => <section className="git-hunk" key={index}>
                        <label><span>Change {index + 1}</span><code className="git-hunk-range">{hunk.split("\n")[0]}</code></label>
                        <GitDiffHunk source={hunk} path={file.path} />
                      </section>)}
                    </> : <pre className="git-raw-patch">{file.header}</pre>}
                  </section>)}
                </div>
              ) : view.hunks?.hunks.length ? (
                <div className="git-hunk-review">
                  <details className="git-patch-details">
                    <summary>Patch details</summary>
                    <pre className="git-patch-header">{view.hunks.header}</pre>
                  </details>
                  {view.hunks.hunks.map((hunk, index) => (
                    <section className="git-hunk" key={index}>
                      <label>
                        {view.hunks?.supported && (
                          <input
                            type="checkbox"
                            checked={chosenHunks.includes(index)}
                            onChange={(event) =>
                              setChosenHunks((previous) =>
                                event.target.checked
                                  ? [...previous, index]
                                  : previous.filter((value) => value !== index),
                              )
                            }
                          />
                        )}
                        <span>Change {index + 1}</span>
                        <code className="git-hunk-range">
                          {hunk.split("\n")[0]}
                        </code>
                      </label>
                      <GitDiffHunk source={hunk} path={view.path} />
                    </section>
                  ))}
                </div>
              ) : (
                <pre className="git-diff">
                  {view.text
                    ? view.text.split("\n").map((line, index) => (
                        <span
                          key={index}
                          className={
                            line.startsWith("+") && !line.startsWith("+++")
                              ? "git-raw-added"
                              : line.startsWith("-") && !line.startsWith("---")
                                ? "git-raw-removed"
                                : undefined
                          }
                        >
                          {line}
                          {"\n"}
                        </span>
                      ))
                    : "No textual differences."}
                </pre>
              )}
              <footer>
                {view.historical && (
                  <button className="secondary-button" disabled={busy || hasChanges || inProgress || state?.branch === "Detached HEAD"} onClick={() => void act("cherry-pick", "", view.path)}>
                    Cherry-pick…
                  </button>
                )}
                {view.historical && <button className="secondary-button" disabled={busy || hasChanges || inProgress} onClick={() => { const hash = view.path; setView(null); void act("revert", "", hash); }}>Revert commit…</button>}
                {!view.stash && !view.historical && !view.compared && (
                  <>
                    <button
                      onClick={() => {
                        void openInCode(view.path);
                        setView(null);
                      }}
                    >
                      Open in Code
                    </button>
                    <button
                      className="secondary-button"
                      disabled={busy}
                      onClick={() =>
                        void act(
                          view.staged ? "unstage" : "stage",
                          view.path,
                          "",
                          view.staged ? undefined : view.text,
                        )
                      }
                    >
                      {" "}
                      {view.staged ? "Unstage" : "Stage"} whole file
                    </button>
                    {view.hunks?.supported && (
                      <button
                        className="primary-button"
                        disabled={busy || !chosenHunks.length}
                        onClick={() => void applyChosenHunks()}
                      >
                        {view.staged ? "Unstage" : "Stage"} selected hunks
                      </button>
                    )}
                  </>
                )}
              </footer>
            </section>
          )}
          {merge && (
            <section
              className="code-review-modal git-inline-review merge-conflict-modal"
              aria-label="Merge conflict"
            >
              <header>
                <strong>Conflict · {merge.path}</strong>
                <button aria-label="Close merge" onClick={() => setMerge(null)}>
                  <X size={17} />
                </button>
              </header>
              {renderMerge(`${root}/${merge.path}`, merge.data)}
              <footer>
                <button
                  className="secondary-button"
                  onClick={() => {
                    void openInCode(merge.path);
                    setMerge(null);
                  }}
                >
                  Edit result in Code
                </button>
                <button
                  className="primary-button"
                  disabled={busy}
                  onClick={() => void act("resolve", merge.path)}
                >
                  Validate & stage result
                </button>
              </footer>
            </section>
          )}
          {state && comparison && !view && !merge && (
            <section className="git-branch-detail git-comparison" aria-label="Branch comparison">
              <header>
                <div>
                  <h2>{comparison.baseBranch} and {comparison.name}</h2>
                  <p className="git-help">{comparison.ahead} outgoing · {comparison.behind} incoming</p>
                </div>
                <button className="secondary-button" disabled={busy || !comparison.stat} onClick={() => void inspectComparisonDiff()}>View branch diff</button>
                <button className="secondary-button" disabled={busy} onClick={() => void openComparison(comparison.target)}>Refresh comparison</button>
                <button className="icon-button" aria-label="Close branch comparison" onClick={() => setComparison(null)}><X size={15} /></button>
              </header>
              {comparison.target.kind === "upstream" && comparison.ahead > 0 && comparison.behind > 0 && (
                <div className="git-comparison-resolution">
                  <strong>Both branches have new commits</strong>
                  <p className="git-help">
                    {hasChanges ? "Commit or stash local changes before integrating the upstream."
                      : "Merge keeps both histories. Rebase replays your local commits on top of the upstream."}
                  </p>
                  <div className="git-branch-actions">
                    <button className="secondary-button" disabled={!canChangeBranch || hasChanges || comparisonStale} onClick={() => void act("merge-upstream", comparison.reference, comparison.targetHead)}>Merge upstream…</button>
                    <button className="secondary-button" disabled={!canChangeBranch || hasChanges || comparisonStale} onClick={() => void act("rebase-upstream", comparison.reference, comparison.targetHead)}>Rebase onto upstream…</button>
                  </div>
                </div>
              )}
              {comparisonStale && <p className="git-help">The checked-out branch or commit changed. Refresh the comparison to see the latest commits.</p>}
              <div className="git-comparison-columns">
                {(["incoming", "outgoing"] as const).map((direction) => (
                  <section key={direction} aria-label={direction === "incoming" ? "Incoming commits" : "Outgoing commits"}>
                    <h3>{direction === "incoming" ? "Incoming commits" : "Outgoing commits"}</h3>
                    {comparison[direction].commits.length ? comparison[direction].commits.map(renderCommit) : <p className="git-help">No {direction} commits.</p>}
                    {comparison[direction].hasMore && <button className="secondary-button git-load-older" disabled={busy} onClick={() => void loadComparisonPage(direction)}>Load more</button>}
                  </section>
                ))}
              </div>
              {comparison.stat && (
                <details className="git-comparison-stat">
                  <summary>Changed files between branches</summary>
                  <pre>{comparison.stat}</pre>
                </details>
              )}
            </section>
          )}
          {state && sidebarView === "branches" && !comparison && !view && !merge && (
            <section className="git-branch-detail" aria-label="Branch details">
              {branchForm ? (
                <form
                  className="git-branch-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const name = branchForm.value.trim();
                    if (!name || !canChangeBranch) return;
                    if (branchForm.kind === "create" && !hasChanges) void act("create-branch", "", name);
                    if (branchForm.kind === "rename" && name !== branchForm.name && localBranches.includes(branchForm.name))
                      void act("rename-branch", branchForm.name, name);
                  }}
                >
                  <h2>{branchForm.kind === "create" ? "New branch" : `Rename ${branchForm.name}`}</h2>
                  <label className="git-control">
                    Branch name
                    <input
                      autoFocus
                      value={branchForm.value}
                      onChange={(event) => setBranchForm({ ...branchForm, value: event.target.value })}
                      onKeyDown={(event) => {
                        if (event.key === "Escape" && !busy) {
                          event.preventDefault();
                          setBranchForm(null);
                        }
                      }}
                      readOnly={busy}
                    />
                  </label>
                  <div className="git-branch-actions">
                    <button className="primary-button" type="submit" disabled={!canChangeBranch || !branchForm.value.trim() || (branchForm.kind === "create" ? hasChanges : branchForm.name === branchForm.value.trim() || !localBranches.includes(branchForm.name))}>
                      {branchForm.kind === "create" ? "Create & switch" : "Rename branch"}
                    </button>
                    <button className="secondary-button" type="button" disabled={busy} onClick={() => setBranchForm(null)}>Cancel</button>
                  </div>
                </form>
              ) : selectedRemote ? (
                <>
                  <h2>{selectedRemote.name}</h2>
                  <p className="git-help">Remote branch</p>
                  <div className="git-branch-actions">
                    <button className="secondary-button" disabled={busy || !state.head} onClick={() => void openComparison({ kind: "remote", name: selectedRemote.name })}>Compare with current</button>
                    {existingTrackingBranch
                      ? <button className="secondary-button" disabled={busy} onClick={() => selectBranch("local", selectedRemote.localName)}>View local branch</button>
                      : <button className="primary-button" disabled={!canChangeBranch || hasChanges} onClick={() => void act("track-branch", "", selectedRemote.name)}>Track & switch…</button>}
                  </div>
                </>
              ) : selectedLocal ? (
                <>
                  <h2>{selectedLocal}</h2>
                  <p className="git-help">{currentBranch ? "Current branch" : "Local branch"}</p>
                  <div className="git-branch-actions">
                    {!currentBranch && <>
                      <button className="primary-button" disabled={!canChangeBranch} onClick={() => void act("switch", "", selectedLocal)}>Switch branch</button>
                      <button className="secondary-button" disabled={busy || !state.head} onClick={() => void openComparison({ kind: "local", name: selectedLocal })}>Compare with current</button>
                      <button className="secondary-button" disabled={!canChangeBranch || hasChanges} onClick={() => void act("merge", "", selectedLocal)}>Merge into {state.branch}…</button>
                    </>}
                    <button className="secondary-button" disabled={!canChangeBranch} onClick={() => setBranchForm({ kind: "rename", name: selectedLocal, value: selectedLocal })}>Rename…</button>
                    {!currentBranch && <button className="secondary-button danger-outline" disabled={!canChangeBranch} onClick={() => void act("delete-branch", selectedLocal)}>Delete…</button>}
                  </div>
                </>
              ) : <p className="git-help">Select a branch to view its actions.</p>}
              {inProgress && (
                <p className="git-help">Finish or abort the current operation before changing branches.</p>
              )}
              {hasChanges && !inProgress && !branchForm && (
                selectedRemote && !existingTrackingBranch
                  ? <p className="git-help">Commit or stash local changes before tracking this branch.</p>
                  : !selectedRemote && selectedLocal && !currentBranch
                    ? <p className="git-help">Commit or stash local changes before merging.</p>
                    : null
              )}
            </section>
          )}
          {!view && !merge && !comparison && (state ? sidebarView !== "branches" : !repositoryError) && (
            <div className="git-main-empty">
              {state?.merging ? <p>Merge in progress. Resolve conflicts, review staged files, then commit.</p> : null}
              <p>{state ? sidebarView === "history"
                ? "Select a commit to review its changes."
                : state.entries.length
                  ? "Select a changed file to review it."
                  : "No working tree changes."
                : desktop ? "Loading repository…" : "Git operations are available in the desktop app."}</p>
            </div>
          )}
        </div>,
        overlayHost ?? document.body,
      )}
    </div>
  );
}
