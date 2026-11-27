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
import { closeActiveTab } from "../lib/closeTab";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
const props = {
  project: { id: "p", name: "Test", roots: ["/project/api"], updatedAt: 0 },
  root: "/project/api",
  visible: true,
  revision: 0,
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
it("offers remote tracking checkout without treating remote refs as local branches", async () => {
  const original = harness.invoke.getMockImplementation()!;
  harness.invoke.mockImplementation(async (command, args) => {
    if (command === "git_snapshot") return {
      ...await original(command, args),
      branches: harness.branch === "master" ? ["main", "feature", "master"] : ["main", "feature"],
      remoteBranches: [
        { name: "origin/master", localName: "master" },
        { name: "origin/main", localName: "main" },
      ],
    };
    if (command === "git_action") {
      harness.branch = "master";
      return "Tracking origin/master";
    }
    return original(command, args);
  });
  await act(async () => root.render(<GitPanel {...props} />));
  const trigger = document.querySelector<HTMLButtonElement>('button[aria-label="Switch branch in api"]')!;
  await act(async () => trigger.click());
  const options = [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')];
  expect(options.find((option) => option.textContent?.includes("origin/main"))?.disabled).toBe(true);
  await act(async () => options.find((option) => option.textContent?.includes("origin/master"))!.click());
  expect(harness.invoke).toHaveBeenCalledWith("git_action", expect.objectContaining({
    root: "/project/api",
    request: expect.objectContaining({ action: "track-branch", value: "origin/master", expectedHead: "abc" }),
  }));
  expect(trigger.textContent).toContain("master");
});

it("keeps the old branch and shows a dismissible failure in the Git workspace", async () => {
  harness.failure = "Your local changes would be overwritten.\n  src/config.ts\nCommit or stash your changes before switching.";
  const editorHost = document.createElement("section");
  document.body.append(editorHost);
  await act(async () => root.render(<GitPanel {...props} overlayHost={editorHost} />));
  const selector = await switchBranch();
  expect(selector.value).toBe("main");
  const alert = editorHost.querySelector('[role="alert"]')!;
  expect(alert.querySelector("strong")?.textContent).toBe("Couldn’t switch branches");
  expect(alert.querySelector("p")?.textContent).toBe(harness.failure);
  expect(document.querySelector('.git-tools [role="alert"]')).toBeNull();
  await act(async () => editorHost.querySelector<HTMLButtonElement>('[aria-label="Dismiss Git message"]')!.click());
  expect(editorHost.querySelector('[role="alert"]')).toBeNull();
});

it("shows repository loading errors in Git and retries the snapshot", async () => {
  harness.invoke.mockRejectedValueOnce("Not a Git repository");
  const editorHost = document.createElement("section");
  document.body.append(editorHost);
  await act(async () => root.render(<GitPanel {...props} overlayHost={editorHost} />));
  expect(editorHost.querySelector('[role="alert"]')?.textContent).toContain("Not a Git repository");
  const retry = [...editorHost.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Retry")!;
  await act(async () => retry.click());
  expect(editorHost.querySelector('[role="alert"]')).toBeNull();
  expect(editorHost.textContent).toContain("No working tree changes.");
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
      expect(message.value).toBe("Fix rooms");
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
  ["Select all", "stage-many", " ", "M"],
  ["Deselect all", "unstage-many", "M", " "],
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
      for (const entry of harness.entries.filter((entry) => args.request.paths.includes(entry.path))) {
        entry.index = action === "stage-many" ? "M" : " ";
        entry.worktree = action === "stage-many" ? " " : "M";
      }
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
    expect(requests).toHaveLength(1);
    expect(requests[0][1].request.paths).toEqual(["first.php", "second.php"]);
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
  expect(editorHost.querySelector('[aria-label="Git diff"]')?.getAttribute("aria-modal")).toBeNull();
  expect(editorHost.querySelector('[aria-label="Git diff"]')).not.toBeNull();
  expect(editorHost.querySelector('[aria-label="Repository controls"]')).not.toBeNull();
  expect(document.querySelector(".git-group-heading button:not([aria-expanded])")).not.toBeNull();
  await act(async () => closeActiveTab());
  expect(editorHost.querySelector('[aria-label="Git diff"]')).toBeNull();
});

it("opens a conflict in the same editor pane and replaces it when a diff is selected", async () => {
  harness.entries = [
    { path: "conflict.ts", index: "U", worktree: "U", conflict: true },
    { path: "changed.ts", index: " ", worktree: "M", conflict: false },
  ];
  const original = harness.invoke.getMockImplementation()!;
  harness.invoke.mockImplementation(async (command, args) => {
    if (command === "git_conflict") return { base: "base", ours: "local", theirs: "incoming" };
    if (command === "git_hunks") return { patch: "", header: "", hunks: [], supported: false };
    return original(command, args);
  });
  const editorHost = document.createElement("section");
  document.body.append(editorHost);
  await act(async () => root.render(<GitPanel {...props} overlayHost={editorHost} renderMerge={() => "Result editor"} />));
  const [conflict, change] = document.querySelectorAll<HTMLButtonElement>(".git-change > button:first-child");
  await act(async () => conflict.click());
  expect(editorHost.querySelector('[aria-label="Merge conflict"]')?.textContent).toContain("Result editor");
  expect(conflict.getAttribute("aria-pressed")).toBe("true");
  await act(async () => change.click());
  expect(editorHost.querySelector('[aria-label="Merge conflict"]')).toBeNull();
  expect(editorHost.querySelector('[aria-label="Git diff"]')).not.toBeNull();
});

it("renders recent commits as read-only per-file before/after comparisons", async () => {
  const original = harness.invoke.getMockImplementation()!;
  harness.invoke.mockImplementation(async (command, args) => {
    if (command === "git_snapshot") return { ...await original(command, args), history: [{ hash: "a".repeat(40), subject: "Example commit", author: "Test", date: "2026-10-30" }] };
    if (command === "git_show_commit") return "commit example\n\ndiff --git a/example.ts b/example.ts\n--- a/example.ts\n+++ b/example.ts\n@@ -1 +1 @@\n-oldValue\n+newValue\ndiff --git a/picture.png b/picture.png\nBinary files a/picture.png and b/picture.png differ\n";
    return original(command, args);
  });
  await act(async () => root.render(<GitPanel {...props} />));
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Git sidebar view"] > button:nth-child(2)')!.click());
  await act(async () => document.querySelector<HTMLButtonElement>(".git-history")!.click());
  const dialog = document.querySelector('[aria-label="Git diff"]')!;
  expect(dialog.querySelector('[aria-label="Code changes before and after"]')).not.toBeNull();
  expect(dialog.textContent).toContain("example.ts");
  expect(dialog.textContent).toContain("oldValue"); expect(dialog.textContent).toContain("newValue");
  expect(dialog.textContent).toContain("Binary files");
  expect(dialog.querySelector('input[type="checkbox"]')).toBeNull();
  expect(dialog.textContent).not.toContain("Stage selected hunks");
});

it("prefills the latest recent message and preserves edits across refreshes and commits", async () => {
  const original = harness.invoke.getMockImplementation()!;
  harness.invoke.mockImplementation(async (command, args) => {
    if (command === "git_snapshot") return {
      ...await original(command, args),
      stagedRevision: "reviewed-index",
      history: [{ hash: "a".repeat(40), subject: args.root === props.root ? "Latest message" : "Other repository", author: "Test", date: "2026-11-03" }],
    };
    if (command === "git_action") return "Committed";
    return original(command, args);
  });
  await act(async () => root.render(<GitPanel {...props} />));
  const message = document.querySelector<HTMLTextAreaElement>('[aria-label="Commit message"]')!;
  expect(message.value).toBe("Latest message");
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(message, "My next message");
    message.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => root.render(<GitPanel {...props} revision={1} />));
  expect(message.value).toBe("My next message");
  await act(async () => document.querySelector<HTMLButtonElement>(".git-commit-actions button")!.click());
  expect(harness.invoke).toHaveBeenCalledWith("git_action", expect.objectContaining({ request: expect.objectContaining({ action: "commit", value: "My next message" }) }));
  expect(message.value).toBe("My next message");
  await act(async () => root.render(<GitPanel {...props} root="/project/other" />));
  expect(document.querySelector<HTMLTextAreaElement>('[aria-label="Commit message"]')!.value).toBe("Other repository");
});

it("shows actions for the selected local branch and keeps a failed rename editable", async () => {
  const original = harness.invoke.getMockImplementation()!;
  harness.invoke.mockImplementation(async (command, args) => {
    if (command === "git_action") throw new Error("Branch name already exists");
    return original(command, args);
  });
  await act(async () => root.render(<GitPanel {...props} />));
  const click = (selector: string, label: string) => act(async () => {
    [...document.querySelectorAll<HTMLButtonElement>(selector)]
      .find((button) => button.textContent?.trim() === label)!.click();
  });
  await click(".git-sidebar-views button", "Branches");
  const detail = document.querySelector('[aria-label="Branch details"]')!;
  expect(detail.textContent).toContain("Current branch");
  expect(detail.textContent).not.toContain("Delete…");
  expect(document.querySelector(".git-branch-form")).toBeNull();

  await act(async () => document.querySelector<HTMLButtonElement>('.git-branch-row[title="feature"]')!.click());
  expect(detail.textContent).toContain("Merge into main…");
  expect(detail.textContent).toContain("Delete…");
  await click(".git-branch-actions button", "Rename…");
  const form = detail.querySelector("form")!;
  const name = form.querySelector("input")!;
  expect(name.value).toBe("feature");
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(name, "updated");
    name.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await click(".git-branch-actions button", "Rename branch");
  expect(harness.invoke).toHaveBeenCalledWith("git_action", expect.objectContaining({
    request: expect.objectContaining({ action: "rename-branch", path: "feature", value: "updated", expectedHead: "abc" }),
  }));
  expect(document.querySelector('.git-main [role="alert"]')?.textContent).toContain("Branch name already exists");
  expect(name.value).toBe("updated");
});

it("applies and drops individually selected stashes using immutable hashes", async () => {
  const original = harness.invoke.getMockImplementation()!;
  const stashes = [{ reference: "stash@{0}", hash: "a".repeat(40), subject: "Newest changes" }, { reference: "stash@{1}", hash: "b".repeat(40), subject: "Older changes" }];
  harness.invoke.mockImplementation(async (command, args) => {
    if (command === "git_snapshot") return { ...await original(command, args), stashes };
    if (command === "git_action") return "Done";
    return original(command, args);
  });
  await act(async () => root.render(<GitPanel {...props} />));
  const rows = document.querySelectorAll('.git-stash-row'); expect(rows).toHaveLength(2);
  await act(async () => rows[1].querySelector<HTMLButtonElement>('button[title="Apply and keep this stash"]')!.click());
  expect(harness.invoke).toHaveBeenCalledWith("git_action", expect.objectContaining({ request: expect.objectContaining({ action: "stash-apply", path: "stash@{1}", value: "b".repeat(40) }) }));
  await act(async () => document.querySelectorAll('.git-stash-row')[0].querySelector<HTMLButtonElement>('.danger-outline')!.click());
  expect(harness.invoke).toHaveBeenCalledWith("git_action", expect.objectContaining({ request: expect.objectContaining({ action: "stash-drop", path: "stash@{0}", value: "a".repeat(40) }) }));
});

it.each([
  [{ name: "origin/master", ahead: 2, behind: 3, gone: false }, "main", "abc", "origin/master · ↑2 ↓3"],
  [{ name: "origin/master", ahead: 0, behind: 0, gone: false }, "main", "abc", "up to date"],
  [{ name: "origin/master", ahead: null, behind: null, gone: true }, "main", "abc", "upstream missing"],
  [{ name: "origin/master", ahead: null, behind: null, gone: false }, "main", "abc", "comparison unavailable"],
  [null, "main", "abc", "No upstream configured"],
  [null, "Detached HEAD", "abc", "Detached HEAD · no upstream comparison"],
  [null, "main", "", "No commits yet · no upstream comparison"],
])("shows branch tracking state %#", async (tracking, branch, head, expected) => {
  const original = harness.invoke.getMockImplementation()!;
  harness.invoke.mockImplementation(async (command, args) => {
    const result = await original(command, args);
    return command === "git_snapshot" ? { ...result, tracking, branch, head } : result;
  });
  await act(async () => root.render(<GitPanel {...props} />));
  const status = document.querySelector('[aria-label="Branch tracking status"]')!;
  expect(status.textContent).toContain(expected);
  expect(status.getAttribute("title")).toContain("Fetch to update");
});

it("opens upstream divergence, loads both sides, and routes a paused rebase to Changes", async () => {
  const tracking = { name: "origin/team", reference: "refs/remotes/origin/team", remote: "origin", remoteRef: "refs/heads/team", ahead: 1, behind: 1, gone: false };
  const incoming = { hash: "b".repeat(40), subject: "Team update", author: "Team", date: "2026-11-25" };
  const outgoing = { hash: "a".repeat(40), subject: "Local update", author: "Local", date: "2026-11-25" };
  let rebasing = false;
  harness.invoke.mockImplementation(async (command, args) => {
    if (command === "git_snapshot") return {
      branch: "main", head: outgoing.hash, entries: rebasing ? [{ path: "test.ts", conflict: true, index: "U", worktree: "U" }] : [],
      branches: ["main"], remotes: ["origin"], stagedRevision: "", merging: false, rebasing, history: [outgoing], tracking,
    };
    if (command === "git_compare") return {
      name: tracking.name, reference: tracking.reference, baseHead: outgoing.hash, baseBranch: "main",
      targetHead: incoming.hash, ahead: 1, behind: 1, stat: "test.ts",
    };
    if (command === "git_history") return { commits: [args.head === incoming.hash ? incoming : outgoing], hasMore: false };
    if (command === "git_action" && args.request.action === "rebase-upstream") {
      rebasing = true;
      throw new Error("Resolve the conflict in test.ts");
    }
  });
  await act(async () => root.render(<GitPanel {...props} />));
  const click = (selector: string, label: string) => act(async () => {
    [...document.querySelectorAll<HTMLButtonElement>(selector)]
      .find((button) => button.textContent?.trim() === label)!.click();
  });
  await click(".git-sync-controls button", "Review divergence");
  expect(document.querySelector('[aria-label="Incoming commits"]')?.textContent).toContain("Team update");
  expect(document.querySelector('[aria-label="Outgoing commits"]')?.textContent).toContain("Local update");
  await click(".git-comparison-resolution button", "Rebase onto upstream…");
  expect(harness.invoke).toHaveBeenCalledWith("git_action", expect.objectContaining({
    request: expect.objectContaining({
      action: "rebase-upstream",
      path: tracking.reference,
      value: incoming.hash,
      expectedHead: outgoing.hash,
      expectedBranch: "main",
    }),
  }));
  expect(document.querySelector('[aria-label="Branch comparison"]')).toBeNull();
  const recovery = document.querySelector('[aria-label="Git operation in progress"]')!;
  expect(recovery.textContent).toContain("Rebase in progress");
  expect(recovery.querySelector<HTMLButtonElement>(".primary-button")?.disabled).toBe(true);
  expect(document.querySelector(".git-main [role='alert']")?.textContent).toContain("Resolve the conflict in test.ts");
});

it("pages recent history, searches the Git history, and offers cherry-pick on a commit", async () => {
  const recent = { hash: "c".repeat(40), subject: "Recent change", author: "Test", date: "2026-11-25" };
  const older = { ...recent, hash: "d".repeat(40), subject: "Earlier release" };
  const original = harness.invoke.getMockImplementation()!;
  harness.invoke.mockImplementation(async (command, args) => {
    if (command === "git_snapshot") return { ...await original(command, args), head: recent.hash, history: [recent], historyHasMore: true };
    if (command === "git_history") return { commits: [older], hasMore: false };
    if (command === "git_show_commit") return "commit d";
    if (command === "git_action") return "Cherry-picked";
    return original(command, args);
  });
  await act(async () => root.render(<GitPanel {...props} />));
  await act(async () => document.querySelector<HTMLButtonElement>('.git-sidebar-views button:nth-child(2)')!.click());
  await act(async () => document.querySelector<HTMLButtonElement>('.git-load-older')!.click());
  expect(harness.invoke).toHaveBeenCalledWith("git_history", expect.objectContaining({ offset: 1, query: "", head: recent.hash }));
  expect(document.querySelectorAll('.git-history')).toHaveLength(2);
  const field = document.querySelector<HTMLInputElement>('[aria-label="Search commit history"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, "release");
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => document.querySelector<HTMLButtonElement>('.git-history-search button')!.click());
  expect(harness.invoke).toHaveBeenCalledWith("git_history", expect.objectContaining({ offset: 0, query: "release", head: recent.hash }));
  expect(document.querySelectorAll('.git-history')).toHaveLength(1);
  await act(async () => document.querySelector<HTMLButtonElement>('.git-history')!.click());
  const cherryPick = [...document.querySelectorAll<HTMLButtonElement>('.git-inline-review footer button')]
    .find((button) => button.textContent?.trim() === "Cherry-pick…")!;
  await act(async () => cherryPick.click());
  expect(harness.invoke).toHaveBeenCalledWith("git_action", expect.objectContaining({
    request: expect.objectContaining({ action: "cherry-pick", value: older.hash, expectedHead: recent.hash }),
  }));
});

it("browses stash files read-only and shows only the selected file diff", async () => {
  const original = harness.invoke.getMockImplementation()!;
  const stash = { reference: "stash@{1}", hash: "b".repeat(40), subject: "Saved work" };
  harness.invoke.mockImplementation(async (command, args) => {
    if (command === "git_snapshot") return { ...await original(command, args), stashes: [stash] };
    if (command === "git_show_stash") return "diff --git a/first.txt b/first.txt\n--- a/first.txt\n+++ b/first.txt\n@@ -1 +1 @@\n-old\n+saved\ndiff --git a/new.txt b/new.txt\nnew file mode 100644\n--- /dev/null\n+++ b/new.txt\n@@ -0,0 +1 @@\n+untracked\n";
    return original(command, args);
  });
  await act(async () => root.render(<GitPanel {...props} />));
  await act(async () => document.querySelector<HTMLButtonElement>(".git-stash-open")!.click());
  expect(harness.invoke).toHaveBeenCalledWith("git_show_stash", { projectId: "p", root: "/project/api", hash: stash.hash });
  expect(document.querySelector(".git-inline-review footer")?.textContent).not.toContain("Stage");
  expect(document.querySelector(".git-inline-review footer")?.textContent).not.toContain("Open in Code");
  const files = document.querySelectorAll<HTMLButtonElement>(".git-stash-files button");
  expect(files).toHaveLength(2);
  expect(document.querySelector(".git-commit-file h3")?.textContent).toBe("first.txt");
  await act(async () => files[1].click());
  expect(document.querySelector(".git-commit-file h3")?.textContent).toBe("new.txt");
  expect(document.querySelectorAll(".git-commit-file")).toHaveLength(1);
  expect(document.querySelector('.git-stash-files button[aria-pressed="true"]')?.textContent).toBe("new.txt");
  expect(harness.invoke.mock.calls.some(([command]) => command === "git_action")).toBe(false);
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Close Git diff"]')!.click());
  expect(document.querySelector(".git-stash-files")).toBeNull();
});

it("switches branches from the header outside Git with the same save and stale-state guards", async () => {
  const host = document.createElement("span");
  document.body.append(host);
  const beforeAction = vi.fn(async () => true);
  await act(async () => root.render(<GitPanel {...props} visible={false} branchHost={host} branchVisible beforeAction={beforeAction} />));
  const trigger = host.querySelector<HTMLButtonElement>('[aria-label="Current project branch"]')!;
  expect(trigger.textContent).toBe("main");
  await act(async () => trigger.click());
  await act(async () => Array.from(document.querySelectorAll<HTMLButtonElement>(".git-branch-menu-row")).find((button) => button.textContent === "feature")!.click());
  expect(beforeAction).toHaveBeenCalledOnce();
  expect(harness.invoke).toHaveBeenCalledWith("git_action", expect.objectContaining({
    root: "/project/api", request: expect.objectContaining({ action: "switch", value: "feature", expectedHead: "abc", expectedBranch: "main" }),
  }));
  expect(trigger.textContent).toBe("feature");
});
it("keeps the branch and reports failed Code flushes from a header switch", async () => {
  const host = document.createElement("span");
  document.body.append(host);
  const onActionError = vi.fn();
  await act(async () => root.render(<GitPanel {...props} visible={false} branchHost={host} beforeAction={async () => false} onActionError={onActionError} />));
  const trigger = host.querySelector<HTMLButtonElement>('[aria-label="Current project branch"]')!;
  await act(async () => trigger.click());
  await act(async () => Array.from(document.querySelectorAll<HTMLButtonElement>(".git-branch-menu-row")).find((button) => button.textContent === "feature")!.click());
  expect(harness.invoke.mock.calls.some(([command]) => command === "git_action")).toBe(false);
  expect(trigger.textContent).toBe("main");
  expect(onActionError).toHaveBeenCalledWith(expect.stringContaining("Save or resolve Code conflicts"));
});
it("omits the header branch control when the folder has no Git repository", async () => {
  harness.invoke.mockRejectedValue(new Error("Not a Git repository"));
  const host = document.createElement("span");
  document.body.append(host);
  await act(async () => root.render(<GitPanel {...props} branchHost={host} />));
  expect(host.textContent).toBe("");
  expect(host.querySelector('[role="combobox"]')).toBeNull();
});

it("searches local and remote branches in the header menu and shows command shortcuts", async () => {
  const original = harness.invoke.getMockImplementation()!;
  harness.invoke.mockImplementation(async (command, args) => command === "git_snapshot"
    ? { ...await original(command, args), remotes: ["origin"], remoteBranches: [{ name: "origin/review", localName: "review" }] }
    : original(command, args));
  const host = document.createElement("span"); document.body.append(host);
  await act(async () => root.render(<GitPanel {...props} branchHost={host} />));
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Current project branch"]')!.click());
  expect(document.querySelector('.git-branch-menu-actions')?.textContent).toContain("Update Project…");
  expect(document.querySelector('.git-branch-menu-actions')?.textContent).toContain("Commit and Push…");
  expect(document.querySelectorAll('.git-branch-menu-actions kbd')).toHaveLength(4);
  const input = document.querySelector<HTMLInputElement>('[aria-label="Search Git branches"]')!;
  expect(document.activeElement).toBe(input);
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "review");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(document.querySelector('.git-branch-menu-actions')).toBeNull();
  expect(document.querySelectorAll('.git-branch-menu-row')).toHaveLength(1);
  expect(document.querySelector('.git-branch-menu-row')?.textContent).toContain("origin/review");
  await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(document.querySelector('[aria-label="Git branches and actions"]')).toBeNull();
  expect(document.activeElement).toBe(host.querySelector('button'));
});

it.each([
  { key: "k", shiftKey: false, altKey: false, action: "commit" },
  { key: "k", shiftKey: true, altKey: false, action: "push" },
  { key: "k", shiftKey: false, altKey: true, action: "commit-push" },
  { key: "t", shiftKey: false, altKey: false, action: "pull" },
])("routes the PhpStorm $action shortcut to Git before executing anything", async ({ key, shiftKey, altKey, action }) => {
  const original = harness.invoke.getMockImplementation()!;
  harness.invoke.mockImplementation(async (command, args) => command === "git_snapshot"
    ? { ...await original(command, args), remotes: ["origin"] }
    : original(command, args));
  const onShowGit = vi.fn();
  await act(async () => root.render(<GitPanel {...props} visible={false} branchVisible onShowGit={onShowGit} />));
  await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key, code: key === "k" ? "KeyK" : "KeyT", metaKey: true, shiftKey, altKey, bubbles: true, cancelable: true })));
  expect(onShowGit).toHaveBeenCalledOnce();
  expect(harness.invoke.mock.calls.some(([command]) => command === "git_action")).toBe(false);
  await act(async () => root.render(<GitPanel {...props} branchVisible onShowGit={onShowGit} />));
  if (action === "pull" || action === "push") {
    expect(harness.invoke).toHaveBeenCalledWith("git_action", expect.objectContaining({ request: expect.objectContaining({ action }) }));
  } else {
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Commit message");
    expect(harness.invoke.mock.calls.some(([command]) => command === "git_action")).toBe(false);
    if (action === "commit-push") expect(document.querySelector('.git-commit-actions .primary-button')?.textContent).toContain("Commit & Push");
  }
});

it("opens Git for a menu Push and leaves terminal-focused shortcuts alone", async () => {
  const original = harness.invoke.getMockImplementation()!;
  harness.invoke.mockImplementation(async (command, args) => command === "git_snapshot"
    ? { ...await original(command, args), remotes: ["origin"] }
    : original(command, args));
  const onShowGit = vi.fn(); const host = document.createElement("span"); document.body.append(host);
  await act(async () => root.render(<GitPanel {...props} visible={false} branchVisible branchHost={host} onShowGit={onShowGit} />));
  const terminal = document.createElement("div"); terminal.className = "terminal-panel";
  const input = document.createElement("textarea"); terminal.append(input); document.body.append(terminal); input.focus();
  await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "t", metaKey: true, bubbles: true, cancelable: true })));
  expect(onShowGit).not.toHaveBeenCalled();
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Current project branch"]')!.click());
  await act(async () => Array.from(document.querySelectorAll<HTMLButtonElement>('.git-branch-menu-actions button')).find((button) => button.textContent?.startsWith("Push…"))!.click());
  expect(onShowGit).toHaveBeenCalledOnce();
  expect(harness.invoke.mock.calls.some(([command]) => command === "git_action")).toBe(false);
});
