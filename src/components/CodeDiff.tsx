import { deepOcean } from "../editor/deepOcean";
import { useEffect, useRef } from "react";
import { monaco } from "../editor/runtime";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
Object.assign(self, {
  MonacoEnvironment: {
    getWorker() {
      return new EditorWorker();
    },
  },
});
monaco.editor.defineTheme("octode", deepOcean);
export default function CodeDiff({
  before,
  after,
  language = "plaintext",
}: {
  before: string;
  after: string;
  language?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const models = useRef<{
    original: monaco.editor.ITextModel;
    modified: monaco.editor.ITextModel;
  } | null>(null);
  useEffect(() => {
    if (!host.current) return;
    const element = host.current;
    const original = monaco.editor.createModel(before, language);
    const modified = monaco.editor.createModel(after, language);
    models.current = { original, modified };
    const editor = monaco.editor.createDiffEditor(element, {
      readOnly: true,
      originalEditable: false,
      automaticLayout: false,
      renderSideBySide: true,
      minimap: { enabled: false },
      fontSize: 12,
      scrollBeyondLastLine: false,
      theme: "octode",
    });
    editor.setModel({ original, modified });
    const layout = () => {
      if (element.clientWidth && element.clientHeight)
        editor.layout({
          width: element.clientWidth,
          height: element.clientHeight,
        });
    };
    const observer = new ResizeObserver(layout);
    observer.observe(element);
    const frame = requestAnimationFrame(layout);
    layout();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      editor.dispose();
      original.dispose();
      modified.dispose();
      models.current = null;
    };
  }, [language]);
  useEffect(() => {
    const current = models.current;
    if (current) {
      if (current.original.getValue() !== before)
        current.original.setValue(before);
      if (current.modified.getValue() !== after)
        current.modified.setValue(after);
    }
  }, [before, after]);
  return <div className="monaco-host" ref={host} />;
}
