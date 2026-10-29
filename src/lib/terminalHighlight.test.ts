// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  installTerminalHighlighting,
  setTerminalHighlightEnabled,
  terminalHighlights,
} from "./terminalHighlight";
import type { Terminal } from "@xterm/xterm";
let frames: (() => void)[];
beforeEach(() => {
  localStorage.clear();
  frames = [];
  vi.stubGlobal("requestAnimationFrame", (callback: () => void) => {
    frames.push(callback);
    return frames.length;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  setTerminalHighlightEnabled(true);
});
afterEach(() => vi.unstubAllGlobals());
const flush = () => {
  const work = frames;
  frames = [];
  work.forEach((callback) => callback());
};
function terminalFixture() {
  const callbacks: Record<string, () => void> = {};
  const listeners: { dispose: ReturnType<typeof vi.fn> }[] = [];
  const event = (name: string) => (callback: () => void) => {
    callbacks[name] = callback;
    const listener = { dispose: vi.fn() };
    listeners.push(listener);
    return listener;
  };
  let text = "root@host:/var/www/app# ERROR ready 12.5";
  let explicitColors = false;
  const normal = {
    viewportY: 0,
    baseY: 5,
    cursorY: 2,
    length: 1,
    getLine: () => {
      const cells = Array.from(text).flatMap((char) => {
        const width = char === "界" ? 2 : 1;
        const cell = {
          getWidth: () => width,
          getChars: () => char,
          isFgDefault: () => !explicitColors,
          isBgDefault: () => true,
          isInverse: () => 0,
        };
        return width === 2
          ? [cell, { ...cell, getWidth: () => 0, getChars: () => "" }]
          : [cell];
      });
      return { length: cells.length, getCell: (x: number) => cells[x] };
    },
  };
  const resources: { dispose: ReturnType<typeof vi.fn> }[] = [];
  const resource = () => {
    const item = { dispose: vi.fn() };
    resources.push(item);
    return item;
  };
  const terminal = {
    buffer: { normal, active: normal, onBufferChange: event("buffer") },
    cols: 120,
    rows: 24,
    registerMarker: vi.fn(resource),
    registerDecoration: vi.fn(resource),
    onWriteParsed: event("write"),
    onScroll: event("scroll"),
    onResize: event("resize"),
  };
  return {
    terminal,
    callbacks,
    resources,
    listeners,
    setText: (value: string) => {
      text = value;
    },
    explicit: () => {
      explicitColors = true;
    },
  };
}
it("recognizes prompts, paths, severity and success without overlapping ranges", () => {
  const text = "root@host:/var/www/app# ERROR warning completed 12.5";
  const hints = terminalHighlights(text);
  const tokens = hints.map((hint) => [
    text.slice(hint.start, hint.end),
    hint.color,
  ]);
  expect(tokens).toContainEqual(["root@host", "#80cbc4"]);
  expect(tokens).toContainEqual(["ERROR", "#ff787d"]);
  expect(tokens).toContainEqual(["warning", "#e4c16c"]);
  expect(tokens).toContainEqual(["completed", "#97d790"]);
  expect(
    tokens.some(
      ([word, color]) => word.startsWith("/var/www") && color === "#68caff",
    ),
  ).toBe(true);
  expect(terminalHighlights("ordinary output without special tokens")).toEqual(
    [],
  );
  for (let i = 1; i < hints.length; i++)
    expect(hints[i].start).toBeGreaterThanOrEqual(hints[i - 1].end);
});
it("decorates visible cells without rewriting output and preserves ANSI colors", () => {
  const fixture = terminalFixture();
  const highlight = installTerminalHighlighting(
    fixture.terminal as unknown as Terminal,
    () => true,
  );
  flush();
  expect(fixture.terminal.registerMarker).toHaveBeenCalledWith(-7);
  expect(fixture.terminal.registerDecoration).toHaveBeenCalledWith(
    expect.objectContaining({
      x: 0,
      width: 9,
      foregroundColor: "#80cbc4",
      layer: "bottom",
    }),
  );
  fixture.explicit();
  fixture.terminal.registerDecoration.mockClear();
  fixture.callbacks.write();
  flush();
  expect(fixture.terminal.registerDecoration).not.toHaveBeenCalled();
  highlight.dispose();
  expect(
    fixture.resources.every(
      (resource) => resource.dispose.mock.calls.length > 0,
    ),
  ).toBe(true);
  expect(
    fixture.listeners.every(
      (listener) => listener.dispose.mock.calls.length === 1,
    ),
  ).toBe(true);
});
it("maps emoji and wide characters to cell columns instead of UTF-16 offsets", () => {
  const fixture = terminalFixture();
  fixture.setText("😀界 ERROR");
  const highlight = installTerminalHighlighting(
    fixture.terminal as unknown as Terminal,
    () => true,
  );
  flush();
  expect(fixture.terminal.registerDecoration).toHaveBeenCalledWith(
    expect.objectContaining({ x: 4, width: 5, foregroundColor: "#ff787d" }),
  );
  highlight.dispose();
});
it("skips alternate buffers and inactive panes and clears all colors when toggled off", () => {
  const fixture = terminalFixture();
  let active = true;
  const highlight = installTerminalHighlighting(
    fixture.terminal as unknown as Terminal,
    () => active,
  );
  flush();
  expect(fixture.terminal.registerDecoration).toHaveBeenCalled();
  setTerminalHighlightEnabled(false);
  flush();
  expect(
    fixture.resources.every(
      (resource) => resource.dispose.mock.calls.length > 0,
    ),
  ).toBe(true);
  fixture.terminal.registerDecoration.mockClear();
  fixture.callbacks.write();
  flush();
  expect(fixture.terminal.registerDecoration).not.toHaveBeenCalled();
  setTerminalHighlightEnabled(true);
  active = false;
  flush();
  expect(fixture.terminal.registerDecoration).not.toHaveBeenCalled();
  active = true;
  fixture.terminal.buffer.active = { ...fixture.terminal.buffer.normal };
  fixture.callbacks.buffer();
  flush();
  expect(fixture.terminal.registerDecoration).not.toHaveBeenCalled();
  fixture.terminal.buffer.active = fixture.terminal.buffer.normal;
  fixture.callbacks.buffer();
  flush();
  expect(fixture.terminal.registerDecoration).toHaveBeenCalled();
  highlight.dispose();
});

it("works with xterm's real parser while retaining output, ANSI styling and alternate screens", async () => {
  // This parser-only check never opens a renderer; jsdom has no canvas.
  const canvas = vi
    .spyOn(HTMLCanvasElement.prototype, "getContext")
    .mockReturnValue(null);
  const { Terminal: Xterm } = await import("@xterm/xterm");
  const terminal = new Xterm({ allowProposedApi: true, cols: 80, rows: 8 });
  const decorate = vi.spyOn(terminal, "registerDecoration");
  const highlight = installTerminalHighlighting(terminal, () => true);
  const write = (text: string) =>
    new Promise<void>((resolve) => terminal.write(text, resolve));
  try {
    await write("root@host:/var/www# ERROR \x1b[35mwarning\x1b[0m\r\n");
    flush();
    expect(terminal.buffer.normal.getLine(0)?.translateToString(true)).toBe(
      "root@host:/var/www# ERROR warning",
    );
    expect(decorate).toHaveBeenCalledWith(
      expect.objectContaining({ foregroundColor: "#ff787d" }),
    );
    expect(decorate).not.toHaveBeenCalledWith(
      expect.objectContaining({ foregroundColor: "#e4c16c" }),
    );
    await write("\x1b[?1049hERROR full-screen editor");
    flush();
    expect(terminal.buffer.active).toBe(terminal.buffer.alternate);
    const count = decorate.mock.calls.length;
    highlight.refresh();
    flush();
    expect(decorate).toHaveBeenCalledTimes(count);
    await write("\x1b[?1049l");
    flush();
    expect(decorate.mock.calls.length).toBeGreaterThan(count);
    setTerminalHighlightEnabled(false);
    flush();
    expect(terminal.markers).toHaveLength(0);
    expect(terminal.buffer.normal.getLine(0)?.translateToString(true)).toBe(
      "root@host:/var/www# ERROR warning",
    );
  } finally {
    highlight.dispose();
    terminal.dispose();
    canvas.mockRestore();
  }
});
