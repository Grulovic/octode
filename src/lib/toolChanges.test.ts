import { expect, it } from "vitest";
import { changedIds, toolChanges } from "./toolChanges";
it("describes named additions, removals and edited fields without exposing contents or credentials", () => {
  const saved = {
    connections: [
      {
        id: "c",
        name: "Production",
        host: "old",
        password: { id: "s", value: "", secret: true, hasSecret: true },
      },
    ],
    requests: [
      { id: "r", name: "List rooms", url: "/before", body: "private-before" },
    ],
    folders: [{ id: "f", name: "Old" }],
  };
  const next = {
    connections: [
      {
        ...saved.connections[0],
        host: "new",
        password: {
          id: "s",
          value: "super-private-password",
          secret: true,
          hasSecret: false,
        },
      },
    ],
    requests: [
      { ...saved.requests[0], url: "/after", body: "private-after" },
      { id: "new", name: "Create room", url: "/", body: "" },
    ],
    folders: [],
  };
  const changes = toolChanges(next, saved);
  expect(changes).toContain("Connections › Production › Host changed");
  expect(changes).toContain(
    "Connections › Production › Password changed (secret value hidden)",
  );
  expect(changes).toContain("Requests › List rooms › Url changed");
  expect(changes).toContain("Requests › Create room added");
  expect(changes).toContain("Folders › Old removed");
  expect(JSON.stringify(changes)).not.toContain("super-private-password");
  expect(JSON.stringify(changes)).not.toContain("private-after");
  expect([...changedIds(next.requests, saved.requests)]).toEqual(["r", "new"]);
  expect(toolChanges(saved, saved)).toEqual([]);
});
