import { monaco } from "./runtime";
import type { editor } from "monaco-editor";
import { invoke } from "../lib/bridge";

type BlameLine = { commit: string; author: string; time: number; summary: string };

// Keep annotations outside Monaco's text model so toggling preserves edits and undo.
export function mountGitBlame(instance: editor.IStandaloneCodeEditor, gutter: HTMLDivElement, projectId: string, path: string, content: string) {
  let disposed = false;
  let lines: BlameLine[] = [];
  const date = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" });
  const render = () => {
    const nodes: HTMLElement[] = [];
    const seen = new Set<number>();
    const height = instance.getOption(monaco.editor.EditorOption.lineHeight);
    for (const range of instance.getVisibleRanges()) {
      for (let line = range.startLineNumber; line <= range.endLineNumber; line++) {
        if (seen.has(line)) continue;
        seen.add(line);
        const entry = lines[line - 1];
        if (!entry) continue;
        const row = gutter.ownerDocument.createElement("div");
        row.className = "git-blame-line";
        row.style.top = `${instance.getTopForLineNumber(line) - instance.getScrollTop()}px`;
        row.style.height = `${height}px`;
        row.style.lineHeight = `${height}px`;
        row.textContent = `${entry.time ? date.format(new Date(entry.time * 1000)) + " " : ""}${entry.author}`;
        row.title = `${entry.author}\n${entry.time ? date.format(new Date(entry.time * 1000)) + " · " + entry.commit.slice(0, 8) : "Uncommitted changes"}\n${entry.summary}`;
        nodes.push(row);
      }
    }
    gutter.replaceChildren(...nodes);
  };
  const listeners = [instance.onDidScrollChange(render), instance.onDidLayoutChange(render), instance.onDidContentSizeChange(render)];
  gutter.textContent = "Loading blame…";
  const timer = window.setTimeout(() => {
    void invoke<BlameLine[]>("git_blame", { projectId, path, content }).then((result) => {
      if (disposed) return;
      lines = result;
      render();
    }).catch((error: unknown) => {
      if (disposed) return;
      gutter.textContent = "Blame unavailable";
      gutter.title = String(error);
    });
  }, 450);
  return () => {
    disposed = true;
    window.clearTimeout(timer);
    listeners.forEach((listener) => listener.dispose());
    gutter.replaceChildren();
    gutter.removeAttribute("title");
  };
}
