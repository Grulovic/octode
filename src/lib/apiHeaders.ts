import type { ValueRow } from "../toolTypes";

/** Enabled request headers replace environment defaults, case-insensitively. */
export function inheritHeaders(environment: ValueRow[], request: ValueRow[]): ValueRow[] {
  const names = new Set(request.filter((row) => row.enabled && row.name.trim()).map((row) => row.name.trim().toLowerCase()));
  return [...environment.filter((row) => !names.has(row.name.trim().toLowerCase())), ...request];
}
