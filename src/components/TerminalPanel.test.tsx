// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import TerminalPanel from "./TerminalPanel";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
async function chooseFolder(host: HTMLElement, label: string, name: string) {
  await act(async () => host.querySelector<HTMLButtonElement>(`[role="combobox"][aria-label="${label}"]`)!.click());
  const option = [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')].find((item) => item.textContent === name)!;
  expect(option).toBeTruthy();
  await act(async () => option.click());
}

it("middle-click closes only its terminal and respects cancellation", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  try {
    await act(async () =>
      root.render(
        <TerminalPanel
          project={{ id: "p", name: "P", roots: ["/project"], updatedAt: 0 }}
          initialRoot="/project"
          visible
          onError={() => {}}
          onHide={() => {}}
        />,
      ),
    );
    await chooseFolder(host, "New terminal", "project");
    const tabs = () =>
      host.querySelectorAll<HTMLElement>(".local-terminal-tabs > div");
    expect(tabs()).toHaveLength(2);
    await act(async () =>
      tabs()[0].dispatchEvent(
        new MouseEvent("auxclick", {
          button: 1,
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(tabs()).toHaveLength(2);
    confirm.mockReturnValue(true);
    await act(async () =>
      tabs()[0].dispatchEvent(
        new MouseEvent("mouseup", {
          button: 1,
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(tabs()).toHaveLength(1);
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(tabs()[0].classList.contains("selected")).toBe(true);
    expect(
      host.querySelector('[aria-label="Resize local terminal"]'),
    ).not.toBeNull();
  } finally {
    await act(async () => root.unmount());
    host.remove();
    confirm.mockRestore();
  }
});
it("Cmd+W closes the focused terminal tab only after confirmation", async () => {
  const { installCloseTabShortcut } = await import("../lib/closeTab");
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  const time = vi.spyOn(performance, "now").mockReturnValue(2_000_000);
  const stop = installCloseTabShortcut();
  try {
    await act(async () =>
      root.render(
        <TerminalPanel
          project={{ id: "p", name: "P", roots: ["/project"], updatedAt: 0 }}
          initialRoot="/project"
          visible
          onError={() => {}}
          onHide={() => {}}
        />,
      ),
    );
    host
      .querySelector<HTMLButtonElement>(".local-terminal-tabs button")!
      .focus();
    const close = async () =>
      act(async () => {
        window.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "w",
            metaKey: true,
            cancelable: true,
          }),
        );
      });
    await close();
    expect(host.querySelectorAll(".local-terminal-tabs > div")).toHaveLength(1);
    expect(confirm).toHaveBeenCalledOnce();
    confirm.mockReturnValue(true);
    time.mockReturnValue(2_001_000);
    await close();
    expect(host.querySelectorAll(".local-terminal-tabs > div")).toHaveLength(0);
    expect(host.querySelector(".terminal-panel")).not.toBeNull();
  } finally {
    stop();
    await act(async () => root.unmount());
    host.remove();
    confirm.mockRestore();
    time.mockRestore();
  }
});

it("launches in a fresh tab once per request and rejects unavailable roots or full capacity", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host),
    onError = vi.fn(),
    handled = vi.fn();
  const project = {
    id: "launch",
    name: "Launch",
    roots: ["/api", "/frontend"],
    updatedAt: 0,
  };
  const render = (id: number, path = "/frontend") =>
    root.render(
      <TerminalPanel
        project={project}
        initialRoot="/api"
        visible
        onHide={() => {}}
        onError={onError}
        launchRequest={{ id, root: path, command: "codex --resume" }}
        onLaunchHandled={handled}
      />,
    );
  const tabs = () => host.querySelectorAll(".local-terminal-tabs > div");
  try {
    await act(async () => render(1));
    expect(tabs()).toHaveLength(2);
    expect(tabs()[0].textContent).toBe("api 1");
    expect(tabs()[1].classList.contains("selected")).toBe(true);
    expect(tabs()[1].querySelector("button")?.title).toBe("/frontend");
    expect(handled).toHaveBeenCalledExactlyOnceWith(1);
    await act(async () => render(1));
    expect(tabs()).toHaveLength(2);
    await act(async () => render(2, "/unregistered"));
    expect(tabs()).toHaveLength(2);
    expect(onError).toHaveBeenLastCalledWith(
      expect.stringContaining("available project folder"),
    );
    for (let id = 3; id <= 6; id++) await act(async () => render(id));
    expect(tabs()).toHaveLength(6);
    await act(async () => render(7));
    expect(tabs()).toHaveLength(6);
    expect(onError).toHaveBeenLastCalledWith(
      expect.stringContaining("six terminal tabs"),
    );
    expect(handled).toHaveBeenLastCalledWith(7);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it("Cmd/Ctrl+T opens plain tabs only in the focused visible terminal and respects the tab limit", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const outside = document.createElement("input");
  document.body.append(outside);
  const root = createRoot(host),
    onError = vi.fn();
  const project = {
    id: "shortcut",
    name: "Shortcut",
    roots: ["/api", "/frontend"],
    updatedAt: 0,
  };
  const render = (visible = true) =>
    root.render(
      <TerminalPanel
        project={project}
        initialRoot="/api"
        visible={visible}
        onError={onError}
        onHide={() => {}}
      />,
    );
  const tabs = () => host.querySelectorAll(".local-terminal-tabs > div");
  const focus = () =>
    host
      .querySelector<HTMLButtonElement>(".local-terminal-tabs button")!
      .focus();
  const key = async (extra: KeyboardEventInit = {}) => {
    const event = new KeyboardEvent("keydown", {
      key: "t",
      metaKey: true,
      bubbles: true,
      cancelable: true,
      ...extra,
    });
    await act(async () => window.dispatchEvent(event));
    return event;
  };
  try {
    await act(async () => render());
    outside.focus();
    expect((await key()).defaultPrevented).toBe(false);
    expect(tabs()).toHaveLength(1);
    focus();
    expect((await key()).defaultPrevented).toBe(true);
    expect(tabs()).toHaveLength(2);
    expect(tabs()[1].querySelector("button")?.title).toBe("/api");
    expect(tabs()[1].classList.contains("selected")).toBe(true);
    await key({ repeat: true });
    await key({ shiftKey: true });
    expect(tabs()).toHaveLength(2);
    await key({ metaKey: false, ctrlKey: true });
    expect(tabs()).toHaveLength(3);
    const modal = document.createElement("div");
    modal.setAttribute("aria-modal", "true");
    document.body.append(modal);
    await key();
    expect(tabs()).toHaveLength(3);
    modal.remove();
    await act(async () => render(false));
    await key();
    expect(tabs()).toHaveLength(3);
    await act(async () => render());
    focus();
    for (let i = 0; i < 4; i++) await key();
    expect(tabs()).toHaveLength(6);
    expect(onError).toHaveBeenCalledWith(
      expect.stringContaining("six terminal tabs"),
    );
    expect(host.textContent).not.toContain("Launch command:");
  } finally {
    await act(async () => root.unmount());
    host.remove();
    outside.remove();
  }
});

it("Cmd+T creates the first session from an empty pane without needing an existing tab to focus", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const outside = document.createElement("input");
  document.body.append(outside);
  const root = createRoot(host),
    confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
  const project = {
    id: "empty",
    name: "Empty",
    roots: ["/project"],
    updatedAt: 0,
  };
  const render = (visible = true) =>
    root.render(
      <TerminalPanel
        project={project}
        initialRoot="/project"
        visible={visible}
        onError={() => {}}
        onHide={() => {}}
      />,
    );
  const count = () =>
    host.querySelectorAll(".local-terminal-tabs > div").length;
  const key = async () => {
    const event = new KeyboardEvent("keydown", {
      key: "t",
      metaKey: true,
      cancelable: true,
    });
    await act(async () => window.dispatchEvent(event));
    return event;
  };
  try {
    await act(async () => render());
    await act(async () =>
      host
        .querySelector<HTMLButtonElement>('[aria-label="Close terminal 1"]')!
        .click(),
    );
    expect(count()).toBe(0);
    expect(document.activeElement).toBe(host.querySelector(".terminal-panel"));
    const modal = document.createElement("div");
    modal.setAttribute("aria-modal", "true");
    document.body.append(modal);
    expect((await key()).defaultPrevented).toBe(false);
    expect(count()).toBe(0);
    modal.remove();
    await act(async () => render(false));
    expect((await key()).defaultPrevented).toBe(false);
    expect(count()).toBe(0);
    await act(async () => render());
    outside.focus();
    expect((await key()).defaultPrevented).toBe(true);
    expect(count()).toBe(1);
    expect(
      host
        .querySelector(".local-terminal-tabs > div")
        ?.classList.contains("selected"),
    ).toBe(true);
  } finally {
    await act(async () => root.unmount());
    confirm.mockRestore();
    host.remove();
    outside.remove();
  }
});

it("AI star offers folders and launches the current configured command on selection", async () => {
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  const key = "octode-editor-settings", previous = localStorage.getItem(key);
  try {
    localStorage.setItem(key, JSON.stringify({ version: 1, terminalCommand: "codex --resume" }));
    await act(async () => root.render(<TerminalPanel project={{ id: "ai", name: "AI", roots: ["/api", "/frontend"], updatedAt: 0 }} initialRoot="/api" visible onError={() => {}} onHide={() => {}} />));
    const tabs = () => host.querySelectorAll(".local-terminal-tabs > div");
    const star = host.querySelector<HTMLButtonElement>('[role="combobox"][aria-label="New AI terminal"]')!;
    await act(async () => star.click()); expect(tabs()).toHaveLength(1);
    const option = [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')].find((item) => item.textContent === "frontend")!;
    await act(async () => option.click());
    expect(tabs()).toHaveLength(2); expect(tabs()[1].classList.contains("selected")).toBe(true);
    expect(tabs()[1].querySelector("button")?.title).toBe("/frontend");
    expect(host.textContent).toContain("codex --resume");
    expect(document.querySelector('[role="listbox"]')).toBeNull();
    localStorage.setItem(key, JSON.stringify({ version: 1, terminalCommand: "claude" }));
    await chooseFolder(host, "New AI terminal", "api");
    expect(tabs()).toHaveLength(3); expect(host.textContent).toContain("claude");
    for (let count = 0; count < 3; count++) await chooseFolder(host, "New AI terminal", "api");
    expect(tabs()).toHaveLength(6); expect(star.disabled).toBe(true);
    await act(async () => star.click()); expect(tabs()).toHaveLength(6);
  } finally {
    if (previous === null) localStorage.removeItem(key); else localStorage.setItem(key, previous);
    await act(async () => root.unmount()); host.remove();
  }
});

it("plus launches in the chosen folder and Cmd+T always follows the active Code folder", async () => {
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  const project = { id: "folders", name: "Folders", roots: ["/api", "/frontend"], updatedAt: 0 };
  const render = (folder: string) => root.render(<TerminalPanel project={project} initialRoot={folder} visible onError={() => {}} onHide={() => {}} />);
  const tabs = () => host.querySelectorAll(".local-terminal-tabs > div");
  const shortcut = async () => {
    host.querySelector<HTMLButtonElement>(".local-terminal-tabs button")!.focus();
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "t", metaKey: true, cancelable: true, bubbles: true })));
  };
  try {
    await act(async () => render("/api"));
    const plus = host.querySelector<HTMLButtonElement>('[role="combobox"][aria-label="New terminal"]')!;
    await act(async () => plus.click()); expect(tabs()).toHaveLength(1);
    await act(async () => plus.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(tabs()).toHaveLength(1); expect(document.querySelector('[role="listbox"]')).toBeNull();
    await chooseFolder(host, "New terminal", "frontend");
    expect(tabs()[1].querySelector("button")?.title).toBe("/frontend");
    await shortcut(); expect(tabs()[2].querySelector("button")?.title).toBe("/api");
    await act(async () => render("/frontend"));
    await shortcut(); expect(tabs()[3].querySelector("button")?.title).toBe("/frontend");
    expect(tabs()[0].querySelector("button")?.title).toBe("/api");
  } finally { await act(async () => root.unmount()); host.remove(); }
});
