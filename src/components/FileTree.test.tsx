// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { it, expect, vi } from "vitest";
import FileTree from "./FileTree";
import * as bridge from "../lib/bridge";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
it("shows only the selected root's contents directly and switches between repositories", async () => {
  const files = vi
    .spyOn(bridge, "listDirectory")
    .mockImplementation(async (_project, path) => [
      {
        name: path === "/api" ? "api.php" : "index.ts",
        path: `${path}/${path === "/api" ? "api.php" : "index.ts"}`,
        directory: false,
      },
    ]);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const project = {
    id: "two",
    name: "Two repos",
    roots: ["/api", "/frontend"],
    updatedAt: 0,
  };
  const render = (selectedRoot?: string) => (
    <FileTree
      project={project}
      selectedRoot={selectedRoot}
      onOpen={() => {}}
      onError={() => {}}
    />
  );
  try {
    await act(async () => root.render(render()));
    expect(host.querySelectorAll(".tree-root")).toHaveLength(1);
    expect(host.querySelector(".tree-root")?.getAttribute("data-root")).toBe(
      "/api",
    );
    expect(host.querySelector('.tree-row[title="/api"]')).toBeNull();
    expect(host.textContent).toBe("api.php");
    expect(files.mock.calls.some(([, path]) => path === "/frontend")).toBe(
      false,
    );
    await act(async () => root.render(render("/frontend")));
    expect(host.querySelectorAll(".tree-root")).toHaveLength(1);
    expect(host.querySelector(".tree-root")?.getAttribute("data-root")).toBe(
      "/frontend",
    );
    expect(host.textContent).toBe("index.ts");
    expect(host.querySelector('.tree-row[title="/frontend"]')).toBeNull();
    expect(host.querySelector('[title="/api/api.php"]')).toBeNull();
  } finally {
    await act(async () => root.unmount());
    host.remove();
    files.mockRestore();
  }
});

it("refreshes expanded folders automatically, preserves expansion, and collapses child folders while keeping root contents visible", async () => {
  vi.useFakeTimers();
  const files = vi.spyOn(bridge, "listDirectory");
  files.mockImplementation(async (_project, path) =>
    path === "/app"
      ? [{ name: "Models", path: "/app/Models", directory: true }]
      : [],
  );
  const status = vi
    .spyOn(bridge, "gitStatus")
    .mockResolvedValue({ branch: "main", files: [] });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const project = { id: "auto", name: "Auto", roots: ["/app"], updatedAt: 0 };
  const onError = vi.fn();
  const render = (version: number) => (
    <FileTree
      project={project}
      onOpen={() => {}}
      onError={onError}
      collapseVersion={version}
    />
  );
  try {
    await act(async () => root.render(render(0)));
    await act(async () =>
      host.querySelector<HTMLButtonElement>('[title="/app"]')!.click(),
    );
    await act(async () =>
      host.querySelector<HTMLButtonElement>('[title="/app/Models"]')!.click(),
    );
    files.mockImplementation(async (_project, path) =>
      path === "/app"
        ? [
            { name: "Models", path: "/app/Models", directory: true },
            { name: "new.php", path: "/app/new.php", directory: false },
          ]
        : [],
    );
    await act(async () => vi.advanceTimersByTimeAsync(2000));
    expect(host.textContent).toContain("new.php");
    expect(
      host
        .querySelector('[title="/app/Models"]')!
        .getAttribute("aria-expanded"),
    ).toBe("true");
    await act(async () => root.render(render(1)));
    expect(
      host
        .querySelector('[title="/app/Models"]')!
        .getAttribute("aria-expanded"),
    ).toBe("false");
    expect(host.querySelector('[title="/app/new.php"]')).not.toBeNull();
    files.mockClear();
    await act(async () => vi.advanceTimersByTimeAsync(2000));
    expect(files.mock.calls.map(([, path]) => path)).toEqual(["/app"]);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    files.mockRestore();
    status.mockRestore();
    vi.useRealTimers();
  }
});

it("reveals the active file by expanding only its root and ancestors and scrolling to its highlighted row", async () => {
  const target = "/api/Models/Room.php";
  const files = vi
    .spyOn(bridge, "listDirectory")
    .mockImplementation(async (_project, path) =>
      path === "/api"
        ? [{ path: "/api/Models", name: "Models", directory: true }]
        : path === "/api/Models"
          ? [{ path: target, name: "Room.php", directory: false }]
          : [],
    );
  const status = vi
    .spyOn(bridge, "gitStatus")
    .mockResolvedValue({ branch: "main", files: [] });
  const rectangle = vi
    .spyOn(HTMLElement.prototype, "getBoundingClientRect")
    .mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains("file-tree"))
        return { top: 100, bottom: 300, height: 200 } as DOMRect;
      const offset = this.closest<HTMLElement>(".file-tree")?.scrollTop ?? 0;
      return { top: 500 - offset, bottom: 530 - offset, height: 30 } as DOMRect;
    });
  const height = vi
    .spyOn(HTMLElement.prototype, "clientHeight", "get")
    .mockReturnValue(200);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const done = vi.fn();
  const project = {
    id: "reveal",
    name: "Reveal",
    roots: ["/web", "/api"],
    updatedAt: 0,
  };
  const render = (collapseVersion: number, revision: number) => (
    <FileTree
      project={project}
      active={target}
      revealTarget={{ path: target, revision }}
      onRevealDone={done}
      collapseVersion={collapseVersion}
      onOpen={() => {}}
      onError={() => {}}
    />
  );
  try {
    await act(async () => root.render(render(0, 1)));
    const row = host.querySelector(`[title="${target}"]`)!;
    expect(row.classList.contains("selected")).toBe(true);
    expect(host.querySelector(".tree-root")?.getAttribute("data-root")).toBe(
      "/api",
    );
    expect(
      host
        .querySelector('[title="/api/Models"]')
        ?.getAttribute("aria-expanded"),
    ).toBe("true");
    expect(host.querySelector('[title="/web"]')).toBeNull();
    expect(host.querySelector(".file-tree")?.scrollTop).toBe(230);
    expect(done).toHaveBeenCalledOnce();
    expect(files.mock.calls.some(([, path]) => path === "/web")).toBe(false);
    await act(async () =>
      root.render(
        <FileTree
          project={project}
          active={target}
          collapseVersion={1}
          onOpen={() => {}}
          onError={() => {}}
        />,
      ),
    );
    expect(host.querySelector(`[title="${target}"]`)).toBeNull();
    await act(async () => root.render(render(1, 2)));
    expect(
      host.querySelector(`[title="${target}"]`)?.classList.contains("selected"),
    ).toBe(true);
    expect(done).toHaveBeenCalledTimes(2);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    files.mockRestore();
    status.mockRestore();
    rectangle.mockRestore();
    height.mockRestore();
  }
});
