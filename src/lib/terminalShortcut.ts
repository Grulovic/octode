/** Two clean Cmd/Ctrl+2 presses; other keys and window blur reset the sequence. */
export function installTerminalShortcut(
  target: Window,
  toggle: () => void,
  launch: () => void,
  enabled: () => boolean,
  delay = 400,
) {
  let previous: number | null = null;
  const reset = () => {
    previous = null;
  };
  const key = (event: KeyboardEvent) => {
    const match =
      (event.metaKey || event.ctrlKey) &&
      !event.altKey &&
      !event.shiftKey &&
      event.key === "2" &&
      !event.isComposing;
    if (!match) {
      if (!["Meta", "Control"].includes(event.key)) reset();
      return;
    }
    if (!enabled()) {
      reset();
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.repeat) return;
    const now = Date.now();
    if (previous !== null && now - previous <= delay) {
      reset();
      launch();
    } else {
      previous = now;
      toggle();
    }
  };
  target.addEventListener("keydown", key, true);
  target.addEventListener("blur", reset);
  return () => {
    target.removeEventListener("keydown", key, true);
    target.removeEventListener("blur", reset);
    reset();
  };
}
