import type { ApiEnvironment, ApiRequest, SecretValue } from "../toolTypes";
import { inheritHeaders } from "./apiHeaders";
export function environmentCredential(environment: ApiEnvironment): SecretValue {
  return environment.credential ?? { id: environment.id, value: "", secret: true };
}
/** Resolve inheritance for sending without changing the saved request or exposing stored secrets. */
export function requestWithEnvironment(request: ApiRequest, environment?: ApiEnvironment): ApiRequest {
  let auth = request.auth === "inherit" ? environment?.auth ?? "none" : request.auth;
  let headers = inheritHeaders(environment?.headers ?? [], request.headers);
  // A request's explicit Authorization header overrides environment authorization.
  if (request.auth === "inherit" && request.headers.some((row) => row.enabled && row.name.trim().toLowerCase() === "authorization")) auth = "none";
  // An explicit auth mode generates one Authorization header, replacing inherited/manual defaults.
  if (auth !== "none") headers = headers.filter((row) => row.name.trim().toLowerCase() !== "authorization");
  return {
    ...request, headers, auth,
    username: request.auth === "inherit" ? environment?.username ?? "" : request.username,
    credential: request.auth === "inherit" && environment ? environmentCredential(environment) : request.credential,
  };
}
