import type { DbTable } from "../toolTypes";
export const tableKey = (table: DbTable) => JSON.stringify([table.schema, table.name]);
export interface TransferProgress {
  phase: string;
  rows: number;
  bytes: number;
  totalBytes: number | null;
  table: string;
}
export interface TransferSummary { rows: number; bytes: number; tables: number }
export interface ImportPreview {
  token: string;
  name: string;
  bytes: number;
  preview: string;
  truncated: boolean;
  rows: number;
  statements: number;
  headers: string[];
  sample: string[][];
}
export function transferSize(bytes: number) {
  if (bytes < 1024) return `${bytes.toLocaleString()} B`;
  const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), 4);
  return `${(bytes / 1024 ** unit).toLocaleString(undefined, { maximumFractionDigits: 1 })} ${["B", "KB", "MB", "GB", "TB"][unit]}`;
}
