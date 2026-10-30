// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import type { Terminal } from "@xterm/xterm";
import { installTerminalLinks, terminalLineLinks, terminalWebUrl } from "./terminalLinks";
function terminal(rows: { text: string; wrapped?: boolean }[], cols = 40) {
  let provider: any;
  const stop = vi.fn();
  const lines = rows.map(({ text, wrapped }) => {
    const cells: { chars: string; width: number }[] = [];
    for (const char of text) {
      const width = char === "中" ? 2 : 1;
      cells.push({ chars: char, width });
      if (width === 2) cells.push({ chars: "", width: 0 });
    }
    while (cells.length < cols) cells.push({ chars: "", width: 1 });
    return { isWrapped: !!wrapped, length: cells.length, getCell: (col: number) => cells[col] && ({ getChars: () => cells[col].chars, getWidth: () => cells[col].width }) };
  });
  const term = { options: {}, element: document.createElement("div"), buffer: { active: { length: rows.length, getLine: (row: number) => lines[row] } }, registerLinkProvider: (value: any) => { provider = value; return { dispose: stop }; } } as unknown as Terminal;
  return { term, stop, links: (line: number) => { let result: any; provider.provideLinks(line, (value: any) => { result = value; }); return result; } };
}
it("finds localhost and HTTPS URLs without trailing sentence punctuation", () => {
  const { term } = terminal([{ text: "see (https://example.com/a(1)). http://localhost:5173/" }]);
  expect(terminalLineLinks(term, 1).map((link) => link.text)).toEqual(["https://example.com/a(1)", "http://localhost:5173/"]);
  expect(terminalWebUrl("javascript:alert(1)")).toBeNull();
  expect(terminalWebUrl("file:///tmp/test")).toBeNull();
  expect(terminalWebUrl("https://example.com/\n")).toBeNull();
});
it("maps wrapped URLs and wide terminal characters to the right buffer positions", () => {
  const { term } = terminal([{ text: "中 https://example." }, { text: "com/path", wrapped: true }], 19);
  const first = terminalLineLinks(term, 1)[0], second = terminalLineLinks(term, 2)[0];
  expect(first.text).toBe("https://example.com/path");
  expect(first.range).toEqual({ start: { x: 4, y: 1 }, end: { x: 8, y: 2 } });
  expect(second).toEqual(first);
});
it("opens only explicit modifier-clicks, handles OSC links and removes providers on cleanup", async () => {
  vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
  const { term, stop, links } = terminal([{ text: "https://example.com/" }]);
  const open = vi.fn().mockResolvedValue(undefined), error = vi.fn();
  const dispose = installTerminalLinks(term, error, open);
  const link = links(1)[0];
  link.activate(new MouseEvent("click"), link.text);
  expect(open).not.toHaveBeenCalled();
  link.activate(new MouseEvent("click", { metaKey: true }), link.text);
  expect(open).toHaveBeenCalledWith("https://example.com/");
  const handler = term.options.linkHandler!;
  handler.activate(new MouseEvent("click", { metaKey: true }), "file:///tmp/file", link.range);
  expect(open).toHaveBeenCalledTimes(1);
  handler.activate(new MouseEvent("click", { metaKey: true }), "http://localhost:8080/", link.range);
  expect(open).toHaveBeenCalledWith("http://localhost:8080/");
  open.mockRejectedValueOnce(new Error("No browser"));
  link.activate(new MouseEvent("click", { metaKey: true }), link.text);
  await Promise.resolve();
  expect(error).toHaveBeenCalledWith(expect.stringContaining("No browser"));
  dispose(); expect(stop).toHaveBeenCalledOnce(); expect(term.options.linkHandler).toBeNull();
  vi.restoreAllMocks();
});
