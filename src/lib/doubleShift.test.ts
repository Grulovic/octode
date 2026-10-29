// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { installDoubleShift } from "./doubleShift";
afterEach(() => vi.useRealTimers());
const key = (type: string, name: string, options: KeyboardEventInit = {}) =>
  window.dispatchEvent(
    new KeyboardEvent(type, {
      key: name,
      bubbles: true,
      cancelable: true,
      ...options,
    }),
  );
const tap = () => {
  key("keydown", "Shift");
  key("keyup", "Shift");
};
describe("double Shift", () => {
  it("opens once after two released Shift taps and removes listeners", () => {
    vi.useFakeTimers();
    const open = vi.fn();
    const remove = installDoubleShift(window, open);
    tap();
    vi.advanceTimersByTime(100);
    tap();
    expect(open).toHaveBeenCalledOnce();
    remove();
    tap();
    tap();
    expect(open).toHaveBeenCalledOnce();
  });
  it("ignores typing, held/modifier keys, slow taps, blocked contexts and focus loss", () => {
    vi.useFakeTimers();
    const open = vi.fn();
    let blocked = false;
    const remove = installDoubleShift(window, open, () => blocked);
    key("keydown", "Shift");
    key("keydown", "A", { shiftKey: true });
    key("keyup", "Shift");
    tap();
    vi.advanceTimersByTime(400);
    tap();
    expect(open).not.toHaveBeenCalled();
    key("keydown", "Shift", { repeat: true });
    tap();
    expect(open).not.toHaveBeenCalled();
    key("keydown", "Shift", { metaKey: true });
    key("keyup", "Shift");
    tap();
    expect(open).not.toHaveBeenCalled();
    window.dispatchEvent(new Event("blur"));
    tap();
    expect(open).not.toHaveBeenCalled();
    blocked = true;
    tap();
    tap();
    expect(open).not.toHaveBeenCalled();
    remove();
  });
});
