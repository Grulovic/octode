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
      "Customer",
      "Customer.php",
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
    expect(results[0].label).toBe("Room");
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
});
