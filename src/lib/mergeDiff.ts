import { DefaultLinesDiffComputer } from "monaco-editor/esm/vs/editor/common/diff/defaultLinesDiffComputer/defaultLinesDiffComputer.js";
export interface MergeChange { sourceStart: number; sourceEnd: number; resultStart: number; resultEnd: number }
export interface MergeRegion {
  resultStart: number; resultEnd: number;
  leftStart: number; leftEnd: number; rightStart: number; rightEnd: number;
  left: boolean; right: boolean; extraBefore: number;
  height: number;
}
export function mergeChanges(source: string[], result: string[]): MergeChange[] {
  return new DefaultLinesDiffComputer().computeDiff(source, result, {
    ignoreTrimWhitespace: false, maxComputationTimeMs: 120, computeMoves: false,
  }).changes.map(({ original, modified }) => ({
    sourceStart: original.startLineNumber, sourceEnd: original.endLineNumberExclusive,
    resultStart: modified.startLineNumber, resultEnd: modified.endLineNumberExclusive,
  }));
}
/** Merge touching edits into aligned three-way regions; ranges are 1-based and end-exclusive. */
export function mergeRegions(left: MergeChange[], right: MergeChange[]): MergeRegion[] {
  const edits = [...left.map((change) => ({ change, side: "left" as const })), ...right.map((change) => ({ change, side: "right" as const }))]
    .sort((a, b) => a.change.resultStart - b.change.resultStart || a.change.resultEnd - b.change.resultEnd);
  const groups: typeof edits[] = [];
  for (const entry of edits) {
    const previous = groups.at(-1);
    if (previous && entry.change.resultStart <= Math.max(...previous.map(({ change }) => change.resultEnd))) previous.push(entry);
    else groups.push([entry]);
  }
  let leftOffset = 0, rightOffset = 0, extraBefore = 0;
  return groups.map((group) => {
    const resultStart = Math.min(...group.map(({ change }) => change.resultStart));
    const resultEnd = Math.max(...group.map(({ change }) => change.resultEnd));
    const delta = (side: "left" | "right") => group.filter((item) => item.side === side).reduce((sum, { change }) => sum + change.sourceEnd - change.sourceStart - (change.resultEnd - change.resultStart), 0);
    const leftStart = resultStart + leftOffset, rightStart = resultStart + rightOffset;
    leftOffset += delta("left"); rightOffset += delta("right");
    const leftEnd = resultEnd + leftOffset, rightEnd = resultEnd + rightOffset;
    const height = Math.max(resultEnd - resultStart, leftEnd - leftStart, rightEnd - rightStart);
    const region = { resultStart, resultEnd, leftStart, leftEnd, rightStart, rightEnd, height, extraBefore, left: group.some((item) => item.side === "left"), right: group.some((item) => item.side === "right") };
    extraBefore += height - (resultEnd - resultStart);
    return region;
  });
}
/** Convert line spans to exact character edits, including insertions/deletions at EOF. */
export function mergeReplacement(source: string[], result: string[], change: MergeChange) {
  const sourceLength = source.length, resultLength = result.length;
  const range = (start: number, end: number, lines: string[], previousLine = false) => previousLine
    ? { startLineNumber: start - 1, startColumn: lines[start - 2].length + 1, endLineNumber: end - 1, endColumn: lines[end - 2].length + 1 }
    : { startLineNumber: start, startColumn: 1, endLineNumber: Math.min(end, lines.length), endColumn: end <= lines.length ? 1 : lines.at(-1)!.length + 1 };
  const eof = change.sourceEnd > sourceLength || change.resultEnd > resultLength;
  const empty = change.sourceStart === change.sourceEnd || change.resultStart === change.resultEnd;
  const previousLine = eof && empty && change.sourceStart > 1 && change.resultStart > 1;
  return {
    sourceRange: range(change.sourceStart, change.sourceEnd, source, previousLine),
    resultRange: range(change.resultStart, change.resultEnd, result, previousLine),
  };
}
