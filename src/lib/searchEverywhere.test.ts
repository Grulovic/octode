// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { matchingEntries, type SearchEntry } from "./searchEverywhere";
const entry = (
  label: string,
  kind: SearchEntry["kind"],
  path = "src/Customer.php",
  line = 1,
): SearchEntry => ({
  label,
  kind,
  path: `/project/${path}`,
  relative: path,
  root: "/project",
  line,
});
describe("Search everywhere matching", () => {
  it("combines file, class and function matches, ranks exact names and keeps declaration lines", () => {
    const rows = [
      entry("Customer.php", "file"),
      entry("CustomerService", "class"),
      entry("Customer", "class", undefined, 4),
      entry("findCustomer", "function", undefined, 12),
      entry("Other", "class", "other.ts"),
    ];
    const results = matchingEntries(rows, "CUSTOMER");
    expect(results.map((row) => row.label)).toEqual([
      "Customer.php",
      "Customer",
      "CustomerService",
      "findCustomer",
    ]);
    expect(results.at(-1)?.line).toBe(12);
  });
  it("supports abbreviated names, path terms, multiple roots and bounded results", () => {
    const rows = [
      entry("CustomerService", "class"),
      entry("CustomerService", "class", "lib/Customer.ts"),
      entry("findCustomer", "function"),
    ];
    expect(
      matchingEntries(rows, "CSv src/").map((row) => row.relative),
    ).toEqual(["src/Customer.php"]);
    expect(matchingEntries(rows, "Customer", 1)).toHaveLength(1);
    expect(matchingEntries(rows, "unknown")).toEqual([]);
  });
  it("combines Laravel folder and class names and ranks stronger matches first", () => {
    const rows = [
      entry("RoomController", "class", "app/Models/RoomController.php"),
      entry("Room", "class", "app/Models/Room.php", 7),
      entry("Room.php", "file", "app/Models/Room.php"),
      entry("Room", "class", "app/Services/Room.php"),
      entry("Room", "class", "app/Models/LegacyBuilding.php", 14),
      entry("LegacyBuilding.php", "file", "app/Models/LegacyBuilding.php"),
    ];
    const results = matchingEntries(rows, "model room");
    expect(results[0].label).toBe("Room.php");
    expect(results[0].relative).toContain("Models/");
    expect(results.some((row) => row.relative.includes("Services/"))).toBe(
      false,
    );
    expect(
      results.find((row) => row.label === "LegacyBuilding.php"),
    ).toBeDefined();
    expect(results.indexOf(rows[1])).toBeLessThan(results.indexOf(rows[0]));
    expect(matchingEntries(rows, "models room missing")).toEqual([]);
  });
  it("keeps files, classes, servers, database, API, then functions before applying the limit", () => {
    const rows = [
      entry("User", "function"),
      entry("User", "request", "api:request:user"),
      entry("User", "environment", "api:environment:user"),
      entry("User", "folder", "api:folder:user"),
      entry("User", "query", "database:query:user"),
      entry("User", "table", "database:table:user"),
      entry("User", "database", "database:connection:user"),
      entry("User", "server", "servers:user"),
      entry("User", "class"),
      entry("UserFactory.php", "file", "app/Models/UserFactory.php"),
      entry("User.php", "file", "app/Models/User.php"),
    ];
    const kinds = matchingEntries(rows, "user").map((row) => row.kind);
    expect(kinds.slice(0, 4)).toEqual(["file", "file", "class", "server"]);
    expect(kinds.slice(4, 7).sort()).toEqual(["database", "query", "table"]);
    expect(kinds.slice(7, 10).sort()).toEqual(["environment", "folder", "request"]);
    expect(kinds.at(-1)).toBe("function");
    expect(matchingEntries(rows, "user", 1)).toEqual([rows[10]]);
    expect(matchingEntries(rows, "").map((row) => row.kind)).toEqual(kinds);
  });
  it("puts the User file and class above functions for folder + name searches", () => {
    const rows = [
      entry("user", "function", "app/Models/User.php", 21),
      entry("UserFactory.php", "file", "app/Models/UserFactory.php"),
      entry("UserFactory", "class", "app/Models/UserFactory.php", 5),
      entry("User", "class", "app/Models/User.php", 5),
      entry("User.php", "file", "app/Models/User.php"),
      entry("User", "class", "app/Services/User.php"),
    ];
    const expected = [rows[4], rows[1], rows[3], rows[2], rows[0]];
    expect(matchingEntries(rows, "model User")).toEqual(expected);
    expect(matchingEntries(rows, " USER   model USER ")).toEqual(expected);
    expect(matchingEntries(rows, "app/Models/User.php")).toEqual(expected);
    expect(matchingEntries(rows, "app\\Models\\User.php")).toEqual(expected);
    expect(matchingEntries(rows, "model user missing")).toEqual([]);
  });
  it("finds files by declarations without lending sibling names to other symbols", () => {
    const rows = [
      entry("Legacy.php", "file", "app/Models/Legacy.php"),
      entry("User", "class", "app/Models/Legacy.php", 4),
      entry("unrelated", "function", "app/Models/Legacy.php", 12),
      entry("Other", "class", "app/Models/Legacy.php", 24),
    ];
    expect(matchingEntries(rows, "model user")).toEqual(rows.slice(0, 2));
    expect(matchingEntries(rows, "model unrelated")).toEqual([rows[0], rows[2]]);
  });
  it("handles quoted names, Unicode, extensions and abbreviated compound names", () => {
    const rows = [
      entry("User Profile.php", "file", "app/Models/User Profile.php"),
      entry("User HTTP Profile.php", "file", "app/Models/User HTTP Profile.php"),
      entry("CustomerService", "class", "src/Customer.ts"),
      entry("Član.php", "file", "app/Models/Član.php"),
      entry("User", "server", "servers:user"),
    ];
    expect(matchingEntries(rows, 'models "user profile"')).toEqual([rows[0]]);
    expect(matchingEntries(rows, "models 'user profile'")).toEqual([rows[0]]);
    expect(matchingEntries(rows, "MODEL ČLAN.php")).toEqual([rows[3]]);
    expect(matchingEntries(rows, "src CSv")).toEqual([rows[2]]);
    expect(matchingEntries(rows, "models profile http")).toEqual([rows[1]]);
  });
  it("does not match ancestor directories such as macOS /Users as name evidence", () => {
    const rows = [
      entry("Room.php", "file", "app/Models/Room.php"),
      entry("User.php", "file", "app/Models/User.php"),
    ].map((row) => ({ ...row, root: "/Users/user/Projects/backend" }));
    expect(matchingEntries(rows, "model user")).toEqual([rows[1]]);
    expect(matchingEntries(rows, "backend model user")).toEqual([rows[1]]);
    expect(matchingEntries(rows, "Projects model user")).toEqual([]);
  });
});
