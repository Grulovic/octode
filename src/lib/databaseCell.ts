import type { DbResult } from "../toolTypes";
import type { TableMetadata } from "../components/DatabaseRowEditor";

/** Validate and format JSON without changing numeric precision, key order or duplicate keys. */
export function formatCellJson(source: string) {
  if (source.length > 4 * 1024 * 1024)
    throw new Error("JSON cells above 4 MB cannot be formatted here.");
  JSON.parse(source);
  const tokens = source.match(/"(?:\\.|[^"\\])*"|[^\s]/g) ?? [];
  let depth = 0;
  let output = "";
  const newline = () => "\n" + "  ".repeat(depth);
  tokens.forEach((token, index) => {
    if (token === "{" || token === "[") {
      output += token;
      depth++;
      if (depth > 100)
        throw new Error("JSON nesting exceeds the formatting limit.");
      if (tokens[index + 1] !== "}" && tokens[index + 1] !== "]")
        output += newline();
    } else if (token === "}" || token === "]") {
      depth--;
      if (tokens[index - 1] !== "{" && tokens[index - 1] !== "[")
        output += newline();
      output += token;
    } else if (token === ",") output += "," + newline();
    else if (token === ":") output += ": ";
    else output += token;
    if (output.length > 8 * 1024 * 1024)
      throw new Error("Formatted JSON exceeds 8 MB.");
  });
  return output;
}
export function cellJson(source: string, dataType: string) {
  if (/json/i.test(dataType)) return true;
  if (!/^\s*[\[{]/.test(source)) return false;
  try {
    JSON.parse(source);
    return true;
  } catch {
    return false;
  }
}
export function cellEditReason(
  result: DbResult,
  metadata: TableMetadata | null,
  row: number,
  column: number,
): string {
  if (!metadata) return "Column information is still loading.";
  if (!metadata.editable)
    return metadata.reason || "This connection or table is read-only.";
  const field = metadata.columns.find(
    (item) => item.name === result.columns[column]?.name,
  );
  if (!field) return "Column information is unavailable. Reload this table.";
  if (field.generated) return "Generated columns cannot be edited.";
  const cell = result.rows[row]?.[column];
  if (!cell || (cell.kind !== "text" && cell.kind !== "null"))
    return "This cell cannot be edited because its full value is unavailable.";
  const keys = metadata.columns.filter((item) => item.primaryKey);
  if (
    !keys.length ||
    keys.some((key) => {
      const index = result.columns.findIndex((item) => item.name === key.name);
      return result.rows[row]?.[index]?.kind !== "text";
    })
  )
    return "Reload this row with its complete primary key before editing.";
  return "";
}
export function editableCell(
  result: DbResult,
  metadata: TableMetadata | null,
  row: number,
  column: number,
) {
  return !cellEditReason(result, metadata, row, column);
}
