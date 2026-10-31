// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const harness = vi.hoisted(() => ({
  models: new Map<string, any>(),
  instances: [] as any[],
}));
vi.mock("../editor/runtime", () => ({
  monaco: {
    Uri: { parse: (path: string) => ({ toString: () => path }) },
    KeyCode: { F12: 70 },
    KeyMod: { CtrlCmd: 2048 },
    editor: {
      defineTheme: vi.fn(),
      MouseTargetType: { CONTENT_TEXT: 6 },
      getModel: (uri: any) => harness.models.get(uri.toString()),
      setModelLanguage: (model: any, language: string) => { model.language = language; },
      createModel: (value: string, language: string, uri: any) => {
        const model = {
          uri,
          value,
          language,
          getLanguageId() { return this.language; },
          getValue() {
            return this.value;
          },
          setValue(text: string) {
            this.value = text;
            for (const instance of harness.instances.filter(
              (item) => item.model === this,
            ))
              instance.change?.({ isFlush: true });
          },
          getLineContent: () => "",
          getWordAtPosition: () => null,
          dispose() {
            harness.models.delete(uri.toString());
          },
        };
        harness.models.set(uri.toString(), model);
        return model;
      },
      create: (_host: any, options: any) => {
        const instance = {
          model: options.model,
          change: null as any,
          getModel() {
            return this.model;
          },
          onDidChangeModelContent(fn: any) {
            this.change = fn;
            return { dispose: vi.fn() };
          },
          mouseDown: null as any,
          mouseMove: null as any,
          mouseLeave: null as any,
          decorations: { set: vi.fn(), clear: vi.fn() },
          createDecorationsCollection() {
            return this.decorations;
          },
          onMouseDown(fn: any) {
            this.mouseDown = fn;
            return { dispose: vi.fn() };
          },
          onMouseMove(fn: any) {
            this.mouseMove = fn;
            return { dispose: vi.fn() };
          },
          onMouseLeave(fn: any) {
            this.mouseLeave = fn;
            return { dispose: vi.fn() };
          },
          addAction: () => ({ dispose: vi.fn() }),
          updateOptions: vi.fn(),
          dispose: vi.fn(),
          setPosition: vi.fn(),
          revealLineInCenter: vi.fn(),
          focus: vi.fn(),
          getAction: vi.fn(() => ({ run: vi.fn() })),
        };
        harness.instances.push(instance);
        return instance;
      },
    },
  },
}));
import EditorPane from "./EditorPane";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
const file = (path: string, text: string) => ({
  path,
  name: path.split("/").pop()!,
  text,
  saved: text,
});
beforeEach(() => {
  harness.models.clear();
  harness.instances = [];
  document.body.innerHTML = '<div id="test"></div>';
  root = createRoot(document.getElementById("test")!);
});
afterEach(async () => {
  await act(async () => root.unmount());
});
describe("file-bound editor events", () => {
  it("opens Monaco Find only when requested, independently from global search", async () => {
    const doc = file("/find.php", "Room");
    await act(async () =>
      root.render(<EditorPane document={doc} onChange={() => {}} />),
    );
    const instance = harness.instances[0];
    expect(instance.getAction).not.toHaveBeenCalled();
    await act(async () =>
      root.render(
        <EditorPane document={doc} onChange={() => {}} findToken={1} />,
      ),
    );
    expect(instance.getAction).toHaveBeenCalledWith("actions.find");
    expect(instance.focus).toHaveBeenCalled();
  });
  it("switches models without copying content into the previous file and ignores late events", async () => {
    const first = vi.fn();
    const second = vi.fn();
    await act(async () =>
      root.render(
        <EditorPane document={file("/a.php", "A")} onChange={first} />,
      ),
    );
    const old = harness.instances[0];
    await act(async () =>
      root.render(
        <EditorPane document={file("/b.php", "B")} onChange={second} />,
      ),
    );
    old.change({ isFlush: false });
    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();
    expect(harness.models.get("/a.php").value).toBe("A");
    const current = harness.instances.at(-1);
    current.model.value = "edited B";
    current.change({ isFlush: false });
    expect(second).toHaveBeenCalledExactlyOnceWith("edited B");
  });
  it("applies disk reloads while read-only without saving stale model contents", async () => {
    const change = vi.fn();
    await act(async () =>
      root.render(
        <EditorPane
          document={file("/a.php", "Local draft")}
          onChange={change}
          readOnly
        />,
      ),
    );
    await act(async () =>
      root.render(
        <EditorPane
          document={file("/a.php", "Reloaded disk")}
          onChange={change}
          readOnly
        />,
      ),
    );
    expect(harness.models.get("/a.php").value).toBe("Reloaded disk");
    expect(change).not.toHaveBeenCalled();
    await act(async () =>
      root.render(
        <EditorPane
          document={file("/a.php", "Reloaded disk")}
          onChange={change}
        />,
      ),
    );
    expect(harness.models.get("/a.php").value).toBe("Reloaded disk");
    expect(change).not.toHaveBeenCalled();
  });
  it("underlines the hovered navigation token only while Command or Control is held", async () => {
    const navigate = vi.fn();
    await act(async () =>
      root.render(
        <EditorPane
          document={file("/a.php", "Room::find()")}
          onChange={vi.fn()}
          onNavigate={navigate}
        />,
      ),
    );
    const instance = harness.instances[0];
    instance.model.getLineContent = () => "Room::find()";
    instance.model.getWordAtPosition = () => ({
      word: "Room",
      startColumn: 1,
      endColumn: 5,
    });
    const event = {
      target: { type: 6, position: { lineNumber: 1, column: 2 } },
      event: { metaKey: false, ctrlKey: false, preventDefault: vi.fn() },
    };
    instance.mouseMove(event);
    expect(instance.decorations.set).toHaveBeenLastCalledWith([]);
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Meta", metaKey: true }),
    );
    expect(instance.decorations.set.mock.lastCall[0][0].range).toEqual({
      startLineNumber: 1,
      endLineNumber: 1,
      startColumn: 1,
      endColumn: 5,
    });
    instance.mouseDown({ ...event, event: { ...event.event, metaKey: true } });
    expect(navigate).toHaveBeenCalledWith("Room", 1);
    window.dispatchEvent(new KeyboardEvent("keyup", { key: "Meta" }));
    expect(instance.decorations.set).toHaveBeenLastCalledWith([]);
    instance.mouseLeave();
    expect(instance.decorations.clear).toHaveBeenCalled();
  });
  it("changes note language in place without replacing the editor or losing text", async () => {
    const change = vi.fn();
    const render = (languageId: string) => root.render(<EditorPane
      document={file("notes://scratch.txt", "select * from users;")}
      modelPath="notes://scratch.txt" languageId={languageId} onChange={change}
    />);
    await act(async () => render("plaintext"));
    const instance = harness.instances[0], model = instance.model;
    await act(async () => render("php"));
    expect(model.getLanguageId()).toBe("php");
    await act(async () => render("sql"));
    expect(model.getLanguageId()).toBe("sql");
    await act(async () => render("plaintext"));
    expect(model.getLanguageId()).toBe("plaintext");
    expect(harness.instances).toHaveLength(1);
    expect(instance.model).toBe(model);
    expect(model.getValue()).toBe("select * from users;");
    expect(change).not.toHaveBeenCalled();
  });
  it("keeps main and merge models separate and disposes the merge model on close", async () => {
    const change = vi.fn();
    await act(async () =>
      root.render(
        <EditorPane
          document={file("/a.php", "result")}
          modelPath="octode-merge:/a.php"
          onChange={change}
        />,
      ),
    );
    const instance = harness.instances[0];
    await act(async () => root.render(<div>Closed</div>));
    instance.change({ isFlush: false });
    expect(change).not.toHaveBeenCalled();
    expect(harness.models.size).toBe(0);
  });
});

it("retains a note model and its undo history across editor unmounts without resetting its text", async () => {
  const { disposeRetainedEditorModel } = await import("../lib/retainedEditorModels");
  const path = "notes://undo-test.txt";
  const doc = file(path, "edited note");
  try {
    const render = () => root.render(<EditorPane document={doc} modelPath={path} retainModel onChange={() => {}} />);
    await act(async () => render());
    const model = harness.models.get(path);
    model.undoHistory = ["original note"];
    const reset = vi.spyOn(model, "setValue");
    await act(async () => root.render(null));
    expect(harness.models.get(path)).toBe(model);
    await act(async () => render());
    expect(harness.instances.at(-1).model).toBe(model);
    expect(model.undoHistory).toEqual(["original note"]);
    expect(reset).not.toHaveBeenCalled();
    await act(async () => root.render(null));
    disposeRetainedEditorModel(path);
    expect(harness.models.has(path)).toBe(false);
  } finally { disposeRetainedEditorModel(path); }
});
