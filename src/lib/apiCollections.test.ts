// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { apiDocument, apiRequest, row } from "./toolDefaults";
import {
  exportCollection,
  importCollection,
  prettyResponse,
  boundedHistory,
  duplicateRequest,
} from "./apiCollections";
describe("API collections", () => {
  it("duplicates request drafts independently while preserving immutable saved secret references", () => {
    const request = apiRequest();
    request.name = "Get App Data";
    request.url = "https://example.test/data";
    request.folderId = "folder";
    request.auth = "bearer";
    request.credential.hasSecret = true;
    request.headers = [
      { ...row("Authorization", ""), secret: true, hasSecret: true },
      row("Accept", "application/json"),
    ];
    const copy = duplicateRequest(request, [request.name, "Get App Data copy"]);
    expect(copy.id).not.toBe(request.id);
    expect(copy.name).toBe("Get App Data copy 2");
    expect(copy.folderId).toBe("folder");
    expect(copy.auth).toBe("bearer");
    expect(copy.credential.id).toBe(request.credential.id);
    expect(copy.headers[0].id).toBe(request.headers[0].id);
    expect(copy.headers[1].id).not.toBe(request.headers[1].id);
    copy.headers[0].value = "replacement";
    copy.url = "https://other.test";
    expect(request.headers[0].value).toBe("");
    expect(request.url).toBe("https://example.test/data");
  });
  it("exports structural data without credential values or live credential references", () => {
    const doc = apiDocument();
    const request = apiRequest();
    request.credential.value = "private-token";
    request.credential.hasSecret = true;
    request.headers = [
      row("Authorization", "Bearer hidden"),
      { ...row("x-custom", "secret-variable"), secret: true },
    ];
    request.url = "{{host}}/users";
    doc.requests.push(request);
    const output = exportCollection(doc);
    expect(output).not.toContain("private-token");
    expect(output).not.toContain("Bearer hidden");
    expect(output).not.toContain("secret-variable");
    expect(output).toContain("{{host}}/users");
    const imported = importCollection(output);
    expect(imported.requests[0].id).not.toBe(request.id);
    expect(imported.requests[0].credential.hasSecret).not.toBe(true);
  });
  it("imports nested Postman folders, auth, variables and params without duplicating the query", () => {
    const collection = {
      info: { name: "Test" },
      variable: [{ key: "host", value: "https://example.test" }],
      item: [
        {
          name: "Users",
          item: [
            {
              name: "Get users",
              request: {
                method: "GET",
                url: {
                  raw: "{{host}}/users?limit=10",
                  query: [{ key: "limit", value: "10" }],
                },
                auth: {
                  type: "bearer",
                  bearer: [{ key: "token", value: "{{token}}" }],
                },
              },
            },
          ],
        },
      ],
    };
    const imported = importCollection(JSON.stringify(collection));
    expect(imported.requests[0].folderId).toBe(imported.folders[0].id);
    expect(imported.requests[0].url).toBe("{{host}}/users");
    expect(imported.requests[0].params[0].value).toBe("10");
    expect(imported.requests[0].credential.value).toBe("{{token}}");
    expect(imported.environments[0].variables[0].name).toBe("host");
  });
  it("bounds retained response bodies and formats JSON without executing it", () => {
    expect(prettyResponse('{"a":1}')).toBe('{\n  "a": 1\n}');
    expect(prettyResponse("<script>hello</script>")).toBe(
      "<script>hello</script>",
    );
    expect(
      boundedHistory(
        Array.from({ length: 20 }, () => ({ response: { body: "x" } })),
      ),
    ).toHaveLength(12);
    expect(() => importCollection("{}")).toThrow();
  });
});

it("round-trips inherited auth modes and environment settings while removing environment credentials", () => {
  const doc = apiDocument();
  doc.requests.push(apiRequest());
  const credential = { ...apiRequest().credential, value: "environment-private-token", hasSecret: true };
  doc.environments.push({ id: "env", name: "Dev", variables: [], auth: "basic", username: "{{user}}", credential });
  const exported = exportCollection(doc);
  expect(exported).not.toContain("environment-private-token");
  const imported = importCollection(exported);
  expect(imported.requests[0].auth).toBe("inherit");
  expect(imported.environments[0].auth).toBe("basic");
  expect(imported.environments[0].username).toBe("{{user}}");
  expect(imported.environments[0].credential?.value).toBe("");
  expect(imported.environments[0].credential?.hasSecret).not.toBe(true);
  expect(imported.environments[0].credential?.id).not.toBe(credential.id);
});
it("preserves nested folders across Octode exports and Postman imports", () => {
  const doc = apiDocument();
  doc.folders = [{ id: "child", name: "Child", parentId: "root" }, { id: "root", name: "Root" }];
  doc.requests = [{ ...apiRequest(), folderId: "child" }];
  const imported = importCollection(exportCollection(doc));
  expect(imported.folders[0].parentId).toBe(imported.folders[1].id);
  expect(imported.requests[0].folderId).toBe(imported.folders[0].id);
  const postman = importCollection(JSON.stringify({ item: [{ name: "Outer", item: [{ name: "Inner", item: [{ name: "Request", request: { url: "https://example.test" } }] }] }] }));
  expect(postman.folders.map((item) => item.name)).toEqual(["Outer", "Inner"]);
  expect(postman.folders[1].parentId).toBe(postman.folders[0].id);
  expect(postman.requests[0].folderId).toBe(postman.folders[1].id);
});
