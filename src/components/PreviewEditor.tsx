import { useEffect, useRef, useState } from "react";
import type { Document, EditorSelection } from "../types";
import "./preview.css";

export default function PreviewEditor({
  document,
  onChange,
  selection,
  findToken,
  onFindHandled,
  onNavigate,
  readOnly = false,
}: {
  document: Document;
  onChange: (value: string) => void;
  selection?: EditorSelection;
  findToken?: number;
  onFindHandled?: () => void;
  onNavigate?: (query: string, line?: number) => void;
  readOnly?: boolean;
  modelPath?: string;
}) {
  const input = useRef<HTMLTextAreaElement>(null);
  const findInput = useRef<HTMLInputElement>(null);
  const [finding, setFinding] = useState(false);
  const [query, setQuery] = useState("");
  useEffect(() => {
    if (findToken) {
      setFinding(true);
      onFindHandled?.();
    }
  }, [findToken, onFindHandled]);
  useEffect(() => {
    if (finding) {
      findInput.current?.focus();
      findInput.current?.select();
    }
  }, [finding, findToken]);
  const findNext = () => {
    const field = input.current;
    if (!field || !query) return;
    const text = document.text.toLocaleLowerCase(),
      needle = query.toLocaleLowerCase();
    const next = text.indexOf(needle, field.selectionEnd);
    const position = next >= 0 ? next : text.indexOf(needle);
    if (position >= 0) {
      field.focus();
      field.setSelectionRange(position, position + query.length);
    }
  };
  useEffect(() => {
    if (selection?.path !== document.path || !input.current) return;
    const offset = document.text
      .split("\n")
      .slice(0, Math.max(0, selection.line - 1))
      .reduce((length, line) => length + line.length + 1, 0);
    input.current.focus();
    input.current.setSelectionRange(offset, offset);
    input.current.scrollTop = Math.max(0, (selection.line - 4) * 24);
  }, [document.path, selection]);
  return (
    <div className="preview-editor">
      <div className="preview-notice">
        Preview editor · The desktop app uses Monaco with syntax highlighting.
      </div>
      {finding && (
        <div className="preview-find">
          <input
            ref={findInput}
            aria-label="Find in file"
            placeholder="Find in file…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                findNext();
              }
              if (event.key === "Escape") {
                setFinding(false);
                input.current?.focus();
              }
            }}
          />
          <button onClick={findNext}>Find next</button>
          <button
            aria-label="Close find"
            onClick={() => {
              setFinding(false);
              input.current?.focus();
            }}
          >
            ×
          </button>
        </div>
      )}
      <textarea
        ref={input}
        aria-label={`Edit ${document.name}`}
        spellCheck={false}
        readOnly={readOnly}
        onClick={(event) => {
          if (!(event.metaKey || event.ctrlKey)) return;
          const value = event.currentTarget.value;
          const position = event.currentTarget.selectionStart;
          let start = position;
          let end = position;
          while (start > 0 && /[\w$]/.test(value[start - 1])) start--;
          while (end < value.length && /[\w$]/.test(value[end])) end++;
          onNavigate?.(
            value.slice(start, end),
            value.slice(0, position).split("\n").length,
          );
        }}
        value={document.text}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Tab") {
            event.preventDefault();
            const target = event.currentTarget;
            const start = target.selectionStart;
            const end = target.selectionEnd;
            onChange(
              document.text.slice(0, start) + "    " + document.text.slice(end),
            );
            requestAnimationFrame(() => {
              target.selectionStart = target.selectionEnd = start + 4;
            });
          }
        }}
      />
    </div>
  );
}
