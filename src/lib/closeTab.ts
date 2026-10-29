import { desktop } from "./bridge";
type Closer = {
  active: () => boolean;
  close: () => void | Promise<void>;
  priority?: number;
};
const closers = new Set<Closer>();
let pending = false;
let lastRequest = -Infinity;
export function registerTabCloser(closer: Closer) {
  closers.add(closer);
  return () => {
    closers.delete(closer);
  };
}
export async function closeActiveTab() {
  if (
    pending ||
    performance.now() - lastRequest < 150 ||
    document.querySelector('[aria-modal="true"]')
  )
    return;
  const closer = [...closers]
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
    .find((item) => item.active());
  if (!closer) return;
  lastRequest = performance.now();
  pending = true;
  try {
    await closer.close();
  } finally {
    pending = false;
  }
}
export function installCloseTabShortcut() {
  let disposed = false;
  let stop: (() => void) | undefined;
  const close = () => {
    void closeActiveTab().catch(() => {});
  };
  const key = (event: KeyboardEvent) => {
    if (
      !(event.metaKey || event.ctrlKey) ||
      event.altKey ||
      event.shiftKey ||
      event.key.toLowerCase() !== "w"
    )
      return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!event.repeat) close();
  };
  window.addEventListener("keydown", key, true);
  if (desktop)
    void import("@tauri-apps/api/event").then(async ({ listen }) => {
      const unlisten = await listen("octode-close-tab", close);
      if (disposed) unlisten();
      else stop = unlisten;
    });
  return () => {
    disposed = true;
    stop?.();
    window.removeEventListener("keydown", key, true);
  };
}
