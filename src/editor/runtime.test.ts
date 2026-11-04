// @vitest-environment jsdom
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

let monaco: typeof import("./runtime").monaco;
beforeAll(async () => {
  Object.defineProperty(document, "queryCommandSupported", {
    configurable: true,
    value: () => false,
  });
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    media: "",
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {
      return true;
    },
  }));
  ({ monaco } = await import("./runtime"));
});
afterAll(() => {
  Reflect.deleteProperty(document, "queryCommandSupported");
  vi.unstubAllGlobals();
});

async function tokens(source: string, id: string) {
  const model = monaco.editor.createModel(source, id);
  try {
    for (let attempt = 0; attempt < 100; attempt++) {
      const result = monaco.editor.tokenize(source, id).flat();
      if (result.some((token) => token.type)) return result;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`No syntax tokens were produced for ${id}`);
  } finally {
    model.dispose();
  }
}

describe("syntax-only language runtime", () => {
  it("highlights dotenv assignments and keeps quoted hashes inside strings", async () => {
    const source = 'export APP_NAME="Octode # demo" # comment\nAPP_URL=${HOST}/api\nPLAIN=value\n# disabled';
    const result = await tokens(source, "dotenv");
    for (const type of ["keyword.dotenv", "attribute.name.dotenv", "operator.dotenv", "string.dotenv", "variable.dotenv", "comment.dotenv"]) {
      expect(result.map((token) => token.type)).toContain(type);
    }
    const firstLine = monaco.editor.tokenize(source, "dotenv")[0];
    expect(firstLine.find((token) => token.type === "comment.dotenv")?.offset).toBe(source.indexOf("# comment"));
    expect(monaco.editor.tokenize(source, "dotenv")[2][0].type).toBe("attribute.name.dotenv");
  });

  it("toggles dotenv line comments using the editor's Cmd/Ctrl+/ action", async () => {
    const canvas = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      measureText: () => ({ width: 8 }),
    } as unknown as CanvasRenderingContext2D);
    const model = monaco.editor.createModel("APP_NAME=Octode\nAPP_DEBUG=true", "dotenv");
    const container = document.createElement("div");
    document.body.append(container);
    const editor = monaco.editor.create(container, { model, automaticLayout: false, occurrencesHighlight: "off" });
    try {
      editor.setSelection(new monaco.Selection(1, 1, 2, 15));
      await editor.getAction("editor.action.commentLine")!.run();
      expect(model.getValue()).toBe("# APP_NAME=Octode\n# APP_DEBUG=true");
      await editor.getAction("editor.action.commentLine")!.run();
      expect(model.getValue()).toBe("APP_NAME=Octode\nAPP_DEBUG=true");
    } finally {
      editor.dispose();
      model.dispose();
      container.remove();
      canvas.mockRestore();
    }
  });

  it("distinguishes PHP function and class tokens for the Deep Ocean scheme", async () => {
    const result = await tokens(
      "<?php class Customer { public function findCustomer() { return $id; } }",
      "php",
    );
    expect(result.some((token) => token.type === "type.php")).toBe(true);
    expect(result.some((token) => token.type === "function.php")).toBe(true);
    expect(result.some((token) => token.type === "variable.php")).toBe(true);
  });

  it.each([
    [
      "php",
      "<?php\nfinal class Welcome { public function read() { return 'hello'; } }",
    ],
    ["javascript", "export const message = 'hello';"],
    ["typescript", "export const message: string = 'hello';"],
    ["html", '<div class="title">Hello</div>'],
    ["css", ".title { color: red; }"],
    ["sql", "SELECT name FROM users WHERE status = 'active';"],
    ["yaml", 'name: "Octode"'],
    ["markdown", "# Heading\n\n**Bold text**"],
  ])("highlights %s without a language service", async (id, source) => {
    const result = await tokens(source, id);
    expect(result.some((token) => token.type.length > 0)).toBe(true);
  });
  it("distinguishes JSON keys, values, numbers, and booleans", async () => {
    const types = (
      await tokens('{"name":"Octode","count":2,"enabled":true}', "json")
    ).map((token) => token.type);
    expect(types).toContain("string.key.json");
    expect(types).toContain("string.value.json");
    expect(types).toContain("number.json");
    expect(types).toContain("keyword.json");
  });
});

it("keeps SQL filter string/operator colors stable without generated editor CSS classes", async () => {
  const { sqlHighlightParts } = await import("../lib/sqlHighlight");
  const value = "name LIKE '%Alpha%'";
  const parts = sqlHighlightParts(value, await tokens(value, "sql"));
  expect(parts.map((part) => part.text).join("")).toBe(value);
  expect(parts.find((part) => part.text.includes("%Alpha%"))?.color).toBe("#98d792");
  expect(parts.find((part) => part.text.includes("LIKE"))?.color).toBe("#51c5c5");
});
