import { useCallback, useEffect, useRef, useState } from "react";

/** Briefly lights on output; keeps the light on for output received while hidden. */
export function useTerminalActivity(visible: boolean, onChange?: (active: boolean) => void) {
  const [active, setActive] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const callback = useRef(onChange);
  callback.current = onChange;
  const output = useCallback(() => {
    clearTimeout(timer.current);
    setActive(true);
    if (visibleRef.current) timer.current = setTimeout(() => setActive(false), 1000);
  }, []);
  useEffect(() => {
    if (visible) { clearTimeout(timer.current); setActive(false); }
  }, [visible]);
  useEffect(() => { callback.current?.(active); }, [active]);
  useEffect(() => () => { clearTimeout(timer.current); callback.current?.(false); }, []);
  return { active, output };
}
