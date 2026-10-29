import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AUTOSAVE_DELAY, createCodeAutosave } from "./autosave";
import type { Document } from "../types";

function fixture() {
  let documents: Document[] = [
    { path: "/app/a.php", name: "a.php", text: "original", saved: "original" },
    { path: "/app/b.ts", name: "b.ts", text: "second", saved: "second" },
  ];
  const disk = new Map(documents.map((item) => [item.path, item.saved]));
  const error = vi.fn();
  const write = vi.fn(async (snapshot: Document) => {
    if (disk.get(snapshot.path) !== snapshot.saved)
      throw new Error("Changed on disk");
    disk.set(snapshot.path, snapshot.text);
  });
  const manager = createCodeAutosave({
    read: () => documents,
    write,
    saved: (snapshot) => {
      documents = documents.map((item) =>
        item.path === snapshot.path ? { ...item, saved: snapshot.text } : item,
      );
    },
    state: () => {},
    error,
  });
  return {
    manager,
    disk,
    write,
    error,
    read: () => documents,
    edit(path: string, text: string) {
      documents = documents.map((item) =>
        item.path === path ? { ...item, text } : item,
      );
      manager.changed(path);
    },
  };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
describe("Code autosave", () => {
  it("pauses a pending write until the external change has been reviewed", async () => {
    const f = fixture();
    f.edit("/app/a.php", "local");
    f.manager.pause("/app/a.php");
    await vi.advanceTimersByTimeAsync(2000);
    expect(f.write).not.toHaveBeenCalled();
    expect(await f.manager.flush()).toBe(false);
    f.manager.forget("/app/a.php");
    f.manager.changed("/app/a.php");
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY);
    expect(f.disk.get("/app/a.php")).toBe("local");
    f.manager.dispose();
  });
  it("recovers from a transport that throws before returning a promise", async () => {
    const f = fixture();
    f.write.mockImplementationOnce(() => {
      throw new Error("Transport unavailable");
    });
    f.edit("/app/a.php", "recover");
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY);
    expect(await f.manager.flush("/app/a.php", true)).toBe(true);
    expect(f.disk.get("/app/a.php")).toBe("recover");
    f.manager.dispose();
  });
  it("retries failed writes only when explicitly requested", async () => {
    const f = fixture();
    f.write.mockRejectedValueOnce(new Error("Temporary write failure"));
    f.edit("/app/a.php", "retry me");
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY);
    expect(await f.manager.flush("/app/a.php", true)).toBe(true);
    expect(f.disk.get("/app/a.php")).toBe("retry me");
    expect(f.write).toHaveBeenCalledTimes(2);
    f.manager.dispose();
  });
  it("debounces typing and saves the latest text", async () => {
    const f = fixture();
    f.edit("/app/a.php", "first");
    await vi.advanceTimersByTimeAsync(300);
    f.edit("/app/a.php", "latest");
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY - 1);
    expect(f.write).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(f.disk.get("/app/a.php")).toBe("latest");
    expect(f.read()[0].saved).toBe("latest");
    f.manager.dispose();
  });
  it("saves independently edited files even when their tabs are inactive", async () => {
    const f = fixture();
    f.edit("/app/a.php", "php");
    f.edit("/app/b.ts", "typescript");
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY);
    expect(f.disk.get("/app/a.php")).toBe("php");
    expect(f.disk.get("/app/b.ts")).toBe("typescript");
    f.manager.dispose();
  });
  it("serializes edits arriving during an in-flight write", async () => {
    const f = fixture();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    f.write.mockImplementationOnce(async (snapshot) => {
      await gate;
      f.disk.set(snapshot.path, snapshot.text);
    });
    f.edit("/app/a.php", "first");
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY);
    f.edit("/app/a.php", "newer");
    const flushing = f.manager.flush();
    release();
    expect(await flushing).toBe(true);
    expect(
      f.write.mock.calls.map(([snapshot]) => [snapshot.text, snapshot.saved]),
    ).toEqual([
      ["first", "original"],
      ["newer", "first"],
    ]);
    expect(f.disk.get("/app/a.php")).toBe("newer");
    f.manager.dispose();
  });
  it("preserves an undo to the original text during a write", async () => {
    const f = fixture();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    f.write.mockImplementationOnce(async (snapshot) => {
      await gate;
      f.disk.set(snapshot.path, snapshot.text);
    });
    f.edit("/app/a.php", "temporary");
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY);
    f.edit("/app/a.php", "original");
    const flushing = f.manager.flush();
    release();
    expect(await flushing).toBe(true);
    expect(f.disk.get("/app/a.php")).toBe("original");
    f.manager.dispose();
  });
  it("preserves external edits and stops automatic retries after a failure", async () => {
    const f = fixture();
    f.edit("/app/a.php", "my edit");
    f.disk.set("/app/a.php", "agent edit");
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY);
    f.edit("/app/a.php", "more edits");
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY * 3);
    expect(f.write).toHaveBeenCalledTimes(1);
    expect(f.error).toHaveBeenCalledTimes(1);
    expect(f.disk.get("/app/a.php")).toBe("agent edit");
    expect(f.read()[0].text).toBe("more edits");
    expect(await f.manager.flush()).toBe(false);
    f.manager.dispose();
  });
  it("flushes immediately before closing and cancels pending timers on disposal", async () => {
    const f = fixture();
    f.edit("/app/a.php", "close now");
    expect(await f.manager.flush("/app/a.php")).toBe(true);
    expect(f.disk.get("/app/a.php")).toBe("close now");
    f.edit("/app/b.ts", "not flushed");
    f.manager.dispose();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY);
    expect(f.disk.get("/app/b.ts")).toBe("second");
  });
});
