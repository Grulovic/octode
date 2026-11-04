import { validateTerminalCommand } from "./terminalCommand";
export interface SavedTerminalCommand {
  id: string;
  name: string | null;
  command: string;
}

function normalizeCommands(value: unknown): SavedTerminalCommand[] {
  if (!Array.isArray(value) || value.length > 100)
    throw new Error("Save up to 100 terminal commands.");
  const ids = new Set<string>();
  return value.map((item) => {
    if (!item || typeof item.id !== "string" || !item.id || ids.has(item.id) ||
        (item.name != null && (typeof item.name !== "string" || item.name.length > 100 || /[\r\n\0]/.test(item.name))) || typeof item.command !== "string")
      throw new Error("Each terminal command needs a unique ID, command text, and an optional name (up to 100 characters).");
    ids.add(item.id);
    return { id: item.id, name: item.name?.trim() || null, command: validateTerminalCommand(item.command) };
  });
}

export interface EditorSettings {
  version: 1;
  terminalCommand: string;
  terminalCommands: SavedTerminalCommand[];
  fontSize: number;
  tabSize: number;
  wordWrap: "off" | "on";
}
export const defaultSettings: EditorSettings = {
  version: 1,
  fontSize: 13,
  terminalCommand: "codex",
  terminalCommands: [],
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
    let terminalCommands: SavedTerminalCommand[] = [];
    try { terminalCommands = normalizeCommands(value.terminalCommands ?? []); } catch { /* Invalid saved lists stay inert. */ }
    return {
      version: 1,
      terminalCommands,
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
  const terminalCommands = normalizeCommands(value.terminalCommands);
  localStorage.setItem(
    "octode-editor-settings",
    JSON.stringify({ ...value, terminalCommand, terminalCommands }),
  );
  window.dispatchEvent(new Event("octode-editor-settings"));
}
