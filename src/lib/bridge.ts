import type {
  FileEntry,
  GitStatus,
  Project,
  SearchResults,
  WorkspaceSession,
} from "../types";
import { normalizeSession } from "./workspace";

export const desktop = "__TAURI_INTERNALS__" in window;
export async function invoke<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  const { invoke: nativeInvoke } = await import("@tauri-apps/api/core");
  return nativeInvoke<T>(command, args);
}
const DEMO_ID = "welcome";
const sampleFolders = new Set<string>();
const sampleFiles: Record<string, string> = {
  "/welcome/README.md":
    "# Welcome to Octode\n\nA little less switching. A little more building.\n\nYour code, servers, databases, and API requests — together in one workspace.\n\n## Getting started\n\nOpen the desktop app and add a local project to browse and edit your files.\n\nThis browser preview is a sandbox. Its sample files stay in this session.\n",
  "/welcome/app/Http/Controllers/WelcomeController.php":
    "<?php\n\ndeclare(strict_types=1);\n\nnamespace App\\Http\\Controllers;\n\nfinal class WelcomeController\n{\n    public function index(): array\n    {\n        return [\n            'message' => 'A place for your next idea.',\n            'workspace' => 'Octode',\n        ];\n    }\n}\n",
  "/welcome/routes/api.php":
    "<?php\n\nuse Illuminate\\Support\\Facades\\Route;\nuse App\\Http\\Controllers\\WelcomeController;\n\nRoute::get('/welcome', [WelcomeController::class, 'index']);\n",
  "/welcome/package.json":
    '{\n  "name": "your-next-idea",\n  "private": true\n}\n',
};
export const previewProject: Project = {
  id: DEMO_ID,
  name: "Welcome to Octode",
  roots: ["/welcome"],
  updatedAt: 0,
};

export async function listProjects(): Promise<Project[]> {
  return desktop ? invoke("list_projects") : [];
}
export async function createProject(
  name: string,
  roots: string[],
  color = "#80cbc4",
): Promise<Project> {
  return invoke("create_project", { name, roots, color });
}
export async function listDirectory(
  project: Project,
  path: string,
): Promise<FileEntry[]> {
  if (desktop) return invoke("list_directory", { projectId: project.id, path });
  const entries = new Map<string, FileEntry>();
  for (const file of [...Object.keys(sampleFiles), ...sampleFolders]) {
    if (!file.startsWith(`${path}/`)) continue;
    const relative = file.slice(path.length + 1);
    const name = relative.split("/")[0];
    entries.set(name, {
      name,
      path: `${path}/${name}`,
      directory: relative.includes("/") || sampleFolders.has(file),
    });
  }
  return [...entries.values()].sort(
    (a, b) =>
      Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name),
  );
}
export async function readFile(
  project: Project,
  path: string,
): Promise<string> {
  return desktop
    ? invoke("read_file", { projectId: project.id, path })
    : (sampleFiles[path] ??
        (() => {
          throw new Error("File is unavailable");
        })());
}
export async function saveFile(
  project: Project,
  path: string,
  content: string,
  expected: string,
): Promise<void> {
  if (desktop)
    return invoke("save_file", {
      projectId: project.id,
      path,
      content,
      expected,
    });
  sampleFiles[path] = content;
}
export async function gitStatus(
  project: Project,
  root: string,
): Promise<GitStatus> {
  return desktop
    ? invoke("git_status", { projectId: project.id, root })
    : { branch: "preview", files: [] };
}

export async function searchWorkspace(
  project: Project,
  query: string,
  kind: "files" | "text",
  matchCase = false,
  options: SearchOptions = {
    regex: false,
    exclusions: [],
    respectGitignore: true,
  },
): Promise<SearchResults> {
  if (desktop)
    return invoke("search_workspace", {
      projectId: project.id,
      query,
      kind,
      matchCase,
      options,
    });
  const result: SearchResults = {
    files: [],
    matches: [],
    truncated: false,
    cancelled: false,
    skipped: 0,
    warnings: [],
  };
  const pattern = options.regex
    ? new RegExp(query, matchCase ? "" : "i")
    : null;
  for (const [path, text] of Object.entries(sampleFiles)) {
    if (
      options.exclusions.some((pattern) =>
        path.includes(pattern.replaceAll("*", "")),
      )
    )
      continue;
    const relative = path.slice("/welcome/".length);
    if (kind === "files") {
      if (
        query
          .toLowerCase()
          .trim()
          .split(/\s+/)
          .every((part) => relative.toLowerCase().includes(part))
      )
        result.files.push({ path, relative, root: "/welcome" });
    } else if (query.trim()) {
      text.split("\n").forEach((content, index) => {
        if (
          pattern
            ? pattern.test(content)
            : matchCase
              ? content.includes(query)
              : content.toLowerCase().includes(query.toLowerCase())
        )
          result.matches.push({
            path,
            relative,
            line: index + 1,
            preview: content.trim(),
          });
      });
    }
  }
  return result;
}
export async function cancelSearch(kind: "files" | "text"): Promise<void> {
  if (desktop) await invoke("cancel_search", { kind });
}
export async function loadSession(project: Project): Promise<WorkspaceSession> {
  const raw = desktop
    ? await invoke<unknown>("load_workspace_state", { projectId: project.id })
    : null;
  return normalizeSession(raw, project);
}
export async function saveSession(
  project: Project,
  session: WorkspaceSession,
): Promise<void> {
  if (desktop)
    await invoke("save_workspace_state", { projectId: project.id, session });
}

export async function fileAction(
  project: Project,
  request: import("../devTypes").FileAction,
): Promise<string> {
  if (desktop) return invoke("file_action", { projectId: project.id, request });
  if (request.action === "reveal")
    throw new Error("Open in file manager is available in the desktop app");
  if (["copy", "move", "duplicate"].includes(request.action)) {
    if (!(request.path in sampleFiles))
      throw new Error("Choose a regular file");
    if (
      request.expected !== undefined &&
      sampleFiles[request.path] !== request.expected
    )
      throw new Error("The source file changed on disk");
    const sourceParent = request.path.slice(0, request.path.lastIndexOf("/"));
    const parent =
      request.action === "duplicate" ? sourceParent : request.destination;
    if (
      !parent ||
      !project.roots.some(
        (root) => parent === root || parent.startsWith(root + "/"),
      ) ||
      parent.split("/").some((part) => part === ".." || part === ".git")
    )
      throw new Error("Choose a project destination folder");
    const name = request.path.slice(request.path.lastIndexOf("/") + 1);
    const dot = name.lastIndexOf(".");
    const stem = dot > 0 ? name.slice(0, dot) : name,
      extension = dot > 0 ? name.slice(dot) : "";
    let destination = `${parent}/${name}`;
    if (request.action === "move") {
      if (destination === request.path) return destination;
      if (destination in sampleFiles || sampleFolders.has(destination))
        throw new Error("The destination already exists");
    } else {
      let attempt = request.action === "duplicate" ? 1 : 0;
      while (
        attempt ||
        destination in sampleFiles ||
        sampleFolders.has(destination)
      ) {
        if (!attempt) attempt = 1;
        destination = `${parent}/${stem} copy${attempt === 1 ? "" : ` ${attempt}`}${extension}`;
        if (!(destination in sampleFiles) && !sampleFolders.has(destination))
          break;
        attempt++;
      }
    }
    sampleFiles[destination] = sampleFiles[request.path];
    if (request.action === "move") delete sampleFiles[request.path];
    return destination;
  }
  const target = request.name
    ? `${request.path}/${request.name}`
    : request.path;
  if (
    request.name &&
    request.name
      .split(/[\\/]/)
      .some((part) => !part || part === ".." || part === "." || part === ".git")
  )
    throw new Error("Use a relative name without parent segments or .git");
  if (request.action === "create-file" || request.action === "create-folder") {
    if (target in sampleFiles || sampleFolders.has(target))
      throw new Error("The destination already exists");
    if (request.action === "create-file") sampleFiles[target] = "";
    else sampleFolders.add(target);
    return target;
  }
  if (project.roots.includes(request.path))
    throw new Error("Project roots cannot be changed here");
  if (request.action === "rename") {
    const destination = `${request.path.slice(0, request.path.lastIndexOf("/"))}/${request.name}`;
    if (destination in sampleFiles || sampleFolders.has(destination))
      throw new Error("The destination already exists");
    for (const path of Object.keys(sampleFiles))
      if (path === request.path || path.startsWith(`${request.path}/`)) {
        sampleFiles[destination + path.slice(request.path.length)] =
          sampleFiles[path];
        delete sampleFiles[path];
      }
    for (const path of [...sampleFolders])
      if (path === request.path || path.startsWith(`${request.path}/`)) {
        sampleFolders.add(destination + path.slice(request.path.length));
        sampleFolders.delete(path);
      }
    return destination;
  }
  if (
    Object.keys(sampleFiles).some((path) =>
      path.startsWith(`${request.path}/`),
    ) ||
    [...sampleFolders].some((path) => path.startsWith(`${request.path}/`))
  )
    throw new Error("Only empty folders can be deleted");
  if (
    request.expected !== undefined &&
    sampleFiles[request.path] !== request.expected
  )
    throw new Error("This file changed on disk");
  delete sampleFiles[request.path];
  sampleFolders.delete(request.path);
  return request.path;
}
export async function inspectFiles(
  project: Project,
  files: { path: string; stamp: string }[],
): Promise<import("../devTypes").FileInspection[]> {
  if (desktop) return invoke("inspect_files", { projectId: project.id, files });
  return files.map(({ path, stamp }) => {
    const content = sampleFiles[path];
    return {
      path,
      stamp: content ?? "unavailable",
      content: content === stamp ? null : (content ?? null),
      error: content === undefined ? "File is unavailable" : null,
    };
  });
}
export async function navigationTargets(
  project: Project,
  path: string,
  query: string,
): Promise<import("../devTypes").NavigationTargets> {
  if (desktop)
    return invoke("navigation_targets", { projectId: project.id, path, query });
  const targets: import("../devTypes").NavigationTarget[] = [];
  for (const [path, text] of Object.entries(sampleFiles)) {
    text.split("\n").forEach((line, index) => {
      if (
        new RegExp(
          `\\b(?:class|function|const|let|interface|type)\\s+${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
        ).test(line)
      )
        targets.push({
          path,
          line: index + 1,
          label: query,
          preview: line.trim(),
        });
    });
  }
  return { targets, truncated: false };
}

export interface SearchOptions {
  regex: boolean;
  exclusions: string[];
  respectGitignore: boolean;
}
export interface Replacement {
  path: string;
  before: string;
  after: string;
  count: number;
}
export async function previewReplacements(
  project: Project,
  query: string,
  replacement: string,
  matchCase: boolean,
  options: SearchOptions,
): Promise<Replacement[]> {
  if (desktop)
    return invoke("preview_replacements", {
      projectId: project.id,
      request: { query, replacement, matchCase, options },
    });
  const changes: Replacement[] = [];
  const source = options.regex
    ? query
    : query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(source, matchCase ? "g" : "gi");
  for (const [path, before] of Object.entries(sampleFiles)) {
    const count = [...before.matchAll(pattern)].length;
    if (!count) continue;
    const after = options.regex
      ? before.replace(pattern, replacement)
      : before.replace(pattern, () => replacement);
    if (before !== after) changes.push({ path, before, after, count });
  }
  return changes;
}
export async function applyReplacements(
  project: Project,
  changes: Replacement[],
): Promise<{ path: string; error: string | null }[]> {
  if (desktop)
    return invoke("apply_replacements", { projectId: project.id, changes });
  return Promise.all(
    changes.map(async (change) => {
      try {
        await saveFile(project, change.path, change.after, change.before);
        return { path: change.path, error: null };
      } catch (error) {
        return { path: change.path, error: String(error) };
      }
    }),
  );
}
