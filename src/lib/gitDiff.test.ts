import { expect, it } from "vitest";
import { parseHunk, changedRanges } from "./gitDiff";
it("aligns replacements, additions and context with original file line numbers", () => {
  const hunk = parseHunk(
    "@@ -10,3 +10,4 @@ example\n keep\n-old\n+new\n+extra\n end\n",
  )!;
  expect(hunk.before).toEqual(["keep", "old", "end"]);
  expect(hunk.after).toEqual(["keep", "new", "extra", "end"]);
  expect(
    hunk.rows.map((row) => [
      row.before?.number,
      row.after?.number,
      row.changed,
    ]),
  ).toEqual([
    [10, 10, false],
    [11, 11, true],
    [undefined, 12, true],
    [12, 13, false],
  ]);
  expect([hunk.removed, hunk.added]).toEqual([1, 2]);
});
it("handles new/deleted files, omitted counts, blank lines and missing final newlines", () => {
  expect(parseHunk("@@ -0,0 +1,2 @@\n+hello\n+\n")?.after).toEqual([
    "hello",
    "",
  ]);
  expect(
    parseHunk("@@ -1 +0,0 @@\n-old\n\\ No newline at end of file\n")?.before,
  ).toEqual(["old"]);
  expect(
    parseHunk("@@ -1 +1 @@\n-a\n+b\n\\ No newline at end of file\n")?.rows,
  ).toHaveLength(1);
});
it("rejects malformed or truncated hunks rather than inventing line numbers", () => {
  expect(parseHunk("@@@ -1,2 +1,2 @@@\n a")).toBeNull();
  expect(parseHunk("@@ -1,3 +1,3 @@\n a\n")).toBeNull();
  expect(parseHunk("@@ -1 +1 @@\nunknown")).toBeNull();
});
it("finds changed character ranges without splitting emoji", () => {
  expect(changedRanges('"react": "19.2.3"', '"react": "19.3.0"')).toEqual([
    13, 16, 16,
  ]);
  const before = "a😀z",
    after = "a😃z";
  const [start, oldEnd, newEnd] = changedRanges(before, after);
  expect(before.slice(start, oldEnd)).toBe("😀");
  expect(after.slice(start, newEnd)).toBe("😃");
  expect(changedRanges("same", "same")).toEqual([4, 4, 4]);
});
