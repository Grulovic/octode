export async function prepareRestart({
  saveCode,
  waitForSaves,
  hasUnsavedSettings,
  confirmDiscard,
  flushLayout,
}: {
  saveCode: () => Promise<boolean>;
  waitForSaves: () => Promise<boolean>;
  hasUnsavedSettings: () => boolean;
  confirmDiscard: () => Promise<boolean>;
  flushLayout: () => Promise<void>;
}): Promise<boolean> {
  if (!(await saveCode()))
    throw new Error(
      "Code could not be saved. Resolve the save error before restarting.",
    );
  if (!(await waitForSaves()))
    throw new Error("A settings save failed. Retry Save before restarting.");
  if (hasUnsavedSettings() && !(await confirmDiscard())) return false;
  await flushLayout();
  return true;
}
