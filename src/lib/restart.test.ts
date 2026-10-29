import { expect, it, vi } from "vitest";
import { prepareRestart } from "./restart";
const options = () => ({
  saveCode: vi.fn(async () => true),
  waitForSaves: vi.fn(async () => true),
  hasUnsavedSettings: () => false,
  confirmDiscard: vi.fn(async () => false),
  flushLayout: vi.fn(async () => {}),
});
it("waits for Code and an already-started settings Save before flushing the layout", async () => {
  const calls: string[] = [];
  let saved!: (value: boolean) => void;
  const config = options();
  config.saveCode = vi.fn(async () => {
    calls.push("code");
    return new Promise<boolean>((resolve) => {
      saved = resolve;
    });
  });
  config.waitForSaves = vi.fn(async () => {
    calls.push("settings");
    return true;
  });
  config.flushLayout = vi.fn(async () => {
    calls.push("layout");
  });
  const result = prepareRestart(config);
  expect(calls).toEqual(["code"]);
  saved(true);
  expect(await result).toBe(true);
  expect(calls).toEqual(["code", "settings", "layout"]);
  expect(config.confirmDiscard).not.toHaveBeenCalled();
});
it("cancels a restart with unsaved settings without saving or discarding them", async () => {
  const config = { ...options(), hasUnsavedSettings: () => true };
  expect(await prepareRestart(config)).toBe(false);
  expect(config.confirmDiscard).toHaveBeenCalledOnce();
  expect(config.flushLayout).not.toHaveBeenCalled();
  config.confirmDiscard.mockResolvedValue(true);
  expect(await prepareRestart(config)).toBe(true);
  expect(config.flushLayout).toHaveBeenCalledOnce();
});
it("blocks restart if Code or an explicit settings Save fails", async () => {
  const config = options();
  config.saveCode.mockResolvedValue(false);
  await expect(prepareRestart(config)).rejects.toThrow(
    "Code could not be saved",
  );
  expect(config.waitForSaves).not.toHaveBeenCalled();
  config.saveCode.mockResolvedValue(true);
  config.waitForSaves.mockResolvedValue(false);
  await expect(prepareRestart(config)).rejects.toThrow("settings save failed");
  expect(config.flushLayout).not.toHaveBeenCalled();
});
