import { validateTerminalCommand } from "./terminalCommand";
export interface EditorSettings {
  version: 1;
  terminalCommand: string;
  fontSize: number;
  tabSize: number;
  wordWrap: "off" | "on";
}
export const defaultSettings: EditorSettings = {
  version: 1,
  fontSize: 13,
  terminalCommand: "codex",
  tabSize: 4,
  wordWrap: "off",
};
export function loadSettings(): EditorSettings {
  try {
    const value = JSON.parse(
      localStorage.getItem("octode-editor-settings") ?? "null",
    );
    if (value?.version !== 1) return { ...defaultSettings };
    let terminalCommand = "codex";
    try {
      if (typeof value.terminalCommand === "string")
        terminalCommand = validateTerminalCommand(value.terminalCommand);
    } catch {
      /* Old/invalid preferences use the default command. */
    }
    return {
      version: 1,
      terminalCommand,
      fontSize: Math.max(10, Math.min(22, Number(value.fontSize) || 13)),
      tabSize: [2, 4, 8].includes(value.tabSize) ? value.tabSize : 4,
      wordWrap: value.wordWrap === "on" ? "on" : "off",
    };
  } catch {
    return { ...defaultSettings };
  }
}
export function saveSettings(value: EditorSettings) {
  const terminalCommand = validateTerminalCommand(value.terminalCommand);
  localStorage.setItem(
    "octode-editor-settings",
    JSON.stringify({ ...value, terminalCommand }),
  );
  window.dispatchEvent(new Event("octode-editor-settings"));
}
