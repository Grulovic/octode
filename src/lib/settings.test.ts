// @vitest-environment jsdom
import { expect, it } from "vitest";
import { loadSettings, saveSettings } from "./settings";
it("migrates older preferences to codex and persists a custom launch command", () => {
  localStorage.clear();
  localStorage.setItem(
    "octode-editor-settings",
    JSON.stringify({ version: 1, fontSize: 16, tabSize: 2, wordWrap: "on" }),
  );
  expect(loadSettings()).toMatchObject({
    terminalCommand: "codex",
    fontSize: 16,
    tabSize: 2,
  });
  saveSettings({ ...loadSettings(), terminalCommand: "  codex --resume  " });
  expect(loadSettings().terminalCommand).toBe("codex --resume");
  const saved = localStorage.getItem("octode-editor-settings");
  for (const command of [
    "",
    "  ",
    "codex\nexit",
    "codex\r",
    "a\0",
    "x".repeat(4097),
  ]) {
    expect(() =>
      saveSettings({ ...loadSettings(), terminalCommand: command }),
    ).toThrow("single-line");
    expect(localStorage.getItem("octode-editor-settings")).toBe(saved);
  }
  localStorage.clear();
});

it("persists and validates named terminal commands without changing saved data on failure", () => {
  localStorage.clear();
  expect(loadSettings().terminalCommands).toEqual([]);
  saveSettings({ ...loadSettings(), terminalCommands: [{ id: "dev", name: " Dev server ", command: " npm run dev " }] });
  expect(loadSettings().terminalCommands).toEqual([{ id: "dev", name: "Dev server", command: "npm run dev" }]);
  const saved = localStorage.getItem("octode-editor-settings");
  for (const terminalCommands of [
    [{ id: "dev", name: "Bad\nname", command: "npm run dev" }],
    [{ id: "dev", name: "Dev", command: "echo hi\nexit" }],
    [{ id: "dev", name: "Dev", command: "npm run dev" }, { id: "dev", name: "Other", command: "pwd" }],
  ]) {
    expect(() => saveSettings({ ...loadSettings(), terminalCommands })).toThrow();
    expect(localStorage.getItem("octode-editor-settings")).toBe(saved);
  }
  saveSettings({ ...loadSettings(), terminalCommands: [] });
  expect(loadSettings().terminalCommands).toEqual([]);
  localStorage.clear();
});


it("accepts blank, null, and omitted names and stores them as null", () => {
  localStorage.clear();
  for (const name of ["", "   ", null]) {
    saveSettings({ ...loadSettings(), terminalCommands: [{ id: "dev", name, command: "npm run dev" }] });
    expect(loadSettings().terminalCommands).toEqual([{ id: "dev", name: null, command: "npm run dev" }]);
  }
  localStorage.setItem("octode-editor-settings", JSON.stringify({ version: 1, terminalCommands: [{ id: "pwd", command: "pwd" }] }));
  expect(loadSettings().terminalCommands).toEqual([{ id: "pwd", name: null, command: "pwd" }]);
  localStorage.clear();
});
