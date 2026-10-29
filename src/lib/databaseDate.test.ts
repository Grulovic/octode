import { expect, it } from "vitest";
import {
  calendarDays,
  cellDateKind,
  dateParts,
  moveCalendarMonth,
  pickedDate,
  validCellDate,
} from "./databaseDate";
it("recognizes date and timestamp columns and ISO text dates", () => {
  expect(cellDateKind("DATE", "")).toBe("date");
  expect(cellDateKind("timestamp with time zone", "")).toBe("datetime");
  expect(cellDateKind("DATETIME(6)", "")).toBe("datetime");
  expect(cellDateKind("TEXT", "2026-10-28")).toBe("date");
  expect(cellDateKind("TEXT", "plain text")).toBeNull();
  expect(cellDateKind("TIME", "11:28:29")).toBeNull();
});
it("changes date/time without timezone conversion or loss of fractional seconds", () => {
  const value = "2026-10-28 11:28:29.123456+02:00";
  expect(
    pickedDate("datetime", "2026-10-29", dateParts(value).time, value),
  ).toBe("2026-10-29 11:28:29.123456+02:00");
  expect(
    pickedDate(
      "datetime",
      "2026-10-29",
      "10:11:12.000001",
      "2026-10-28T11:28:29Z",
    ),
  ).toBe("2026-10-29T10:11:12.000001Z");
  expect(pickedDate("date", "2026-10-29", "", "")).toBe("2026-10-29");
  expect(() =>
    pickedDate("datetime", "2026-10-29", "25:00:00", value),
  ).toThrow();
  expect(() => pickedDate("date", "2026-02-30", "", "")).toThrow();
});
it("builds calendar months and leap days using UTC date arithmetic", () => {
  expect(validCellDate("2024-02-29")).toBe(true);
  expect(validCellDate("2026-02-29")).toBe(false);
  expect(calendarDays("2026-10")).toHaveLength(42);
  expect(calendarDays("2026-10")[0]).toBe("2026-09-27");
  expect(calendarDays("2026-10")).toContain("2026-10-29");
  expect(moveCalendarMonth("2026-12", 1)).toBe("2027-01");
  expect(moveCalendarMonth("2026-01", -1)).toBe("2025-12");
});
