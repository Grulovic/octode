import type { ApiDocument, ApiRequest, ValueRow } from "../toolTypes";
import { apiDocument, apiRequest, id, row } from "./toolDefaults";
const sensitive = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "api-key",
]);
export function exportCollection(document: ApiDocument): string {
  const sanitize = (value: unknown, key = ""): unknown => {
    if (Array.isArray(value)) return value.map((item) => sanitize(item));
    if (value && typeof value === "object") {
      const item = value as Record<string, unknown>;
      const secret =
        item.secret === true ||
        (typeof item.name === "string" &&
          sensitive.has(item.name.toLowerCase())) ||
        ["password", "passphrase", "credential"].includes(key);
      return Object.fromEntries(
        Object.entries(item).map(([name, value]) => [
          name,
          name === "value" && secret
            ? ""
            : name === "hasSecret"
              ? false
              : sanitize(value, name),
        ]),
      );
    }
    return value;
  };
  return JSON.stringify(
    { format: "octode-api", version: 1, document: sanitize(document) },
    null,
    2,
  );
}
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const string = (value: unknown, fallback = "") =>
  typeof value === "string" ? value : fallback;
const rows = (value: unknown): ValueRow[] =>
  Array.isArray(value)
    ? value.slice(0, 200).map((raw) => {
        const item = record(raw);
        return {
          ...row(string(item.key ?? item.name), string(item.value)),
          file: item.file === true,
          enabled: item.disabled !== true && item.enabled !== false,
          secret:
            item.secret === true ||
            sensitive.has(string(item.key ?? item.name).toLowerCase()),
        };
      })
    : [];
export function importCollection(raw: string): ApiDocument {
  if (raw.length > 4 * 1024 * 1024) throw new Error("Collection exceeds 4 MB.");
  const parsed = record(JSON.parse(raw));
  const out = apiDocument();
  const source = record(parsed.document ?? parsed);
  if (Array.isArray(source.requests) && source.version === 1) {
    const folders = new Map<string, string>();
    for (const raw of (Array.isArray(source.folders)
      ? source.folders
      : []
    ).slice(0, 200)) {
      const folder = record(raw);
      const newId = id();
      folders.set(string(folder.id), newId);
      out.folders.push({
        id: newId,
        name: string(folder.name, "Imported folder"),
      });
    }
    for (const raw of source.requests.slice(0, 1000)) {
      const item = record(raw);
      const request = apiRequest();
      Object.assign(request, {
        name: string(item.name, "Imported request"),
        method: string(item.method, "GET").toUpperCase(),
        url: string(item.url),
        folderId: folders.get(string(item.folderId)) ?? "",
        headers: rows(item.headers),
        params: rows(item.params),
        form: rows(item.form),
        body: string(item.body),
        bodyMode: ["none", "json", "text", "form", "multipart"].includes(
          string(item.bodyMode),
        )
          ? item.bodyMode
          : "none",
        auth: ["none", "bearer", "basic"].includes(string(item.auth))
          ? item.auth
          : "none",
        username: string(item.username),
        timeoutSeconds: Math.max(
          1,
          Math.min(300, Number(item.timeoutSeconds) || 30),
        ),
      });
      request.credential.value = string(record(item.credential).value);
      out.requests.push(request);
    }
    for (const raw of (Array.isArray(source.environments)
      ? source.environments
      : []
    ).slice(0, 100)) {
      const item = record(raw);
      out.environments.push({
        id: id(),
        name: string(item.name, "Imported environment"),
        variables: rows(item.variables),
      });
    }
    return out;
  }
  if (!Array.isArray(parsed.item))
    throw new Error("Choose an Octode export or a Postman v2 collection.");
  const visit = (items: unknown[], folderId = "", prefix = "", depth = 0) => {
    if (depth > 12)
      throw new Error("Collection folder nesting exceeds 12 levels.");
    for (const raw of items) {
      if (out.requests.length >= 1000 || out.folders.length >= 200)
        throw new Error(
          "Collection is too large (1,000 requests / 200 folders).",
        );
      const item = record(raw);
      const name = string(item.name, "Imported request");
      if (Array.isArray(item.item)) {
        const folder = {
          id: id(),
          name: prefix ? `${prefix} / ${name}` : name,
        };
        out.folders.push(folder);
        visit(item.item, folder.id, folder.name, depth + 1);
        continue;
      }
      const source =
        typeof item.request === "string"
          ? { url: item.request }
          : record(item.request);
      const request = apiRequest();
      request.folderId = folderId;
      request.name = name;
      request.method = string(source.method, "GET").toUpperCase();
      const url = record(source.url);
      request.url =
        typeof source.url === "string" ? source.url : string(url.raw);
      request.headers = rows(source.header);
      request.params = rows(url.query);
      // Postman raw URLs usually already contain their query string; params are represented only once.
      if (request.params.length) {
        const position = request.url.indexOf("?");
        if (position >= 0) request.url = request.url.slice(0, position);
      }
      const body = record(source.body);
      if (body.mode === "raw") {
        request.body = string(body.raw);
        request.bodyMode =
          record(record(body.options).raw).language === "json"
            ? "json"
            : "text";
      } else if (body.mode === "urlencoded") {
        request.bodyMode = "form";
        request.form = rows(body.urlencoded);
      } else if (body.mode === "formdata") {
        request.bodyMode = "multipart";
        request.form = rows(body.formdata);
        if (
          (body.formdata as unknown[]).some(
            (raw) => record(raw).type === "file",
          )
        )
          throw new Error(
            "Imported multipart file fields need local files; remove those fields from the import and add them in Octode.",
          );
      }
      const auth = record(source.auth);
      if (auth.type === "bearer") {
        request.auth = "bearer";
        request.credential.value =
          rows(auth.bearer).find((value) => value.name === "token")?.value ??
          "";
      } else if (auth.type === "basic") {
        request.auth = "basic";
        const basic = rows(auth.basic);
        request.username =
          basic.find((value) => value.name === "username")?.value ?? "";
        request.credential.value =
          basic.find((value) => value.name === "password")?.value ?? "";
      }
      out.requests.push(request);
    }
  };
  visit(parsed.item);
  if (Array.isArray(parsed.variable))
    out.environments.push({
      id: id(),
      name: string(record(parsed.info).name, "Collection variables"),
      variables: rows(parsed.variable),
    });
  return out;
}
export function prettyResponse(body: string) {
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
}
export function mergeCollection(
  current: ApiDocument,
  incoming: ApiDocument,
): ApiDocument {
  if (current.requests.length + incoming.requests.length > 1000)
    throw new Error("This project would exceed 1,000 requests.");
  return {
    version: 1,
    folders: [...current.folders, ...incoming.folders],
    requests: [...current.requests, ...incoming.requests],
    environments: [...current.environments, ...incoming.environments],
  };
}
export function boundedHistory<T extends { response: { body: string } }>(
  items: T[],
) {
  let bytes = 0;
  return items.slice(0, 12).filter((item) => {
    bytes += item.response.body.length;
    return bytes <= 8 * 1024 * 1024;
  });
}

export function duplicateRequest(
  request: ApiRequest,
  names: string[],
): ApiRequest {
  const copy = structuredClone(request);
  copy.id = id();
  const base = `${request.name} copy`;
  copy.name = base;
  for (let number = 2; names.includes(copy.name); number++)
    copy.name = `${base} ${number}`;
  // Saved credential references are immutable: editing a value creates a new vault ID on Save.
  // Keep those references so the copy retains auth without exposing secrets to the frontend.
  if (!copy.credential.hasSecret) copy.credential.id = id();
  for (const values of [copy.headers, copy.params, copy.form]) {
    for (const value of values) if (!value.hasSecret) value.id = id();
  }
  return copy;
}
