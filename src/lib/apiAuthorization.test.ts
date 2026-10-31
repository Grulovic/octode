import { expect, it } from "vitest";
import { requestWithEnvironment } from "./apiAuthorization";
import { apiRequest, row, secret } from "./toolDefaults";
import type { ApiEnvironment } from "../toolTypes";
const environment = (): ApiEnvironment => ({ id: "env", name: "Dev", variables: [], headers: [row("Accept", "application/json")], auth: "bearer", credential: { ...secret(), value: "", hasSecret: true } });
it("new requests inherit environment authorization and preserve stored secret references", () => {
  const request = apiRequest(), env = environment();
  const effective = requestWithEnvironment(request, env);
  expect(request.auth).toBe("inherit");
  expect(effective.auth).toBe("bearer"); expect(effective.credential).toBe(env.credential);
  expect(effective.credential.value).toBe(""); expect(effective.credential.hasSecret).toBe(true);
  expect(effective.headers).toEqual(env.headers);
  expect(request.headers).toEqual([]); expect(request.credential).not.toBe(env.credential);
  expect(requestWithEnvironment(request, { ...env, auth: "basic", username: "{{user}}" }).username).toBe("{{user}}");
  expect(requestWithEnvironment(request).auth).toBe("none");
  expect(requestWithEnvironment(request, { id: "old", name: "Old", variables: [] }).auth).toBe("none");
});
it("respects request overrides and explicit None while preventing duplicate Authorization headers", () => {
  const request = apiRequest(), env = environment();
  const own = { ...request, auth: "basic" as const, username: "own", credential: { ...secret(), value: "own-password" } };
  env.headers!.push(row("Authorization", "legacy default")); own.headers.push(row("authorization", "manual"));
  const effective = requestWithEnvironment(own, env);
  expect(effective.auth).toBe("basic"); expect(effective.username).toBe("own"); expect(effective.credential).toBe(own.credential);
  expect(effective.headers.map((header) => header.name)).toEqual(["Accept"]);
  expect(requestWithEnvironment({ ...request, auth: "none" }, env).auth).toBe("none");
  const manual = { ...request, headers: [row("AUTHORIZATION", "Custom request token")] };
  const override = requestWithEnvironment(manual, env);
  expect(override.auth).toBe("none"); expect(override.headers.filter((header) => /authorization/i.test(header.name))).toEqual(manual.headers);
  manual.headers[0].enabled = false;
  expect(requestWithEnvironment(manual, env).auth).toBe("bearer");
});
it("follows the chosen environment without mutating stored request settings", () => {
  const request = apiRequest(), first = environment(), second = { ...environment(), id: "other" };
  expect(requestWithEnvironment(request, first).credential).toBe(first.credential);
  expect(requestWithEnvironment(request, second).credential).toBe(second.credential);
  expect(request.auth).toBe("inherit"); expect(request.credential.hasSecret).not.toBe(true);
});
