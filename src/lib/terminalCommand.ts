export function validateTerminalCommand(value: string): string {
  const command = value.trim();
  if (!command || command.length > 4096 || /[\r\n\0]/.test(value))
    throw new Error(
      "Enter a single-line terminal command (up to 4096 characters).",
    );
  return command;
}
