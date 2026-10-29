import { describe, it, expect } from "vitest";
import { parseCsv, csvInserts } from "./csv";
import { resultCsv } from "./export";
describe("CSV data interchange", () => {
  it("parses quotes, embedded delimiters and newlines, Unicode, BOM and CRLF", () => {
    expect(
      parseCsv('\uFEFFid,name,note\r\n1,"Ćao, team","line 1\nline ""2"""\r\n'),
    ).toEqual([
      ["id", "name", "note"],
      ["1", "Ćao, team", 'line 1\nline "2"'],
    ]);
    expect(() => parseCsv('id,name\n1,"unfinished')).toThrow();
    expect(() => parseCsv("id,name\n1")).toThrow();
  });
  it("preserves explicit empty rows while ignoring blank separator lines", () => {
    expect(parseCsv('a,b\n,\n\n"",""\n')).toEqual([
      ["a", "b"],
      ["", ""],
      ["", ""],
    ]);
    expect(parseCsv('value\n""\n')).toEqual([["value"], [""]]);
  });
  it("requires unique mapped columns and keeps empty strings separate from NULL", () => {
    const rows = [
      ["id", "name"],
      ["9007199254740993", ""],
    ];
    expect(csvInserts(rows, ["id", "name"], false)[0].values).toEqual({
      id: "9007199254740993",
      name: "",
    });
    expect(csvInserts(rows, ["id", "name"], true)[0].values.name).toBeNull();
    expect(() => csvInserts(rows, ["id", "id"], false)).toThrow();
  });
  it("round-trips empty exported rows without silently dropping records", () => {
    expect(
      parseCsv(
        resultCsv({
          columns: [{ name: "value", dataType: "text" }],
          rows: [[{ kind: "text", value: "" }], [{ kind: "null", value: "" }]],
          rowsAffected: 0,
          elapsedMs: 0,
          truncated: false,
        }),
      ),
    ).toEqual([["value"], [""], [""]]);
  });
  it("exports display values with quoting and preserves exact IDs", () => {
    const csv = resultCsv({
      columns: [
        { name: "id", dataType: "bigint" },
        { name: "name", dataType: "text" },
      ],
      rows: [
        [
          { kind: "text", value: "9007199254740993" },
          { kind: "text", value: 'O"Brien, first\nsecond' },
        ],
      ],
      rowsAffected: 0,
      elapsedMs: 0,
      truncated: false,
    });
    expect(parseCsv(csv)[1]).toEqual([
      "9007199254740993",
      'O"Brien, first\nsecond',
    ]);
  });
});
