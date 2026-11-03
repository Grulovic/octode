import { describe, expect, it } from "vitest";
import { windowLayoutBounds } from "./windowLayout";

describe("windowLayoutBounds", () => {
  const area = { position: { x: -2880, y: 50 }, size: { width: 2880, height: 1750 } };
  it.each([
    ["left", -2880, 1440], ["right", -1440, 1440],
    ["center", -2160, 1440], ["full", -2880, 2880],
  ] as const)("places %s within the current monitor's usable area", (layout, x, width) => {
    expect(windowLayoutBounds(layout, area)).toEqual({ x, y: 50, width, height: 1750 });
  });
  it("keeps the right edge flush on odd-width displays", () => {
    expect(windowLayoutBounds("right", { position: { x: 0, y: 0 }, size: { width: 1513, height: 900 } }))
      .toEqual({ x: 757, y: 0, width: 756, height: 900 });
  });
});
