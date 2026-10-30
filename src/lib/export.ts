import type { DbResult } from "../toolTypes";
export async function exportText(
  content: string,
  filename: string,
  title = "Export file",
) {
  const { desktop, invoke } = await import("./bridge");
  if (!desktop) throw new Error("Open the desktop app to export files.");
  const path = await (
    await import("@tauri-apps/plugin-dialog")
  ).save({ title, defaultPath: filename });
  if (!path) return null;
  await invoke("save_export_file", { path, content });
  return path;
}
export function resultCsv(result: DbResult) {
  const quote = (value: string) =>
    value === "" || /[",\r\n]/.test(value)
      ? `"${value.replaceAll('"', '""')}"`
      : value;
  return (
    [
      result.columns.map((column) => quote(column.name)).join(","),
      ...result.rows.map((row) =>
        row
          .map((cell) =>
            quote(
              cell.kind === "null"
                ? ""
                : cell.kind === "binary"
                  ? `base64:${cell.value}`
                  : cell.value,
            ),
          )
          .join(","),
      ),
    ].join("\r\n") + "\r\n"
  );
}
