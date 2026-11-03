import { describe, expect, it } from "vitest";
import { markdownEdit, type MarkdownCommand } from "./markdownEditing";
function apply(value: string, start: number, end: number, command: MarkdownCommand) {
  const edit = markdownEdit(value, start, end, command);
  return { value: value.slice(0, edit.start) + edit.text + value.slice(edit.end), edit };
}
describe("Markdown selection editing", () => {
  it("wraps only selected text and keeps it selected for a second formatting action", () => {
    const { value, edit } = apply("Hello world!", 6, 11, { action: "bold" });
    expect(value).toBe("Hello **world**!");
    expect(value.slice(edit.selectionStart, edit.selectionEnd)).toBe("world");
    expect(apply(value, edit.selectionStart, edit.selectionEnd, { action: "bold" }).value).toBe("Hello world!");
  });
  it("converts existing lists without stacking markers and excludes a final unselected line", () => {
    const text = "- one\n- [x] two\nuntouched";
    expect(apply(text, 2, text.indexOf("untouched"), { action: "ordered" }).value).toBe("1. one\n2. two\nuntouched");
    expect(apply("one\n\ntwo", 0, 8, { action: "task" }).value).toBe("- [ ] one\n\n- [ ] two");
  });
  it("converts tab-separated rows to a table and escapes literal pipes", () => {
    const text = "Before\n\nName\tValue\nAlpha\tA|B\n\nAfter";
    expect(apply(text, text.indexOf("Name"), text.indexOf("\n\nAfter"), { action: "table" }).value).toBe("Before\n\n| Name | Value |\n| --- | --- |\n| Alpha | A\\|B |\n\nAfter");
  });
  it("inserts an empty table at the caret without deleting nearby text", () => {
    expect(apply("BeforeAfter", 6, 6, { action: "table", rows: 1, columns: 2 }).value).toBe("Before\n\n| Column 1 | Column 2 |\n| --- | --- |\n|  |  |\n\nAfter");
  });
  it("preserves Windows newlines and uses a fence longer than embedded backticks", () => {
    expect(apply("one\r\ntwo", 0, 8, { action: "bullet" }).value).toBe("- one\r\n- two");
    expect(apply("```js\ncode\n```", 0, 14, { action: "codeBlock" }).value).toBe("````\n```js\ncode\n```\n````");
  });
  it("escapes link labels and URLs while retaining the selected label", () => {
    const { value, edit } = apply("a[b]", 0, 4, { action: "link", url: "https://example.com/a(b)" });
    expect(value).toBe("[a\\[b\\]](https://example.com/a%28b%29)");
    expect(value.slice(edit.selectionStart, edit.selectionEnd)).toBe("a\\[b\\]");
  });
});
