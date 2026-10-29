/** Native clipboard when available, with a selection fallback for older WebViews. */
export async function copyTextToClipboard(text: string) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      /* Fall back to the browser copy command. */
    }
  }
  const previous = document.activeElement;
  const field = document.createElement("textarea");
  field.value = text;
  field.style.position = "fixed";
  field.style.opacity = "0";
  document.body.append(field);
  field.select();
  // Textareas normalize CRLF; set the original CSV in the native copy event.
  const onCopy = (event: ClipboardEvent) => {
    if (!event.clipboardData) return;
    event.clipboardData.setData("text/plain", text);
    event.preventDefault();
  };
  document.addEventListener("copy", onCopy, true);
  try {
    if (!document.execCommand?.("copy"))
      throw new Error("Could not copy CSV to the clipboard.");
  } finally {
    document.removeEventListener("copy", onCopy, true);
    field.remove();
    if (previous instanceof HTMLElement && previous.isConnected)
      previous.focus();
  }
}
