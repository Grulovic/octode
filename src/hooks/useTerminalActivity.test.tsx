// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { useTerminalActivity } from "./useTerminalActivity";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
it("lights on output, retains hidden output, and clears when viewed", () => {
  vi.useFakeTimers();
  const host = document.createElement("div");
  const root = createRoot(host);
  let notify = () => {};
  function Probe({ visible }: { visible: boolean }) {
    const activity = useTerminalActivity(visible);
    notify = activity.output;
    return <span>{String(activity.active)}</span>;
  }
  try {
    act(() => root.render(<Probe visible />));
    act(() => notify()); expect(host.textContent).toBe("true");
    act(() => vi.advanceTimersByTime(1100)); expect(host.textContent).toBe("false");
    act(() => root.render(<Probe visible={false} />));
    act(() => notify());
    act(() => vi.advanceTimersByTime(10000)); expect(host.textContent).toBe("true");
    act(() => root.render(<Probe visible />)); expect(host.textContent).toBe("false");
  } finally { act(() => root.unmount()); vi.useRealTimers(); }
});
