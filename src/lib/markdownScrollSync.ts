import type { editor } from "monaco-editor";

type Anchor = { source: number; preview: number };

// Interpolate between Markdown blocks, rather than matching overall percentages.
export function mappedScroll(anchors: Anchor[], value: number, from: keyof Anchor) {
  const to = from === "source" ? "preview" : "source";
  for (let index = 1; index < anchors.length; index++) {
    const left = anchors[index - 1], right = anchors[index];
    if (value <= right[from]) {
      const progress = Math.max(0, Math.min(1, (value - left[from]) / (right[from] - left[from] || 1)));
      return left[to] + progress * (right[to] - left[to]);
    }
  }
  return anchors.at(-1)?.[to] ?? 0;
}

export function syncMarkdownScroll(source: editor.IStandaloneCodeEditor, preview: HTMLElement) {
  let expectedSource: number | null = null;
  let expectedPreview: number | null = null;
  const anchors = () => {
    const sourceMax = Math.max(0, source.getScrollHeight() - source.getLayoutInfo().height);
    const previewMax = Math.max(0, preview.scrollHeight - preview.clientHeight);
    const result: Anchor[] = [{ source: 0, preview: 0 }];
    const top = preview.getBoundingClientRect().top;
    for (const block of preview.querySelectorAll<HTMLElement>("[data-source-line]")) {
      const point = {
        source: source.getTopForLineNumber(Number(block.dataset.sourceLine)),
        preview: block.getBoundingClientRect().top - top + preview.scrollTop,
      };
      const previous = result[result.length - 1];
      if (point.source > previous.source && point.preview > previous.preview && point.source < sourceMax && point.preview < previewMax) result.push(point);
    }
    result.push({ source: sourceMax, preview: previewMax });
    return result;
  };
  const fromSource = () => {
    const current = source.getScrollTop();
    if (expectedSource !== null && Math.abs(current - expectedSource) < 1) { expectedSource = null; return; }
    expectedSource = null;
    const next = mappedScroll(anchors(), current, "source");
    if (Math.abs(next - preview.scrollTop) < 1) return;
    preview.scrollTop = next;
    expectedPreview = preview.scrollTop;
  };
  const fromPreview = () => {
    const current = preview.scrollTop;
    if (expectedPreview !== null && Math.abs(current - expectedPreview) < 1) { expectedPreview = null; return; }
    expectedPreview = null;
    const next = mappedScroll(anchors(), current, "preview");
    if (Math.abs(next - source.getScrollTop()) < 1) return;
    expectedSource = next;
    source.setScrollTop(next);
  };
  const subscription = source.onDidScrollChange((event) => { if (event.scrollTopChanged) fromSource(); });
  const layout = source.onDidLayoutChange(fromSource);
  preview.addEventListener("scroll", fromPreview, { passive: true });
  preview.addEventListener("load", fromSource, true);
  const observer = new ResizeObserver(fromSource);
  observer.observe(preview);
  fromSource();
  return () => {
    subscription.dispose(); layout.dispose(); observer.disconnect();
    preview.removeEventListener("scroll", fromPreview);
    preview.removeEventListener("load", fromSource, true);
  };
}
