// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { moveTab, useTabReorder } from "./useTabReorder";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
it("moves tabs in either direction without replacing their state", () => {
  const items = [{ id: "a", draft: "unsaved" }, { id: "b" }, { id: "c" }];
  const moved = moveTab(items, "a", "c", true, (item) => item.id);
  expect(moved.map((item) => item.id)).toEqual(["b", "c", "a"]);
  expect(moved[2]).toBe(items[0]);
  expect(moveTab(moved, "a", "b", false, (item) => item.id)).toEqual(items);
  expect(moveTab(items, "missing", "b", false, (item) => item.id)).toBe(items);
});
it("reorders on mouse release and suppresses the click after a drag", async () => {
  const select = vi.fn();
  function Harness() {
    const [tabs, setTabs] = useState(["a", "b", "c"]);
    const reorder = useTabReorder((source, target, after) => setTabs((items) => moveTab(items, source, target, after, (item) => item)));
    return <div ref={reorder.container}>{tabs.map((id) => <div key={id} {...reorder.tabProps(id)}><button onClick={() => select(id)}>{id}</button></div>)}</div>;
  }
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  const original = document.elementFromPoint;
  try {
    await act(async () => root.render(<Harness />));
    const first = host.querySelector("button")!;
    const last = host.querySelector('[data-reorder-tab="c"]')!;
    document.elementFromPoint = () => last;
    await act(async () => {
      first.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, clientX: 5 }));
      window.dispatchEvent(new MouseEvent("mousemove", { clientX: 100 }));
    });
    expect(last.getAttribute("data-drop-edge")).toBe("after");
    await act(async () => {
      window.dispatchEvent(new MouseEvent("mouseup", { clientX: 100 }));
      first.click();
    });
    expect([...host.querySelectorAll("button")].map((button) => button.textContent)).toEqual(["b", "c", "a"]);
    expect(select).not.toHaveBeenCalled();
  } finally {
    document.elementFromPoint = original;
    await act(async () => root.unmount()); host.remove();
  }
});
