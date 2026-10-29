import type { IDisposable, Terminal } from "@xterm/xterm";

const preference = "octode-terminal-highlighting";
export const terminalHighlightEvent = "octode-terminal-highlighting-change";
let sessionPreference: boolean | undefined;
export function terminalHighlightEnabled() {
  if (sessionPreference !== undefined) return sessionPreference;
  try {
    return localStorage.getItem(preference) !== "off";
  } catch {
    return true;
  }
}
export function setTerminalHighlightEnabled(enabled: boolean) {
  sessionPreference = enabled;
  try {
    localStorage.setItem(preference, enabled ? "on" : "off");
  } catch {
    /* Session-only preference if storage is unavailable. */
  }
  window.dispatchEvent(
    new CustomEvent(terminalHighlightEvent, { detail: enabled }),
  );
}
export interface Highlight {
  start: number;
  end: number;
  color: string;
}
/** Conservative visual hints; never rewrites output or interprets shell input. */
export function terminalHighlights(text: string): Highlight[] {
  const matches: Highlight[] = [];
  const add = (pattern: RegExp, color: string) => {
    for (const match of text.matchAll(pattern)) {
      const start = match.index!,
        end = start + match[0].length;
      if (!matches.some((item) => start < item.end && end > item.start))
        matches.push({ start, end, color });
      if (matches.length >= 64) break;
    }
  };
  add(/\b(?:error|fatal|failed|failure|denied|exception|panic)\b/gi, "#ff787d");
  add(/\b(?:warn(?:ing)?|deprecated|caution)\b/gi, "#e4c16c");
  add(
    /\b(?:success(?:ful(?:ly)?)?|passed|completed|connected|ready)\b/gi,
    "#97d790",
  );
  add(/^[\w.-]+@[\w.-]+(?=[:\s])/g, "#80cbc4");
  add(/(?:https?:\/\/|(?:~|\.{1,2})?\/)[^\s<>"'`|;,)\]}]+/g, "#68caff");
  add(
    /\b[\w.-]+\.(?:php|js|jsx|ts|tsx|json|log|conf|yml|yaml|sql|sh|py|env)(?::\d+)?\b/g,
    "#68caff",
  );
  add(/\b\d+(?:[.:]\d+)+(?:%|ms|s)?\b/g, "#ff9e60");
  return matches.sort((a, b) => a.start - b.start);
}

/** Color only unstyled cells in the visible normal buffer. Full-screen apps are untouched. */
export function installTerminalHighlighting(
  terminal: Terminal,
  active: () => boolean,
) {
  let decorations: IDisposable[] = [];
  let frame: number | undefined;
  let disposed = false;
  const clear = () => {
    for (const decoration of decorations) decoration.dispose();
    decorations = [];
  };
  const draw = () => {
    frame = undefined;
    clear();
    if (disposed || !active() || !terminalHighlightEnabled()) return;
    const buffer = terminal.buffer.active;
    if (buffer !== terminal.buffer.normal) return;
    for (
      let row = buffer.viewportY;
      row < Math.min(buffer.length, buffer.viewportY + terminal.rows);
      row++
    ) {
      const line = buffer.getLine(row);
      if (!line) continue;
      // Map UTF-16 string offsets back to terminal cells (wide/combined Unicode included).
      const cells: {
        x: number;
        start: number;
        end: number;
        width: number;
        plain: boolean;
      }[] = [];
      let text = "";
      for (let x = 0; x < Math.min(line.length, terminal.cols); x++) {
        const cell = line.getCell(x);
        if (!cell || cell.getWidth() === 0) continue;
        const chars = cell.getChars() || " ";
        cells.push({
          x,
          start: text.length,
          end: text.length + chars.length,
          width: cell.getWidth(),
          plain: cell.isFgDefault() && cell.isBgDefault() && !cell.isInverse(),
        });
        text += chars;
      }
      const hints = terminalHighlights(text);
      if (!hints.length) continue;
      const marker = terminal.registerMarker(
        row - buffer.baseY - buffer.cursorY,
      );
      if (!marker) continue;
      decorations.push(marker);
      for (const hint of hints) {
        let start = -1,
          end = -1;
        const flush = () => {
          if (start < 0) return;
          const decoration = terminal.registerDecoration({
            marker,
            x: start,
            width: end - start,
            foregroundColor: hint.color,
            layer: "bottom",
          });
          if (decoration) decorations.push(decoration);
          start = end = -1;
        };
        for (const cell of cells) {
          if (cell.start >= hint.start && cell.end <= hint.end && cell.plain) {
            if (start < 0) start = cell.x;
            end = cell.x + cell.width;
          } else flush();
        }
        flush();
      }
    }
  };
  const refresh = () => {
    if (!disposed && frame === undefined) frame = requestAnimationFrame(draw);
  };
  const listeners = [
    terminal.onWriteParsed(refresh),
    terminal.onScroll(refresh),
    terminal.onResize(refresh),
    terminal.buffer.onBufferChange(() => {
      clear();
      refresh();
    }),
  ];
  window.addEventListener(terminalHighlightEvent, refresh);
  refresh();
  return {
    refresh,
    dispose() {
      disposed = true;
      if (frame !== undefined) cancelAnimationFrame(frame);
      listeners.forEach((listener) => listener.dispose());
      window.removeEventListener(terminalHighlightEvent, refresh);
      clear();
    },
  };
}
