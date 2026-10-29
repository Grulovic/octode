const styles = [
  "snake",
  "camel",
  "pascal",
  "screaming",
  "kebab",
  "dot",
  "lower",
  "title",
  "upper",
] as const;
function convertRun(value: string, style: (typeof styles)[number]) {
  const words = value
    .replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, "$1 $2")
    .replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, "$1 $2")
    .split(/[_.\s-]+/u)
    .filter(Boolean)
    .map((word) => word.toLowerCase());
  const capital = (word: string) =>
    word.replace(/^./u, (letter) => letter.toUpperCase());
  switch (style) {
    case "snake":
      return words.join("_");
    case "camel":
      return words
        .map((word, index) => (index ? capital(word) : word))
        .join("");
    case "pascal":
      return words.map(capital).join("");
    case "screaming":
      return words.join("_").toUpperCase();
    case "kebab":
      return words.join("-");
    case "dot":
      return words.join(".");
    case "lower":
      return words.join(" ");
    case "title":
      return words.map(capital).join(" ");
    case "upper":
      return words.join(" ").toUpperCase();
  }
}
export function nextTextCase(value: string): string {
  const variants = [
    ...new Set(
      styles.map((style) =>
        value.replace(
          /[\p{L}\p{N}\p{M}]+(?:[_. \t-]+[\p{L}\p{N}\p{M}]+)*/gu,
          (run) => convertRun(run, style),
        ),
      ),
    ),
  ];
  const current = variants.indexOf(value);
  return variants[(current + 1) % variants.length] ?? value;
}
const editors = new Set<() => boolean>();
export function registerCaseEditor(change: () => boolean) {
  editors.add(change);
  return () => {
    editors.delete(change);
  };
}
export function installCaseShortcut() {
  const onKey = (event: KeyboardEvent) => {
    if (
      !event.altKey ||
      !event.shiftKey ||
      event.metaKey ||
      event.ctrlKey ||
      event.isComposing ||
      !(event.code === "KeyU" || event.key.toLowerCase() === "u")
    )
      return;
    const target =
      event.target instanceof Element ? event.target : document.activeElement;
    if (
      !target ||
      target.closest(".xterm, [aria-readonly='true'], [data-case-cycle-ignore]")
    )
      return;
    const handled = () => {
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    for (const editor of editors)
      if (editor()) {
        handled();
        return;
      }
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement
    ) {
      if (
        target.disabled ||
        target.matches(":disabled") ||
        target.readOnly ||
        target.matches(".monaco-editor textarea.inputarea") ||
        (target instanceof HTMLInputElement && target.type === "password")
      )
        return;
      const start = target.selectionStart;
      const end = target.selectionEnd;
      if (start === null || end === null) return;
      if (start === end) {
        handled();
        return;
      }
      const replacement = nextTextCase(target.value.slice(start, end));
      if (replacement === target.value.slice(start, end)) {
        handled();
        return;
      }
      handled();
      const direction = target.selectionDirection ?? "forward";
      // Browser editing commands preserve the native undo stack in WKWebView.
      // setRangeText is the fallback for environments without editing commands.
      let inserted = false;
      try {
        inserted =
          document.execCommand?.("insertText", false, replacement) ?? false;
      } catch {
        /* Fallback below. */
      }
      if (!inserted) {
        target.setRangeText(replacement, start, end, "select");
        target.dispatchEvent(
          new InputEvent("input", {
            bubbles: true,
            inputType: "insertReplacementText",
            data: replacement,
          }),
        );
      }
      target.setSelectionRange(start, start + replacement.length, direction);
      return;
    }
    const selection = document.getSelection();
    if (!selection?.rangeCount || selection.isCollapsed) return;
    const range = selection.getRangeAt(0);
    const element =
      range.commonAncestorContainer instanceof Element
        ? range.commonAncestorContainer
        : range.commonAncestorContainer.parentElement;
    const editable = element?.closest<HTMLElement>("[contenteditable]");
    if (
      !editable ||
      editable.getAttribute("contenteditable") === "false" ||
      editable.closest("[aria-readonly='true']") ||
      !editable.contains(range.startContainer) ||
      !editable.contains(range.endContainer) ||
      [...editable.querySelectorAll('[contenteditable="false"]')].some((node) =>
        range.intersectsNode(node),
      )
    )
      return;
    const replacement = nextTextCase(range.toString());
    if (replacement === range.toString()) {
      handled();
      return;
    }
    handled();
    let inserted = false;
    try {
      inserted =
        document.execCommand?.("insertText", false, replacement) ?? false;
    } catch {
      /* Fallback below. */
    }
    if (!inserted) {
      range.deleteContents();
      const node = document.createTextNode(replacement);
      range.insertNode(node);
      range.selectNodeContents(node);
      selection.removeAllRanges();
      selection.addRange(range);
      editable.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          inputType: "insertReplacementText",
          data: replacement,
        }),
      );
    } else {
      // insertText leaves the caret at the end; keep the transformed text selected.
      const after = selection.getRangeAt(0);
      if (
        after.endContainer.nodeType === Node.TEXT_NODE &&
        after.endOffset >= replacement.length
      ) {
        after.setStart(
          after.endContainer,
          after.endOffset - replacement.length,
        );
        selection.removeAllRanges();
        selection.addRange(after);
      }
    }
  };
  window.addEventListener("keydown", onKey, true);
  return () => window.removeEventListener("keydown", onKey, true);
}
