// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { useToolDocument } from "./useToolDocument";
import * as bridge from "../lib/toolsBridge";
import { apiDocument, apiRequest } from "../lib/toolDefaults";
import { previewProject } from "../lib/bridge";
import { waitForPendingToolSaves } from "../lib/toolSaves";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
let hook: ReturnType<typeof useToolDocument<ReturnType<typeof apiDocument>>>;
const error = vi.fn();
const dirty = vi.fn();
function Harness() {
  hook = useToolDocument(previewProject, "api", apiDocument, error, dirty);
  return (
    <span>{hook.loading ? "loading" : hook.dirty ? "pending" : "saved"}</span>
  );
}
beforeEach(() => {
  document.body.innerHTML = '<div id="test"></div>';
  root = createRoot(document.getElementById("test")!);
  vi.spyOn(bridge, "loadTool").mockResolvedValue(apiDocument());
  error.mockClear();
  dirty.mockClear();
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.restoreAllMocks();
  vi.useRealTimers();
});
it("saves only the clicked snapshot and keeps edits made during Save unsaved", async () => {
  const persisted: unknown[] = [];
  let release: (value: any) => void = () => {};
  const writer = vi
    .spyOn(bridge, "saveTool")
    .mockImplementation(async (_project, _tool, doc) => {
      persisted.push(structuredClone(doc));
      if (persisted.length === 1)
        return new Promise((resolve) => {
          release = resolve;
        });
      return structuredClone(doc);
    });
  await act(async () => root.render(<Harness />));
  const request = apiRequest();
  request.name = "first";
  await act(async () =>
    hook.setDocument((previous) => ({ ...previous, requests: [request] })),
  );
  let flushing: Promise<boolean>;
  await act(async () => {
    flushing = hook.save();
  });
  await act(async () =>
    hook.setDocument((previous) => ({
      ...previous,
      requests: previous.requests.map((item) => ({ ...item, name: "latest" })),
    })),
  );
  expect(writer).toHaveBeenCalledTimes(1);
  await act(async () => {
    release(structuredClone(persisted[0]));
    expect(await flushing!).toBe(true);
  });
  expect(writer).toHaveBeenCalledTimes(1);
  expect(hook.dirty).toBe(true);
  await act(async () => expect(await hook.save()).toBe(true));
  expect(writer).toHaveBeenCalledTimes(2);
  expect((persisted[1] as any).requests[0].name).toBe("latest");
  expect(hook.dirty).toBe(false);
});
it("retains failed settings, reports failure and retries without claiming they were saved", async () => {
  const writer = vi
    .spyOn(bridge, "saveTool")
    .mockRejectedValue(new Error("disk full"));
  await act(async () => root.render(<Harness />));
  await act(async () =>
    hook.setDocument((previous) => ({ ...previous, requests: [apiRequest()] })),
  );
  await act(async () => expect(await hook.save()).toBe(false));
  expect(hook.dirty).toBe(true);
  expect(error).toHaveBeenCalled();
  writer.mockImplementation(async (_p, _t, doc) => structuredClone(doc));
  await act(async () => expect(await hook.save()).toBe(true));
  expect(hook.dirty).toBe(false);
});
it("never writes on a typing pause, blur, leaving, or unmount and refuses to overwrite after load failure", async () => {
  vi.useFakeTimers();
  const writer = vi
    .spyOn(bridge, "saveTool")
    .mockImplementation(async (_p, _t, doc) => structuredClone(doc));
  await act(async () => root.render(<Harness />));
  await act(async () =>
    hook.setDocument((previous) => ({ ...previous, requests: [apiRequest()] })),
  );
  await act(async () => {
    window.dispatchEvent(new Event("blur"));
    await vi.advanceTimersByTimeAsync(2000);
    expect(await waitForPendingToolSaves()).toBe(true);
  });
  expect(writer).not.toHaveBeenCalled();
  expect(hook.dirty).toBe(true);
  await act(async () => root.unmount());
  expect(writer).not.toHaveBeenCalled();
  root = createRoot(document.getElementById("test")!);
  vi.mocked(bridge.loadTool).mockRejectedValue(new Error("unreadable"));
  await act(async () => root.render(<Harness />));
  await act(async () => expect(await hook.save()).toBe(false));
  expect(writer).not.toHaveBeenCalled();
});

it("acknowledges a sealed password even when another field changes during Save", async () => {
  let release: (value: any) => void = () => {};
  vi.spyOn(bridge, "saveTool").mockImplementation(async () => new Promise((resolve) => { release = resolve; }));
  await act(async () => root.render(<Harness />));
  const request = apiRequest();
  request.credential.value = "test-only-password";
  await act(async () => hook.setDocument((previous) => ({ ...previous, requests: [request] })));
  const snapshot = structuredClone(hook.document);
  let pending: Promise<boolean>;
  await act(async () => { pending = hook.save(); });
  await act(async () => hook.setDocument((previous) => ({
    ...previous, requests: previous.requests.map((item) => ({...item, name: "New name while saving"})),
  })));
  const saved = structuredClone(snapshot);
  saved.requests[0].credential = { id:"saved-reference", value:"", secret:true, hasSecret:true };
  await act(async () => { release(saved); expect(await pending!).toBe(true); });
  expect(hook.document.requests[0].credential).toEqual(saved.requests[0].credential);
  expect(hook.document.requests[0].name).toBe("New name while saving");
  expect(hook.dirty).toBe(true);
});
