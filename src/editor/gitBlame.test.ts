// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import type { editor } from "monaco-editor";
const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("../lib/bridge", () => native);
vi.mock("./runtime", () => ({ monaco: { editor: { EditorOption: { lineHeight: 67 } } } }));
import { mountGitBlame } from "./gitBlame";

afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });
function fixture() {
  const events: Record<string, () => void> = {};
  let scrollTop = 0;
  const listen = (name: string) => (callback: () => void) => {
    events[name] = callback;
    return { dispose: () => { delete events[name]; } };
  };
  const instance = {
    getOption: () => 21,
    getVisibleRanges: () => [{ startLineNumber: 1, endLineNumber: 2 }],
    getTopForLineNumber: (line: number) => 22 + (line - 1) * 21,
    getScrollTop: () => scrollTop,
    onDidScrollChange: listen("scroll"),
    onDidLayoutChange: listen("layout"),
    onDidContentSizeChange: listen("content"),
  } as unknown as editor.IStandaloneCodeEditor;
  return { instance, events, gutter: document.createElement("div"), scroll: (top: number) => { scrollTop = top; events.scroll(); } };
}
it("shows buffer attribution as inert text, follows scroll, and disposes listeners", async () => {
  vi.useFakeTimers();
  native.invoke.mockResolvedValue([
    { author: "<img src=x>", commit: "abc12345", time: 1700000000, summary: "Initial" },
    { author: "Uncommitted", commit: "00000000", time: 0, summary: "Changed" },
  ]);
  const { instance, events, gutter, scroll } = fixture();
  const dispose = mountGitBlame(instance, gutter, "project", "/repo/file", "unsaved");
  await vi.advanceTimersByTimeAsync(450);
  expect(native.invoke).toHaveBeenCalledWith("git_blame", { projectId: "project", path: "/repo/file", content: "unsaved" });
  expect(gutter.children).toHaveLength(2);
  expect(gutter.querySelector("img")).toBeNull();
  expect(gutter.children[0].textContent).toContain("<img src=x>");
  expect((gutter.children[1] as HTMLElement).style.top).toBe("43px");
  scroll(21);
  expect((gutter.children[1] as HTMLElement).style.top).toBe("22px");
  dispose();
  expect(gutter.children).toHaveLength(0);
  expect(Object.keys(events)).toHaveLength(0);
});
it("ignores late results from a previous buffer and explains unavailable blame", async () => {
  vi.useFakeTimers();
  let finish!: (value: unknown) => void;
  native.invoke.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const { instance, gutter } = fixture();
  const dispose = mountGitBlame(instance, gutter, "project", "/repo/file", "old");
  await vi.advanceTimersByTimeAsync(450);
  dispose();
  finish([{ author: "Old", time: 0 }]);
  await Promise.resolve();
  expect(gutter.textContent).toBe("");
  native.invoke.mockRejectedValueOnce("File must be committed");
  const cleanup = mountGitBlame(instance, gutter, "project", "/repo/file", "new");
  await vi.advanceTimersByTimeAsync(450);
  expect(gutter.textContent).toBe("Blame unavailable");
  expect(gutter.title).toBe("File must be committed");
  cleanup();
});
