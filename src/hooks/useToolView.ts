import { useState, useCallback } from "react";
export function useToolView<T>(
  projectId: string,
  name: string,
  fallback: T,
): [T, (value: T | ((previous: T) => T)) => void] {
  const key = `octode-view:${projectId}:${name}`;
  const [value, setValue] = useState<T>(() => {
    try {
      return JSON.parse(localStorage.getItem(key) ?? "null") ?? fallback;
    } catch {
      return fallback;
    }
  });
  const update = useCallback(
    (next: T | ((previous: T) => T)) =>
      setValue((previous) => {
        const value =
          typeof next === "function"
            ? (next as (previous: T) => T)(previous)
            : next;
        localStorage.setItem(key, JSON.stringify(value));
        return value;
      }),
    [key],
  );
  return [value, update];
}
