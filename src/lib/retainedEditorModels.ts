interface RetainedModel { dispose: () => void }
const retained = new Map<string, { model: RetainedModel; users: number; released: boolean }>();
/** Keep document undo history while its editor is temporarily unmounted. */
export function retainEditorModel(uri: string, model: RetainedModel) {
  let entry = retained.get(uri);
  if (!entry) { entry = { model, users: 0, released: false }; retained.set(uri, entry); }
  entry.users++;
  const current = entry;
  return () => {
    current.users--;
    if (!current.users && current.released) { current.model.dispose(); retained.delete(uri); }
  };
}
/** Active editors release their model after unmount, so deleting a note cannot disturb another note. */
export function disposeRetainedEditorModel(uri: string) {
  const entry = retained.get(uri);
  if (!entry) return;
  entry.released = true;
  if (!entry.users) { entry.model.dispose(); retained.delete(uri); }
}
