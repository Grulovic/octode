/** Describe changed fields without exposing passwords, tokens or request contents. */
export function toolChanges(current: unknown, saved: unknown): string[] {
  const changes: string[] = [];
  const label = (key: string) =>
    key
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/^./, (letter) => letter.toUpperCase());
  const equal = (a: unknown, b: unknown) =>
    JSON.stringify(a) === JSON.stringify(b);
  const walk = (a: any, b: any, path: string) => {
    if (equal(a, b)) return;
    if (Array.isArray(a) && Array.isArray(b)) {
      const identified = [...a, ...b].every(
        (item) =>
          item && typeof item === "object" && typeof item.id === "string",
      );
      if (!identified) {
        changes.push(`${path} changed`);
        return;
      }
      const old = new Map(b.map((item) => [item.id, item]));
      const next = new Map(a.map((item) => [item.id, item]));
      for (const item of a) {
        const location = `${path} › ${item.name || item.id}`;
        if (!old.has(item.id)) changes.push(`${location} added`);
        else walk(item, old.get(item.id), location);
      }
      for (const item of b)
        if (!next.has(item.id))
          changes.push(`${path} › ${item.name || item.id} removed`);
      if (
        a.length === b.length &&
        a.every((item) => old.has(item.id)) &&
        a.some((item, index) => item.id !== b[index]?.id)
      )
        changes.push(`${path} reordered`);
      return;
    }
    if (a && b && typeof a === "object" && typeof b === "object") {
      if (
        a.secret === true ||
        b.secret === true ||
        "hasSecret" in a ||
        "hasSecret" in b
      ) {
        changes.push(`${path} changed (secret value hidden)`);
        return;
      }
      for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
        if (key === "id" || key === "version") continue;
        walk(a[key], b[key], path ? `${path} › ${label(key)}` : label(key));
      }
      return;
    }
    changes.push(`${path} changed`);
  };
  walk(current, saved, "");
  return changes;
}
export function changedIds(current: { id: string }[], saved: { id: string }[]) {
  const old = new Map(saved.map((item) => [item.id, JSON.stringify(item)]));
  return new Set(
    current
      .filter((item) => old.get(item.id) !== JSON.stringify(item))
      .map((item) => item.id),
  );
}
