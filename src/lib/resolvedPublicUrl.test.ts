import { describe, expect, it } from "vitest";
import { resolvedPublicUrl } from "./resolvedPublicUrl";
const variable = { id: "1", name: "baseUrl", value: "https://example.test", enabled: true };
describe("resolved URL preview", () => {
  it("resolves public enabled variables", () => expect(resolvedPublicUrl("{{baseUrl}}/rooms", [variable])).toBe("https://example.test/rooms"));
  it("hides secret, stored, disabled, missing and nested variables", () => {
    for (const vars of [[{...variable, secret:true}], [{...variable, hasSecret:true}], [{...variable, enabled:false}], [], [{...variable, value:"{{token}}"}]]) expect(resolvedPublicUrl("{{baseUrl}}/rooms", vars)).toBeNull();
  });
  it("includes enabled public parameters and hides secret parameters", () => {
    expect(resolvedPublicUrl("{{baseUrl}}/rooms", [variable], [{...variable, name:"q", value:"a & b"}])).toBe("https://example.test/rooms?q=a+%26+b");
    expect(resolvedPublicUrl("{{baseUrl}}/rooms", [variable], [{...variable, name:"token", secret:true}])).toBeNull();
  });
  it("hides embedded URL credentials", () => expect(resolvedPublicUrl("https://user:password@example.test", [])).toBeNull());
});
