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
export default function RemoteTerminal({
  session,
  visible,
  onError,
}: {
  session: string;
  visible: boolean;
  onError: (error: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
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
      scrollback: 3000,
      theme: terminalTheme,
    });
    const fit = new FitAddon();
    fitRef.current = fit;
    terminal.loadAddon(fit);
    terminal.open(host.current);
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
      terminal.dispose();
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
  return (
    <div className="remote-terminal">
      <div className="remote-terminal-toolbar">
        <span>{status}</span>
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
