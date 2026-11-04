// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const backup = vi.hoisted(() => ({ export: vi.fn(), import: vi.fn() }));
vi.mock("../lib/appData", async (original) => ({ ...await original<typeof import("../lib/appData")>(), exportAppData: backup.export, importAppData: backup.import }));
import SettingsModal from "./SettingsModal";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
let beforeReplace: ReturnType<typeof vi.fn>;
const raw = JSON.stringify({ format: "octode-app-data", version: 1, projects: [], notes: [{ id: "fixture", title: "Fixture", text: "dummy" }], preferences: {} });
const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent === text)!;
const click = async (text: string) => act(async () => button(text).click());
const selectBackup = async () => {
  const input = document.querySelector<HTMLInputElement>('[aria-label="App data file"]')!;
  Object.defineProperty(input, "files", { configurable: true, value: [{ name: "fixture-backup.json", size: raw.length, text: async () => raw }] });
  await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
};
beforeEach(async () => {
  localStorage.clear(); vi.clearAllMocks();
  backup.export.mockResolvedValue("/tmp/fixture-backup.json"); backup.import.mockResolvedValue(0);
  beforeReplace = vi.fn().mockResolvedValue(undefined);
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById("root")!);
  await act(async () => root.render(<SettingsModal onClose={() => {}} beforeReplace={beforeReplace} />));
});
afterEach(async () => act(async () => root.unmount()));
it("includes passwords by default and permits excluding them", async () => {
  await click("Export app data");
  expect(backup.export).toHaveBeenLastCalledWith(true);
  const checkbox = document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[1];
  await act(async () => checkbox.click());
  await click("Export app data");
  expect(backup.export).toHaveBeenLastCalledWith(false);
});
it("reviews a backup without applying it, allows cancellation, and merges only explicitly", async () => {
  await selectBackup();
  expect(document.querySelector('[aria-label="Review app data import"]')?.textContent).toContain("fixture-backup.json");
  expect(backup.import).not.toHaveBeenCalled();
  await click("Cancel import");
  expect(backup.import).not.toHaveBeenCalled();
  await selectBackup();
  await click("Import and merge");
  expect(backup.import).toHaveBeenCalledWith(raw, "merge");
  expect(beforeReplace).not.toHaveBeenCalled();
});
it("requires replacement checks and retains the review when unsaved work blocks replacement", async () => {
  await selectBackup();
  await act(async () => document.querySelector<HTMLButtonElement>('[role="combobox"][aria-label="Import mode"]')!.click());
  await act(async () => document.querySelector<HTMLButtonElement>('[role="option"][data-index="1"]')!.click());
  beforeReplace.mockRejectedValueOnce(new Error("Save unsaved Notes first"));
  await click("Import and replace");
  expect(beforeReplace).toHaveBeenCalledOnce();
  expect(backup.import).not.toHaveBeenCalled();
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("Save unsaved Notes first");
  expect(button("Import and replace")).toBeDefined();
  await click("Import and replace");
  expect(backup.import).toHaveBeenCalledWith(raw, "replace");
});
