// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("./bridge", () => ({ desktop: true, invoke: native.invoke }));
vi.mock("./export", () => ({ exportText: vi.fn() }));
import { appPreferences, exportAppData, importAppData, parseAppData } from "./appData";
beforeEach(() => { localStorage.clear(); native.invoke.mockReset(); });
it("exports only app preferences and validates the backup before native import", async () => {
  localStorage.setItem("other-app-token", "private");
  localStorage.setItem("octode-editor-settings", "{}");
  expect(appPreferences()).toEqual({ "octode-editor-settings": "{}" });
  expect(() => parseAppData('{"format":"other","version":1}')).toThrow();
  await expect(importAppData(JSON.stringify({ format: "octode-app-data", version: 1, projects: [], preferences: { "other-app-token": "bad" } }))).rejects.toThrow();
  expect(native.invoke).not.toHaveBeenCalled();
});
it("remaps restored project views without overwriting the existing project view", async () => {
  localStorage.setItem("octode-view:old:api", "existing");
  native.invoke.mockResolvedValue({ old: "new" });
  const refreshed = vi.fn();
  window.addEventListener("octode-app-data-imported", refreshed);
  try {
    expect(await importAppData(JSON.stringify({ format: "octode-app-data", version: 1, projects: [], preferences: { "octode-view:old:api": "restored", "octode-view:missing:api": "skip", "octode-layout:terminal-height": "400" } }))).toBe(1);
    expect(localStorage.getItem("octode-view:old:api")).toBe("existing");
    expect(localStorage.getItem("octode-view:new:api")).toBe("restored");
    expect(localStorage.getItem("octode-view:missing:api")).toBeNull();
    expect(refreshed).toHaveBeenCalledOnce();
  } finally { window.removeEventListener("octode-app-data-imported", refreshed); }
});

it("exports without credential access by default and passes explicit opt-in", async () => {
  native.invoke.mockResolvedValue({ format: "octode-app-data", version: 1, projects: [], notes: [] });
  await exportAppData();
  expect(native.invoke).toHaveBeenLastCalledWith("export_app_data", { includeCredentials: false });
  await exportAppData(true);
  expect(native.invoke).toHaveBeenLastCalledWith("export_app_data", { includeCredentials: true });
});
