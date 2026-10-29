import { nextTextCase, registerCaseEditor } from "../lib/textCase";
import { deepOcean } from "../editor/deepOcean";
import { useEffect, useRef } from "react";
import { monaco } from "../editor/runtime";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import { loadSettings } from "../lib/settings";
import { language } from "../lib/workspace";
import type { Document, EditorSelection } from "../types";

Object.assign(self, {
  MonacoEnvironment: {
    getWorker() {
      return new EditorWorker();
    },
  },
});

monaco.editor.defineTheme("octode", deepOcean);

export default function EditorPane({
  document,
  onChange,
  selection,
  findToken,
  onFindHandled,
  onNavigate,
  onExecute,
  readOnly = false,
  modelPath,
}: {
  document: Document;
  onChange: (value: string) => void;
  selection?: EditorSelection;
  findToken?: number;
  onFindHandled?: () => void;
  onNavigate?: (query: string, line?: number) => void;
  onExecute?: (text: string) => void;
  readOnly?: boolean;
  modelPath?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const latest = useRef({
    document,
    onChange,
    onNavigate,
    onExecute,
    readOnly,
  });
  latest.current = { document, onChange, onNavigate, onExecute, readOnly };
  const syncing = useRef(false);
  const uri = modelPath ?? document.path;
  useEffect(() => {
    if (!host.current) return;
    const resource = monaco.Uri.parse(uri);
    const existing = monaco.editor.getModel(resource);
    const model =
      existing ??
      monaco.editor.createModel(
        latest.current.document.text,
        language(latest.current.document.path),
        resource,
      );
    // A retained model carries undo history, but disk reloads remain authoritative.
    if (model.getValue() !== latest.current.document.text)
      model.setValue(latest.current.document.text);
    const instance = monaco.editor.create(host.current, {
      model,
      theme: "octode",
      readOnly: latest.current.readOnly,
      fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
      fontSize: loadSettings().fontSize,
      lineHeight: 23,
      minimap: { enabled: false },
      padding: { top: 22 },
      scrollBeyondLastLine: false,
      automaticLayout: true,
      tabSize: loadSettings().tabSize,
      wordWrap: loadSettings().wordWrap,
      renderLineHighlight: "line",
      smoothScrolling: false,
      scrollbar: {
        verticalScrollbarSize: 4,
        horizontalScrollbarSize: 4,
        useShadows: false,
      },
      bracketPairColorization: { enabled: true },
      quickSuggestions: false,
      suggestOnTriggerCharacters: false,
      wordBasedSuggestions: "off",
      inlineSuggest: { enabled: false },
      parameterHints: { enabled: false },
      snippetSuggestions: "none",
      tabCompletion: "off",
      acceptSuggestionOnEnter: "off",
    });
    editor.current = instance;
    const unregisterCase = registerCaseEditor(() => {
      if (
        !host.current?.isConnected ||
        !instance.hasTextFocus() ||
        latest.current.readOnly
      )
        return false;
      const selections =
        instance.getSelections()?.filter((selection) => !selection.isEmpty()) ??
        [];
      if (!selections.length) return true;
      const edits = selections.map((range) => ({
        range,
        text: nextTextCase(model.getValueInRange(range)),
        forceMoveMarkers: true,
      }));
      if (
        !edits.some((edit) => edit.text !== model.getValueInRange(edit.range))
      )
        return true;
      instance.pushUndoStop();
      instance.executeEdits("octode.cycleCase", edits, (inverse) =>
        inverse.map(
          (edit) =>
            new monaco.Selection(
              edit.range.startLineNumber,
              edit.range.startColumn,
              edit.range.endLineNumber,
              edit.range.endColumn,
            ),
        ),
      );
      instance.pushUndoStop();
      instance.focus();
      return true;
    });
    // Keep native tooltips on Monaco's icon-only find controls.
    const labelFindControls = () =>
      host.current
        ?.querySelectorAll<HTMLElement>(".find-widget [aria-label]")
        .forEach((element) => {
          const label = element.getAttribute("aria-label");
          if (label && element.getAttribute("title") !== label)
            element.title = label;
        });
    const findObserver = new MutationObserver(labelFindControls);
    findObserver.observe(host.current, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["aria-label"],
    });
    labelFindControls();

    const settings = () => instance.updateOptions(loadSettings());
    window.addEventListener("octode-editor-settings", settings);
    const execute = onExecute
      ? instance.addAction({
          id: "octode.execute",
          label: "Run SQL selection or query",
          keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
          run: () => {
            const selection = instance.getSelection();
            const selected = selection ? model.getValueInRange(selection) : "";
            latest.current.onExecute?.(
              selected.trim() ? selected : model.getValue(),
            );
          },
        })
      : null;
    const change = instance.onDidChangeModelContent((event) => {
      if (syncing.current || event.isFlush || editor.current !== instance)
        return;
      const current = latest.current;
      const value = model.getValue();
      if (value !== current.document.text) current.onChange(value);
    });
    const navigationToken = (position: monaco.Position) => {
      const line = model.getLineContent(position.lineNumber);
      const offset = position.column - 1;
      const literal = [...line.matchAll(/["'`]([^"'`]+)["'`]/g)].find(
        (match) =>
          offset > (match.index ?? 0) &&
          offset < (match.index ?? 0) + match[0].length - 1,
      );
      if (literal)
        return {
          query: literal[1],
          range: {
            startLineNumber: position.lineNumber,
            endLineNumber: position.lineNumber,
            startColumn: (literal.index ?? 0) + 2,
            endColumn: (literal.index ?? 0) + literal[0].length,
          },
        };
      const word = model.getWordAtPosition(position);
      if (!word || !/[\p{L}_$]/u.test(word.word)) return null;
      return {
        query: word.word,
        range: {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn,
        },
      };
    };
    const links = instance.createDecorationsCollection();
    let hovered: monaco.Position | null = null;
    let modified = false;
    const updateLink = () => {
      const token =
        latest.current.onNavigate && modified && hovered
          ? navigationToken(hovered)
          : null;
      links.set(
        token
          ? [
              {
                range: token.range,
                options: { inlineClassName: "octode-navigation-link" },
              },
            ]
          : [],
      );
    };
    const move = instance.onMouseMove((event) => {
      hovered =
        event.target.type === monaco.editor.MouseTargetType.CONTENT_TEXT
          ? event.target.position
          : null;
      modified = event.event.metaKey || event.event.ctrlKey;
      updateLink();
    });
    const leave = instance.onMouseLeave(() => {
      hovered = null;
      links.clear();
    });
    const key = (event: KeyboardEvent) => {
      if (!host.current?.isConnected) return;
      modified = event.metaKey || event.ctrlKey;
      updateLink();
    };
    const blur = () => {
      hovered = null;
      modified = false;
      links.clear();
    };
    window.addEventListener("keydown", key);
    window.addEventListener("keyup", key);
    window.addEventListener("blur", blur);
    const mouse = instance.onMouseDown((event) => {
      if (
        !latest.current.onNavigate ||
        !(event.event.metaKey || event.event.ctrlKey) ||
        event.target.type !== monaco.editor.MouseTargetType.CONTENT_TEXT ||
        !event.target.position
      )
        return;
      const token = navigationToken(event.target.position);
      if (token) {
        event.event.preventDefault();
        latest.current.onNavigate(
          token.query,
          event.target.position.lineNumber,
        );
      }
    });
    const action = instance.addAction({
      id: "octode.navigate",
      label: "Find declaration or file",
      keybindings: [monaco.KeyCode.F12],
      run: () => {
        const position = instance.getPosition();
        const query = position && model.getWordAtPosition(position)?.word;
        if (query && position)
          latest.current.onNavigate?.(query, position.lineNumber);
      },
    });
    return () => {
      window.removeEventListener("octode-editor-settings", settings);
      editor.current = null;
      execute?.dispose();
      change.dispose();
      mouse.dispose();
      move.dispose();
      leave.dispose();
      links.clear();
      window.removeEventListener("keydown", key);
      window.removeEventListener("keyup", key);
      window.removeEventListener("blur", blur);
      action.dispose();
      unregisterCase();
      findObserver.disconnect();
      instance.dispose();
      if (modelPath) model.dispose();
    };
  }, [uri, modelPath]);
  useEffect(() => {
    const instance = editor.current;
    const model = instance?.getModel();
    if (!model) return;
    syncing.current = true;
    try {
      if (model.getValue() !== document.text) model.setValue(document.text);
      instance?.updateOptions({ readOnly });
    } finally {
      syncing.current = false;
    }
  }, [document.text, readOnly, uri]);
  useEffect(() => {
    if (selection?.path === document.path && editor.current) {
      editor.current.setPosition({ lineNumber: selection.line, column: 1 });
      editor.current.revealLineInCenter(selection.line);
      editor.current.focus();
    }
  }, [document.path, selection]);
  useEffect(() => {
    if (!findToken || !editor.current) return;
    editor.current.focus();
    void editor.current.getAction("actions.find")?.run();
    onFindHandled?.();
  }, [findToken, uri, onFindHandled]);
  return <div className="monaco-host" ref={host} />;
}
