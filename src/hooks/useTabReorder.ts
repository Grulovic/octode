import { useEffect, useRef, useState, type MouseEvent } from "react";

// Mouse dragging also works in WKWebView, where native HTML dragging is unreliable.
export function useTabReorder(onMove: (source: string, target: string, after: boolean) => void) {
  const container = useRef<HTMLDivElement>(null);
  const move = useRef(onMove);
  move.current = onMove;
  const drag = useRef<{ id: string; x: number; y: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const [drop, setDrop] = useState<{ id: string; after: boolean } | null>(null);
  useEffect(() => {
    const targetAt = (event: globalThis.MouseEvent) => {
      const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-reorder-tab]");
      if (!target || !container.current?.contains(target)) return null;
      const rect = target.getBoundingClientRect();
      return { id: target.dataset.reorderTab!, after: event.clientX > rect.left + rect.width / 2 };
    };
    const moving = (event: globalThis.MouseEvent) => {
      const item = drag.current;
      if (!item || (!item.moved && Math.hypot(event.clientX - item.x, event.clientY - item.y) < 6)) return;
      item.moved = true;
      event.preventDefault();
      const bounds = container.current?.getBoundingClientRect();
      if (bounds && container.current) {
        if (event.clientX < bounds.left + 24) container.current.scrollLeft -= 20;
        else if (event.clientX > bounds.right - 24) container.current.scrollLeft += 20;
      }
      setDrop(targetAt(event));
    };
    const finish = (event: globalThis.MouseEvent) => {
      const item = drag.current;
      drag.current = null;
      if (item?.moved) {
        const target = targetAt(event);
        if (target) move.current(item.id, target.id, target.after);
        suppressClick.current = true;
        setTimeout(() => { suppressClick.current = false; }, 0);
      }
      setDrop(null);
    };
    const cancel = () => { drag.current = null; setDrop(null); };
    window.addEventListener("mousemove", moving);
    window.addEventListener("mouseup", finish);
    window.addEventListener("blur", cancel);
    return () => {
      window.removeEventListener("mousemove", moving);
      window.removeEventListener("mouseup", finish);
      window.removeEventListener("blur", cancel);
    };
  }, []);
  return {
    container,
    tabProps: (id: string) => ({
      "data-reorder-tab": id,
      "data-drop-edge": drop?.id === id ? (drop.after ? "after" : "before") : undefined,
      draggable: false,
      onMouseDown: (event: MouseEvent) => {
        if (event.button !== 0 || (event.target as Element).closest('button[aria-label^="Close"]')) return;
        drag.current = { id, x: event.clientX, y: event.clientY, moved: false };
      },
      onClickCapture: (event: MouseEvent) => {
        if (suppressClick.current) { event.preventDefault(); event.stopPropagation(); }
      },
    }),
  };
}

export function moveTab<T>(items: T[], source: string, target: string, after: boolean, key: (item: T) => string): T[] {
  if (source === target || !items.some((item) => key(item) === target)) return items;
  const item = items.find((item) => key(item) === source);
  if (!item) return items;
  const remaining = items.filter((item) => key(item) !== source);
  remaining.splice(remaining.findIndex((item) => key(item) === target) + Number(after), 0, item);
  return remaining;
}
