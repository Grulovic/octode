// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import MarkdownPreview from "./MarkdownPreview";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
it("renders Markdown blocks and inline formatting while keeping HTML and unsafe links inert", async () => {
  const host = document.createElement("div"); const root = createRoot(host);
  try {
    await act(async () => root.render(<MarkdownPreview text={'# Heading\n\n**Bold** &amp; `x < y`\n\n- [x] Done\n- Item\n\n> Quote\n\n```sql\nselect * from notes;\n```\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n[Web](https://example.com) [Bad](javascript:alert%281%29)\n\n<script>alert(1)</script>\n\n![bad](javascript:alert%281%29)'} />));
    expect(host.querySelector("h1")?.textContent).toBe("Heading");
    expect(host.querySelector("strong")?.textContent).toBe("Bold");
    expect(host.querySelector("code")?.textContent).toBe("x < y");
    expect(host.querySelector("p")?.textContent).toContain("Bold &");
    expect(host.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked).toBe(true);
    expect(host.querySelector("blockquote")?.textContent).toContain("Quote");
    expect(host.querySelector("pre code")?.textContent).toBe("select * from notes;");
    expect(host.querySelectorAll("td")).toHaveLength(2);
    expect(host.querySelectorAll("a")).toHaveLength(1);
    expect(host.querySelector("a")?.href).toBe("https://example.com/");
    expect(host.querySelector("script")).toBeNull(); expect(host.querySelector("img")).toBeNull();
    expect(host.textContent).toContain("<script>alert(1)</script>");
  } finally { await act(async () => root.unmount()); }
});
