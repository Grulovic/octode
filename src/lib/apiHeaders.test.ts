import { describe, expect, it } from "vitest";
import { inheritHeaders } from "./apiHeaders";
import { row } from "./toolDefaults";

describe("environment headers", () => {
  it("inherits defaults and replaces matching names without duplicates", () => {
    const defaults = [row("Accept", "application/json"), row("Authorization", "{{token}}")];
    const override = row("accept", "text/plain");
    expect(inheritHeaders(defaults, [override])).toEqual([defaults[1], override]);
    expect(defaults).toHaveLength(2);
  });
  it("does not let a disabled request header hide an enabled default", () => {
    const header = row("X-Team", "octode");
    expect(inheritHeaders([header], [{ ...header, enabled: false }])[0]).toEqual(header);
    expect(inheritHeaders([], [header])).toEqual([header]);
  });
});
