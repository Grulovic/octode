import { notesForBackup, type Note } from "./notes";
import { desktop, invoke } from "./bridge";
import { setTerminalHighlightEnabled } from "./terminalHighlight";
import { exportText } from "./export";

type Preferences = Record<string, string>;
interface Backup {
  format: "octode-app-data";
  version: 1;
  projects: unknown[];
  preferences: Preferences;
  notes?: Note[];
}
const allowedPreference = (key: string) => key === "octode-editor-settings" || key === "octode-terminal-highlighting" || key.startsWith("octode-view:") || key.startsWith("octode-layout:");
export function appPreferences(): Preferences {
  return Object.fromEntries(Object.keys(localStorage).filter(allowedPreference).map((key) => [key, localStorage.getItem(key)!]));
}
export function parseAppData(raw: string): Backup {
  if (new TextEncoder().encode(raw).length > 20 * 1024 * 1024) throw new Error("App data exceeds 20 MB.");
  const value = JSON.parse(raw);
  if (value?.format !== "octode-app-data" || value.version !== 1 || !Array.isArray(value.projects) || !value.preferences || typeof value.preferences !== "object" || Array.isArray(value.preferences) || Object.entries(value.preferences).some(([key, content]) => !allowedPreference(key) || typeof content !== "string")) throw new Error("Choose a valid Octode app-data export.");
  return value;
}
export async function exportAppData() {
  if (!desktop) throw new Error("Open the desktop app to export app data.");
  const data = await invoke<Omit<Backup, "preferences">>("export_app_data");
  await exportText(JSON.stringify({ ...data, ...notesForBackup(), preferences: appPreferences() }, null, 2), `octode-app-data-${new Date().toISOString().slice(0, 10)}.json`, "Export app data");
}
export async function importAppData(raw: string) {
  if (!desktop) throw new Error("Open the desktop app to import app data.");
  const data = parseAppData(raw);
  const ids = await invoke<Record<string, string>>("import_app_data", { data });
  for (const [key, value] of Object.entries(data.preferences)) {
    let target = key;
    if (key.startsWith("octode-view:")) {
      const oldId = key.split(":")[1];
      if (!ids[oldId]) continue;
      target = key.replace(`octode-view:${oldId}:`, `octode-view:${ids[oldId]}:`);
    }
    localStorage.setItem(target, value);
  }
  window.dispatchEvent(new Event("octode-editor-settings"));
  if ("octode-terminal-highlighting" in data.preferences) setTerminalHighlightEnabled(data.preferences["octode-terminal-highlighting"] !== "off");
  window.dispatchEvent(new Event("octode-app-data-imported"));
  return Object.keys(ids).length;
}
