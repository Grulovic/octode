// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import type { editor } from "monaco-editor";
import { mappedScroll, syncMarkdownScroll } from "./markdownScrollSync";

it("aligns matching blocks in both directions despite different rendered heights", () => {
  const anchors = [{ source: 0, preview: 0 }, { source: 200, preview: 600 }, { source: 1000, preview: 1200 }];
  expect(mappedScroll(anchors, 200, "source")).toBe(600);
  expect(mappedScroll(anchors, 600, "preview")).toBe(200);
  expect(mappedScroll(anchors, 600, "source")).toBe(900);
  expect(mappedScroll(anchors, 900, "preview")).toBe(600);
  expect(mappedScroll(anchors, 2000, "source")).toBe(1200);
});

it("follows scrolls from either pane and detaches when disabled", () => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  const preview = document.createElement("article");
  preview.innerHTML = '<h2 data-source-line="11">Section</h2>';
  Object.defineProperties(preview, { scrollHeight: { value: 1400 }, clientHeight: { value: 200 } });
  preview.getBoundingClientRect = () => ({ top: 0 }) as DOMRect;
  preview.firstElementChild!.getBoundingClientRect = () => ({ top: 600 - preview.scrollTop }) as DOMRect;
  let top = 0;
  let onScroll = (_event: { scrollTopChanged: boolean }) => {};
  const dispose = vi.fn();
  const source = {
    getScrollHeight: () => 1200, getLayoutInfo: () => ({ height: 200 }), getScrollTop: () => top,
    getTopForLineNumber: () => 200,
    setScrollTop: (value: number) => { top = value; onScroll({ scrollTopChanged: true }); },
    onDidScrollChange: (listener: typeof onScroll) => { onScroll = listener; return { dispose }; },
    onDidLayoutChange: () => ({ dispose }),
  } as unknown as editor.IStandaloneCodeEditor;
  try {
    const stop = syncMarkdownScroll(source, preview);
    top = 200; onScroll({ scrollTopChanged: true });
    expect(preview.scrollTop).toBe(600);
    preview.dispatchEvent(new Event("scroll"));
    preview.scrollTop = 900; preview.dispatchEvent(new Event("scroll"));
    expect(top).toBe(600);
    expect(preview.scrollTop).toBe(900);
    stop();
    preview.scrollTop = 300; preview.dispatchEvent(new Event("scroll"));
    expect(top).toBe(600);
    expect(dispose).toHaveBeenCalledTimes(2);
  } finally { vi.unstubAllGlobals(); }
});
