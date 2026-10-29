// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { loadDrafts, saveDrafts, recoverySnapshot } from "./recovery";
import type { Project } from "../types";
vi.mock("./bridge", () => ({ desktop: false, invoke: vi.fn() }));
const project = (id: string): Project => ({
  id,
  name: id,
  roots: ["/project"],
  updatedAt: 0,
});
describe("Code recovery", () => {
  it("keeps pending recoveries and only backs up unsaved buffers", () => {
    const pending = {
      path: "/project/a",
      text: "crash draft",
      saved: "baseline",
    };
    expect(
      recoverySnapshot(
        [
          {
            path: "/project/a",
            name: "a",
            text: "baseline",
            saved: "baseline",
          },
          { path: "/project/b", name: "b", text: "unsaved", saved: "old" },
          { path: "/project/c", name: "c", text: "saved", saved: "saved" },
        ],
        [pending],
      ),
    ).toEqual([pending, { path: "/project/b", text: "unsaved", saved: "old" }]);
  });
  it("serializes snapshots per project and retains a copy independent of subsequent edits", async () => {
    const one = project("one");
    const drafts = [{ path: "/project/a", text: "first", saved: "old" }];
    const first = saveDrafts(one, drafts);
    drafts[0].text = "mutated after submit";
    await first;
    expect((await loadDrafts(one))[0].text).toBe("first");
    await Promise.all([
      saveDrafts(one, [{ path: "/project/a", text: "second", saved: "old" }]),
      saveDrafts(one, []),
    ]);
    expect(await loadDrafts(one)).toEqual([]);
    expect(await loadDrafts(project("other"))).toEqual([]);
  });
});
