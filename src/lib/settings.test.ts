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
