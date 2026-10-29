import { expect, it, vi } from "vitest";
import { createWorkspaceRuntime } from "./workspaceRegistry";
it("checks every parked workspace before quitting, without saving manual settings", async () => {
  const runtime = createWorkspaceRuntime();
  let dirty = true;
  const alpha = {
    saveCode: vi.fn(async () => true),
    flushLayout: vi.fn(async () => {}),
    hasUnsavedSettings: () => false,
  };
  const beta = {
    saveCode: vi.fn(async () => false),
    flushLayout: vi.fn(async () => {}),
    hasUnsavedSettings: () => dirty,
  };
  runtime.register("alpha", alpha);
  runtime.register("beta", beta);
  expect(runtime.hasUnsavedSettings()).toBe(true);
  expect(await runtime.saveAllCode()).toBe(false);
  expect(alpha.saveCode).toHaveBeenCalledOnce();
  expect(beta.saveCode).toHaveBeenCalledOnce();
  dirty = false;
  expect(runtime.hasUnsavedSettings()).toBe(false);
  await runtime.flushAllLayouts();
  expect(alpha.flushLayout).toHaveBeenCalledOnce();
  expect(beta.flushLayout).toHaveBeenCalledOnce();
});
it("does not lose a replacement registration to stale cleanup and surfaces save errors", async () => {
  const runtime = createWorkspaceRuntime();
  const old = {
    saveCode: async () => true,
    flushLayout: async () => {},
    hasUnsavedSettings: () => false,
  };
  const stop = runtime.register("alpha", old);
  const newer = {
    saveCode: async () => {
      throw new Error("disk offline");
    },
    flushLayout: async () => {
      throw new Error("layout offline");
    },
    hasUnsavedSettings: () => true,
  };
  const close = runtime.register("alpha", newer);
  stop();
  expect(runtime.hasUnsavedSettings()).toBe(true);
  expect(await runtime.saveAllCode()).toBe(false);
  await expect(runtime.flushAllLayouts()).rejects.toThrow("layout offline");
  close();
  expect(runtime.hasUnsavedSettings()).toBe(false);
  expect(await runtime.saveAllCode()).toBe(true);
});
