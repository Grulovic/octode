import { expect, it } from "vitest";
import { mergeChanges, mergeRegions, mergeReplacement } from "./mergeDiff";
const lines = (text: string) => text.split("\n");
function replace(source: string, result: string) {
  const a = lines(source), b = lines(result);
  const changes = mergeChanges(a, b);
  for (const change of changes.reverse()) {
    const ranges = mergeReplacement(a, b, change);
    const offset = (text: string, line: number, col: number) => text.split("\n").slice(0, line - 1).reduce((sum, value) => sum + value.length + 1, 0) + col - 1;
    const from = (text: string, range: typeof ranges.sourceRange) => [offset(text, range.startLineNumber, range.startColumn), offset(text, range.endLineNumber, range.endColumn)];
    const [sourceStart, sourceEnd] = from(source, ranges.sourceRange), [start, end] = from(result, ranges.resultRange);
    result = result.slice(0, start) + source.slice(sourceStart, sourceEnd) + result.slice(end);
  }
  return result;
}
it.each([
  ["a\nb\nc\n", "a\nx\nc\n"], ["a\nb", "a"], ["a", "a\nb"], ["a\n", "a"], ["a", "a\n"],
  ["", "a\nb"], ["a\nb", ""], ["a\nb\n", ""], ["", "a\nb\n"],
  ["insert\na\nb\n", "a\nb\n"], ["a\nb\n", "insert\na\nb\n"],
  ["a\n\nc", "a\nc"], ["a\nc", "a\n\nc"], ["a\n\n", "a\n"],
  ["a\nb\nc\nd", "a\nx\nc\ny"], ["one\n\n", ""],
])("accepting all chunks reproduces source exactly, including newline boundaries (%j)", (source, result) => {
  expect(replace(source, result)).toBe(source);
});
it("aligns different-length edits from both sources around the same result region", () => {
  const result = ["one", "base", "three", "four"];
  const left = mergeChanges(["one", "left", "extra", "three", "four"], result);
  const right = mergeChanges(["one", "right", "three", "four"], result);
  const regions = mergeRegions(left, right);
  expect(regions).toEqual([{ resultStart: 2, resultEnd: 3, leftStart: 2, leftEnd: 4, rightStart: 2, rightEnd: 3, left: true, right: true, height: 2, extraBefore: 0 }]);
});
it("keeps separated edits independently transferable and removes accepted differences", () => {
  const source = ["a", "left", "c", "d", "e", "f", "g", "end"];
  const result = ["a", "base", "c", "d", "e", "f", "g", "old"];
  const changes = mergeChanges(source, result);
  expect(changes).toHaveLength(2);
  expect(mergeRegions(changes, [])).toHaveLength(2);
  expect(mergeChanges(source, source)).toEqual([]);
});
it("aligns insertions at the beginning and end without negative line numbers", () => {
  const result = ["a", "b", "c"];
  const left = mergeChanges(["first", ...result, "last"], result);
  for (const region of mergeRegions(left, [])) {
    expect(region.leftStart).toBeGreaterThanOrEqual(1);
    expect(region.rightEnd - region.rightStart).toBe(region.resultEnd - region.resultStart);
    expect(region.height).toBeGreaterThan(0);
  }
});
it("preserves text exactly over many independent insertion/deletion combinations", () => {
  let seed = 617;
  const next = () => (seed = (seed * 1664525 + 1013904223) >>> 0);
  const text = () => Array.from({ length: next() % 12 }, () => ["same", "", "alpha", "beta", "🙂"][next() % 5]).join("\n");
  for (let index = 0; index < 120; index++) {
    const source = text(), result = text();
    expect(replace(source, result)).toBe(source);
    const left = lines(source), middle = lines(result), right = lines(text());
    const regions = mergeRegions(mergeChanges(left, middle), mergeChanges(right, middle));
    const totals = { left: left.length, middle: middle.length, right: right.length };
    for (const region of regions) {
      totals.left += region.height - (region.leftEnd - region.leftStart);
      totals.middle += region.height - (region.resultEnd - region.resultStart);
      totals.right += region.height - (region.rightEnd - region.rightStart);
    }
    expect(totals.left).toBe(totals.middle); expect(totals.right).toBe(totals.middle);
  }
});
