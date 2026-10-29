// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { it, expect, vi } from "vitest";
import SearchEverywhere from "./SearchEverywhere";
import { previewProject } from "../lib/bridge";
import type { SearchEntry } from "../lib/searchEverywhere";
const fixture = vi.hoisted(() => ({
  entries: null as SearchEntry[] | null,
  sections: [] as SearchEntry[],
}));
vi.mock("../lib/searchEverywhere", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/searchEverywhere")>()),
  cachedSearchIndex: () => ({
    entries:
      fixture.entries ??
      Array.from({ length: 25 }, (_, i) => ({
        path: `/file${i}`,
        relative: `file${i}`,
        root: "/project",
        label: `file${String(i).padStart(2, "0")}`,
        kind: "file",
        line: 1,
      })),
    truncated: false,
  }),
  loadSearchIndex: () => new Promise(() => {}),
}));
vi.mock("../lib/sectionSearch", () => ({
  loadSectionEntries: async () => ({ entries: fixture.sections, errors: [] }),
}));
it("scrolls the result container down and back up with keyboard selection without hover stealing selection", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  document.body.innerHTML = '<div id="test"></div>';
  const root = createRoot(document.getElementById("test")!);
  try {
    await act(async () =>
      root.render(
        <SearchEverywhere
          project={previewProject}
          onClose={() => {}}
          onOpen={() => {}}
        />,
      ),
    );
    const list = document.querySelector<HTMLElement>("#everywhere-results")!;
    Object.defineProperty(list, "clientHeight", { value: 180 });
    list.getBoundingClientRect = () => ({ top: 100, bottom: 280 }) as DOMRect;
    const rows = [...list.querySelectorAll<HTMLElement>('[role="option"]')];
    rows.forEach((row, i) => {
      row.getBoundingClientRect = () =>
        ({
          top: 100 + i * 60 - list.scrollTop,
          bottom: 160 + i * 60 - list.scrollTop,
        }) as DOMRect;
    });
    const input = document.querySelector<HTMLInputElement>("input")!;
    const key = async (key: string) =>
      act(async () => {
        input.dispatchEvent(
          new KeyboardEvent("keydown", {
            key,
            bubbles: true,
            cancelable: true,
          }),
        );
      });
    for (let i = 0; i < 10; i++) await key("ArrowDown");
    expect(rows[10].getAttribute("aria-selected")).toBe("true");
    expect(list.scrollTop).toBe(480);
    expect(rows[10].getBoundingClientRect().bottom).toBeLessThanOrEqual(280);
    await act(async () => {
      rows[8].dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    });
    expect(rows[10].getAttribute("aria-selected")).toBe("true");
    for (let i = 0; i < 10; i++) await key("ArrowUp");
    expect(list.scrollTop).toBe(0);
    expect(rows[0].getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(input);
  } finally {
    await act(async () => root.unmount());
  }
});

it("defaults to All, scopes before the result limit, preserves queries and supports left/right tabs", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const room: SearchEntry = {
    path: "/project-b/Models/Room.php",
    relative: "Models/Room.php",
    root: "/project-b",
    label: "Room1000",
    kind: "class",
    line: 42,
  };
  fixture.entries = [
    ...Array.from({ length: 101 }, (_, i) => ({
      ...room,
      root: "/project-a",
      path: `/project-a/Room${i}.php`,
      label: `Room${String(i).padStart(4, "0")}`,
    })),
    room,
  ];
  fixture.sections = [
    {
      path: "api:request:special",
      relative: "Requests",
      root: "API",
      label: "Special API",
      kind: "request",
      line: 1,
      target: { tool: "api", id: "special" },
    },
  ];
  document.body.innerHTML = '<div id="test"></div>';
  const root = createRoot(document.getElementById("test")!),
    open = vi.fn(),
    close = vi.fn();
  const project = { ...previewProject, roots: ["/project-a", "/project-b"] };
  const render = (key = "first") =>
    root.render(
      <SearchEverywhere
        key={key}
        project={project}
        onOpen={open}
        onClose={close}
      />,
    );
  const active = () =>
    document.querySelector('[role="tab"][aria-selected="true"]')?.textContent;
  const rows = () =>
    document.querySelectorAll('#everywhere-results [role="option"]');
  const key = async (key: string, extra: KeyboardEventInit = {}) => {
    const event = new KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
      ...extra,
    });
    await act(async () =>
      document
        .querySelector<HTMLInputElement>(".quick-open-input input")!
        .dispatchEvent(event),
    );
    return event;
  };
  const type = async (value: string) =>
    act(async () => {
      const input = document.querySelector<HTMLInputElement>(
        ".quick-open-input input",
      )!;
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  try {
    await act(async () => render());
    expect(active()).toBe("All");
    expect(
      [...document.querySelectorAll('[role="tab"]')].map(
        (tab) => tab.textContent,
      ),
    ).toEqual(["All", "project-a", "project-b"]);
    await type("Room");
    expect(rows()).toHaveLength(100);
    expect(
      document.querySelector("#everywhere-results")?.textContent,
    ).not.toContain("Room1000");
    await key("ArrowRight");
    expect(active()).toBe("project-a");
    await key("ArrowDown");
    document.querySelector("#everywhere-results")!.scrollTop = 200;
    await key("ArrowRight");
    expect(active()).toBe("project-b");
    expect(rows()).toHaveLength(1);
    expect(rows()[0].textContent).toContain("Room1000");
    expect(rows()[0].getAttribute("aria-selected")).toBe("true");
    expect(document.querySelector("#everywhere-results")!.scrollTop).toBe(0);
    expect(
      document.querySelector<HTMLInputElement>(".quick-open-input input")
        ?.value,
    ).toBe("Room");
    expect((await key("ArrowLeft", { shiftKey: true })).defaultPrevented).toBe(
      false,
    );
    expect(active()).toBe("project-b");
    await key("ArrowRight");
    expect(active()).toBe("All");
    await type("Special");
    expect(rows()).toHaveLength(1);
    await act(async () =>
      document.querySelectorAll<HTMLButtonElement>('[role="tab"]')[2].click(),
    );
    expect(rows()).toHaveLength(0);
    expect(document.activeElement).toBe(
      document.querySelector(".quick-open-input input"),
    );
    await type("Room");
    await key("Enter");
    expect(open).toHaveBeenCalledWith(room);
    expect(close).toHaveBeenCalledOnce();
    await act(async () => render("reopen"));
    expect(active()).toBe("All");
  } finally {
    await act(async () => root.unmount());
    fixture.entries = null;
    fixture.sections = [];
  }
});
