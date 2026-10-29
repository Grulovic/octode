import type { ValueRow } from "../toolTypes";
/** A non-secret preview only; sending still uses native validation and resolution. */
export function resolvedPublicUrl(url: string, variables: ValueRow[], params: ValueRow[] = []): string | null {
  let safe = true;
  const expand = (value: string) => value.replace(/\{\{([^{}]+)\}\}/g, (_, name: string) => {
    const variable = variables.find((item) => item.enabled && item.name === name.trim());
    if (!variable || variable.secret || variable.hasSecret || /\{\{/.test(variable.value)) {
      safe = false;
      return "";
    }
    return variable.value;
  });
  const resolved = expand(url);
  if (!safe || /^\w+:\/\/[^/]*@/.test(resolved)) return null;
  const enabled = params.filter((item) => item.enabled && item.name.trim());
  if (!enabled.length) return resolved;
  try {
    const preview = new URL(resolved);
    for (const param of enabled) {
      if (param.secret || param.hasSecret) return null;
      preview.searchParams.append(expand(param.name), expand(param.value));
    }
    return safe ? preview.toString() : null;
  } catch { return null; }
}
