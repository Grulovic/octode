import {
  installTerminalFileDrop,
  quoteTerminalPaths,
} from "../lib/terminalDrop";
import { validateTerminalCommand } from "../lib/terminalCommand";
import { terminalTheme } from "../editor/deepOcean";
import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { Channel, invoke } from "@tauri-apps/api/core";
import { desktop } from "../lib/bridge";
import type { Project, TerminalEvent } from "../types";
import { createTerminalInputQueue } from "../lib/terminal";
import "@xterm/xterm/css/xterm.css";

export default function LocalTerminal({
  project,
  root,
  startupCommand,
  visible,
  onError,
}: {
  project: Project;
  root: string;
  startupCommand?: string;
  visible: boolean;
  onError: (error: string) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const [dragging, setDragging] = useState(false);
  const initialCommand = useRef(startupCommand).current;
  const fitRef = useRef<FitAddon | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const [search, setSearch] = useState("");
  const [searchStatus, setSearchStatus] = useState("");
  const lastMatch = useRef<{
    query: string;
    row: number;
    column: number;
  } | null>(null);
  const [status, setStatus] = useState(
    desktop ? "Starting shell…" : "Desktop app required",
  );
  const errorRef = useRef(onError);
  errorRef.current = onError;
  useEffect(() => {
    if (!container.current) return;
    let disposed = false;
    let session: string | undefined;
    let pendingAck = 0;
    let exited = false;
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 12,
      fontFamily: '"SFMono-Regular", Consolas, monospace',
      scrollback: 3000,
      theme: terminalTheme,
    });
    termRef.current = term;
    const fit = new FitAddon();
    fitRef.current = fit;
    term.loadAddon(fit);
    term.open(container.current);
    fit.fit();
    const observer = new ResizeObserver(() => {
      if (container.current?.offsetWidth) fit.fit();
    });
    observer.observe(container.current);
    const inputQueue = createTerminalInputQueue(
      async (data) => {
        if (!session || disposed || exited) return;
        await invoke("terminal_write", { id: session, data });
      },
      (reason) => errorRef.current(String(reason)),
    );
    const input = term.onData((data) => {
      if (session && !exited) inputQueue.send(data);
    });
    const stopDrops = installTerminalFileDrop(container.current, {
      active: () => visibleRef.current && !disposed,
      onHover: setDragging,
      onError: (reason) => errorRef.current(reason),
      native: desktop,
      windows: navigator.platform.toLowerCase().includes("win"),
      onPaths: (paths) => {
        if (!session || exited || disposed) {
          errorRef.current(
            "Wait for a connected terminal before dropping files.",
          );
          return;
        }
        try {
          const text = quoteTerminalPaths(
            paths,
            navigator.platform.toLowerCase().includes("win"),
          );
          term.focus();
          term.paste(text);
        } catch (reason) {
          errorRef.current(String(reason));
        }
      },
    });
    const resize = term.onResize(({ rows, cols }) => {
      if (session)
        void invoke("terminal_resize", { id: session, rows, cols }).catch(
          (reason) => errorRef.current(String(reason)),
        );
    });
    if (!desktop) {
      term.writeln("\x1b[38;2;168;217;188mWelcome to Octode.\x1b[0m\r\n");
      term.writeln("Local shell sessions are available in the desktop app.");
      term.writeln("This browser preview does not execute commands.");
    } else {
      const output = new Channel<TerminalEvent>();
      output.onmessage = (message) => {
        if (disposed) return;
        if (message.event === "data")
          term.write(new Uint8Array(message.data), () => {
            if (disposed) return;
            if (session) {
              void invoke("terminal_ack", {
                id: session,
                bytes: message.data.length,
              }).catch(() => {});
            } else {
              pendingAck += message.data.length;
            }
          });
        else {
          exited = true;
          setStatus("Shell exited");
          term.writeln(`\r\n[${message.data}]`);
        }
      };
      void invoke<string>("terminal_create", {
        request: {
          projectId: project.id,
          root,
          rows: term.rows,
          cols: term.cols,
        },
        output,
      })
        .then((id) => {
          if (disposed) {
            void invoke("terminal_close", { id }).catch(() => {});
            return;
          }
          session = id;
          if (pendingAck) {
            void invoke("terminal_ack", {
              id: session,
              bytes: pendingAck,
            }).catch(() => {});
            pendingAck = 0;
          }
          if (initialCommand && !exited) {
            try {
              inputQueue.send(validateTerminalCommand(initialCommand) + "\r");
            } catch (reason) {
              errorRef.current(String(reason));
            }
          }
          setStatus(exited ? "Shell exited" : "Connected");
          term.focus();
        })
        .catch((reason) => {
          if (!disposed) {
            setStatus("Could not start shell");
            errorRef.current(String(reason));
          }
        });
    }
    return () => {
      disposed = true;
      inputQueue.close();
      stopDrops();
      observer.disconnect();
      input.dispose();
      resize.dispose();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
      if (session)
        void invoke("terminal_close", { id: session }).catch(() => {});
    };
  }, [project.id, root]);
  useEffect(() => {
    if (!visible) return;
    const frame = requestAnimationFrame(() => {
      fitRef.current?.fit();
      termRef.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
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
      matches[(index + (backward ? -1 : 1) + matches.length) % matches.length];
    lastMatch.current = { query: search, ...next };
    term.select(next.column, next.row, search.length);
    term.scrollToLine(Math.max(0, next.row - 2));
    setSearchStatus(
      `${matches.indexOf(next) + 1} / ${matches.length}${matches.length === 1000 ? "+" : ""}`,
    );
  };
  return (
    <div className="terminal-content">
      <div className="terminal-search">
        <input
          aria-label="Find in terminal"
          placeholder="Find in output…"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            lastMatch.current = null;
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") find(event.shiftKey);
          }}
        />
        <button onClick={() => find(true)}>Previous</button>
        <button onClick={() => find()}>Next</button>
        <span role="status">{searchStatus}</span>
        <button
          onClick={() => {
            termRef.current?.clear();
            setSearchStatus("");
            lastMatch.current = null;
          }}
        >
          Clear output
        </button>
      </div>
      <span className="terminal-status">{status}</span>
      <div
        className={`terminal-mount ${dragging ? "terminal-drop-target" : ""}`}
        ref={container}
      />
    </div>
  );
}
