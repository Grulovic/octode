// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { copyMarkdownForEmail, markdownForEmail } from "./markdownClipboard";

it("exports semantic email formatting without the preview theme or executable note HTML", () => {
  const result = markdownForEmail('# Heading\n\n## Subheading\n\n**Bold** and *italic* [link](https://example.com)\n\n- First\n- Second\n\n```js\nconst x = 1;\n```\n\n<script>alert(1)</script>\n\n[unsafe](javascript:alert(1))\n\n- [x] Done');
  const doc = new DOMParser().parseFromString(result.html, "text/html");
  expect(doc.querySelector("h1")?.textContent).toBe("Heading");
  expect(doc.querySelector("h2")?.textContent).toBe("Subheading");
  expect(doc.querySelector("strong")?.textContent).toBe("Bold");
  expect(doc.querySelectorAll("li")).toHaveLength(3);
  expect(doc.querySelector("pre code")?.textContent).toBe("const x = 1;");
  expect(doc.querySelector("script,input,[class]")).toBeNull();
  expect(doc.querySelectorAll("a")).toHaveLength(1);
  expect(result.html).not.toMatch(/background|var\(--oc-/);
  expect(result.text).toContain("Heading\n");
  expect(result.text).toContain("☑ Done");
});

it("copies both HTML and plain text through the WebView fallback and restores input focus", async () => {
  const field = document.createElement("input");
  document.body.append(field); field.focus();
  const setData = vi.fn();
  vi.stubGlobal("ClipboardItem", undefined);
  const original = Object.getOwnPropertyDescriptor(document, "execCommand");
  Object.defineProperty(document, "execCommand", { configurable: true, value: () => {
    const event = new Event("copy", { cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: { setData } });
    document.dispatchEvent(event);
    return true;
  } });
  try {
    await copyMarkdownForEmail("# Copy me\n\n**Formatted**");
    expect(setData).toHaveBeenCalledWith("text/html", expect.stringContaining("<h1"));
    expect(setData).toHaveBeenCalledWith("text/plain", "Copy me\nFormatted");
    expect(document.activeElement).toBe(field);
  } finally {
    field.remove(); vi.unstubAllGlobals();
    if (original) Object.defineProperty(document, "execCommand", original);
    else Reflect.deleteProperty(document, "execCommand");
  }
});
