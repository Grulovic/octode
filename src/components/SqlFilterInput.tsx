import { useEffect, useState } from "react";
import { sqlHighlightParts } from "../lib/sqlHighlight";

/** A normal text input with an inert SQL-colored mirror behind it. */
export default function SqlFilterInput({ value, onChange, onSubmit, disabled = false }: { value: string; onChange: (value: string) => void; onSubmit: () => void; disabled?: boolean }) {
  const [colored, setColored] = useState<{ value: string; parts: { text: string; color: string }[] }>({ value: "", parts: [] });
  const [scroll, setScroll] = useState(0);
  useEffect(() => {
    let gone = false;
    if (value) void import("../editor/runtime").then(async ({ monaco }) => {
      // Await lazy grammar loading, then render token colors inline so global
      // editor theme/style changes cannot recolor this input incorrectly.
      await monaco.editor.colorize(value, "sql", { tabSize: 4 });
      const parts = sqlHighlightParts(value, monaco.editor.tokenize(value, "sql")[0]);
      if (!gone) setColored({ value, parts });
    }).catch(() => {});
    return () => { gone = true; };
  }, [value]);
  return <span className="database-sql-filter">
    <span className="database-sql-filter-mirror" aria-hidden="true">
      <span style={{ transform: `translateX(${-scroll}px)` }}>{colored.value === value && colored.parts.length ? colored.parts.map((part, index) => <span key={index} style={{ color: part.color }}>{part.text}</span>) : value}</span>
    </span>
    <input aria-label="Quick WHERE expression" placeholder="id > 10 or WHERE id > 10" title="Filter rows with a SQL condition; WHERE is optional" value={value} disabled={disabled} spellCheck={false} autoCorrect="off" autoCapitalize="off" autoComplete="off" onChange={(event) => onChange(event.target.value)} onScroll={(event) => setScroll(event.currentTarget.scrollLeft)} onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) onSubmit(); }} />
  </span>;
}
