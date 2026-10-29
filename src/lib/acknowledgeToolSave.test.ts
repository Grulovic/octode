import { expect, it } from "vitest";
import { acknowledgeToolSave } from "./acknowledgeToolSave";
const password = { id: "draft", value: "test-only", secret: true, hasSecret: false };
const connection = { id: "connection", host: "before", password };
const snapshot = { connections: [connection] };
const sealed = { id: "stored", value: "", secret: true, hasSecret: true };
const saved = { connections: [{ ...connection, password: sealed }] };
it("adopts a saved database credential while keeping later host edits unsaved", () => {
  const current = { connections: [{ ...connection, host: "after", password: {...password} }] };
  const result = acknowledgeToolSave(current, snapshot, saved);
  expect(result.connections[0]).toEqual({ ...saved.connections[0], host: "after" });
  expect(JSON.stringify(result)).not.toContain("test-only");
});
it("preserves a replacement password typed during Save", () => {
  const current = { connections: [{ ...connection, password: {...password, value:"new-test-only"} }] };
  expect(acknowledgeToolSave(current, snapshot, saved)).toEqual(current);
});
it("preserves additions, deletions, reordering and clearing a saved credential", () => {
  const other = { ...connection, id:"other" };
  const current = { connections: [other] };
  expect(acknowledgeToolSave(current, snapshot, saved)).toEqual(current);
  const cleared = { connections: [{ ...connection, password: {...password, value:"", hasSecret:false} }] };
  expect(acknowledgeToolSave(cleared, snapshot, saved)).toEqual(cleared);
  const reordered = { connections: [other, {...connection, host:"after"}] };
  expect(acknowledgeToolSave(reordered, snapshot, saved).connections).toEqual([other, {...saved.connections[0], host:"after"}]);
});
