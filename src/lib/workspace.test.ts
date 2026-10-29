import { describe, expect, it } from "vitest";
import {
  canClose,
  codeModelPath,
  filename,
  folderBranchLabel,
  filterProjects,
  language,
  normalizeSession,
  rootForPath,
} from "./workspace";

describe("workspace behavior", () => {
  it("isolates editor model identities for projects sharing a source file", () => {
    expect(codeModelPath("alpha", "/shared/app.php")).not.toBe(
      codeModelPath("beta", "/shared/app.php"),
    );
    expect(codeModelPath("alpha", "/shared/app.php")).toBe(
      codeModelPath("alpha", "/shared/app.php"),
    );
  });
  it("finds the owning project root without confusing sibling prefixes and handles nested roots", () => {
    expect(
      rootForPath(["/project", "/project/api"], "/project/api/app/Room.php"),
    ).toBe("/project/api");
    expect(
      rootForPath(["/project/api"], "/project/api-next/index.ts"),
    ).toBeUndefined();
    expect(rootForPath(["C:\\work\\api"], "C:\\work\\api\\app\\Room.php")).toBe(
      "C:\\work\\api",
    );
  });
  it("formats folder / branch only when a branch is available", () => {
    expect(folderBranchLabel("/work/api", "main")).toBe("api / main");
    expect(folderBranchLabel("/work/api", "main...origin/main")).toBe(
      "api / main",
    );
    expect(folderBranchLabel("/work/api", "")).toBe("api");
    expect(folderBranchLabel("/work/api", "No repository")).toBe("api");
  });
  it("recognizes filenames on both supported path styles", () => {
    expect(filename("/Users/me/api/routes/api.php")).toBe("api.php");
    expect(filename("C:\\work\\app\\index.ts")).toBe("index.ts");
  });
  it("searches names and roots without case sensitivity", () => {
    const projects = [
      { id: "1", name: "Backend", roots: ["/work/Laravel"], updatedAt: 0 },
    ];
    expect(filterProjects(projects, " LARAVEL ")).toEqual(projects);
    expect(filterProjects(projects, "missing")).toEqual([]);
  });
  it("identifies dirty buffers including empty-file changes", () => {
    expect(canClose([{ text: "", saved: "content" }])).toBe(false);
    expect(canClose([{ text: "same", saved: "same" }])).toBe(true);
  });
  it("uses a safe default language", () => {
    expect(language("Controller.php")).toBe("php");
    expect(language("unknown.xyz")).toBe("plaintext");
  });
  it("restores only known tools, roots, and deduplicated project files", () => {
    const project = {
      id: "1",
      name: "App",
      roots: ["/work/app"],
      updatedAt: 0,
    };
    const restored = normalizeSession(
      {
        version: 1,
        tool: "code",
        openFiles: ["/work/app/a.php", "/elsewhere/private", "/work/app/a.php"],
        activeFile: "/elsewhere/private",
        activeRoot: "/elsewhere",
        terminalVisible: true,
      },
      project,
    );
    expect(restored.openFiles).toEqual(["/work/app/a.php"]);
    expect(restored.activeFile).toBe("/work/app/a.php");
    expect(restored.activeRoot).toBe("/work/app");
    expect(restored.tool).toBe("code");
    expect(normalizeSession({ tool: "unsupported" }, project).tool).toBe(
      "home",
    );
  });
});
