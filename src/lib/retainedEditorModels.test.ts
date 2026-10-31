import { expect, it, vi } from "vitest";
import { retainEditorModel, disposeRetainedEditorModel } from "./retainedEditorModels";
it("keeps inactive note histories and disposes deleted notes only after their editors detach", () => {
  const first = { dispose: vi.fn() }, second = { dispose: vi.fn() };
  const closeFirst = retainEditorModel("note:first", first);
  const closeSecond = retainEditorModel("note:second", second);
  closeFirst(); expect(first.dispose).not.toHaveBeenCalled();
  const reopen = retainEditorModel("note:first", first);
  disposeRetainedEditorModel("note:first");
  expect(first.dispose).not.toHaveBeenCalled();
  reopen(); expect(first.dispose).toHaveBeenCalledOnce();
  expect(second.dispose).not.toHaveBeenCalled();
  closeSecond(); disposeRetainedEditorModel("note:second");
  expect(second.dispose).toHaveBeenCalledOnce();
});
