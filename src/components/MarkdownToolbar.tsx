import "./markdown-toolbar.css";
import { useState } from "react";
import { Bold, Italic, Strikethrough, Code, List, ListOrdered, ListTodo, Quote, Link, Image, Table, Minus, FileCode } from "lucide-react";
import CustomSelect from "./CustomSelect";
import type { MarkdownAction, MarkdownCommand } from "../lib/markdownEditing";

const tools = [
  ["bold", "Bold", Bold], ["italic", "Italic", Italic], ["strike", "Strikethrough", Strikethrough],
  ["bullet", "Bullet list", List], ["ordered", "Numbered list", ListOrdered], ["task", "Checkbox list", ListTodo],
  ["quote", "Block quote", Quote], ["code", "Inline code", Code], ["codeBlock", "Code block", FileCode],
  ["link", "Insert link", Link], ["image", "Insert image", Image], ["table", "Insert or convert table", Table], ["rule", "Horizontal rule", Minus],
] as const;

export default function MarkdownToolbar({ disabled, preview, split = false, onSplit, syncScroll, onSyncScroll, onPreview, onCommand }: {
  syncScroll?: boolean; onSyncScroll?: () => void;
  disabled: boolean; preview: boolean; split?: boolean; onSplit?: () => void; onPreview: (preview: boolean) => void; onCommand: (command: MarkdownCommand) => void;
}) {
  const [panel, setPanel] = useState<"link" | "image" | "table" | null>(null);
  const [url, setUrl] = useState("https://");
  const [rows, setRows] = useState(2);
  const [columns, setColumns] = useState(3);
  const run = (action: MarkdownAction) => {
    if (action === "link" || action === "image" || action === "table") { setPanel(action); setUrl("https://"); }
    else { setPanel(null); onCommand({ action }); }
  };
  return <div className="notes-markdown-tools">
    <div className="notes-format-toolbar" role="toolbar" aria-label="Markdown formatting">
      <div className="notes-markdown-views">
        <button aria-pressed={!preview && !split} onClick={() => { setPanel(null); onPreview(false); }}>Write</button>
        {onSplit && <button aria-pressed={split} onClick={() => { setPanel(null); onSplit(); }}>Split</button>}
        <button aria-pressed={preview} onClick={() => { setPanel(null); onPreview(true); }}>Preview</button>
      </div>
      {split && onSyncScroll && <button aria-label="Sync scroll" aria-pressed={syncScroll} title="Keep editor and preview scrolling together" onClick={onSyncScroll}>Sync scroll</button>}
      {!preview && <>
        <CustomSelect aria-label="Markdown heading" title="Format selected lines" value="" disabled={disabled} onChange={(event) => { setPanel(null); onCommand({ action: event.target.value as MarkdownAction }); }}>
          <option value="" disabled>Heading</option><option value="paragraph">Paragraph</option><option value="heading1">Heading 1</option><option value="heading2">Heading 2</option><option value="heading3">Heading 3</option>
        </CustomSelect>
        <div className="notes-format-buttons">{tools.map(([action, label, Icon]) => <button key={action} disabled={disabled} title={label} aria-label={label} aria-expanded={action === "link" || action === "image" || action === "table" ? panel === action : undefined} onMouseDown={(event) => event.preventDefault()} onClick={() => run(action)}><Icon size={15} /></button>)}</div>
      </>}
    </div>
    {!preview && panel && <form className="notes-format-options" onSubmit={(event) => {
      event.preventDefault();
      if (!disabled) onCommand({ action: panel, url: url.trim(), rows, columns });
      setPanel(null);
    }} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); setPanel(null); } }}>
      {panel === "table" ? <><label>Columns<input aria-label="Table columns" type="number" min={1} max={12} value={columns} onChange={(event) => setColumns(Number(event.target.value))} required /></label><label>Body rows<input aria-label="Table body rows" type="number" min={1} max={30} value={rows} onChange={(event) => setRows(Number(event.target.value))} required /></label><span>Selected lines become rows; tabs separate columns. First row becomes the header.</span></> : <label className="notes-format-url">{panel === "image" ? "Image URL" : "Link URL"}<input aria-label={panel === "image" ? "Image URL" : "Link URL"} type="url" required value={url} onChange={(event) => setUrl(event.target.value)} /></label>}
      <button className="secondary-button" type="submit" disabled={disabled}>Insert</button><button className="secondary-button" type="button" onClick={() => setPanel(null)}>Cancel</button>
    </form>}
  </div>;
}
