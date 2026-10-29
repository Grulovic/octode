import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { deepOcean } from "../editor/deepOcean";
import { language } from "../lib/workspace";
import { changedRanges, parseHunk, type DiffLine } from "../lib/gitDiff";
type Token = { offset: number; type: string };
const tokenStyles = new Map<string, CSSProperties>();
let syntax: Promise<(typeof import("../editor/runtime"))["monaco"]> | undefined;
function syntaxRuntime() {
  return (syntax ??= import("../editor/runtime").then(({ monaco }) => {
    monaco.editor.defineTheme("octode", deepOcean);
    return monaco;
  }));
}
function tokenStyle(type: string): CSSProperties {
  const existing = tokenStyles.get(type);
  if (existing) return existing;
  const rule = deepOcean.rules
    .filter((rule) => type === rule.token || type.startsWith(rule.token + "."))
    .sort((a, b) => b.token.length - a.token.length)[0];
  const style: CSSProperties = {
    color: rule?.foreground ? `#${rule.foreground}` : undefined,
    fontStyle: rule?.fontStyle?.includes("italic") ? "italic" : undefined,
    fontWeight: rule?.fontStyle?.includes("bold") ? 600 : undefined,
  };
  tokenStyles.set(type, style);
  return style;
}
export default function GitDiffHunk({
  source,
  path,
}: {
  source: string;
  path: string;
}) {
  const hunk = useMemo(() => parseHunk(source), [source]);
  const [tokens, setTokens] = useState<{
    before: Token[][];
    after: Token[][];
  } | null>(null);
  useEffect(() => {
    let gone = false;
    setTokens(null);
    if (!hunk) return;
    const highlight = async () => {
      const monaco = await syntaxRuntime();
      const id = language(path);
      const tokenize = async (lines: string[]) => {
        const prefix =
          id === "php" && !lines.join("\n").includes("<?") ? "<?php\n" : "";
        const text = prefix + lines.join("\n");
        // Wait for lazily registered grammars before tokenizing either side.
        await monaco.editor.colorize(text, id, { tabSize: 4 });
        return monaco.editor.tokenize(text, id).slice(prefix ? 1 : 0);
      };
      const [before, after] = await Promise.all([
        tokenize(hunk.before),
        tokenize(hunk.after),
      ]);
      if (!gone) setTokens({ before, after });
    };
    void highlight().catch(() => {});
    return () => {
      gone = true;
    };
  }, [hunk, path]);
  if (!hunk) return <pre className="git-raw-patch">{source}</pre>;
  const cell = (
    line: DiffLine | undefined,
    side: "before" | "after",
    changed: boolean,
    range?: [number, number],
  ) => {
    const kind = !line
      ? "empty"
      : changed
        ? side === "before"
          ? "removed"
          : "added"
        : "context";
    const segments = tokens?.[side][line?.index ?? -1] ?? [
      { offset: 0, type: "" },
    ];
    return (
      <>
        <td className={`git-diff-number ${kind}`}>
          <span>{line?.number}</span>
          <span className="git-diff-sign">
            {line && changed ? (side === "before" ? "−" : "+") : ""}
          </span>
        </td>
        <td className={`git-diff-code ${kind}`}>
          {line && (
            <code>
              {segments.map((token, i) => {
                const start = token.offset,
                  end = segments[i + 1]?.offset ?? line.text.length;
                const cuts = [
                  start,
                  ...(range ?? []).filter(
                    (point) => point > start && point < end,
                  ),
                  end,
                ].sort((a, b) => a - b);
                return cuts.slice(0, -1).map((from, j) => (
                  <span
                    key={`${i}:${j}`}
                    style={tokenStyle(token.type)}
                    className={
                      range && from >= range[0] && from < range[1]
                        ? "git-word-change"
                        : undefined
                    }
                  >
                    {line.text.slice(from, cuts[j + 1])}
                  </span>
                ));
              })}
              {!line.text && "\u00a0"}
            </code>
          )}
        </td>
      </>
    );
  };
  return (
    <div className="git-compare-scroll">
      <table
        className="git-compare-table"
        aria-label="Code changes before and after"
      >
        <colgroup>
          <col className="git-number-column" />
          <col />
          <col className="git-number-column" />
          <col />
        </colgroup>
        <thead>
          <tr>
            <th colSpan={2}>
              Before{" "}
              <span className="git-removed-count">−{hunk.removed} removed</span>
            </th>
            <th colSpan={2}>
              After <span className="git-added-count">+{hunk.added} added</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {hunk.rows.map((row, i) => {
            const range =
              row.changed && row.before && row.after
                ? changedRanges(row.before.text, row.after.text)
                : undefined;
            return (
              <tr key={i}>
                {cell(
                  row.before,
                  "before",
                  row.changed,
                  range ? [range[0], range[1]] : undefined,
                )}
                {cell(
                  row.after,
                  "after",
                  row.changed,
                  range ? [range[0], range[2]] : undefined,
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
