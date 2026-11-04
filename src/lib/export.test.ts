// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
const native = vi.hoisted(() => ({ save: vi.fn(), invoke: vi.fn() }));
vi.mock("./bridge", () => ({ desktop: true, invoke: native.invoke }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: native.save }));
import { exportText } from "./export";
beforeEach(() => { vi.clearAllMocks(); });
it("does not gather passwords if the destination dialog is canceled", async () => {
  native.save.mockResolvedValue(null);
  const gather = vi.fn();
  expect(await exportText(gather, "backup.json")).toBeNull();
  expect(gather).not.toHaveBeenCalled();
  expect(native.invoke).not.toHaveBeenCalled();
});
it("writes only after gathering succeeds and aborts once on denial", async () => {
  native.save.mockResolvedValue("/tmp/backup.json");
  const gather = vi.fn().mockRejectedValue(new Error("access denied"));
  await expect(exportText(gather, "backup.json")).rejects.toThrow("access denied");
  expect(gather).toHaveBeenCalledOnce();
  expect(native.invoke).not.toHaveBeenCalled();
  await exportText(async () => "backup-fixture", "backup.json");
  expect(native.invoke).toHaveBeenCalledWith("save_export_file", { path: "/tmp/backup.json", content: "backup-fixture" });
});
