import type { MouseEvent } from "react";
const released = new WeakMap<EventTarget, number>();
export function middleClose(event: MouseEvent, close: () => void) {
  if (event.button !== 1) return;
  event.preventDefault();
  event.stopPropagation();
  // WKWebView versions differ in auxclick support. Mouse release is the
  // fallback; ignore the following auxclick when both events are dispatched.
  const target = event.currentTarget;
  if (
    event.type === "auxclick" &&
    Date.now() - (released.get(target) ?? -Infinity) < 1000
  )
    return;
  if (event.type === "mouseup") released.set(target, Date.now());
  close();
}
