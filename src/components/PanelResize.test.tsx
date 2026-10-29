// @vitest-environment jsdom
import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it } from "vitest";
import PanelResize, { usePanelSize } from "./PanelResize";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
function Layout({ axis = "x" }: { axis?: "x" | "y" }) {
  const panel = useRef<HTMLDivElement>(null);
  const [size, setSize] = usePanelSize("test-panel", 240);
  return (
    <div className="parent main-workspace">
      <div className="workspace-terminal-host">
      <div
        ref={panel}
        className="panel"
        style={axis === "x" ? { width: size } : { height: size }}
      />
      <PanelResize
        target={panel}
        size={size}
        axis={axis}
        onResize={setSize}
        label="Resize test"
      />
      </div>
    </div>
  );
}
function mockLayout(axis: "x" | "y") {
  const parent = document.querySelector(axis === "y" ? ".parent" : ".workspace-terminal-host")!;
  Object.defineProperty(parent, "clientWidth", { value: 1000 });
  Object.defineProperty(parent, "clientHeight", { value: 800 });
  const panel = document.querySelector<HTMLElement>(".panel")!;
  panel.getBoundingClientRect = () =>
    ({
      width: Number.parseFloat(panel.style.width) || 500,
      height: Number.parseFloat(panel.style.height) || 500,
    }) as DOMRect;
  return { panel, handle: document.querySelector('[role="separator"]')!, axis };
}
beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById("root")!);
});
afterEach(async () => {
  await act(async () => root.unmount());
});
it("drags the sidebar divider, clamps width, persists it, and supports keyboard resizing", async () => {
  await act(async () => root.render(<Layout />));
  const { panel, handle } = mockLayout("x");
  await act(async () =>
    handle.dispatchEvent(
      new MouseEvent("mousedown", { button: 0, clientX: 240, bubbles: true }),
    ),
  );
  await act(async () =>
    window.dispatchEvent(new MouseEvent("mousemove", { clientX: 370 })),
  );
  expect(panel.style.width).toBe("370px");
  await act(async () =>
    window.dispatchEvent(new MouseEvent("mousemove", { clientX: 2000 })),
  );
  expect(panel.style.width).toBe("640px");
  await act(async () => window.dispatchEvent(new MouseEvent("mouseup")));
  expect(document.documentElement.classList.contains("resizing-panels")).toBe(
    false,
  );
  await act(async () =>
    handle.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }),
    ),
  );
  expect(panel.style.width).toBe("630px");
  await act(async () => root.render(<div />));
  expect(localStorage.getItem("test-panel")).toBe("630");
  await act(async () => root.render(<Layout />));
  expect(document.querySelector<HTMLElement>(".panel")!.style.width).toBe(
    "630px",
  );
});
it("grows the terminal upward, clamps height, and stops dragging on blur", async () => {
  await act(async () => root.render(<Layout axis="y" />));
  const { panel, handle } = mockLayout("y");
  await act(async () =>
    handle.dispatchEvent(
      new MouseEvent("mousedown", { button: 0, clientY: 560, bubbles: true }),
    ),
  );
  await act(async () =>
    window.dispatchEvent(new MouseEvent("mousemove", { clientY: 360 })),
  );
  expect(panel.style.height).toBe("440px");
  await act(async () =>
    window.dispatchEvent(new MouseEvent("mousemove", { clientY: -1000 })),
  );
  expect(panel.style.height).toBe("660px");
  await act(async () => window.dispatchEvent(new Event("blur")));
  await act(async () =>
    window.dispatchEvent(new MouseEvent("mousemove", { clientY: 500 })),
  );
  expect(panel.style.height).toBe("660px");
});
