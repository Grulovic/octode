import "./preview.css";

export default function PreviewTerminal({
  startupCommand,
}: {
  startupCommand?: string;
}) {
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
