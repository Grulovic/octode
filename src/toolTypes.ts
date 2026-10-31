export interface SecretValue {
  id: string;
  value: string;
  secret: true;
  hasSecret?: boolean;
}
export interface ValueRow {
  id: string;
  name: string;
  value: string;
  enabled: boolean;
  secret?: boolean;
  hasSecret?: boolean;
  file?: boolean;
}
export interface ApiRequest {
  id: string;
  name: string;
  folderId: string;
  method: string;
  url: string;
  headers: ValueRow[];
  params: ValueRow[];
  bodyMode: "none" | "json" | "text" | "form" | "multipart";
  body: string;
  form: ValueRow[];
  auth: "inherit" | "none" | "bearer" | "basic";
  username: string;
  credential: SecretValue;
  timeoutSeconds: number;
}
export interface ApiEnvironment {
  id: string;
  name: string;
  variables: ValueRow[];
  headers?: ValueRow[];
  auth?: "none" | "bearer" | "basic";
  username?: string;
  credential?: SecretValue;
}
export interface ApiFolder { id: string; name: string; parentId?: string }
export interface ApiDocument {
  version: 1;
  folders: ApiFolder[];
  requests: ApiRequest[];
  environments: ApiEnvironment[];
}
export interface ApiResponse {
  status: number;
  statusText: string;
  headers: [string, string][];
  body: string;
  bytes: number;
  elapsedMs: number;
  truncated: boolean;
  contentType: string;
  binary: boolean;
}
export interface ServerConnection {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  auth: "password" | "key" | "agent";
  password: SecretValue;
  keyPath: string;
  passphrase: SecretValue;
  fingerprint: string;
}
export interface ServerDocument {
  version: 1;
  connections: ServerConnection[];
}
export interface RemoteEntry {
  name: string;
  path: string;
  directory: boolean;
  size: number;
  modified: number | null;
}
export interface DatabaseConnection {
  id: string;
  name: string;
  engine: "sqlite" | "mysql" | "postgres";
  host: string;
  port: number;
  database: string;
  username: string;
  password: SecretValue;
  file: string;
  tls: "verify" | "require" | "disable";
  readOnly: boolean;
  sshId: string;
}
export interface DatabaseDocument {
  version: 1;
  connections: DatabaseConnection[];
  queries: { id: string; name: string; connectionId: string; sql: string }[];
}
export interface DbTable {
  schema: string;
  name: string;
}
export interface DbColumn {
  name: string;
  dataType: string;
  nullable: boolean;
  primaryKey: boolean;
  defaultValue: string | null;
}
export interface DbCell {
  kind: "null" | "text" | "binary" | "unsupported";
  value: string;
}
export interface DbResult {
  columns: { name: string; dataType: string }[];
  rows: DbCell[][];
  rowsAffected: number;
  elapsedMs: number;
  truncated: boolean;
}
export type ToolDocument = ApiDocument | ServerDocument | DatabaseDocument;
export type SavedTool = "api" | "servers" | "database";
