export type MarkdownAction = "bold" | "italic" | "strike" | "code" | "codeBlock" | "heading1" | "heading2" | "heading3" | "paragraph" | "bullet" | "ordered" | "task" | "quote" | "link" | "image" | "table" | "rule";
export interface MarkdownCommand { action: MarkdownAction; url?: string; rows?: number; columns?: number }
export interface MarkdownEdit { start: number; end: number; text: string; selectionStart: number; selectionEnd: number }

// Offsets are UTF-16, matching both Monaco and textarea selections.
export function markdownEdit(value: string, start: number, end: number, command: MarkdownCommand): MarkdownEdit {
  const eol = value.includes("\r\n") ? "\r\n" : "\n";
  const selected = value.slice(start, end);
  const result = (text: string, from = 0, to = text.length): MarkdownEdit => ({ start, end, text, selectionStart: start + from, selectionEnd: start + to });
  const wrap = (marker: string, placeholder: string) => {
    if (selected.startsWith(marker) && selected.endsWith(marker) && selected.length >= marker.length * 2) return result(selected.slice(marker.length, -marker.length));
    if (value.slice(start - marker.length, start) === marker && value.slice(end, end + marker.length) === marker) {
      start -= marker.length; end += marker.length;
      return result(selected);
    }
    const text = selected || placeholder;
    return result(marker + text + marker, marker.length, marker.length + text.length);
  };
  switch (command.action) {
    case "bold": return wrap("**", "bold text");
    case "italic": return wrap("_", "italic text");
    case "strike": return wrap("~~", "text");
    case "code": {
      const longest = Math.max(0, ...Array.from(selected.matchAll(/`+/g), (match) => match[0].length));
      return wrap("`".repeat(longest + 1), "code");
    }
    case "link": case "image": {
      const label = (selected || (command.action === "image" ? "image description" : "link text")).replace(/[\[\]\\]/g, "\\$&");
      const url = (command.url || "https://").replace(/\\/g, "%5C").replace(/\s/g, (char) => encodeURIComponent(char)).replace(/\(/g, "%28").replace(/\)/g, "%29");
      const prefix = command.action === "image" ? "![" : "[";
      return result(`${prefix}${label}](${url})`, prefix.length, prefix.length + label.length);
    }
  }
  // Block actions operate on complete lines. An end at column one excludes that line.
  const originalStart = start, originalEnd = end;
  start = start === 0 ? 0 : value.lastIndexOf("\n", start - 1) + 1;
  const last = end > originalStart && value[end - 1] === "\n" ? end - 1 : end;
  const next = value.indexOf("\n", last);
  end = next < 0 ? value.length : next;
  if (value[end - 1] === "\r") end--;
  const lines = value.slice(start, end).split(/\r?\n/);
  const block = (text: string) => {
    const prefix = value.slice(0, start), suffix = value.slice(end);
    const before = !prefix || /\r?\n\r?\n$/.test(prefix) ? "" : prefix.endsWith("\n") ? eol : eol + eol;
    const after = !suffix || /^\r?\n\r?\n/.test(suffix) ? "" : /^\r?\n/.test(suffix) ? eol : eol + eol;
    return result(before + text + after, before.length, before.length + text.length);
  };
  if (command.action === "table") {
    if (originalEnd === originalStart) { start = originalStart; end = originalEnd; }
    const data = originalEnd > originalStart ? lines.map((line) => line.split("\t")) : [];
    const columns = data.length ? Math.max(...data.map((row) => row.length)) : Math.max(1, Math.min(12, command.columns || 3));
    const escape = (cell: string) => cell.trim().replace(/\|/g, "\\|");
    const row = (cells: string[]) => `| ${Array.from({ length: columns }, (_, index) => escape(cells[index] ?? "")).join(" | ")} |`;
    const header = data[0] ?? Array.from({ length: columns }, (_, index) => `Column ${index + 1}`);
    const body = data.length ? data.slice(1) : Array.from({ length: Math.max(1, Math.min(30, command.rows || 2)) }, () => [] as string[]);
    return block([row(header), row(Array(columns).fill("---")), ...body.map(row)].join(eol));
  }
  if (command.action === "codeBlock") {
    const text = lines.join(eol) || "code";
    const fence = "`".repeat(Math.max(3, ...Array.from(text.matchAll(/`+/g), (match) => match[0].length + 1)));
    return block(`${fence}${eol}${text}${eol}${fence}`);
  }
  if (command.action === "rule") {
    // Insert at the selection rather than replacing any surrounding line text.
    start = originalStart; end = originalEnd;
    const before = start > 0 ? eol + eol : "";
    return result(before + "---" + eol + eol);
  }
  const marker = command.action === "bullet" ? "- " : command.action === "task" ? "- [ ] " : command.action === "quote" ? "> " : command.action.startsWith("heading") ? "#".repeat(Number(command.action.slice(-1))) + " " : "";
  const stripList = /^(\s*)(?:[-+*]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)/;
  const isList = ["bullet", "ordered", "task"].includes(command.action);
  const allMarked = command.action !== "ordered" && marker && lines.every((line) => !line.trim() || line.trimStart().startsWith(marker));
  let index = 0;
  return result(lines.map((line) => {
    if (!line.trim() && lines.length > 1) return line;
    if (isList) {
      const clean = line.replace(stripList, "$1");
      if (allMarked) return clean;
      return clean.replace(/^(\s*)/, `$1${command.action === "ordered" ? `${++index}. ` : marker}`);
    }
    if (command.action === "quote") return allMarked ? line.replace(/^(\s*)> /, "$1") : line.replace(/^(\s*)/, "$1> ");
    return line.replace(/^(\s*)(?:#{1,6}\s+)?/, `$1${allMarked || command.action === "paragraph" ? "" : marker}`);
  }).join(eol));
}
