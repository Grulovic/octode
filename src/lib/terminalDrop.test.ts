// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  droppedPaths,
  installTerminalFileDrop,
  quoteTerminalPaths,
  terminalPathsType,
} from "./terminalDrop";
const native = vi.hoisted(() => ({
  handlers: [] as ((event: any) => void)[],
  stop: vi.fn(),
}));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: async (handler: any) => {
      native.handlers.push(handler);
      return native.stop;
    },
  }),
}));
beforeEach(() => {
  native.handlers = [];
  native.stop.mockClear();
  document.body.innerHTML = "";
});
afterEach(() => vi.unstubAllGlobals());
const transfer = (values: Record<string, string>) =>
  ({
    types: Object.keys(values),
    getData: (type: string) => values[type] ?? "",
    dropEffect: "",
  }) as unknown as DataTransfer;
it("quotes paths as literal arguments without submitting or injecting terminal controls", () => {
  expect(
    quoteTerminalPaths(["/tmp/a b.php", "/tmp/it's $(echo bad).php"]),
  ).toBe("'/tmp/a b.php' '/tmp/it'\\''s $(echo bad).php' ");
  expect(quoteTerminalPaths(["C:\\My Files\\test.php"], true)).toBe(
    '"C:\\My Files\\test.php" ',
  );
  for (const path of [
    "relative.php",
    "/tmp/a\nb",
    "/tmp/a\rb",
    "/tmp/\x1b[31m",
    "/tmp/a\0b",
  ])
    expect(() => quoteTerminalPaths([path])).toThrow();
  expect(() => quoteTerminalPaths(["C:\\%TEMP%\\a"], true)).toThrow();
});
it("reads internal tree paths and decoded local file URLs without falling back to filenames", () => {
  expect(
    droppedPaths(
      transfer({ [terminalPathsType]: JSON.stringify(["/project/a.php"]) }),
    ),
  ).toEqual(["/project/a.php"]);
  expect(
    droppedPaths(
      transfer({
        "text/uri-list": "# files\nfile:///tmp/a%20b.php\r\nfile:///tmp/c.php",
      }),
    ),
  ).toEqual(["/tmp/a b.php", "/tmp/c.php"]);
  expect(() =>
    droppedPaths(transfer({ "text/uri-list": "https://example.test/a.php" })),
  ).toThrow();
  expect(() =>
    droppedPaths(transfer({ [terminalPathsType]: "[1]" })),
  ).toThrow();
  expect(droppedPaths(transfer({ Files: "" }))).toEqual([]);
});
it("routes native physical coordinates only to the connected active terminal and cleans up", async () => {
  vi.stubGlobal("devicePixelRatio", 2);
  const element = document.createElement("div");
  document.body.append(element);
  element.getBoundingClientRect = () =>
    ({
      left: 100,
      top: 100,
      right: 300,
      bottom: 300,
      width: 200,
      height: 200,
    }) as DOMRect;
  let active = true;
  const onPaths = vi.fn(),
    onHover = vi.fn();
  const stop = installTerminalFileDrop(element, {
    active: () => active,
    onPaths,
    onHover,
    onError: vi.fn(),
    native: true,
  });
  await vi.waitFor(() => expect(native.handlers).toHaveLength(1));
  const emit = (payload: any) => native.handlers[0]({ payload });
  emit({ type: "enter", paths: ["/a"], position: { x: 300, y: 300 } });
  expect(onHover).toHaveBeenLastCalledWith(true);
  emit({ type: "drop", paths: ["/a"], position: { x: 300, y: 300 } });
  expect(onPaths).toHaveBeenCalledExactlyOnceWith(["/a"]);
  emit({ type: "drop", paths: ["/outside"], position: { x: 20, y: 20 } });
  expect(onPaths).toHaveBeenCalledTimes(1);
  active = false;
  emit({ type: "drop", paths: ["/hidden"], position: { x: 300, y: 300 } });
  expect(onPaths).toHaveBeenCalledTimes(1);
  active = true;
  element.remove();
  emit({ type: "drop", paths: ["/detached"], position: { x: 300, y: 300 } });
  expect(onPaths).toHaveBeenCalledTimes(1);
  stop();
  expect(native.stop).toHaveBeenCalledOnce();
  emit({ type: "drop", paths: ["/closed"], position: { x: 300, y: 300 } });
  expect(onPaths).toHaveBeenCalledTimes(1);
});
it("accepts internal drag/drop and removes handlers when the shell closes", () => {
  const element = document.createElement("div");
  document.body.append(element);
  const onPaths = vi.fn(),
    onHover = vi.fn();
  const stop = installTerminalFileDrop(element, {
    active: () => true,
    onPaths,
    onHover,
    onError: vi.fn(),
    native: false,
  });
  const data = transfer({
    [terminalPathsType]: JSON.stringify(["/project/a.php"]),
  });
  const emit = (name: string) => {
    const event = new Event(name, { cancelable: true, bubbles: true });
    Object.defineProperty(event, "dataTransfer", { value: data });
    element.dispatchEvent(event);
    return event;
  };
  expect(emit("dragover").defaultPrevented).toBe(true);
  expect(onHover).toHaveBeenLastCalledWith(true);
  emit("drop");
  expect(onPaths).toHaveBeenCalledExactlyOnceWith(["/project/a.php"]);
  stop();
  emit("drop");
  expect(onPaths).toHaveBeenCalledTimes(1);
});
