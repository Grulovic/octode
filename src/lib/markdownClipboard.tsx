import { renderToStaticMarkup } from "react-dom/server";
import { marked } from "marked";
import { markdownContent } from "../components/MarkdownPreview";

/** Email styling is deliberately independent of the app's dark preview theme. */
export function markdownForEmail(markdown: string) {
  const html = renderToStaticMarkup(<div>{markdownContent(marked.lexer(markdown, { gfm: true }))}</div>);
  const container = document.createElement("div");
  // Only the existing safe React renderer supplies this HTML; raw note HTML is escaped.
  container.innerHTML = html;
  container.querySelectorAll("input").forEach((input) => input.replaceWith(document.createTextNode(input.checked ? "☑ " : "☐ ")));
  container.querySelectorAll("*").forEach((node) => {
    node.removeAttribute("class");
    const element = node as HTMLElement;
    const alignment = element.style.textAlign;
    element.removeAttribute("style");
    if (alignment) element.style.textAlign = alignment;
    switch (element.tagName) {
      case "H1": case "H2": case "H3": case "H4": case "H5": case "H6":
        element.style.fontSize = `${[24, 20, 18, 16, 14, 13][Number(element.tagName[1]) - 1]}px`;
        element.style.fontWeight = "bold";
        element.style.margin = "16px 0 8px";
        break;
      case "P": element.style.margin = "0 0 12px"; break;
      case "PRE": element.style.whiteSpace = "pre-wrap"; break;
      case "CODE": element.style.fontFamily = "monospace"; break;
      case "BLOCKQUOTE": element.style.margin = "12px 0 12px 20px"; break;
      case "TABLE": element.style.borderCollapse = "collapse"; break;
      case "TH": case "TD": element.style.border = "1px solid #cccccc"; element.style.padding = "6px 8px"; break;
      case "IMG": element.style.maxWidth = "100%"; break;
    }
  });
  const body = container.firstElementChild as HTMLElement;
  body.style.fontFamily = "Arial, sans-serif";
  body.style.fontSize = "14px";
  body.style.lineHeight = "1.5";
  // Explicit line breaks for destinations that only accept plain text.
  const plain = body.cloneNode(true) as HTMLElement;
  plain.querySelectorAll("br").forEach((node) => node.replaceWith("\n"));
  plain.querySelectorAll("p,h1,h2,h3,h4,h5,h6,li,pre,blockquote,tr").forEach((node) => node.append("\n"));
  plain.querySelectorAll("td,th").forEach((node) => node.append("\t"));
  return { html: body.outerHTML, text: (plain.textContent ?? "").trim() };
}

export async function copyMarkdownForEmail(markdown: string) {
  const { html, text } = markdownForEmail(markdown);
  if (navigator.clipboard?.write && typeof ClipboardItem !== "undefined") {
    try {
      await navigator.clipboard.write([new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([text], { type: "text/plain" }),
      })]);
      return;
    } catch { /* Older WebViews can still support rich copy events. */ }
  }
  const previous = document.activeElement;
  const selection = window.getSelection();
  const ranges = selection ? Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index).cloneRange()) : [];
  const field = document.createElement("textarea");
  field.value = text;
  field.style.position = "fixed";
  field.style.opacity = "0";
  document.body.append(field);
  field.select();
  let supplied = false;
  const onCopy = (event: ClipboardEvent) => {
    if (!event.clipboardData) return;
    event.clipboardData.setData("text/html", html);
    event.clipboardData.setData("text/plain", text);
    event.preventDefault();
    supplied = true;
  };
  document.addEventListener("copy", onCopy, true);
  try {
    if (!document.execCommand?.("copy") || !supplied) throw new Error("Rich-text clipboard is unavailable. Please try copying again.");
  } finally {
    document.removeEventListener("copy", onCopy, true);
    field.remove();
    if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    selection?.removeAllRanges();
    ranges.forEach((range) => selection?.addRange(range));
  }
}
