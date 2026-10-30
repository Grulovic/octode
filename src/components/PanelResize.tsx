import { useEffect, useRef, useState, type RefObject } from "react";

export function usePanelSize(key: string, fallback: number) {
  const [size, setSize] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(key));
      return Number.isFinite(saved) && saved >= 150 && saved <= 1600
        ? saved
        : fallback;
    } catch {
      return fallback;
    }
  });
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(key, String(size));
      } catch {
        /* Layout remains usable without storage. */
      }
    }, 120);
    return () => {
      clearTimeout(timer);
      try {
        localStorage.setItem(key, String(size));
      } catch {
        /* Best effort. */
      }
    };
  }, [key, size]);
  return [size, setSize] as const;
}

export default function PanelResize({
  target,
  size,
  axis = "x",
  onResize,
  label,
  className = "",
  title,
  minSize = 160,
}: {
  target: RefObject<HTMLElement | null>;
  size: number;
  axis?: "x" | "y";
  onResize: (size: number) => void;
  label: string;
  className?: string;
  title?: string;
  minSize?: number;
}) {
  const drag = useRef<{ start: number; size: number } | null>(null);
  const latest = useRef(onResize);
  latest.current = onResize;
  const limits = () => {
    const parent =
      axis === "y"
        ? ((target.current?.closest(
            ".main-workspace, .service-right, .editor-section",
          ) as HTMLElement | null) ?? target.current?.parentElement)
        : target.current?.parentElement;
    const available = axis === "x" ? parent?.clientWidth : parent?.clientHeight;
    return {
      min: minSize,
      max: Math.max(
        minSize,
        Math.min(
          axis === "x" ? 640 : 1600,
          (available ?? 800) - (axis === "x" ? 320 : 140),
        ),
      ),
    };
  };
  const change = (size: number) => {
    const { min, max } = limits();
    latest.current(Math.round(Math.max(min, Math.min(max, size))));
  };
  useEffect(() => {
    const move = (event: PointerEvent | MouseEvent) => {
      if (!drag.current) return;
      event.preventDefault();
      const coordinate = axis === "x" ? event.clientX : event.clientY;
      change(
        drag.current.size +
          (coordinate - drag.current.start) * (axis === "x" ? 1 : -1),
      );
    };
    const end = () => {
      if (!drag.current) return;
      drag.current = null;
      document.documentElement.classList.remove(
        "resizing-panels",
        "resizing-panels-y",
      );
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("mousemove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("mouseup", end);
    window.addEventListener("pointercancel", end);
    window.addEventListener("blur", end);
    return () => {
      end();
      window.removeEventListener("pointermove", move);
      window.removeEventListener("mousemove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("mouseup", end);
      window.removeEventListener("pointercancel", end);
      window.removeEventListener("blur", end);
    };
  }, [axis, minSize]);
  const begin = (
    event:
      | React.PointerEvent<HTMLDivElement>
      | React.MouseEvent<HTMLDivElement>,
  ) => {
    if (event.button !== 0 || !target.current) return;
    event.preventDefault();
    event.currentTarget.focus();
    const rectangle = target.current.getBoundingClientRect();
    if ("pointerId" in event)
      event.currentTarget.setPointerCapture?.(event.pointerId);
    drag.current = {
      start: axis === "x" ? event.clientX : event.clientY,
      size: axis === "x" ? rectangle.width : rectangle.height,
    };
    document.documentElement.classList.add("resizing-panels");
    if (axis === "y")
      document.documentElement.classList.add("resizing-panels-y");
  };
  return (
    <div
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-valuenow={size}
      aria-valuemin={limits().min}
      aria-valuemax={limits().max}
      aria-orientation={axis === "x" ? "vertical" : "horizontal"}
      className={`panel-resize panel-resize-${axis} ${className}`}
      title={
        title ??
        (axis === "x"
          ? "Drag to resize sidebar"
          : "Drag upward to enlarge terminal")
      }
      onPointerDown={begin}
      onMouseDown={begin}
      onKeyDown={(event) => {
        const direction =
          axis === "x"
            ? { ArrowLeft: -1, ArrowRight: 1 }
            : { ArrowUp: 1, ArrowDown: -1 };
        const amount = direction[event.key as keyof typeof direction];
        if (!amount || !target.current) return;
        event.preventDefault();
        const rectangle = target.current.getBoundingClientRect();
        change(
          (axis === "x" ? rectangle.width : rectangle.height) +
            amount * (event.shiftKey ? 40 : 10),
        );
      }}
    >
      <span aria-hidden="true" />
    </div>
  );
}
