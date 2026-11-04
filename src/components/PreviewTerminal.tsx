import "./preview.css";
import { useImperativeHandle, type Ref } from "react";
import type { TerminalHandle } from "./LocalTerminal";

export default function PreviewTerminal({
  startupCommand,
  ref,
  onError,
}: {
  startupCommand?: string;
  ref?: Ref<TerminalHandle>;
  onError?: (error: string) => void;
}) {
  useImperativeHandle(ref, () => ({ runCommand: () => onError?.("Terminal commands run in the desktop app.") }), [onError]);
  return (
    <div className="preview-terminal">
      <p>Welcome to Octode.</p>
      {startupCommand && (
        <p>
          Launch command: <code>{startupCommand}</code> (desktop app required).
        </p>
      )}
      <p>Local shell sessions are available in the desktop app.</p>
      <p>This browser preview does not execute commands.</p>
    </div>
  );
}
