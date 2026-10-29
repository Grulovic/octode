import { describe, it, expect } from "vitest";
import {
  createTableSql,
  addColumnSql,
  createIndexSql,
  newColumn,
} from "./schema";
describe("schema SQL generation", () => {
  it("quotes identifiers and escapes literal defaults per dialect", () => {
    const column = {
      ...newColumn(),
      name: 'odd"column',
      defaultValue: "O'Reilly",
    };
    expect(
      createTableSql("postgres", "public", 'odd"table', [column]),
    ).toContain('"odd""table"');
    expect(createTableSql("postgres", "public", "users", [column])).toContain(
      "DEFAULT 'O''Reilly'",
    );
    expect(
      createTableSql("mysql", "db", "table", [
        { ...column, name: "odd`column" },
      ]),
    ).toContain("`odd``column`");
  });
  it("rejects duplicate columns and does not silently alter primary keys", () => {
    expect(() =>
      createTableSql("sqlite", "main", "test", [
        { ...newColumn(), name: "id" },
        { ...newColumn(), name: "ID" },
      ]),
    ).toThrow();
    expect(() =>
      addColumnSql("sqlite", "main", "test", {
        ...newColumn(),
        name: "id",
        primaryKey: true,
      }),
    ).toThrow();
  });
  it("uses SQLite index qualification and preserves compound index order", () => {
    expect(
      createIndexSql(
        "sqlite",
        "main",
        "users",
        "users_key",
        ["last", "first"],
        true,
      ),
    ).toBe(
      'CREATE UNIQUE INDEX "main"."users_key" ON "users" ("last", "first");',
    );
    expect(
      createIndexSql("postgres", "public", "users", "users_key", ["id"], false),
    ).toBe('CREATE INDEX "users_key" ON "public"."users" ("id");');
  });
});
