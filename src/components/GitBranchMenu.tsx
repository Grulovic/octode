import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowDownUp, ArrowRight, Check, ChevronDown, ChevronRight, GitBranch, Plus, RefreshCw, Search } from "./DesignIcons";
import type { GitSnapshot } from "../devTypes";

export type GitMenuAction = "update" | "commit" | "commit-push" | "push" | "new-branch" | "fetch";

export default function GitBranchMenu({ state, folder, disabled, canSwitch, canSync, onAction, onSwitch }: {
  state: GitSnapshot;
  folder: string;
  disabled: boolean;
  canSwitch: boolean;
  canSync: boolean;
  onAction: (action: GitMenuAction) => void;
  onSwitch: (name: string, remote: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [localOpen, setLocalOpen] = useState(true);
  const [remoteOpen, setRemoteOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const mac = navigator.platform.toLowerCase().includes("mac");
  const shortcut = (key: string, shift = false, alt = false) => mac
    ? `${alt ? "⌥" : ""}${shift ? "⇧" : ""}⌘${key}`
    : `Ctrl+${alt ? "Alt+" : ""}${shift ? "Shift+" : ""}${key}`;
  const close = (focus = false) => {
    setOpen(false);
    if (focus) trigger.current?.focus({ preventScroll: true });
  };
  useLayoutEffect(() => {
    if (!open || !popup.current || !trigger.current) return;
    const rect = trigger.current.getBoundingClientRect();
    const width = Math.min(370, window.innerWidth - 16);
    Object.assign(popup.current.style, {
      width: `${width}px`,
      left: `${Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))}px`,
      top: `${rect.bottom + 6}px`,
      maxHeight: `${Math.max(80, window.innerHeight - rect.bottom - 14)}px`,
    });
    search.current?.focus({ preventScroll: true });
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!popup.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) close();
    };
    const dismiss = () => close();
    const scroll = (event: Event) => { if (!(event.target instanceof Node) || !popup.current?.contains(event.target)) close(); };
    window.addEventListener("pointerdown", outside, true);
    window.addEventListener("octode-dismiss-popovers", dismiss);
    window.addEventListener("blur", dismiss);
    window.addEventListener("resize", dismiss);
    window.addEventListener("scroll", scroll, true);
    return () => {
      window.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("octode-dismiss-popovers", dismiss);
      window.removeEventListener("blur", dismiss);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("scroll", scroll, true);
    };
  }, [open]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  const needle = query.trim().toLocaleLowerCase();
  const locals = state.branches.filter((name) => name.toLocaleLowerCase().includes(needle));
  const remotes = (state.remoteBranches ?? []).filter(({ name }) => name.toLocaleLowerCase().includes(needle));
  const actions = [
    { id: "update", label: "Update Project…", key: shortcut("T"), icon: RefreshCw, blocked: !canSync },
    { id: "commit", label: "Commit…", key: shortcut("K"), icon: Check },
    { id: "commit-push", label: "Commit and Push…", key: shortcut("K", false, true), icon: ArrowDownUp },
    { id: "push", label: "Push…", key: shortcut("K", true), icon: ArrowRight, blocked: !canSync },
    { id: "fetch", label: "Fetch", icon: RefreshCw, blocked: !state.remotes.length },
    { id: "new-branch", label: "New Branch…", icon: Plus, blocked: !canSwitch || !!state.entries.length },
  ] as const;
  return <>
    <button ref={trigger} type="button" className="custom-select project-nav-select git-branch-menu-trigger"
      aria-label="Current project branch" aria-haspopup="dialog" aria-expanded={open} disabled={disabled}
      title={`Git branches and actions in ${folder}`}
      onClick={() => {
        if (open) close();
        else { window.dispatchEvent(new Event("octode-dismiss-popovers")); setQuery(""); setOpen(true); }
      }}>
      <span className="custom-select-label"><GitBranch size={13} /><span>{state.branch}</span></span>
      <ChevronDown size={14} aria-hidden="true" />
    </button>
    {open && createPortal(<div ref={popup} className="custom-select-popup git-branch-popup" role="dialog" aria-label="Git branches and actions"
      onKeyDown={(event) => {
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(true); }
        if (["ArrowDown", "ArrowUp"].includes(event.key)) {
          event.preventDefault();
          const items = [search.current, ...popup.current!.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")].filter(Boolean) as HTMLElement[];
          const index = items.indexOf(document.activeElement as HTMLElement);
          items[(index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
        }
        if (event.key === "Tab") close();
      }}>
      <label className="git-branch-menu-search"><Search size={14} /><input ref={search} type="search" aria-label="Search Git branches" placeholder="Search branches…"
        value={query} onChange={(event) => setQuery(event.target.value)} spellCheck={false} autoCorrect="off" autoCapitalize="off"
        onKeyDown={(event) => {
          if (event.key === "Enter" && needle) {
            const first = popup.current?.querySelector<HTMLButtonElement>(".git-branch-menu-row:not(:disabled)");
            if (first) { event.preventDefault(); first.click(); }
          }
        }} /></label>
      <div className="git-branch-menu-context" title={folder}>{folder}</div>
      {!needle && <div className="git-branch-menu-actions">{actions.map(({ id, label, icon: Icon, ...action }) =>
        <button key={id} type="button" data-action={id} className="custom-select-option" disabled={disabled || ("blocked" in action && action.blocked)}
          onClick={() => { close(); onAction(id); }}>
          <Icon size={14} /><span>{label}</span>{"key" in action && <kbd>{action.key}</kbd>}
        </button>)}</div>}
      <div className="git-branch-menu-branches">
        <button type="button" className="git-branch-menu-group" aria-expanded={!!needle || localOpen} onClick={() => setLocalOpen(!localOpen)}>
          {needle || localOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />} Local
        </button>
        {(needle || localOpen) && locals.map((name) => <button key={name} type="button" className="custom-select-option git-branch-menu-row"
          aria-current={name === state.branch ? "true" : undefined} disabled={!canSwitch}
          onClick={() => { close(true); if (name !== state.branch) onSwitch(name, false); }}>
          <GitBranch size={14} /><span>{name}</span>{name === state.branch && <Check size={14} />}
          {name === state.branch && state.tracking?.name && <small>{state.tracking.name}</small>}
        </button>)}
        <button type="button" className="git-branch-menu-group" aria-expanded={!!needle || remoteOpen} onClick={() => setRemoteOpen(!remoteOpen)}>
          {needle || remoteOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />} Remote
        </button>
        {(needle || remoteOpen) && remotes.map(({ name, localName }) => <button key={name} type="button" className="custom-select-option git-branch-menu-row"
          disabled={!canSwitch || state.branches.includes(localName)} title={state.branches.includes(localName) ? `Local branch ${localName} already exists` : `Track as ${localName}`}
          onClick={() => { close(true); onSwitch(name, true); }}>
          <GitBranch size={14} /><span>{name}</span><small>{localName}</small>
        </button>)}
        {needle && !locals.length && !remotes.length && <p className="git-help">No matching branches.</p>}
      </div>
    </div>, document.body)}
  </>;
}
