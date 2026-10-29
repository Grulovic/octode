import { describe, expect, it } from "vitest";
import { createTerminalInputQueue, splitTerminalInput } from "./terminal";

describe("terminal input", () => {
  it("chunks Unicode without splitting surrogate pairs", () => {
    const text = "a".repeat(8191) + "👋Ćao".repeat(5000);
    const chunks = splitTerminalInput(text);
    expect(chunks.join("")).toBe(text);
    expect(chunks.every((chunk) => chunk.length <= 8192)).toBe(true);
    expect(chunks.every((chunk) => !/[\uD800-\uDBFF]$/.test(chunk))).toBe(true);
  });
  it("sends asynchronous input in order", async () => {
    const sent: string[] = [];
    const queue = createTerminalInputQueue(
      async (chunk) => {
        await Promise.resolve();
        sent.push(chunk);
      },
      () => {},
    );
    queue.send("first");
    queue.send("second");
    await queue.flush();
    expect(sent).toEqual(["first", "second"]);
  });
  it("stops the rest of a failed paste while allowing later commands", async () => {
    const sent: string[] = [];
    const failures: unknown[] = [];
    const queue = createTerminalInputQueue(
      async (chunk) => {
        if (chunk.startsWith("a")) throw new Error("blocked");
        sent.push(chunk);
      },
      (error) => failures.push(error),
    );
    queue.send("a".repeat(20000));
    await queue.flush();
    queue.send("later");
    await queue.flush();
    expect(failures).toHaveLength(1);
    expect(sent).toEqual(["later"]);
  });
  it("bounds pending input and drops queued input after disposal", async () => {
    const sent: string[] = [];
    const failures: unknown[] = [];
    const queue = createTerminalInputQueue(
      async (chunk) => {
        sent.push(chunk);
      },
      (error) => failures.push(error),
      8,
    );
    queue.send("12345678");
    queue.send("overflow");
    expect(failures).toHaveLength(1);
    queue.close();
    await queue.flush();
    expect(sent).toEqual([]);
  });
});
