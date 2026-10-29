import type { Document } from "../types";

export type SaveState = "pending" | "saving" | "error";
export const AUTOSAVE_DELAY = 600;

/** Code documents only. Serialize each file's writes against its last saved contents. */
export function createCodeAutosave(options: {
  read: () => Document[];
  write: (snapshot: Document) => Promise<void>;
  saved: (snapshot: Document) => void;
  state: (states: Record<string, SaveState>) => void;
  error: (path: string, reason: unknown) => void;
  delay?: number;
}) {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const jobs = new Map<string, Promise<boolean>>();
  const failed = new Set<string>();
  const states: Record<string, SaveState> = {};
  let disposed = false;
  function status(path: string, value?: SaveState) {
    if (value) states[path] = value;
    else delete states[path];
    if (!disposed) options.state({ ...states });
  }
  function cancelTimer(path: string) {
    const timer = timers.get(path);
    if (timer !== undefined) clearTimeout(timer);
    timers.delete(path);
  }
  async function writeOne(path: string): Promise<boolean> {
    const running = jobs.get(path);
    if (running) {
      if (!(await running)) return false;
      return writeOne(path);
    }
    if (disposed || failed.has(path)) return false;
    const document = options.read().find((item) => item.path === path);
    if (!document || document.text === document.saved) {
      status(path);
      return true;
    }
    const snapshot = { ...document };
    const job = Promise.resolve().then(async () => {
      status(path, "saving");
      try {
        await options.write(snapshot);
        if (!disposed) {
          options.saved(snapshot);
          const latest = options.read().find((item) => item.path === path);
          status(
            path,
            latest && latest.text !== latest.saved ? "pending" : undefined,
          );
        }
        return true;
      } catch (reason) {
        failed.add(path);
        status(path, "error");
        if (!disposed) options.error(path, reason);
        return false;
      } finally {
        jobs.delete(path);
      }
    });
    jobs.set(path, job);
    return job;
  }
  async function flush(path?: string, retry = false): Promise<boolean> {
    const paths = path
      ? [path]
      : [
          ...new Set([
            ...options
              .read()
              .filter((item) => item.text !== item.saved)
              .map((item) => item.path),
            ...jobs.keys(),
          ]),
        ];
    const results = await Promise.all(
      paths.map(async (current) => {
        cancelTimer(current);
        if (retry) failed.delete(current);
        do {
          if (!(await writeOne(current))) return false;
        } while (
          !disposed &&
          options
            .read()
            .some((item) => item.path === current && item.text !== item.saved)
        );
        return !disposed;
      }),
    );
    return results.every(Boolean);
  }
  return {
    changed(path: string) {
      cancelTimer(path);
      if (disposed || failed.has(path)) return;
      const document = options.read().find((item) => item.path === path);
      if (!document) return;
      if (document.text === document.saved && !jobs.has(path)) {
        status(path);
        return;
      }
      status(path, jobs.has(path) ? "saving" : "pending");
      timers.set(
        path,
        setTimeout(() => {
          timers.delete(path);
          void writeOne(path);
        }, options.delay ?? AUTOSAVE_DELAY),
      );
    },
    flush,
    pause(path: string) {
      cancelTimer(path);
      failed.add(path);
      status(path, "error");
    },
    forget(path: string) {
      cancelTimer(path);
      failed.delete(path);
      status(path);
    },
    dispose() {
      disposed = true;
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    },
  };
}

export type CodeAutosave = ReturnType<typeof createCodeAutosave>;
