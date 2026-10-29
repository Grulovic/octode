import type { Project, Tool, WorkspaceSession } from "../types";

export function rootForPath(roots: string[], path: string): string | undefined {
  const normalized = (value: string) =>
    value.replaceAll("\\", "/").replace(/\/$/, "");
  const file = normalized(path);
  return [...roots]
    .sort((a, b) => normalized(b).length - normalized(a).length)
    .find((root) => file.startsWith(normalized(root) + "/"));
}

export function filename(path: string) {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}
export function folderBranchLabel(root: string, branch?: string): string {
  const name = filename(root);
  const current = branch?.split("...")[0].trim();
  return current && !["No repository", "Git", "…"].includes(current)
    ? `${name} / ${current}`
    : name;
}

export function language(path: string): string {
  const ext = path.split(".").at(-1)?.toLowerCase();
  return (
    (
      {
        php: "php",
        js: "javascript",
        jsx: "javascript",
        ts: "typescript",
        tsx: "typescript",
        json: "json",
        css: "css",
        html: "html",
        md: "markdown",
        yml: "yaml",
        yaml: "yaml",
        sql: "sql",
        sh: "shell",
        rs: "rust",
        toml: "ini",
      } as Record<string, string>
    )[ext ?? ""] ?? "plaintext"
  );
}
export function filterProjects(projects: Project[], query: string) {
  const normalized = query.trim().toLowerCase();
  return projects.filter((project) =>
    `${project.name} ${project.roots.join(" ")}`
      .toLowerCase()
      .includes(normalized),
  );
}
export function canClose(documents: { text: string; saved: string }[]) {
  return documents.every((doc) => doc.text === doc.saved);
}

export function normalizeSession(
  value: unknown,
  project: Project,
): WorkspaceSession {
  const data =
    value && typeof value === "object"
      ? (value as Partial<WorkspaceSession>)
      : {};
  const allowed: Tool[] = ["home", "code", "servers", "database", "api"];
  const openFiles = Array.isArray(data.openFiles)
    ? [
        ...new Set(
          data.openFiles.filter(
            (path): path is string =>
              typeof path === "string" &&
              project.roots.some(
                (root) =>
                  path.startsWith(root + "/") || path.startsWith(root + "\\"),
              ),
          ),
        ),
      ].slice(0, 100)
    : [];
  return {
    version: 1,
    tool: allowed.includes(data.tool as Tool) ? (data.tool as Tool) : "home",
    openFiles,
    activeFile: openFiles.includes(data.activeFile ?? "")
      ? data.activeFile!
      : (openFiles[0] ?? ""),
    activeRoot: project.roots.includes(data.activeRoot ?? "")
      ? data.activeRoot!
      : project.roots[0],
    terminalVisible: data.terminalVisible === true,
  };
}

export function codeModelPath(projectId: string, path: string) {
  return `octode-file://${encodeURIComponent(projectId)}/${encodeURIComponent(path)}`;
}
