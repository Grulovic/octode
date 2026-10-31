// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
const picker = vi.hoisted(() => vi.fn());
vi.mock("../lib/bridge", () => ({ desktop: true }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: picker }));
import { ValueRows } from "./ToolLayout";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
it("copies the selected native file path into a multipart row and handles cancellation/errors", async () => {
  const host = document.createElement("div"); const root = createRoot(host), change = vi.fn();
  const values = [{ id: "one", name: "upload", value: "", enabled: true }];
  try {
    await act(async () => root.render(<ValueRows label="Body" values={values} onChange={change} files />));
    picker.mockResolvedValue("/tmp/example image.png");
    const button = host.querySelector<HTMLButtonElement>('[aria-label="Choose file for Body 1"]')!;
    await act(async () => button.click());
    expect(change).toHaveBeenLastCalledWith([{ ...values[0], value: "/tmp/example image.png", file: true, secret: false, hasSecret: false }]);
    change.mockClear(); picker.mockResolvedValue(null);
    await act(async () => button.click()); expect(change).not.toHaveBeenCalled();
    picker.mockRejectedValue(new Error("Picker failed"));
    await act(async () => button.click()); expect(host.querySelector('[role="alert"]')?.textContent).toContain("Picker failed");
    expect(change).not.toHaveBeenCalled();
  } finally { await act(async () => root.unmount()); }
});
