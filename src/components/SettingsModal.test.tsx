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

it("keeps command edits local until Save and supports adding, editing, and deleting", async () => {
  const { loadSettings } = await import("../lib/settings");
  const type = async (label: string, value: string) => {
    const input = document.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };
  await click("Add command");
  await type("Command 1 name", "Dev");
  await type("Command 1 text", "npm run dev");
  expect(loadSettings().terminalCommands).toEqual([]);
  await click("Save settings");
  expect(loadSettings().terminalCommands).toMatchObject([{ name: "Dev", command: "npm run dev" }]);
  await type("Command 1 text", "npm run test");
  expect(loadSettings().terminalCommands[0].command).toBe("npm run dev");
  await click("Save settings");
  expect(loadSettings().terminalCommands[0].command).toBe("npm run test");
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Delete command 1"]')!.click());
  expect(loadSettings().terminalCommands).toHaveLength(1);
  await click("Save settings");
  expect(loadSettings().terminalCommands).toEqual([]);
});

it("reorders and sorts commands locally, then saves their dropdown order", async () => {
  const { loadSettings, saveSettings } = await import("../lib/settings");
  saveSettings({ ...loadSettings(), terminalCommands: [
    { id: "z", name: "Zebra", command: "echo z" },
    { id: "a", name: null, command: "echo a" },
    { id: "b", name: "Beta", command: "echo b" },
  ] });
  await act(async () => root.render(<SettingsModal key="ordered" onClose={() => {}} beforeReplace={beforeReplace} />));
  const action = (label: string) => document.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!;
  const order = () => [...document.querySelectorAll<HTMLInputElement>('.settings-command-list input[aria-label$=" text"]')].map((input) => input.value);
  expect(action("Move command 1 up").disabled).toBe(true);
  expect(action("Move command 3 down").disabled).toBe(true);
  await act(async () => action("Move command 1 down").click());
  expect(order()).toEqual(["echo a", "echo z", "echo b"]);
  expect(loadSettings().terminalCommands.map((item) => item.id)).toEqual(["z", "a", "b"]);
  await act(async () => action("Move command 3 up").click());
  await click("Save settings");
  expect(loadSettings().terminalCommands.map((item) => item.id)).toEqual(["a", "b", "z"]);
  await act(async () => action("Sort commands alphabetically").click());
  expect(order()).toEqual(["echo b", "echo a", "echo z"]);
  await click("Save settings");
  expect(loadSettings().terminalCommands.map((item) => item.id)).toEqual(["b", "a", "z"]);
});
