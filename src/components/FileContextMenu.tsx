import { useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Files } from "lucide-react";
import { Copy, ClipboardPaste, Scissors, Link, Pencil, FolderOpen, FilePlus, FolderPlus, Trash2 } from "./DesignIcons";
import type { FileEntry } from "../types";
import { desktop } from "../lib/bridge";
export type FileMenuAction =
  | "create-file"
  | "create-folder"
  | "delete"
  | "copy"
  | "paste"
  | "cut"
  | "copy-path"
  | "rename"
  | "duplicate"
  | "reveal";
export async function copyPathToClipboard(path: string) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(path);
      return;
    } catch {
      /* Older WebViews use the selection fallback. */
    }
  }
  const previous = document.activeElement;
  const field = document.createElement("textarea");
  field.value = path;
  field.style.position = "fixed";
  field.style.opacity = "0";
  document.body.append(field);
  field.select();
  try {
    if (!document.execCommand("copy"))
      throw new Error("Could not copy the path to the clipboard");
  } finally {
    field.remove();
    if (previous instanceof HTMLElement && previous.isConnected)
      previous.focus();
  }
}
export default function FileContextMenu({
  entry,
  point,
  canPaste,
  isRoot,
  onAction,
  onClose,
}: {
  entry: FileEntry;
  point: { x: number; y: number };
  canPaste: boolean;
  isRoot: boolean;
  onAction: (action: FileMenuAction) => void;
  onClose: () => void;
}) {
  const menu = useRef<HTMLDivElement>(null);
  const previousFocus = useRef(document.activeElement);
  useLayoutEffect(() => {
    const element = menu.current;
    if (!element) return;
    const bounds = element.getBoundingClientRect();
    element.style.left = `${Math.max(8, Math.min(point.x, window.innerWidth - bounds.width - 8))}px`;
    element.style.top = `${Math.max(8, Math.min(point.y, window.innerHeight - bounds.height - 8))}px`;
    element.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }, [point]);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node)) onClose();
    };
    window.addEventListener("pointerdown", outside, true);
    window.addEventListener("resize", onClose);
    window.addEventListener("octode-dismiss-popovers", onClose);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("octode-dismiss-popovers", onClose);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);
  const actions = [
    { id: "create-file", label: "New File", Icon: FilePlus, disabled: false },
    { id: "create-folder", label: "New Folder", Icon: FolderPlus, disabled: false },
    { id: "copy", label: "Copy", Icon: Copy, disabled: entry.directory },
    { id: "paste", label: "Paste", Icon: ClipboardPaste, disabled: !canPaste },
    { id: "cut", label: "Cut", Icon: Scissors, disabled: entry.directory },
    { id: "copy-path", label: "Copy Path", Icon: Link, disabled: false },
    { id: "rename", label: "Rename", Icon: Pencil, disabled: isRoot },
    { id: "delete", label: entry.directory ? "Delete Folder" : "Delete File", Icon: Trash2, disabled: isRoot },
    {
      id: "duplicate",
      label: "Duplicate",
      Icon: Files,
      disabled: entry.directory,
    },
    {
      id: "reveal",
      label: navigator.platform.toLowerCase().includes("mac")
        ? "Open in Finder"
        : navigator.platform.toLowerCase().includes("win")
          ? "Open in File Explorer"
          : "Open in File Manager",
      Icon: FolderOpen,
      disabled: !desktop,
    },
  ] as const;
  return createPortal(
    <div
      ref={menu}
      className="file-context-menu"
      role="menu"
      aria-label={`File actions for ${entry.name}`}
      style={{ left: point.x, top: point.y }}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          if (
            previousFocus.current instanceof HTMLElement &&
            previousFocus.current.isConnected
          )
            previousFocus.current.focus();
          onClose();
        }
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key))
          return;
        event.preventDefault();
        const buttons = [
          ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
            "button:not(:disabled)",
          ),
        ];
        const current = buttons.indexOf(
          document.activeElement as HTMLButtonElement,
        );
        const next =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? buttons.length - 1
              : (current +
                  (event.key === "ArrowDown" ? 1 : -1) +
                  buttons.length) %
                buttons.length;
        buttons[next]?.focus();
      }}
    >
      {actions.map(({ id, label, Icon, disabled }) => (
        <button
          key={id}
          type="button"
          role="menuitem"
          disabled={disabled}
          onClick={() => onAction(id)}
        >
          <Icon size={16} />
          {label}
        </button>
      ))}
    </div>,
    document.body,
  );
}
