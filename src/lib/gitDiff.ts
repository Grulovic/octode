export interface DiffLine {
  text: string;
  number: number;
  index: number;
}
export interface DiffRow {
  before?: DiffLine;
  after?: DiffLine;
  changed: boolean;
}
export interface ParsedHunk {
  heading: string;
  before: string[];
  after: string[];
  rows: DiffRow[];
  added: number;
  removed: number;
}
/** Parse the display copy only. The original patch remains authoritative for staging. */
export function parseHunk(source: string): ParsedHunk | null {
  const lines = source.split("\n");
  const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/.exec(
    lines[0],
  );
  if (!match) return null;
  let oldNumber = Number(match[1]),
    newNumber = Number(match[3]);
  const result: ParsedHunk = {
    heading: lines[0],
    before: [],
    after: [],
    rows: [],
    added: 0,
    removed: 0,
  };
  let removed: DiffLine[] = [],
    added: DiffLine[] = [];
  const flush = () => {
    for (let i = 0; i < Math.max(removed.length, added.length); i++)
      result.rows.push({ before: removed[i], after: added[i], changed: true });
    removed = [];
    added = [];
  };
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("\\ No newline at end of file")) continue;
    if (!line && i === lines.length - 1) continue;
    const text = line.slice(1);
    if (line[0] === "-") {
      removed.push({ text, number: oldNumber++, index: result.before.length });
      result.before.push(text);
      result.removed++;
    } else if (line[0] === "+") {
      added.push({ text, number: newNumber++, index: result.after.length });
      result.after.push(text);
      result.added++;
    } else if (line[0] === " ") {
      flush();
      result.rows.push({
        before: { text, number: oldNumber++, index: result.before.length },
        after: { text, number: newNumber++, index: result.after.length },
        changed: false,
      });
      result.before.push(text);
      result.after.push(text);
    } else return null;
  }
  flush();
  if (
    result.before.length !== Number(match[2] ?? 1) ||
    result.after.length !== Number(match[4] ?? 1)
  )
    return null;
  return result;
}
export function changedRanges(
  before: string,
  after: string,
): [number, number, number] {
  let start = 0,
    oldEnd = before.length,
    newEnd = after.length;
  while (start < oldEnd && start < newEnd && before[start] === after[start])
    start++;
  while (
    oldEnd > start &&
    newEnd > start &&
    before[oldEnd - 1] === after[newEnd - 1]
  ) {
    oldEnd--;
    newEnd--;
  }
  // Avoid splitting a UTF-16 surrogate pair between differently styled spans.
  const low = (value: number) => value >= 0xdc00 && value <= 0xdfff;
  if (low(before.charCodeAt(start)) || low(after.charCodeAt(start))) start--;
  if (low(before.charCodeAt(oldEnd))) oldEnd++;
  if (low(after.charCodeAt(newEnd))) newEnd++;
  return [Math.max(0, start), oldEnd, newEnd];
}
