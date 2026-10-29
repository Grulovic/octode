import assets from "virtual:octode-file-icons";
import manifest from "material-icon-theme/dist/material-icons.json";

const names: Record<string, string> = manifest.fileNames;
const extensions: Record<string, string> = manifest.fileExtensions;

export function fileIconName(path: string): string {
  const parts = path.replaceAll("\\", "/").toLowerCase().split("/");
  // Some associations include a parent folder (for example GitHub workflows).
  for (let index = 0; index < parts.length; index++) {
    const match = names[parts.slice(index).join("/")];
    if (match) return match;
  }
  const name = parts.at(-1) ?? "";
  const segments = name.split(".");
  for (let index = 1; index < segments.length; index++) {
    const match = extensions[segments.slice(index).join(".")];
    if (match) return match;
  }
  return manifest.file;
}
export function fileIconUrl(path: string): string {
  return assets[fileIconName(path)] ?? assets[manifest.file];
}
