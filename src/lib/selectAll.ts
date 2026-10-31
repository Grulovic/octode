import { desktop } from "./bridge";

// Embedded editors keep their own selection, separate from the WebView's
// hidden textarea. Native Edit > Select All must reach the focused editor.
const editors = new Set<() => boolean>();
export function registerSelectAll(select: () => boolean) {
  editors.add(select);
  return () => { editors.delete(select); };
}
export function selectAllInEditor() {
  for (const select of editors) if (select()) return true;
  return false;
}
export function selectAllFocusedText() {
  if (selectAllInEditor()) return;
  const target = document.activeElement;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    if (!target.disabled) target.select();
    return;
  }
  document.execCommand("selectAll");
}
export function installSelectAllShortcut() {
  let disposed = false;
  let stop: (() => void) | undefined;
  const key = (event: KeyboardEvent) => {
    if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey || event.isComposing || event.key.toLowerCase() !== "a") return;
    // Native fields and contenteditable keep the browser's default behavior.
    if (!selectAllInEditor()) return;
    event.preventDefault(); event.stopImmediatePropagation();
  };
  window.addEventListener("keydown", key, true);
  if (desktop) void import("@tauri-apps/api/event").then(async ({ listen }) => {
    const unlisten = await listen("octode-select-all", selectAllFocusedText);
    if (disposed) unlisten(); else stop = unlisten;
  });
  return () => { disposed = true; stop?.(); window.removeEventListener("keydown", key, true); };
}
