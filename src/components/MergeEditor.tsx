import { useCallback, useEffect, useRef, useState } from "react";
import type { editor } from "monaco-editor";
import { monaco } from "../editor/runtime";
import { mergeChanges, mergeRegions, mergeReplacement, type MergeRegion } from "../lib/mergeDiff";
import type { Document } from "../types";
import type { GitConflict } from "../devTypes";
import EditorPane from "./EditorPane";
import { ArrowLeft, ArrowRight, ChevronDown } from "./DesignIcons";
import { confirmAction } from "./ToolLayout";
import "./merge-editor.css";
type Pane = "left" | "result" | "right";
type CodeEditor = editor.IStandaloneCodeEditor;
interface Comparison { text: string; regions: MergeRegion[] }
export default function MergeEditor({ document, conflict, modelPath, readOnly, onChange }: {
  document: Document; conflict: GitConflict; modelPath: string; readOnly: boolean; onChange: (text: string) => void;
}) {
  const editors = useRef<Partial<Record<Pane, CodeEditor>>>({});
  const [ready, setReady] = useState(0);
  const [comparison, setComparison] = useState<Comparison>({ text: "", regions: [] });
  const [scrollTop, setScrollTop] = useState(0);
  const [comparing, setComparing] = useState(false);
  const locked = useRef(false);
  const zones = useRef<Record<Pane, string[]>>({ left: [], result: [], right: [] });
  const decorate = useRef<Partial<Record<Pane, editor.IEditorDecorationsCollection>>>({});
  const bind = useCallback((pane: Pane, instance: CodeEditor) => {
    editors.current[pane] = instance;
    decorate.current[pane] = instance.createDecorationsCollection();
    setReady((value) => value + 1);
    const scroll = instance.onDidScrollChange((event) => {
      if (!event.scrollTopChanged || locked.current) return;
      locked.current = true;
      setScrollTop(event.scrollTop);
      for (const [name, other] of Object.entries(editors.current)) if (name !== pane) other?.setScrollTop(event.scrollTop);
      locked.current = false;
    });
    return () => { scroll.dispose(); decorate.current[pane]?.clear(); delete decorate.current[pane]; delete editors.current[pane]; zones.current[pane] = []; };
  }, []);
  const leftReady = useCallback((instance: CodeEditor) => bind("left", instance), [bind]);
  const resultReady = useCallback((instance: CodeEditor) => bind("result", instance), [bind]);
  const rightReady = useCallback((instance: CodeEditor) => bind("right", instance), [bind]);
  useEffect(() => {
    const { left, result, right } = editors.current;
    if (!left || !result || !right) return;
    setComparing(true);
    const timer = window.setTimeout(() => {
      const leftModel = left.getModel()!, resultModel = result.getModel()!, rightModel = right.getModel()!;
      const leftChanges = mergeChanges(leftModel.getLinesContent(), resultModel.getLinesContent());
      const rightChanges = mergeChanges(rightModel.getLinesContent(), resultModel.getLinesContent());
      const regions = mergeRegions(leftChanges, rightChanges);
      const decorations: Record<Pane, editor.IModelDeltaDecoration[]> = { left: [], result: [], right: [] };
      const highlight = (pane: Pane, start: number, end: number, kind: "added" | "removed") => {
        if (start === end) return;
        decorations[pane].push({ range: new monaco.Range(start, 1, end - 1, Number.MAX_SAFE_INTEGER), options: {
          isWholeLine: true, className: `merge-line-${kind}`, linesDecorationsClassName: `merge-margin-${kind}`,
          overviewRuler: { color: kind === "added" ? "#9bc77c88" : "#ef707b88", position: monaco.editor.OverviewRulerLane.Full },
        } });
      };
      for (const region of regions) {
        if (region.left) highlight("left", region.leftStart, region.leftEnd, "added");
        if (region.right) highlight("right", region.rightStart, region.rightEnd, "added");
        highlight("result", region.resultStart, region.resultEnd, "removed");
      }
      const savedTop = result.getScrollTop();
      locked.current = true;
      for (const pane of ["left", "result", "right"] as const) {
        const instance = editors.current[pane]!;
        decorate.current[pane]?.set(decorations[pane]);
        instance.changeViewZones((accessor) => {
          for (const id of zones.current[pane]) accessor.removeZone(id);
          zones.current[pane] = [];
          for (const region of regions) {
            const start = pane === "result" ? region.resultStart : pane === "left" ? region.leftStart : region.rightStart;
            const end = pane === "result" ? region.resultEnd : pane === "left" ? region.leftEnd : region.rightEnd;
            const missing = region.height - (end - start);
            if (missing) {
              const domNode = window.document.createElement("div"); domNode.className = "merge-alignment-gap";
              zones.current[pane].push(accessor.addZone({ afterLineNumber: end - 1, heightInLines: missing, domNode, suppressMouseDown: true }));
            }
          }
        });
      }
      left.setScrollTop(savedTop); result.setScrollTop(savedTop); right.setScrollTop(savedTop);
      locked.current = false;
      setComparison({ text: resultModel.getValue(), regions }); setComparing(false);
      setScrollTop(result.getScrollTop());
    }, 140);
    return () => window.clearTimeout(timer);
  }, [ready, document.text, conflict.ours, conflict.theirs]);
  const apply = (side: "left" | "right", region: MergeRegion) => {
    const result = editors.current.result, source = editors.current[side];
    const resultModel = result?.getModel(), sourceModel = source?.getModel();
    if (!result || !resultModel || !sourceModel || readOnly || comparing || comparison.text !== resultModel.getValue()) return;
    const ranges = mergeReplacement(sourceModel.getLinesContent(), resultModel.getLinesContent(), {
      sourceStart: side === "left" ? region.leftStart : region.rightStart,
      sourceEnd: side === "left" ? region.leftEnd : region.rightEnd,
      resultStart: region.resultStart, resultEnd: region.resultEnd,
    });
    const top = result.getScrollTop();
    result.pushUndoStop();
    result.executeEdits("octode.merge.accept", [{ range: ranges.resultRange, text: sourceModel.getValueInRange(ranges.sourceRange), forceMoveMarkers: true }], () => {
      const line = Math.min(region.resultStart, resultModel.getLineCount());
      return [new monaco.Selection(line, 1, line, 1)];
    });
    result.pushUndoStop(); result.focus(); result.setScrollTop(top);
  };
  const acceptAll = async (side: "left" | "right") => {
    if (readOnly || !(await confirmAction(`Replace the entire result with ${side === "left" ? "Ours" : "Theirs"}? You can undo this in the result editor.`, "Use this version"))) return;
    const result = editors.current.result, source = editors.current[side]?.getModel();
    if (!result?.getModel() || !source) return;
    result.pushUndoStop(); result.executeEdits("octode.merge.acceptAll", [{ range: result.getModel()!.getFullModelRange(), text: source.getValue() }]); result.pushUndoStop(); result.focus();
  };
  const navigate = (direction: number) => {
    const result = editors.current.result;
    if (!result || !comparison.regions.length) return;
    const line = result.getPosition()?.lineNumber ?? 1;
    const target = direction > 0 ? comparison.regions.find((region) => region.resultStart > line) ?? comparison.regions[0] : [...comparison.regions].reverse().find((region) => region.resultStart < line) ?? comparison.regions.at(-1)!;
    const position = Math.min(target.resultStart, result.getModel()!.getLineCount());
    result.setPosition({ lineNumber: position, column: 1 }); result.revealLineInCenter(position); result.focus();
  };
  const lineHeight = editors.current.result?.getOption(monaco.editor.EditorOption.lineHeight) ?? 21;
  const paddingTop = editors.current.result?.getOption(monaco.editor.EditorOption.padding).top ?? 22;
  const gutter = (side: "left" | "right") => <div className={`merge-transfer-gutter ${side}`} aria-label={`Apply changes from ${side === "left" ? "ours" : "theirs"}`}>
    {comparison.regions.map((region, index) => region[side] && <button key={index} style={{ top: (region.resultStart - 1 + region.extraBefore) * lineHeight + paddingTop - scrollTop }}
      title={`Apply change ${index + 1} from ${side === "left" ? "ours" : "theirs"}`} aria-label={`Apply change ${index + 1} from ${side === "left" ? "ours" : "theirs"}`}
      disabled={readOnly || comparing || comparison.text !== document.text} onClick={() => apply(side, region)}>{side === "left" ? <ArrowRight size={16} /> : <ArrowLeft size={16} />}</button>)}
  </div>;
  const conflictCount = (document.text.match(/^<<<<<<<(?: |$)/gm) ?? []).length;
  const sourceDocument = (text: string): Document => ({ path: document.path, name: document.name, text, saved: text });
  return <div className="merge-workbench">
    <div className="merge-workbench-toolbar" role="toolbar" aria-label="Merge tools">
      <button aria-label="Previous merge change" title="Previous change" onClick={() => navigate(-1)} disabled={!comparison.regions.length}><ChevronDown size={16} className="merge-previous-icon" /></button>
      <button aria-label="Next merge change" title="Next change" onClick={() => navigate(1)} disabled={!comparison.regions.length}><ChevronDown size={16} /></button>
      <span>{comparing ? "Comparing…" : `${comparison.regions.length} changes · ${conflictCount} conflict${conflictCount === 1 ? "" : "s"}`}</span>
      <div className="merge-workbench-actions"><button disabled={readOnly} onClick={() => void acceptAll("left")}>Accept all ours</button><button disabled={readOnly} onClick={() => void acceptAll("right")}>Accept all theirs</button></div>
    </div>
    <div className="merge-workbench-headings"><strong>Ours <span>current branch</span></strong><strong>Result <span>editable · autosaves</span></strong><strong>Theirs <span>incoming branch</span></strong></div>
    <div className="merge-workbench-panes">
      <div className="merge-code-pane"><EditorPane document={sourceDocument(conflict.ours)} modelPath={`${modelPath}:ours`} readOnly wordWrap="off" onChange={() => {}} onReady={leftReady} /></div>
      {gutter("left")}
      <div className="merge-code-pane"><EditorPane document={document} modelPath={modelPath} readOnly={readOnly} wordWrap="off" onChange={onChange} onReady={resultReady} /></div>
      {gutter("right")}
      <div className="merge-code-pane"><EditorPane document={sourceDocument(conflict.theirs)} modelPath={`${modelPath}:theirs`} readOnly wordWrap="off" onChange={() => {}} onReady={rightReady} /></div>
    </div>
  </div>;
}
