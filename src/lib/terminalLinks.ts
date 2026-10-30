import type { Terminal, IBufferRange, ILink, ILinkHandler } from "@xterm/xterm";
import { invoke } from "./bridge";
export function terminalWebUrl(text: string): string | null {
  if (text.length > 8192 || /[\x00-\x20\x7f]/.test(text)) return null;
  try {
    const url = new URL(text);
    return ["http:", "https:"].includes(url.protocol) && url.hostname ? url.href : null;
  } catch { return null; }
}
function trimPunctuation(text: string) {
  let trimmed = text.replace(/[.,;:!]+$/, "");
  for (const [close, open] of [[")", "("], ["]", "["], ["}", "{"]]) {
    while (trimmed.endsWith(close) && trimmed.split(close).length > trimmed.split(open).length)
      trimmed = trimmed.slice(0, -1);
  }
  return trimmed;
}
/** Map UTF-16 text offsets back to terminal cells, including wide/combining characters. */
export function terminalLineLinks(term: Terminal, lineNumber: number): { text: string; range: IBufferRange }[] {
  const buffer = term.buffer.active;
  let first = lineNumber - 1, last = first;
  for (let count = 0; count < 64 && first > 0 && buffer.getLine(first)?.isWrapped; count++) first--;
  while (last - first < 64 && last + 1 < buffer.length && buffer.getLine(last + 1)?.isWrapped) last++;
  let text = "";
  const cells: { x: number; y: number; width: number }[] = [];
  for (let row = first; row <= last && text.length < 16384; row++) {
    const line = buffer.getLine(row);
    if (!line) break;
    for (let col = 0; col < line.length; col++) {
      const cell = line.getCell(col);
      if (!cell || cell.getWidth() === 0) continue;
      const chars = cell.getChars() || " ";
      text += chars;
      for (let index = 0; index < chars.length; index++) cells.push({ x: col + 1, y: row + 1, width: cell.getWidth() });
    }
  }
  const links: { text: string; range: IBufferRange }[] = [];
  for (const match of text.matchAll(/https?:\/\/[^\s<>"'`]+/gi)) {
    const uri = trimPunctuation(match[0]);
    if (!terminalWebUrl(uri)) continue;
    const start = cells[match.index!], end = cells[match.index! + uri.length - 1];
    if (!start || !end || lineNumber < start.y || lineNumber > end.y) continue;
    links.push({ text: uri, range: { start: { x: start.x, y: start.y }, end: { x: end.x + end.width - 1, y: end.y } } });
  }
  return links;
}
export function installTerminalLinks(
  term: Terminal,
  onError: (error: string) => void,
  open: (url: string) => Promise<unknown> = (url) => invoke("open_terminal_url", { url }),
) {
  const modifier = /mac/i.test(navigator.platform) ? "Cmd" : "Ctrl";
  const previous = term.options.linkHandler;
  const handler: ILinkHandler = {
    allowNonHttpProtocols: false,
    activate(event, text) {
      if (!(modifier === "Cmd" ? event.metaKey : event.ctrlKey)) return;
      const url = terminalWebUrl(text);
      if (!url) return;
      event.preventDefault();
      void open(url).catch((error) => onError(`Could not open link: ${String(error)}`));
    },
    hover(_event, text) { if (term.element) term.element.title = `${text}\n${modifier}+click to open in browser`; },
    leave() { if (term.element) term.element.removeAttribute("title"); },
  };
  term.options.linkHandler = handler;
  const provider = term.registerLinkProvider({ provideLinks(lineNumber, callback) {
    callback(terminalLineLinks(term, lineNumber).map((link): ILink => ({
      ...link,
      activate: (event, text) => handler.activate(event, text, link.range),
      hover: (event, text) => handler.hover?.(event, text, link.range),
      leave: (event, text) => handler.leave?.(event, text, link.range),
    })));
  } });
  return () => {
    provider.dispose();
    if (term.options.linkHandler === handler) term.options.linkHandler = previous ?? null;
    term.element?.removeAttribute("title");
  };
}
