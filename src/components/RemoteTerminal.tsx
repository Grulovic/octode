import { registerSelectAll } from "../lib/selectAll";
import { installTerminalLinks } from "../lib/terminalLinks";
import { useTerminalActivity } from "../hooks/useTerminalActivity";
import { monoFont } from "../theme/palette";
import { terminalTheme } from "../editor/deepOcean";
import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { Channel } from "@tauri-apps/api/core";
import { nativeTool } from "../lib/toolsBridge";
import { createTerminalInputQueue } from "../lib/terminal";
import {
  installTerminalHighlighting,
  terminalHighlightEnabled,
  setTerminalHighlightEnabled,
  terminalHighlightEvent,
} from "../lib/terminalHighlight";
import type { TerminalEvent } from "../types";
import "@xterm/xterm/css/xterm.css";
import "./terminal.css";
import { Search, ChevronDown } from "./DesignIcons";
export default function RemoteTerminal({
  session,
  visible,
  onError,
}: {
  session: string;
  visible: boolean;
  onError: (error: string) => void;
}) {
  const activity = useTerminalActivity(visible);
  const host = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState("");
  const [searchStatus, setSearchStatus] = useState("");
  const lastMatch = useRef<{ query: string; row: number; column: number } | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const errorRef = useRef(onError);
  errorRef.current = onError;
  const [status, setStatus] = useState("Opening SSH shell…");
  const [highlighting, setHighlighting] = useState(terminalHighlightEnabled);
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const highlighter = useRef<ReturnType<
    typeof installTerminalHighlighting
  > | null>(null);
  useEffect(() => {
    const update = () => setHighlighting(terminalHighlightEnabled());
    window.addEventListener(terminalHighlightEvent, update);
    return () => window.removeEventListener(terminalHighlightEvent, update);
  }, []);
  useEffect(() => {
    if (!host.current) return;
    let disposed = false;
    let ready = false;
    const shellKey = crypto.randomUUID();
    const terminal = new Terminal({
      allowProposedApi: true,
      cursorBlink: true,
      fontSize: 12,
      fontFamily: monoFont,
      scrollback: 3000,
      theme: terminalTheme,
    });
    termRef.current = terminal;
    lastMatch.current = null;
    setSearchStatus("");
    terminal.attachCustomKeyEventHandler((event) => {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "f") {
        if (event.type === "keydown") {
          event.preventDefault();
          searchInput.current?.focus();
          searchInput.current?.select();
        }
        return false;
      }
      return true;
    });
    const fit = new FitAddon();
    fitRef.current = fit;
    terminal.loadAddon(fit);
    terminal.open(host.current);
    const stopSelectAll = registerSelectAll(() => {
      if (!terminal.textarea || document.activeElement !== terminal.textarea) return false;
      terminal.selectAll(); return true;
    });
    const stopLinks = installTerminalLinks(terminal, (reason) => errorRef.current(reason));
    const highlight = installTerminalHighlighting(
      terminal,
      () => visibleRef.current && !!host.current?.isConnected,
    );
    highlighter.current = highlight;
    fit.fit();
    const output = new Channel<TerminalEvent>();
    output.onmessage = (message) => {
      if (message.event === "data") {
        if (disposed) {
          void nativeTool("ssh_ack", {
            id: session,
            bytes: message.data.length,
          }).catch(() => {});
          return;
        }
        if (message.data.length) activity.output();
        terminal.write(
          new Uint8Array(message.data),
          () =>
            void nativeTool("ssh_ack", {
              id: session,
              bytes: message.data.length,
            }).catch(() => {}),
        );
      } else if (!disposed) {
        ready = false;
        setStatus(message.data);
        terminal.writeln(`\r\n[${message.data}]`);
      }
    };
    const queue = createTerminalInputQueue(
      async (data) => {
        if (ready && !disposed)
          await nativeTool("ssh_write", { id: session, data });
      },
      (error) => errorRef.current(String(error)),
    );
    const input = terminal.onData((data) => queue.send(data));
    const resize = terminal.onResize(({ cols, rows }) => {
      if (ready)
        void nativeTool("ssh_resize", { id: session, cols, rows }).catch(
          (error) => errorRef.current(String(error)),
        );
    });
    const observer = new ResizeObserver(() => {
      if (host.current?.offsetWidth) fit.fit();
    });
    observer.observe(host.current);
    void nativeTool("ssh_shell", {
      id: session,
      shellKey,
      cols: terminal.cols,
      rows: terminal.rows,
      output,
    })
      .then(() => {
        if (disposed) {
          void nativeTool("ssh_shell_close", { id: session, shellKey }).catch(
            () => {},
          );
          return;
        }
        ready = true;
        setStatus("Connected");
        terminal.focus();
      })
      .catch((error) => {
        if (!disposed) {
          setStatus("Shell unavailable");
          errorRef.current(String(error));
        }
      });
    return () => {
      disposed = true;
      ready = false;
      queue.close();
      input.dispose();
      resize.dispose();
      observer.disconnect();
      highlight.dispose();
      highlighter.current = null;
      stopLinks();
      stopSelectAll();
      terminal.dispose();
      termRef.current = null;
      fitRef.current = null;
      void nativeTool("ssh_shell_close", { id: session, shellKey }).catch(
        () => {},
      );
    };
  }, [session]);
  useEffect(() => {
    highlighter.current?.refresh();
    if (visible) requestAnimationFrame(() => fitRef.current?.fit());
  }, [visible]);
  const find = (backward = false) => {
    const term = termRef.current;
    if (!term || !search) {
      term?.clearSelection();
      setSearchStatus("");
      return;
    }
    const matches: { row: number; column: number }[] = [];
    for (let row = 0; row < term.buffer.active.length; row++) {
      const text =
        term.buffer.active.getLine(row)?.translateToString(true) ?? "";
      let offset = 0;
      for (;;) {
        const column = text.toLowerCase().indexOf(search.toLowerCase(), offset);
        if (column < 0) break;
        matches.push({ row, column });
        offset = column + Math.max(search.length, 1);
        if (matches.length >= 1000) break;
      }
      if (matches.length >= 1000) break;
    }
    if (!matches.length) {
      term.clearSelection();
      lastMatch.current = null;
      setSearchStatus("No matches");
      return;
    }
    const previous = lastMatch.current;
    const index =
      previous?.query === search
        ? matches.findIndex(
            (match) =>
              match.row === previous.row && match.column === previous.column,
          )
        : -1;
    const next =
      matches[index < 0 ? (backward ? matches.length - 1 : 0) : (index + (backward ? -1 : 1) + matches.length) % matches.length];
    lastMatch.current = { query: search, ...next };
    term.select(next.column, next.row, search.length);
    term.scrollToLine(Math.max(0, next.row - 2));
    setSearchStatus(
      `${matches.indexOf(next) + 1} / ${matches.length}${matches.length === 1000 ? "+" : ""}`,
    );
  };
  return (
    <div className="remote-terminal" onKeyDown={(event) => {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "f") {
        event.preventDefault();
        event.stopPropagation();
        searchInput.current?.focus();
        searchInput.current?.select();
      }
    }}>
      <div className="remote-terminal-toolbar">
        <div className="terminal-search remote-terminal-search">
          <label className="terminal-search-field">
            <Search size={13} />
            <input
              ref={searchInput}
              aria-label="Find in server terminal"
              placeholder="Find in output…"
              value={search}
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
              onChange={(event) => {
                setSearch(event.target.value);
                setSearchStatus("");
                lastMatch.current = null;
                termRef.current?.clearSelection();
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  event.stopPropagation();
                  find(event.shiftKey);
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  event.stopPropagation();
                  termRef.current?.focus();
                }
              }}
            />
          </label>
          <button type="button" aria-label="Previous match" title="Previous match (Shift+Enter)" onClick={() => find(true)}><ChevronDown className="terminal-previous-icon" size={13} /></button>
          <button type="button" aria-label="Next match" title="Next match (Enter)" onClick={() => find()}><ChevronDown size={13} /></button>
          <span className="terminal-search-result" role="status">{searchStatus}</span>
        </div>
        <span className="remote-terminal-status">{activity.active && <span className="terminal-output-dot" role="img" aria-label="New terminal output" />}{status}</span>
        <button
          type="button"
          aria-pressed={highlighting}
          title="Highlight plain output in all server terminals. Existing program colors are preserved."
          onClick={() => setTerminalHighlightEnabled(!highlighting)}
        >
          Highlighting {highlighting ? "on" : "off"}
        </button>
      </div>
      <div className="terminal-mount" ref={host} />
    </div>
  );
}
