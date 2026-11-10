// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { useConnectionRecovery } from "./useConnectionRecovery";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
afterEach(() => vi.useRealTimers());

it("tries a lost session exactly three times and stops polling after exhaustion", async () => {
  vi.useFakeTimers();
  const check = vi.fn(async () => false);
  const reconnect = vi.fn(async () => { throw new Error("Offline"); });
  const onError = vi.fn();
  const host = document.createElement("div"); const root = createRoot(host);
  function Harness() { useConnectionRecovery({ sessions: { db: "original" }, check, reconnect, onError }); return null; }
  try {
    await act(async () => root.render(<Harness />));
    await act(async () => vi.advanceTimersByTimeAsync(8000));
    expect(reconnect).toHaveBeenCalledTimes(3);
    expect(onError).toHaveBeenCalledOnce();
    await act(async () => vi.advanceTimersByTimeAsync(20000));
    expect(check).toHaveBeenCalledOnce();
  } finally { await act(async () => root.unmount()); }
});

it("stops retries after disconnect and cleans up an in-flight recovery on unmount", async () => {
  vi.useFakeTimers();
  const reconnect = vi.fn(async () => { throw new Error("Offline"); });
  const onError = vi.fn();
  const root = createRoot(document.createElement("div"));
  function Harness({ connected }: { connected: boolean }) {
    useConnectionRecovery({ sessions: connected ? { ssh: "old" } : {}, check: async () => false, reconnect, onError }); return null;
  }
  await act(async () => root.render(<Harness connected />));
  await act(async () => vi.advanceTimersByTimeAsync(5000));
  expect(reconnect).toHaveBeenCalledOnce();
  await act(async () => root.render(<Harness connected={false} />));
  await act(async () => vi.advanceTimersByTimeAsync(2000));
  expect(reconnect).toHaveBeenCalledOnce();
  expect(onError).not.toHaveBeenCalled();
  await act(async () => root.unmount());
});

it("ends recovery after a successful reconnect without replaying other work", async () => {
  vi.useFakeTimers();
  const reconnect = vi.fn().mockRejectedValueOnce(new Error("Offline")).mockResolvedValue(undefined);
  const onError = vi.fn(); const root = createRoot(document.createElement("div"));
  function Harness() { useConnectionRecovery({ sessions: { ssh: "old" }, check: async () => false, reconnect, onError }); return null; }
  try {
    await act(async () => root.render(<Harness />));
    await act(async () => vi.advanceTimersByTimeAsync(6000));
    expect(reconnect).toHaveBeenCalledTimes(2);
    expect(onError).not.toHaveBeenCalled();
  } finally { await act(async () => root.unmount()); }
});
