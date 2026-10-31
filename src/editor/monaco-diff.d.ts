declare module "monaco-editor/esm/vs/editor/common/diff/defaultLinesDiffComputer/defaultLinesDiffComputer.js" {
  interface LineRange { startLineNumber: number; endLineNumberExclusive: number }
  interface TextRange { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number }
  export class DefaultLinesDiffComputer {
    computeDiff(original: string[], modified: string[], options: { ignoreTrimWhitespace: boolean; maxComputationTimeMs: number; computeMoves: boolean }): {
      changes: { original: LineRange; modified: LineRange; toRangeMapping2(original: string[], modified: string[]): { originalRange: TextRange; modifiedRange: TextRange } }[];
      hitTimeout: boolean;
    };
  }
}
