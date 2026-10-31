// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
const native = vi.hoisted(() => ({ callbacks: new Map<string, () => void>(), stop: vi.fn() }));
vi.mock("./bridge", () => ({ desktop: true }));
vi.mock("@tauri-apps/api/event", () => ({ listen: async (name: string, callback: () => void) => { native.callbacks.set(name, callback); return native.stop; } }));
import { installSelectAllShortcut, registerSelectAll, selectAllFocusedText } from "./selectAll";
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); native.callbacks.clear(); native.stop.mockClear(); });
const press = (options: KeyboardEventInit = {}) => {
  const key = new KeyboardEvent("keydown", { key: "a", metaKey: true, cancelable: true, ...options });
  window.dispatchEvent(key); return key;
};
it("routes keyboard and native menu Select All to the focused embedded editor only", async () => {
  const inactive = vi.fn(() => false), focused = vi.fn(() => true), later = vi.fn(() => true);
  const remove = [registerSelectAll(inactive), registerSelectAll(focused), registerSelectAll(later)];
  const stop = installSelectAllShortcut();
  try {
    expect(press().defaultPrevented).toBe(true);
    expect(focused).toHaveBeenCalledOnce(); expect(later).not.toHaveBeenCalled();
    expect(press({ metaKey: false, ctrlKey: true }).defaultPrevented).toBe(true);
    expect(press({ shiftKey: true }).defaultPrevented).toBe(false);
    expect(press({ altKey: true }).defaultPrevented).toBe(false);
    expect(press({ isComposing: true }).defaultPrevented).toBe(false);
    await vi.waitFor(() => expect(native.callbacks.has("octode-select-all")).toBe(true));
    native.callbacks.get("octode-select-all")!();
    expect(focused).toHaveBeenCalledTimes(3);
  } finally { remove.forEach((remove) => remove()); stop(); }
  expect(press().defaultPrevented).toBe(false);
  expect(native.stop).toHaveBeenCalledOnce();
});
it("preserves default typing shortcuts and native menu selection in text fields", () => {
  const stop = installSelectAllShortcut();
  try {
    for (const tag of ["input", "textarea"]) {
      const field = document.createElement(tag) as HTMLInputElement | HTMLTextAreaElement;
      field.value = "all of this text"; field.readOnly = true;
      document.body.append(field); field.focus(); field.setSelectionRange(3, 3);
      expect(press().defaultPrevented).toBe(false);
      selectAllFocusedText();
      expect(field.selectionStart).toBe(0); expect(field.selectionEnd).toBe(field.value.length);
    }
  } finally { stop(); }
});
it("leaves contenteditable and page selection with the WebView", () => {
  const select = vi.fn();
  Object.defineProperty(document, "execCommand", { configurable: true, value: select });
  const editable = document.createElement("div"); editable.contentEditable = "true"; editable.tabIndex = 0;
  document.body.append(editable); editable.focus();
  selectAllFocusedText(); expect(select).toHaveBeenCalledWith("selectAll");
  Reflect.deleteProperty(document, "execCommand");
});
