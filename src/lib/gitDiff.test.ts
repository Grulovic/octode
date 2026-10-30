import { expect, it } from "vitest";
import { parseHunk, changedRanges, parseCommitDiff } from "./gitDiff";
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

it("splits commit patches by file and hunk while retaining metadata, binary changes and renames", () => {
  const source = 'commit abc\nAuthor: Test\n\ndiff --git a/one.ts b/one.ts\n--- a/one.ts\n+++ b/one.ts\n@@ -1 +1 @@\n-old\n+new\n@@ -9 +9 @@\n-before\n+after\ndiff --git a/gone.sql b/gone.sql\ndeleted file mode 100644\n--- a/gone.sql\n+++ /dev/null\n@@ -1 +0,0 @@\n-delete me\ndiff --git a/image.png b/image.png\nBinary files a/image.png and b/image.png differ\ndiff --git a/old.txt b/new name.txt\nsimilarity index 100%\nrename from old.txt\nrename to new name.txt\n';
  const result = parseCommitDiff(source);
  expect(result.header).toContain("Author: Test");
  expect(result.files.map((file) => file.path)).toEqual(["one.ts", "gone.sql", "image.png", "new name.txt"]);
  expect(result.files[0].hunks).toHaveLength(2);
  expect(parseHunk(result.files[0].hunks[0])?.after).toEqual(["new"]);
  expect(parseHunk(result.files[0].hunks[1])?.before).toEqual(["before"]);
  expect(parseHunk(result.files[1].hunks[0])?.before).toEqual(["delete me"]);
  expect(result.files[2].header).toContain("Binary files");
  expect(result.files[3].hunks).toEqual([]);
  expect(parseCommitDiff("commit empty").files).toEqual([]);
});
it("decodes quoted Git paths and leaves combined merge patches available as raw details", () => {
  const quoted = parseCommitDiff('diff --git "a/caf\\303\\251.sql" "b/caf\\303\\251.sql"\n--- "a/caf\\303\\251.sql"\n+++ "b/caf\\303\\251.sql"\n@@ -1 +1 @@\n-a\n+b\n');
  expect(quoted.files[0].path).toBe("café.sql");
  expect(parseHunk(quoted.files[0].hunks[0])?.after).toEqual(["b"]);
  const merge = parseCommitDiff("commit merge\ndiff --cc foo.ts\n@@@ -1,1 -1,1 +1,1 @@@\n++merged\n");
  expect(merge.files[0].hunks).toEqual([]);
  expect(merge.files[0].header).toContain("++merged");
});
