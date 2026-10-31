import type {
  ApiDocument,
  ApiRequest,
  DatabaseConnection,
  DatabaseDocument,
  SecretValue,
  ServerConnection,
  ServerDocument,
  ValueRow,
} from "../toolTypes";
export const id = () => crypto.randomUUID();
export const secret = (): SecretValue => ({
  id: id(),
  value: "",
  secret: true,
});
export const row = (name = "", value = ""): ValueRow => ({
  id: id(),
  name,
  value,
  enabled: true,
});
export const apiDocument = (): ApiDocument => ({
  version: 1,
  folders: [],
  requests: [],
  environments: [],
});
export const serverDocument = (): ServerDocument => ({
  version: 1,
  connections: [],
});
export const databaseDocument = (): DatabaseDocument => ({
  version: 1,
  connections: [],
  queries: [],
});
export const apiRequest = (): ApiRequest => ({
  id: id(),
  name: "Untitled request",
  folderId: "",
  method: "GET",
  url: "",
  headers: [],
  params: [],
  bodyMode: "none",
  body: "",
  form: [],
  auth: "inherit",
  username: "",
  credential: secret(),
  timeoutSeconds: 30,
});
export const serverConnection = (): ServerConnection => ({
  id: id(),
  name: "New server",
  host: "",
  port: 22,
  username: "",
  auth: "agent",
  password: secret(),
  keyPath: "",
  passphrase: secret(),
  fingerprint: "",
});
export const databaseConnection = (): DatabaseConnection => ({
  id: id(),
  name: "New database",
  engine: "sqlite",
  host: "127.0.0.1",
  port: 5432,
  database: "",
  username: "",
  password: secret(),
  file: "",
  tls: "verify",
  readOnly: true,
  sshId: "",
});
export function dirtyDraft(current: unknown, saved: unknown) {
  return JSON.stringify(current) !== JSON.stringify(saved);
}
