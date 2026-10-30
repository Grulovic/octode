// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("../lib/bridge", () => ({ desktop: true }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
  Channel: class {
    onmessage: unknown;
  },
}));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ onDragDropEvent: async () => () => {} }),
}));
vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    options: any;
    constructor(options: any) { this.options = options; }
    registerLinkProvider() { return { dispose() {} }; }
    rows = 24;
    cols = 80;
    loadAddon() {}
    open() {}
    focus() {}
    dispose() {}
    writeln() {}
    data?: (value: string) => void;
    onData(callback: (value: string) => void) {
      this.data = callback;
      return { dispose() {} };
    }
    paste(value: string) {
      this.data?.(value);
    }
    onResize() {
      return { dispose() {} };
    }
  },
}));
vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    fit() {}
  },
}));
import LocalTerminal from "./LocalTerminal";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let resolveSession: (id: string) => void;
let rejectSession: (error: Error) => void;
beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  mocks.invoke.mockReset().mockImplementation((command: string) =>
    command === "terminal_create"
      ? new Promise<string>((resolve, reject) => {
          resolveSession = resolve;
          rejectSession = reject;
        })
      : Promise.resolve(),
  );
});
afterEach(() => vi.unstubAllGlobals());
it("sends the command only after its new PTY is ready and never again on visibility or command changes", async () => {
  const host = document.createElement("div"),
    root = createRoot(host),
    error = vi.fn();
  const project = { id: "p", name: "P", roots: ["/api"], updatedAt: 0 };
  const render = (visible: boolean, command = "codex") =>
    root.render(
      <LocalTerminal
        project={project}
        root="/api"
        visible={visible}
        startupCommand={command}
        onError={error}
      />,
    );
  try {
    await act(async () => render(true));
    expect(mocks.invoke.mock.calls.map(([command]) => command)).toEqual([
      "terminal_create",
    ]);
    await act(async () => resolveSession("new-session"));
    expect(mocks.invoke).toHaveBeenCalledWith("terminal_write", {
      id: "new-session",
      data: "codex\r",
    });
    await act(async () => render(false));
    await act(async () => render(true, "different command"));
    expect(
      mocks.invoke.mock.calls.filter(
        ([command]) => command === "terminal_write",
      ),
    ).toHaveLength(1);
    expect(error).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
  }
});
it("closes a late-created session without launching if its tab was already unmounted", async () => {
  const root = createRoot(document.createElement("div"));
  await act(async () =>
    root.render(
      <LocalTerminal
        project={{ id: "p", name: "P", roots: ["/api"], updatedAt: 0 }}
        root="/api"
        visible
        startupCommand="codex"
        onError={() => {}}
      />,
    ),
  );
  await act(async () => root.unmount());
  await act(async () => resolveSession("late"));
  expect(mocks.invoke).toHaveBeenCalledWith("terminal_close", { id: "late" });
  expect(
    mocks.invoke.mock.calls.some(([command]) => command === "terminal_write"),
  ).toBe(false);
});
it("reports shell creation failure without writing the launch command", async () => {
  const root = createRoot(document.createElement("div")),
    error = vi.fn();
  try {
    await act(async () =>
      root.render(
        <LocalTerminal
          project={{ id: "p", name: "P", roots: ["/api"], updatedAt: 0 }}
          root="/api"
          visible
          startupCommand="codex"
          onError={error}
        />,
      ),
    );
    await act(async () => rejectSession(new Error("Shell unavailable")));
    expect(error).toHaveBeenCalledWith("Error: Shell unavailable");
    expect(
      mocks.invoke.mock.calls.some(([command]) => command === "terminal_write"),
    ).toBe(false);
  } finally {
    await act(async () => root.unmount());
  }
});

it("drops a file path into the live PTY as a quoted paste without Enter", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host),
    onError = vi.fn();
  try {
    await act(async () =>
      root.render(
        <LocalTerminal
          project={{
            id: "drop",
            name: "Drop",
            roots: ["/project"],
            updatedAt: 0,
          }}
          root="/project"
          visible
          onError={onError}
        />,
      ),
    );
    await act(async () => resolveSession("drop-session"));
    const event = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", {
      value: {
        types: ["application/x-octode-paths"],
        getData: () => JSON.stringify(["/project/a b.php"]),
      },
    });
    await act(async () =>
      host.querySelector(".terminal-mount")!.dispatchEvent(event),
    );
    expect(mocks.invoke).toHaveBeenCalledWith("terminal_write", {
      id: "drop-session",
      data: "'/project/a b.php' ",
    });
    expect(onError).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it("starts a home terminal without a project ID while keeping project requests scoped", async () => {
  const { HOME_TERMINAL_ID } = await import("../lib/terminalHome");
  const host = document.createElement("div"), root = createRoot(host);
  try {
    await act(async () => root.render(<LocalTerminal project={{ id: HOME_TERMINAL_ID, name: "Home", roots: ["/home/user"], updatedAt: 0 }} root="/home/user" visible onError={vi.fn()} />));
    expect(mocks.invoke).toHaveBeenCalledWith("terminal_create", expect.objectContaining({ request: expect.objectContaining({ projectId: null, root: "/home/user" }) }));
    await act(async () => resolveSession("home-session"));
  } finally { await act(async () => root.unmount()); }
});
