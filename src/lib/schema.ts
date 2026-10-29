export type Engine = "sqlite" | "mysql" | "postgres";
export interface SchemaColumn {
  name: string;
  type:
    | "integer"
    | "bigint"
    | "text"
    | "varchar"
    | "boolean"
    | "decimal"
    | "date"
    | "timestamp"
    | "json";
  nullable: boolean;
  primaryKey: boolean;
  defaultValue: string;
}
export const newColumn = (): SchemaColumn => ({
  name: "",
  type: "text",
  nullable: true,
  primaryKey: false,
  defaultValue: "",
});
export function identifier(name: string, engine: Engine) {
  if (!name.trim() || name.length > 100 || /[\0\r\n]/.test(name))
    throw new Error("Use a name of 1–100 characters without line breaks.");
  const quote = engine === "mysql" ? "`" : '"';
  return quote + name.replaceAll(quote, quote + quote) + quote;
}
const type = (value: SchemaColumn["type"], engine: Engine) =>
  ({
    integer: "INTEGER",
    bigint: "BIGINT",
    text: "TEXT",
    varchar: "VARCHAR(255)",
    boolean: engine === "sqlite" ? "INTEGER" : "BOOLEAN",
    decimal: "DECIMAL(20, 6)",
    date: "DATE",
    timestamp: engine === "mysql" ? "DATETIME" : "TIMESTAMP",
    json:
      engine === "postgres" ? "JSONB" : engine === "sqlite" ? "TEXT" : "JSON",
  })[value];
function definition(column: SchemaColumn, engine: Engine) {
  let value = `${identifier(column.name, engine)} ${type(column.type, engine)}`;
  if (!column.nullable || column.primaryKey) value += " NOT NULL";
  if (column.defaultValue !== "")
    value += ` DEFAULT '${column.defaultValue.replaceAll("'", "''")}'`;
  return value;
}
export function createTableSql(
  engine: Engine,
  schema: string,
  name: string,
  columns: SchemaColumn[],
) {
  if (!columns.length || columns.length > 100)
    throw new Error("Add 1–100 columns.");
  if (
    new Set(columns.map((column) => column.name.toLowerCase())).size !==
    columns.length
  )
    throw new Error("Column names must be unique.");
  const primary = columns.filter((column) => column.primaryKey);
  const lines = columns.map((column) => "    " + definition(column, engine));
  if (primary.length)
    lines.push(
      `    PRIMARY KEY (${primary.map((column) => identifier(column.name, engine)).join(", ")})`,
    );
  return `CREATE TABLE ${identifier(schema, engine)}.${identifier(name, engine)} (\n${lines.join(",\n")}\n);`;
}
export function addColumnSql(
  engine: Engine,
  schema: string,
  table: string,
  column: SchemaColumn,
) {
  if (column.primaryKey)
    throw new Error(
      "Changing a primary key requires a reviewed table migration; use the SQL console.",
    );
  return `ALTER TABLE ${identifier(schema, engine)}.${identifier(table, engine)} ADD COLUMN ${definition(column, engine)};`;
}
export function createIndexSql(
  engine: Engine,
  schema: string,
  table: string,
  name: string,
  columns: string[],
  unique: boolean,
) {
  if (!columns.length) throw new Error("Choose index columns.");
  const index =
    engine === "sqlite"
      ? `${identifier(schema, engine)}.${identifier(name, engine)}`
      : identifier(name, engine);
  const target =
    engine === "sqlite"
      ? identifier(table, engine)
      : `${identifier(schema, engine)}.${identifier(table, engine)}`;
  return `CREATE ${unique ? "UNIQUE " : ""}INDEX ${index} ON ${target} (${columns.map((column) => identifier(column, engine)).join(", ")});`;
}
