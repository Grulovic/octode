// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { installTerminalShortcut } from "./terminalShortcut";
it("toggles immediately, launches only on a clean double press, and cleans up", () => {
  const toggle = vi.fn(),
    launch = vi.fn();
  let enabled = true;
  const now = vi.spyOn(Date, "now").mockReturnValue(1000);
  const stop = installTerminalShortcut(window, toggle, launch, () => enabled);
  const key = (key = "2", extra: KeyboardEventInit = {}) =>
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key,
        metaKey: true,
        cancelable: true,
        ...extra,
      }),
    );
  try {
    key();
    expect(toggle).toHaveBeenCalledTimes(1);
    expect(launch).not.toHaveBeenCalled();
    key("2", { repeat: true });
    expect(launch).not.toHaveBeenCalled();
    now.mockReturnValue(1200);
    key();
    expect(launch).toHaveBeenCalledTimes(1);
    key();
    key("a");
    key();
    expect(launch).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event("blur"));
    key();
    expect(launch).toHaveBeenCalledTimes(1);
    now.mockReturnValue(2000);
    key();
    expect(launch).toHaveBeenCalledTimes(1);
    enabled = false;
    key();
    enabled = true;
    key("2", { metaKey: false, ctrlKey: true });
    expect(launch).toHaveBeenCalledTimes(1);
    key("2", { metaKey: false, ctrlKey: true });
    expect(launch).toHaveBeenCalledTimes(2);
    stop();
    const count = toggle.mock.calls.length;
    key();
    expect(toggle).toHaveBeenCalledTimes(count);
  } finally {
    stop();
    now.mockRestore();
  }
});
