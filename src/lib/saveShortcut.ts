import { useEffect, useRef } from "react";
import { desktop } from "./bridge";

type SaveTarget = { active: () => boolean; save: () => unknown };
const targets = new Set<SaveTarget>();
export function registerSaveTarget(target: SaveTarget) {
  targets.add(target);
  return () => { targets.delete(target); };
}
export function saveActiveSection() {
  // Parked tools retain their dialogs, but must not intercept the visible tool.
  const modals = [...document.querySelectorAll('[aria-modal="true"]')].filter((modal) => {
    for (let element: Element | null = modal; element; element = element.parentElement) {
      const style = getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden") return false;
    }
    return true;
  });
  if (modals.length) {
    const button = modals[modals.length - 1].querySelector<HTMLButtonElement>('button[data-save-shortcut]');
    if (button && !button.disabled) button.click();
    return;
  }
  const target = [...targets].find((item) => item.active());
  if (target) void target.save();
}
export function useSaveShortcut(active: boolean, save: () => unknown) {
  const latest = useRef({ active, save });
  latest.current = { active, save };
  useEffect(() => registerSaveTarget({
    active: () => latest.current.active,
    save: () => latest.current.save(),
  }), []);
}
export function installSaveShortcut() {
  let disposed = false;
  let stop: (() => void) | undefined;
  const key = (event: KeyboardEvent) => {
    if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey || event.isComposing || event.key.toLowerCase() !== "s") return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!event.repeat) saveActiveSection();
  };
  window.addEventListener("keydown", key, true);
  if (desktop) void import("@tauri-apps/api/event").then(async ({ listen }) => {
    const unlisten = await listen("octode-save", saveActiveSection);
    if (disposed) unlisten(); else stop = unlisten;
  });
  return () => { disposed = true; stop?.(); window.removeEventListener("keydown", key, true); };
}
