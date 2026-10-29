/** Adopt sealed credential references without overwriting edits made during Save. */
export function acknowledgeToolSave<T>(current: T, snapshot: T, saved: T): T {
  if (current === snapshot) return saved;
  const merge = (now: any, before: any, after: any): any => {
    if (now === before) return after;
    if (!now || !before || !after || typeof now !== "object" || typeof before !== "object" || typeof after !== "object") return now;
    if (Array.isArray(now)) {
      if (!Array.isArray(before) || !Array.isArray(after)) return now;
      const positions = new Map(before.map((item, index) => [item?.id, index]));
      return now.map((item) => {
        if (!item || typeof item !== "object" || typeof item.id !== "string") return item;
        const index = positions.get(item.id);
        return index !== undefined && index < after.length ? merge(item, before[index], after[index]) : item;
      });
    }
    const result = { ...now };
    const sealed = after.secret === true && after.hasSecret === true && after.value === "";
    const sameDraft = now.id === before.id && now.value === before.value && now.secret === before.secret && now.hasSecret === before.hasSecret;
    if (sealed && sameDraft) {
      result.id = after.id;
      result.value = "";
      result.secret = true;
      result.hasSecret = true;
    }
    for (const key of Object.keys(now)) {
      if (sealed && ["id", "value", "secret", "hasSecret"].includes(key)) continue;
      if (Object.hasOwn(before, key) && Object.hasOwn(after, key)) result[key] = merge(now[key], before[key], after[key]);
    }
    return result;
  };
  return merge(current, snapshot, saved) as T;
}
