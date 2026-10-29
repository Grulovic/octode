const writers = new Map<string, () => Promise<boolean>>();
export function registerPendingToolSave(
  key: string,
  flush: () => Promise<boolean>,
) {
  writers.set(key, flush);
  return () => {
    if (writers.get(key) === flush) writers.delete(key);
  };
}
export async function waitForPendingToolSaves() {
  return (
    await Promise.all([...writers.values()].map((flush) => flush()))
  ).every(Boolean);
}
