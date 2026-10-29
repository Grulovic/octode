export function parseCsv(text: string): string[][] {
  if (text.length > 4 * 1024 * 1024)
    throw new Error("CSV import exceeds 4 MB.");
  text = text.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let rowStarted = false;
  let closed = false;
  const pushField = () => {
    row.push(field);
    field = "";
    closed = false;
    if (row.length > 200)
      throw new Error("CSV rows may contain at most 200 columns.");
  };
  const pushRow = () => {
    pushField();
    if (rowStarted) rows.push(row);
    row = [];
    rowStarted = false;
    if (rows.length > 101)
      throw new Error("Import at most 100 data rows at a time.");
  };
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index++;
        } else {
          quoted = false;
          closed = true;
        }
      } else {
        field += character;
      }
      continue;
    }
    if (closed && ![",", "\r", "\n"].includes(character))
      throw new Error("Unexpected characters after a quoted CSV field.");
    if (character === '"') {
      if (field.length)
        throw new Error("CSV quotes must begin at the start of a field.");
      quoted = true;
      rowStarted = true;
    } else if (character === ",") {
      rowStarted = true;
      pushField();
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && text[index + 1] === "\n") index++;
      pushRow();
    } else {
      rowStarted = true;
      field += character;
    }
  }
  if (quoted) throw new Error("A CSV quoted field is not closed.");
  if (field !== "" || row.length || closed) pushRow();
  if (!rows.length) throw new Error("The CSV is empty.");
  const width = rows[0].length;
  if (rows.some((row) => row.length !== width))
    throw new Error(
      "Every CSV row must have the same number of fields as the header.",
    );
  return rows;
}
export function csvInserts(
  rows: string[][],
  mapping: string[],
  emptyAsNull: boolean,
) {
  if (rows.length < 2)
    throw new Error("CSV needs a header and at least one data row.");
  const selected = mapping.filter(Boolean);
  if (!selected.length || new Set(selected).size !== selected.length)
    throw new Error("Map each destination column at most once.");
  return rows.slice(1).map((row) => ({
    kind: "insert",
    original: {},
    values: Object.fromEntries(
      mapping.flatMap((column, index) =>
        column
          ? [[column, emptyAsNull && row[index] === "" ? null : row[index]]]
          : [],
      ),
    ),
  }));
}
