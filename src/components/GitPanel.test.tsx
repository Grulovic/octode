// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const harness = vi.hoisted(() => ({
  invoke: vi.fn(),
  branch: "main",
  failure: "",
  entries: [] as any[],
}));
vi.mock("../lib/bridge", () => ({
  desktop: true,
  invoke: (...args: any[]) => harness.invoke(...args),
}));
vi.mock("../editor/runtime", () => ({
  monaco: {
    editor: {
      defineTheme: () => {},
      colorize: async () => "",
      tokenize: (source: string) =>
        source.split("\n").map(() => [{ offset: 0, type: "keyword" }]),
    },
  },
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ confirm: async () => true }));
import GitPanel from "./GitPanel";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
const props = {
  project: { id: "p", name: "Test", roots: ["/project/api"], updatedAt: 0 },
  root: "/project/api",
  visible: true,
  revision: 0,
  onError: vi.fn(),
  beforeAction: vi.fn(async () => true),
  onChanged: vi.fn(async () => {}),
  onBusy: vi.fn(),
  onOpen: vi.fn(async () => {}),
  renderMerge: () => null,
  onChooseVersion: vi.fn(),
};
beforeEach(() => {
  harness.branch = "main";
  harness.failure = "";
  harness.entries = [];
  harness.invoke.mockReset();
  props.onError.mockClear();
  harness.invoke.mockImplementation(async (command, args) => {
    if (command === "git_snapshot")
      return {
        branch: harness.branch,
        head: "abc",
        entries: harness.entries,
        branches: ["main", "feature"],
        remotes: [],
        stagedRevision: "",
        merging: false,
        history: [],
      };
    if (command === "git_action") {
      if (harness.failure) throw new Error(harness.failure);
      harness.branch = args.request.value;
      return "Switched to branch feature";
    }
  });
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById("root")!);
});
afterEach(async () => {
  await act(async () => root.unmount());
});
const switchBranch = async () => {
  const selector = document.querySelector<HTMLSelectElement>(
    '[aria-label="Switch branch in api"]',
  )!;
  await act(async () => {
    selector.value = "feature";
    selector.dispatchEvent(new Event("change", { bubbles: true }));
  });
  return selector;
};
it("switches the selected folder's branch directly and refreshes its displayed branch", async () => {
  await act(async () => root.render(<GitPanel {...props} />));
  const selector = await switchBranch();
  expect(harness.invoke).toHaveBeenCalledWith(
    "git_action",
    expect.objectContaining({
      root: "/project/api",
      request: expect.objectContaining({
        action: "switch",
        value: "feature",
        expectedHead: "abc",
      }),
    }),
  );
  expect(selector.value).toBe("feature");
  expect(document.querySelector('[role="status"]')?.textContent).toContain(
    "Switched",
  );
});
it("keeps the old branch and shows the reason if Git refuses the switch", async () => {
  harness.failure = "Your local changes would be overwritten";
  await act(async () => root.render(<GitPanel {...props} />));
  const selector = await switchBranch();
  expect(selector.value).toBe("main");
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(
    "would be overwritten",
  );
});

it("shows a colored side-by-side comparison and stages the unchanged original patch selection", async () => {
  const patch =
    "diff --git a/test.php b/test.php\n--- a/test.php\n+++ b/test.php\n@@ -10 +10 @@\n-return 1;\n+return 2;\n";
  harness.entries = [
    {
      path: "test.php",
      originalPath: null,
      index: " ",
      worktree: "M",
      conflict: false,
    },
  ];
  const invoke = harness.invoke.getMockImplementation()!;
  harness.invoke.mockImplementation(async (command, args) =>
    command === "git_hunks"
      ? {
          patch,
          header: patch.split("@@")[0],
          hunks: ["@@ -10 +10 @@\n-return 1;\n+return 2;\n"],
          supported: true,
        }
      : command === "git_apply_hunks"
        ? "staged"
        : invoke(command, args),
  );
  await act(async () => root.render(<GitPanel {...props} />));
  await act(async () =>
    document.querySelector<HTMLButtonElement>(".git-change > button")!.click(),
  );
  expect(document.querySelector('[aria-label="Git diff"]')).not.toBeNull();
  expect(document.querySelector(".git-diff-code.removed")?.textContent).toBe(
    "return 1;",
  );
  expect(document.querySelector(".git-diff-code.added")?.textContent).toBe(
    "return 2;",
  );
  expect(document.querySelector(".removed .git-word-change")?.textContent).toBe(
    "1",
  );
  expect(document.querySelector(".added .git-word-change")?.textContent).toBe(
    "2",
  );
  expect(document.querySelector(".git-diff-number")?.textContent).toContain(
    "10",
  );
  expect(
    document.querySelector(".git-diff-code span")?.getAttribute("style"),
  ).toContain("color");
  await act(async () =>
    document.querySelector<HTMLInputElement>(".git-hunk input")!.click(),
  );
  await act(async () =>
    document
      .querySelector<HTMLButtonElement>(
        ".code-review-modal footer .primary-button",
      )!
      .click(),
  );
  expect(harness.invoke).toHaveBeenCalledWith(
    "git_apply_hunks",
    expect.objectContaining({
      request: expect.objectContaining({
        reviewedPatch: patch,
        selected: [0],
        staged: false,
      }),
    }),
  );
});

it.each([null, "commit", "push"] as const)(
  "commits then pushes with refreshed guards and handles %s failure",
  async (failure) => {
    let committed = false;
    harness.invoke.mockImplementation(async (command, args) => {
      if (command === "git_snapshot")
        return {
          branch: "main",
          head: committed ? "new-head" : "old-head",
          entries: [],
          branches: ["main"],
          remotes: ["origin"],
          stagedRevision: committed ? "" : "reviewed-index",
          merging: false,
          history: [],
        };
      if (command === "git_action") {
        if (args.request.action === failure)
          throw new Error(`${failure} rejected`);
        if (args.request.action === "commit") committed = true;
        return "done";
      }
    });
    await act(async () => root.render(<GitPanel {...props} />));
    const message = document.querySelector<HTMLTextAreaElement>(
      '[aria-label="Commit message"]',
    )!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )!.set!.call(message, "Fix rooms");
      message.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const button = [
      ...document.querySelectorAll<HTMLButtonElement>(
        ".git-commit-actions button",
      ),
    ][1];
    expect(button.disabled).toBe(false);
    await act(async () => button.click());
    expect(
      harness.invoke.mock.calls.filter(([command]) => command === "git_action"),
    ).toHaveLength(0);
    const dialog = document.querySelector('[aria-label="Commit and push"]')!;
    expect(dialog.textContent).toContain("main");
    await act(async () =>
      dialog.querySelector<HTMLButtonElement>('button[type="submit"]')!.click(),
    );
    const actions = harness.invoke.mock.calls
      .filter(([command]) => command === "git_action")
      .map(([, args]) => args.request);
    expect(actions[0]).toMatchObject({
      action: "commit",
      value: "Fix rooms",
      expectedHead: "old-head",
      expectedStaged: "reviewed-index",
    });
    if (failure === "commit") {
      expect(actions).toHaveLength(1);
      expect(message.value).toBe("Fix rooms");
      expect(document.querySelector('[role="alert"]')?.textContent).toContain(
        "commit rejected",
      );
    } else {
      expect(actions[1]).toMatchObject({
        action: "push",
        remote: "origin",
        expectedHead: "new-head",
        expectedStaged: "",
      });
      expect(message.value).toBe("");
      if (failure === "push")
        expect(document.querySelector('[role="alert"]')?.textContent).toContain(
          "Commit succeeded locally, but push failed",
        );
      else
        expect(
          document.querySelector('[role="status"]')?.textContent,
        ).toContain("Committed and pushed main to origin");
    }
  },
);
it("keeps Commit local and disables Commit and Push when no remote is configured", async () => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
  const original = harness.invoke.getMockImplementation()!;
  harness.invoke.mockImplementation(async (command, args) => {
    if (command === "git_snapshot")
      return {
        ...(await original(command, args)),
        stagedRevision: "reviewed-index",
      };
    if (command === "git_action") return "Commit completed";
  });
  try {
    await act(async () => root.render(<GitPanel {...props} />));
    const message = document.querySelector<HTMLTextAreaElement>(
      '[aria-label="Commit message"]',
    )!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )!.set!.call(message, "Local commit");
      message.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const buttons = document.querySelectorAll<HTMLButtonElement>(
      ".git-commit-actions button",
    );
    expect(buttons[0].textContent).toBe("Commit");
    expect(buttons[1].textContent).toBe("Commit & Push…");
    expect(document.body.textContent).not.toContain("Commit staged changes");
    expect(buttons[0].disabled).toBe(false);
    expect(buttons[1].disabled).toBe(true);
    await act(async () => buttons[0].click());
    expect(
      harness.invoke.mock.calls
        .filter(([command]) => command === "git_action")
        .map(([, args]) => args.request.action),
    ).toEqual(["commit"]);
  } finally {
    confirm.mockRestore();
  }
});

it.each([
  ["Select all", "stage", " ", "M"],
  ["Deselect all", "unstage", "M", " "],
])(
  "%s applies to every file in its group, excluding conflicts",
  async (label, action, index, worktree) => {
    harness.entries = [
      { path: "first.php", index, worktree, conflict: false },
      { path: "second.php", index, worktree, conflict: false },
      { path: "conflict.php", index: "U", worktree: "U", conflict: true },
    ];
    const originalInvoke = harness.invoke.getMockImplementation()!;
    harness.invoke.mockImplementation(async (command, args) => {
      if (command !== "git_action") return originalInvoke(command, args);
      const entry = harness.entries.find(
        (entry) => entry.path === args.request.path,
      )!;
      entry.index = action === "stage" ? "M" : " ";
      entry.worktree = action === "stage" ? " " : "M";
      return "Done";
    });
    await act(async () => root.render(<GitPanel {...props} />));
    const button = [...document.querySelectorAll("button")].find(
      (button) => button.textContent === label,
    )!;
    expect(button.disabled).toBe(false);
    await act(async () => button.click());
    const requests = harness.invoke.mock.calls.filter(
      ([command]) => command === "git_action",
    );
    expect(requests.map(([, args]) => args.request.path)).toEqual([
      "first.php",
      "second.php",
    ]);
    for (const [, args] of requests) {
      expect(args).toMatchObject({
        projectId: "p",
        root: "/project/api",
        request: { action, expectedHead: "abc" },
      });
    }
    expect(button.disabled).toBe(true);
    expect(document.querySelectorAll(".git-group-heading button:not([aria-expanded])")).toHaveLength(
      2,
    );
  },
);

it("opens a diff in the editor host while keeping staging controls available", async () => {
  harness.entries = [{ path: "test.php", index: " ", worktree: "M", conflict: false }];
  const original = harness.invoke.getMockImplementation()!;
  harness.invoke.mockImplementation(async (command, args) => command === "git_hunks"
    ? { patch: "@@ -1 +1 @@\n-before\n+after\n", header: "", hunks: ["@@ -1 +1 @@\n-before\n+after\n"], supported: true }
    : original(command, args));
  const editorHost = document.createElement("section");
  document.body.append(editorHost);
  await act(async () => root.render(<GitPanel {...props} overlayHost={editorHost} />));
  await act(async () => document.querySelector<HTMLButtonElement>(".git-change > button")!.click());
  expect(editorHost.querySelector('[aria-label="Git diff"]')).not.toBeNull();
  expect(document.querySelector(".git-group-heading button:not([aria-expanded])")).not.toBeNull();
  await act(async () => editorHost.querySelector<HTMLButtonElement>('[aria-label="Close Git diff"]')!.click());
  expect(editorHost.querySelector('[aria-label="Git diff"]')).toBeNull();
});
