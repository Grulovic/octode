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

import { renameTableSql, renameColumnSql, dropTableSql, dropColumnSql, editColumnSql } from "./schema";
it("generates quoted table/column rename and drop SQL without implicit CASCADE", () => {
  expect(renameTableSql("sqlite", "main", "old", "new")).toBe('ALTER TABLE "main"."old" RENAME TO "new";');
  expect(renameColumnSql("mysql", "db", "table", "old", "new")).toBe('ALTER TABLE `db`.`table` RENAME COLUMN `old` TO `new`;');
  expect(dropColumnSql("postgres", "public", "table", "column")).toBe('ALTER TABLE "public"."table" DROP COLUMN "column";');
  expect(dropTableSql("sqlite", "main", 'odd"table')).toBe('DROP TABLE "main"."odd""table";');
});
it("alters supported column properties while retaining existing defaults on request", () => {
  expect(editColumnSql("postgres", "public", "items", "title", "VARCHAR(255)", false, "", false, true)).not.toContain("DEFAULT");
  expect(editColumnSql("mysql", "db", "items", "title", "VARCHAR(255)", true, "", false, true, "O'Reilly")).toContain("DEFAULT 'O''Reilly'");
  expect(editColumnSql("postgres", "public", "items", "number", "INTEGER", true, "12", true)).toContain("SET DEFAULT 12");
  expect(() => editColumnSql("mysql", "db", "items", "title", "TEXT; DROP TABLE x", true, "")).toThrow();
  expect(() => editColumnSql("sqlite", "main", "items", "title", "TEXT", true, "")).toThrow("rebuilding");
});
it("keeps MySQL collation, comments and on-update expressions when editing a column", () => {
  const sql = editColumnSql("mysql", "db", "items", "updated_at", "TIMESTAMP", false, "", false, true, "CURRENT_TIMESTAMP", { extra: "DEFAULT_GENERATED on update CURRENT_TIMESTAMP", collation: "utf8mb4_unicode_ci", comment: "O'Reilly" });
  expect(sql).toContain("DEFAULT CURRENT_TIMESTAMP"); expect(sql).toContain("on update CURRENT_TIMESTAMP");
  expect(sql).toContain("COLLATE `utf8mb4_unicode_ci`"); expect(sql).toContain("COMMENT 'O''Reilly'");
});
