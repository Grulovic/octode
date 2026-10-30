import { createPortal } from "react-dom";
import { filename, folderBranchLabel } from "../lib/workspace";
import CustomSelect from "./CustomSelect";
import GitDiffHunk from "./GitDiffHunk";
import {
  type ReactNode,
  useCallback,
  useId,
  useEffect,
  useRef,
  useState,
} from "react";
import { Minus } from "lucide-react";
import { GitBranch, Plus, RefreshCw, X, RotateCcw, ArrowRight, ChevronDown, ChevronRight } from "./DesignIcons";
import { desktop, invoke } from "../lib/bridge";
import { confirmAction } from "./ToolLayout";
import type { GitEntry, GitSnapshot, GitConflict } from "../devTypes";
import type { Project } from "../types";
import "./code-tools.css";
export default function GitPanel({
  project,
  overlayHost,
  root,
  visible,
  revision,
  onError,
  beforeAction,
  onChanged,
  onOpen,
  onBusy,
  onCount,
  renderMerge,
  onChooseVersion,
}: {
  project: Project;
  overlayHost?: Element;
  root: string;
  visible: boolean;
  revision: number;
  onError: (error: string) => void;
  beforeAction: () => Promise<boolean>;
  onChanged: () => Promise<void>;
  onBusy: (busy: boolean) => void;
  onCount?: (count: number) => void;
  onOpen: (path: string) => Promise<void>;
  renderMerge: (path: string) => ReactNode;
  onChooseVersion: (path: string, text: string) => void;
}) {
  const [state, setState] = useState<GitSnapshot | null>(null);
  useEffect(() => { if (state) onCount?.(state.entries.length); }, [state, onCount]);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [commit, setCommit] = useState("");
  const [pushPrompt, setPushPrompt] = useState(false);
  const [branch, setBranch] = useState("");
  const [newBranch, setNewBranch] = useState("");
  const [remote, setRemote] = useState("");
  const [view, setView] = useState<{
    path: string;
    text: string;
    staged: boolean;
    hunks?: { header: string; hunks: string[]; supported: boolean };
    historical?: boolean;
  } | null>(null);
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [chosenHunks, setChosenHunks] = useState<number[]>([]);
  const [merge, setMerge] = useState<{
    path: string;
    data: GitConflict;
  } | null>(null);
  const [activeHistory, setHistory] = useState(false);
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
    if (!desktop) {
      setError("Git operations are available in the desktop app.");
      return;
    }
    try {
      const snapshot = await invoke<GitSnapshot>("git_snapshot", {
        projectId: project.id,
        root,
      });
      if (mounted.current && epoch.current === version) {
        setState(snapshot);
        setError("");
        setRemote((previous) =>
          snapshot.remotes.includes(previous)
            ? previous
            : (snapshot.remotes[0] ?? ""),
        );
      }
    } catch (reason) {
      if (mounted.current && epoch.current === version)
        setError(String(reason));
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
    setPushPrompt(false);
    setView(null);
    setMerge(null);
    void refresh();
  }, [refresh]);
  useEffect(() => {
    if (!visible) return;
    void refresh();
    const timer = setInterval(() => {
      if (!working.current) void refresh();
    }, 5000);
    return () => clearInterval(timer);
  }, [visible, revision, refresh]);
  const task = async (job: () => Promise<void>) => {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    onBusy(true);
    setMessage("");
    setActionError("");
    try {
      await job();
    } catch (reason) {
      if (mounted.current) setActionError(String(reason));
      onError(String(reason));
    } finally {
      await refresh();
      working.current = false;
      onBusy(false);
      if (mounted.current) setBusy(false);
    }
  };
  const act = (action: string, path = "", value = "", reviewedDiff?: string) =>
    task(async () => {
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
        "create-branch",
        "merge",
        "pull",
        "push",
        "stash",
        "stash-apply",
        "resolve",
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
                  : `${action} ${value || path || remote}?`,
        ))
      )
        return;
      const result = await invoke<string>("git_action", {
        projectId: project.id,
        root,
        request: {
          action,
          path,
          value,
          remote,
          expectedHead: state.head,
          expectedStaged: state.stagedRevision,
          reviewedDiff,
        },
      });
      if (mounted.current) {
        setMessage(result || `${action} completed`);
        if (action === "commit") setCommit("");
        if (action === "resolve") setMerge(null);
        if (action === "stage" || action === "unstage" || action === "rollback")
          setView(null);
      }
      await onChanged();
    });
  const changeAll = (entries: GitEntry[], staged: boolean) =>
    task(async () => {
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
    task(async () => {
      if (
        !state ||
        !commit.trim() ||
        !state.remotes.includes(remote) ||
        state.branch === "Detached HEAD"
      )
        return;
      if (!(await beforeAction()))
        throw new Error("Save or resolve Code conflicts before changing Git.");
      setPushPrompt(false);
      await invoke<string>("git_action", {
        projectId: project.id,
        root,
        request: {
          action: "commit",
          path: "",
          value: commit,
          remote,
          expectedHead: state.head,
          expectedStaged: state.stagedRevision,
        },
      });
      setCommit("");
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
            path: "",
            value: "",
            remote,
            expectedHead: committed.head,
            expectedStaged: committed.stagedRevision,
          },
        });
        setMessage(`Committed and pushed ${state.branch} to ${remote}.`);
      } catch (reason) {
        setMessage("Commit saved locally.");
        throw new Error(
          `Commit succeeded locally, but push failed: ${String(reason)}. Use Push in Branches & remotes to retry; you do not need to commit again.`,
        );
      } finally {
        await onChanged();
      }
    });
  const showDiff = (entry: GitEntry, staged: boolean) =>
    task(async () => {
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
      setView({ path: entry.path, text: data.patch, staged, hunks: data });
    });
  const applyChosenHunks = () =>
    task(async () => {
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
  const inspectCommit = (hash: string) =>
    task(async () => {
      const text = await invoke<string>("git_show_commit", {
        projectId: project.id,
        root,
        hash,
      });
      setView({ path: hash, text, staged: false, historical: true });
    });
  const conflict = (entry: GitEntry) =>
    task(async () => {
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
      setMerge({ path: entry.path, data });
    });
  const pushDialogId = useId();
  const stagedCount = state?.entries.filter((entry) => !entry.conflict && entry.index !== " " && entry.index !== "?").length ?? 0;
  return (
    <div className="git-tools">
      <div className="git-heading">
        <GitBranch size={14} />
        {state ? (
          <CustomSelect
            className="git-branch-switch"
            aria-label={`Switch branch in ${root.split("/").pop()}`}
            title={`Switch branch in ${root}`}
            value={state.branch}
            disabled={busy || state.merging}
            onChange={(event) => {
              if (event.target.value !== state.branch)
                void act("switch", "", event.target.value);
            }}
          >
            {!state.branches.includes(state.branch) && (
              <option value={state.branch}>
                {folderBranchLabel(root, state.branch)}
              </option>
            )}
            {state.branches.map((name) => (
              <option key={name} value={name}>
                {folderBranchLabel(root, name)}
              </option>
            ))}
          </CustomSelect>
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
      </div>
      {error && <p className="git-help">{error}</p>}
      {busy && (
        <p className="git-help" role="status">
          Working…
        </p>
      )}
      {actionError && (
        <p className="git-help git-action-error" role="alert">
          {actionError}
        </p>
      )}
      {message && (
        <pre className="git-message" role="status">
          {message}
        </pre>
      )}
      {state && (
        <>
          <p className="git-help">
            {state.merging
              ? "Merge in progress. Resolve conflicts, review staged files, then commit."
              : `${state.head.slice(0, 8) || "No commits yet"} · ${state.entries.length} changed files`}
          </p>
          {state.merging && (
            <button
              className="secondary-button git-wide"
              disabled={busy}
              onClick={() => void act("abort-merge")}
            >
              Abort merge…
            </button>
          )}
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
                      <span className="git-change-name">
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
                        onClick={() => onOpen(`${root}/${entry.path}`)}
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
              aria-label="Commit message"
              value={commit}
              onChange={(e) => setCommit(e.target.value)}
              placeholder="Describe these staged changes"
            />
          </label>
          <div className="git-commit-actions">
            <button
              className="secondary-button"
              disabled={
                busy ||
                !commit.trim() ||
                (!state.stagedRevision && !state.merging)
              }
              onClick={() => void act("commit", "", commit)}
            >
              Commit
            </button>
            <button
              className="secondary-button"
              disabled={
                busy ||
                !commit.trim() ||
                (!state.stagedRevision && !state.merging) ||
                !state.remotes.length ||
                state.branch === "Detached HEAD"
              }
              title={
                !state.remotes.length
                  ? "Configure a Git remote before pushing"
                  : "Review the destination, commit, and push"
              }
              onClick={() => setPushPrompt(true)}
            >
              Commit & Push…
            </button>
          </div>
          <details className="git-options">
            <summary><ChevronRight size={16} />Branches & remotes</summary>
            <label className="git-control">
              Branch to merge
              <CustomSelect
                aria-label="Git merge branch"
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
              >
                <option value="">Select branch to merge…</option>
                {state.branches.map((name) => (
                  <option key={name}>{name}</option>
                ))}
              </CustomSelect>
            </label>
            <div className="git-action-row">
              <button
                disabled={
                  busy || !branch || branch === state.branch || state.merging
                }
                onClick={() => void act("merge", "", branch)}
              >
                Merge
              </button>
            </div>
            <input
              aria-label="New branch name"
              placeholder="New branch name"
              value={newBranch}
              onChange={(e) => setNewBranch(e.target.value)}
            />
            <button
              disabled={busy || !newBranch.trim()}
              onClick={() => void act("create-branch", "", newBranch)}
            >
              Create & switch
            </button>
            <label className="git-control">
              Remote
              <CustomSelect
                aria-label="Git remote"
                value={remote}
                onChange={(e) => setRemote(e.target.value)}
              >
                <option value="">Select remote…</option>
                {state.remotes.map((name) => (
                  <option key={name}>{name}</option>
                ))}
              </CustomSelect>
            </label>
            <div className="git-action-row">
              {["fetch", "pull", "push"].map((action) => (
                <button
                  key={action}
                  disabled={busy || !remote}
                  onClick={() => void act(action)}
                >
                  {action === "pull" ? "Pull (FF only)" : action}
                </button>
              ))}
            </div>
            <div className="git-action-row">
              <button
                disabled={busy || !state.entries.length || state.merging}
                onClick={() => void act("stash")}
              >
                Stash changes
              </button>
              <button
                disabled={busy || !!state.entries.length || state.merging}
                onClick={() => void act("stash-apply")}
              >
                Apply latest stash
              </button>
            </div>
            <p className="git-help">
              Applying keeps the stash. Network operations use your configured
              Git credentials and SSH agent.
            </p>
          </details>
          <button
            className="git-wide git-history-toggle"
            aria-expanded={activeHistory}
            onClick={() => setHistory((value) => !value)}
          >
            {activeHistory ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            Recent commits ({state.history.length})
          </button>
          {activeHistory &&
            state.history.map((item) => (
              <button
                className="git-history"
                key={item.hash}
                disabled={busy}
                onClick={() => void inspectCommit(item.hash)}
              >
                <code>{item.hash.slice(0, 8)}</code>
                <strong>{item.subject}</strong>
                <small>
                  {item.author} · {item.date.slice(0, 10)}
                </small>
              </button>
            ))}
        </>
      )}
      {busy && <p role="status">Git is working…</p>}

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
                disabled={busy || !state.remotes.includes(remote)}
              >
                Commit and push
              </button>
            </footer>
          </form>
        </div>
      )}
      {view && createPortal(
        <div className="code-modal-backdrop git-editor-diff">
          <section
            className="code-review-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Git diff"
          >
            <header>
              <strong>
                {view.historical
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
            {view.hunks?.hunks.length ? (
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
              {!view.historical && (
                <>
                  <button
                    onClick={() => {
                      onOpen(`${root}/${view.path}`);
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
        </div>
      , overlayHost ?? document.body)}
      {merge && (
        <div className="code-modal-backdrop">
          <section
            className="code-review-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Merge conflict"
          >
            <header>
              <strong>Merge · {merge.path}</strong>
              <button aria-label="Close merge" onClick={() => setMerge(null)}>
                <X size={17} />
              </button>
            </header>
            <p className="git-help">
              Compare the three versions and edit the result below. Code
              autosaves it; validate and stage when the result is ready.
            </p>
            <div className="merge-sources">
              {[
                ["Base", merge.data.base],
                ["Ours (current branch)", merge.data.ours],
                ["Theirs (incoming branch)", merge.data.theirs],
              ].map(([title, text]) => (
                <div key={title}>
                  <strong>{title}</strong>
                  {title !== "Base" && (
                    <button
                      disabled={busy}
                      onClick={async () => {
                        if (
                          await confirmAction(
                            `Replace the entire result with ${title}? Code will autosave the result.`,
                          )
                        )
                          onChooseVersion(`${root}/${merge.path}`, text);
                      }}
                    >
                      Use this version
                    </button>
                  )}
                  <pre>{text}</pre>
                </div>
              ))}
            </div>
            <strong className="merge-result-label">
              Result · Code autosaves
            </strong>
            <div className="merge-editor">
              {renderMerge(`${root}/${merge.path}`)}
            </div>
            <footer>
              <button
                className="secondary-button"
                onClick={() => {
                  onOpen(`${root}/${merge.path}`);
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
        </div>
      )}
    </div>
  );
}
