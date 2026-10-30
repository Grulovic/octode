export const terminalPathsType = "application/x-octode-paths";
/** Insert arguments only, never an Enter or terminal control sequence. */
export function quoteTerminalPaths(paths: string[], windows = false): string {
  if (!paths.length || paths.length > 1000)
    throw new Error("Drop one or more file paths into the terminal.");
  const quoted =
    paths
      .map((path) => {
        if (
          !path ||
          /[\x00-\x1f\x7f]/.test(path) ||
          (windows
            ? !/^(?:[a-zA-Z]:[\\/]|\\\\)/.test(path)
            : !path.startsWith("/"))
        )
          throw new Error(
            "This file path cannot be inserted safely into the terminal.",
          );
        if (windows) {
          if (/["%!]/.test(path))
            throw new Error(
              "This Windows file path contains characters that cannot be inserted safely into cmd.exe.",
            );
          return `"${path}"`;
        }
        return `'${path.replaceAll("'", "'\\''")}'`;
      })
      .join(" ") + " ";
  if (quoted.length > 65536)
    throw new Error("Too many file paths were dropped at once.");
  return quoted;
}
export function droppedPaths(data: DataTransfer, windows = false): string[] {
  const internal = data.getData(terminalPathsType);
  if (internal) {
    if (internal.length > 65536)
      throw new Error("Too many file paths were dropped at once.");
    const paths: unknown = JSON.parse(internal);
    if (
      !Array.isArray(paths) ||
      !paths.every((path) => typeof path === "string")
    )
      throw new Error("Invalid dropped file paths.");
    return paths;
  }
  return data
    .getData("text/uri-list")
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const url = new URL(line);
      if (url.protocol !== "file:")
        throw new Error("Drop local files or folders.");
      const path = decodeURIComponent(url.pathname);
      if (windows)
        return url.hostname && url.hostname !== "localhost"
          ? `\\\\${url.hostname}${path.replaceAll("/", "\\")}`
          : path.replace(/^\/(?=[a-zA-Z]:)/, "").replaceAll("/", "\\");
      if (url.hostname && url.hostname !== "localhost")
        throw new Error("Drop a local file path.");
      return path;
    });
}
export function installFilePathDrop(
  element: HTMLElement,
  options: {
    active: () => boolean;
    onPaths: (paths: string[]) => void;
    onHover: (hover: boolean) => void;
    onError: (error: string) => void;
    native: boolean;
    capture?: boolean;
    onFiles?: (files: File[]) => void;
    windows?: boolean;
  },
) {
  let disposed = false,
    unlisten: (() => void) | undefined;
  const active = () => !disposed && element.isConnected && options.active();
  const accepts = (data: DataTransfer | null) =>
    !!data &&
    [terminalPathsType, "Files", "text/uri-list"].some((type) =>
      Array.from(data.types).includes(type),
    );
  const over = (event: DragEvent) => {
    if (!active() || !accepts(event.dataTransfer)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    options.onHover(true);
  };
  const leave = (event: DragEvent) => {
    if (
      !(event.relatedTarget instanceof Node) ||
      !element.contains(event.relatedTarget)
    )
      options.onHover(false);
  };
  const drop = (event: DragEvent) => {
    if (!active() || !accepts(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    options.onHover(false);
    try {
      const paths = droppedPaths(event.dataTransfer!, options.windows);
      if (paths.length || !options.onFiles) options.onPaths(paths);
      else options.onFiles(Array.from(event.dataTransfer!.files));
    } catch (error) {
      options.onError(String(error));
    }
  };
  element.addEventListener("dragover", over, options.capture ?? false);
  element.addEventListener("dragenter", over, options.capture ?? false);
  element.addEventListener("dragleave", leave, options.capture ?? false);
  element.addEventListener("drop", drop, options.capture ?? false);
  if (options.native)
    void import("@tauri-apps/api/webview")
      .then(async ({ getCurrentWebview }) => {
        if (disposed) return;
        const stop = await getCurrentWebview().onDragDropEvent(
          ({ payload }) => {
            if (disposed) return;
            if (payload.type === "leave" || !active()) {
              options.onHover(false);
              return;
            }
            const scale = window.devicePixelRatio || 1,
              x = payload.position.x / scale,
              y = payload.position.y / scale;
            const rect = element.getBoundingClientRect();
            const inside =
              rect.width > 0 &&
              rect.height > 0 &&
              x >= rect.left &&
              x < rect.right &&
              y >= rect.top &&
              y < rect.bottom;
            options.onHover(inside && payload.type !== "drop");
            if (inside && payload.type === "drop")
              options.onPaths(payload.paths);
          },
        );
        if (disposed) stop();
        else unlisten = stop;
      })
      .catch((error) => {
        if (!disposed)
          options.onError(`Could not enable file dropping: ${String(error)}`);
      });
  return () => {
    disposed = true;
    unlisten?.();
    element.removeEventListener("dragover", over, options.capture ?? false);
    element.removeEventListener("dragenter", over, options.capture ?? false);
    element.removeEventListener("dragleave", leave, options.capture ?? false);
    element.removeEventListener("drop", drop, options.capture ?? false);
  };
}

// Keep terminal callers compatible while sharing native drop routing with Notes.
export const installTerminalFileDrop = installFilePathDrop;
