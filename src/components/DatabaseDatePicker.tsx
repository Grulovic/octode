import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CalendarDays, ChevronLeft, ChevronRight } from "./DesignIcons";
import {
  calendarDays,
  dateParts,
  moveCalendarMonth,
  pickedDate,
  validCellDate,
  type CellDateKind,
} from "../lib/databaseDate";
export default function DatabaseDatePicker({
  kind,
  value,
  disabled,
  owner,
  onChange,
  onDone,
  onOpenChange,
}: {
  kind: CellDateKind;
  value: string;
  disabled: boolean;
  owner: string;
  onChange: (value: string) => void;
  onDone: () => void;
  onOpenChange: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [month, setMonth] = useState("");
  const [error, setError] = useState("");
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const openCallback = useRef(onOpenChange);
  openCallback.current = onOpenChange;
  const setPickerOpen = (value: boolean) => {
    openCallback.current(value);
    setOpen(value);
  };
  const close = () => {
    trigger.current?.focus();
    setPickerOpen(false);
  };
  useEffect(() => () => openCallback.current(false), []);
  useLayoutEffect(() => {
    if (!open) return;
    const locate = () => {
      if (!trigger.current?.isConnected) {
        setPickerOpen(false);
        return;
      }
      const rect = trigger.current.getBoundingClientRect();
      const height = popup.current?.getBoundingClientRect().height || 390;
      setPosition({
        left: Math.max(8, Math.min(rect.left, window.innerWidth - 316)),
        top: Math.max(
          8,
          Math.min(rect.bottom + 6, window.innerHeight - height - 8),
        ),
      });
    };
    locate();
    popup.current
      ?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')
      ?.focus();
    const outside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !trigger.current?.contains(event.target) &&
        !popup.current?.contains(event.target)
      )
        close();
    };
    document.addEventListener("pointerdown", outside, true);
    window.addEventListener("resize", locate);
    window.addEventListener("scroll", locate, true);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("resize", locate);
      window.removeEventListener("scroll", locate, true);
    };
  }, [open]);
  const host =
    trigger.current?.closest(".service-tool") ?? trigger.current?.parentElement;
  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-label="Choose date"
        aria-expanded={open}
        aria-haspopup="dialog"
        disabled={disabled}
        title="Choose a date; you can also type in the text field"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          if (open) {
            close();
            return;
          }
          const parts = dateParts(value);
          const today = new Date();
          const fallback = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
          const initial = validCellDate(parts.date) ? parts.date : fallback;
          setDate(initial);
          setMonth(initial.slice(0, 7));
          setTime(parts.time);
          setError("");
          setPickerOpen(true);
        }}
      >
        <CalendarDays size={15} />
      </button>
      {open &&
        host &&
        createPortal(
          <div
            ref={popup}
            data-db-date-picker={owner}
            className="database-date-popup"
            style={position}
            role="dialog"
            aria-label="Choose cell date"
            onMouseDown={(event) => {
              // WebKit mouse clicks on buttons can blur to body instead of the
              // button. Keep focus for calendar controls; allow text input focus.
              if (
                !(event.target instanceof Element) ||
                !event.target.closest("input, textarea, select")
              )
                event.preventDefault();
            }}
            onBlur={(event) => {
              if (
                event.relatedTarget instanceof Node &&
                !event.currentTarget.contains(event.relatedTarget) &&
                !trigger.current?.contains(event.relatedTarget)
              )
                setPickerOpen(false);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                close();
              }
            }}
          >
            <header>
              <button
                type="button"
                aria-label="Previous month"
                onClick={() => setMonth(moveCalendarMonth(month, -1))}
              >
                <ChevronLeft size={16} />
              </button>
              <strong>
                {new Intl.DateTimeFormat("en", {
                  month: "long",
                  year: "numeric",
                  timeZone: "UTC",
                }).format(new Date(`${month}-01T12:00:00Z`))}
              </strong>
              <button
                type="button"
                aria-label="Next month"
                onClick={() => setMonth(moveCalendarMonth(month, 1))}
              >
                <ChevronRight size={16} />
              </button>
            </header>
            <div className="database-calendar-days">
              <div className="database-calendar-week">
                {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((day) => (
                  <span key={day}>{day}</span>
                ))}
              </div>
              <div className="database-calendar-grid">
                {calendarDays(month).map((day) => (
                  <button
                    type="button"
                    key={day}
                    aria-label={`Choose ${day}`}
                    aria-pressed={day === date}
                    className={day.slice(0, 7) !== month ? "other-month" : ""}
                    onClick={() => setDate(day)}
                    onKeyDown={(event) => {
                      const offset = (
                        {
                          ArrowLeft: -1,
                          ArrowRight: 1,
                          ArrowUp: -7,
                          ArrowDown: 7,
                        } as Record<string, number>
                      )[event.key];
                      if (!offset) return;
                      event.preventDefault();
                      event.stopPropagation();
                      const next = new Date(
                        new Date(`${day}T12:00:00Z`).valueOf() +
                          offset * 86400000,
                      )
                        .toISOString()
                        .slice(0, 10);
                      setDate(next);
                      setMonth(next.slice(0, 7));
                      requestAnimationFrame(() =>
                        popup.current
                          ?.querySelector<HTMLButtonElement>(
                            `[aria-label="Choose ${next}"]`,
                          )
                          ?.focus(),
                      );
                    }}
                  >
                    {Number(day.slice(-2))}
                  </button>
                ))}
              </div>
            </div>
            {kind === "datetime" && (
              <label className="database-calendar-time">
                Time
                <input
                  aria-label="Date picker time"
                  value={time}
                  placeholder="HH:mm:ss"
                  onChange={(event) => setTime(event.target.value)}
                />
              </label>
            )}
            <p>
              {date}
              {kind === "datetime" ? ` ${time}` : ""}
            </p>
            {error && <p role="alert">{error}</p>}
            <footer>
              <button
                type="button"
                className="secondary-button"
                onClick={close}
              >
                Cancel
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={() => {
                  try {
                    const next = pickedDate(kind, date, time, value);
                    onChange(next);
                    close();
                    onDone();
                  } catch (reason) {
                    setError(String(reason).replace(/^Error: /, ""));
                  }
                }}
              >
                Use date
              </button>
            </footer>
          </div>,
          host,
        )}
    </>
  );
}
