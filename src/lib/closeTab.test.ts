// @vitest-environment jsdom
import { it, expect, vi } from "vitest";
import {
  closeActiveTab,
  installCloseTabShortcut,
  registerTabCloser,
} from "./closeTab";
it("consumes Cmd/Ctrl+W even without a tab and cleans up the keyboard handler", () => {
  const stop = installCloseTabShortcut();
  try {
    for (const modifier of ["metaKey", "ctrlKey"]) {
      const event = new KeyboardEvent("keydown", {
        key: "w",
        [modifier]: true,
        cancelable: true,
      });
      window.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
    }
  } finally {
    stop();
  }
  const event = new KeyboardEvent("keydown", {
    key: "w",
    metaKey: true,
    cancelable: true,
  });
  window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(false);
});
it("routes to the focused tab, coalesces native/keyboard delivery, and waits for closure", async () => {
  const time = vi.spyOn(performance, "now").mockReturnValue(1_000_000);
  const code = vi.fn();
  let finish: (() => void) | undefined;
  const terminal = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const removeCode = registerTabCloser({ active: () => true, close: code });
  const removeTerminal = registerTabCloser({
    active: () => true,
    close: terminal,
    priority: 10,
  });
  try {
    const pending = closeActiveTab();
    await closeActiveTab();
    expect(terminal).toHaveBeenCalledTimes(1);
    expect(code).not.toHaveBeenCalled();
    finish!();
    await pending;
    await closeActiveTab();
    expect(terminal).toHaveBeenCalledTimes(1);
    removeTerminal();
    time.mockReturnValue(1_001_000);
    await closeActiveTab();
    expect(code).toHaveBeenCalledOnce();
    time.mockReturnValue(1_002_000);
    document.body.innerHTML = '<div aria-modal="true"></div>';
    await closeActiveTab();
    expect(code).toHaveBeenCalledOnce();
  } finally {
    document.body.innerHTML = "";
    removeTerminal();
    removeCode();
    time.mockRestore();
  }
});
