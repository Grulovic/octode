import {
  Children,
  Fragment,
  isValidElement,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type SelectHTMLAttributes,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "./DesignIcons";
import "./custom-select.css";
interface Option {
  value: string;
  label: string;
  disabled: boolean;
  method?: string;
}
function text(children: ReactNode): string {
  return Children.toArray(children)
    .map((child) =>
      isValidElement<{ children?: ReactNode }>(child)
        ? text(child.props.children)
        : String(child),
    )
    .join("");
}
function optionsFrom(children: ReactNode, disabled = false): Option[] {
  const result: Option[] = [];
  Children.forEach(children, (child) => {
    if (
      !isValidElement<{
        children?: ReactNode;
        value?: string | number;
        label?: string;
        disabled?: boolean;
        "data-method"?: string;
      }>(child)
    )
      return;
    if (child.type === "option") {
      const label = child.props.label ?? text(child.props.children);
      result.push({
        label,
        value: String(child.props.value ?? text(child.props.children)),
        disabled: disabled || !!child.props.disabled,
        method: child.props["data-method"],
      });
    } else if (child.type === Fragment || child.type === "optgroup")
      result.push(
        ...optionsFrom(
          child.props.children,
          disabled || !!child.props.disabled,
        ),
      );
  });
  return result;
}
export default function CustomSelect(
  props: SelectHTMLAttributes<HTMLSelectElement> & {
    renderLabel?: (value: string, label: string) => ReactNode;
    triggerContent?: ReactNode;
  },
) {
  const {
    children,
    renderLabel,
    triggerContent,
    value,
    defaultValue,
    disabled,
    className = "",
    style,
    id: providedId,
    title,
    autoFocus,
    tabIndex,
    ...rest
  } = props;
  const generatedId = useId();
  const id = providedId ?? `select-${generatedId}`;
  const native = useRef<HTMLSelectElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [label, setLabel] = useState("");
  const [uncontrolled, setUncontrolled] = useState(() =>
    String(defaultValue ?? ""),
  );
  const options = useMemo(() => optionsFrom(children), [children]);
  const selectedValue = String(
    value ??
      (defaultValue !== undefined || uncontrolled
        ? uncontrolled
        : (options[0]?.value ?? "")),
  );
  const selected = options.findIndex(
    (option) => option.value === selectedValue,
  );
  const buffer = useRef({ text: "", time: 0 });
  const blocked = () => !!disabled || !!trigger.current?.matches(":disabled");
  useLayoutEffect(() => {
    const parentLabel =
      native.current?.labels?.[0] ??
      trigger.current?.closest("label") ??
      [...document.querySelectorAll("label")].find(
        (item) => item.htmlFor === id,
      );
    if (parentLabel) {
      const caption =
        parentLabel.querySelector("span")?.textContent ??
        [...parentLabel.childNodes]
          .filter((node) => node.nodeType === Node.TEXT_NODE)
          .map((node) => node.textContent)
          .join("");
      setLabel(caption?.trim() ?? "");
      const previous = parentLabel.getAttribute("for");
      parentLabel.htmlFor = id;
      return () => {
        if (parentLabel.htmlFor === id) {
          if (previous === null) parentLabel.removeAttribute("for");
          else parentLabel.setAttribute("for", previous);
        }
      };
    }
  }, [id]);
  const show = (index = selected) => {
    if (blocked()) return;
    if (!open) window.dispatchEvent(new Event("octode-dismiss-popovers"));
    trigger.current?.focus({ preventScroll: true });
    buffer.current = { text: "", time: 0 };
    const next = options.findIndex(
      (option, i) => i >= Math.max(0, index) && !option.disabled,
    );
    setHighlight(
      next >= 0
        ? next
        : Math.max(
            0,
            options.findIndex((option) => !option.disabled),
          ),
    );
    setOpen(true);
  };
  useLayoutEffect(() => {
    if (open && blocked()) setOpen(false);
  });
  useEffect(() => {
    if (!open) buffer.current = { text: "", time: 0 };
  }, [open]);
  const choose = (index: number) => {
    const option = options[index];
    if (blocked() || !option || option.disabled || !native.current) return;
    if (value === undefined) setUncontrolled(option.value);
    // Keep one real form control and normal React change events; the native popup is never shown.
    native.current.value = option.value;
    native.current.dispatchEvent(new Event("change", { bubbles: true }));
    setOpen(false);
    trigger.current?.focus({ preventScroll: true });
  };
  useLayoutEffect(() => {
    if (!open || !trigger.current || !popup.current) return;
    if (blocked()) {
      setOpen(false);
      return;
    }
    const bounds = trigger.current.getBoundingClientRect();
    const below = window.innerHeight - bounds.bottom - 12,
      above = bounds.top - 12;
    const upward =
      below < Math.min(200, options.length * 36 + 12) && above > below;
    const height = Math.max(40, Math.min(320, upward ? above : below));
    const width = Math.min(Math.max(bounds.width, 180), window.innerWidth - 16);
    Object.assign(popup.current.style, {
      width: `${width}px`,
      maxHeight: `${height}px`,
      left: `${Math.max(8, Math.min(bounds.left, window.innerWidth - width - 8))}px`,
    });
    const actualHeight = Math.min(
      popup.current.scrollHeight || options.length * 36 + 12,
      height,
    );
    popup.current.style.top = `${Math.max(8, upward ? bounds.top - actualHeight - 4 : bounds.bottom + 4)}px`;
  }, [open, options.length, disabled]);
  useLayoutEffect(() => {
    if (!open || !popup.current) return;
    const row = popup.current.querySelector<HTMLElement>(
      `[data-index="${highlight}"]`,
    );
    if (!row) return;
    const viewport = popup.current.getBoundingClientRect(),
      bounds = row.getBoundingClientRect();
    if (bounds.top < viewport.top + 5)
      popup.current.scrollTop += bounds.top - viewport.top - 5;
    else if (bounds.bottom > viewport.bottom - 5)
      popup.current.scrollTop += bounds.bottom - viewport.bottom + 5;
  }, [highlight, open, options.length]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (
        !trigger.current?.contains(event.target as Node) &&
        !popup.current?.contains(event.target as Node)
      )
        setOpen(false);
    };
    const close = () => setOpen(false);
    const scroll = (event: Event) => {
      if (
        !(event.target instanceof Node) ||
        !popup.current?.contains(event.target)
      )
        close();
    };
    const shortcut = (event: globalThis.KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey) close();
    };
    window.addEventListener("pointerdown", outside, true);
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    window.addEventListener("scroll", scroll, true);
    window.addEventListener("keydown", shortcut, true);
    window.addEventListener("octode-dismiss-popovers", close);
    return () => {
      window.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("scroll", scroll, true);
      window.removeEventListener("keydown", shortcut, true);
      window.removeEventListener("octode-dismiss-popovers", close);
    };
  }, [open]);
  const keyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (blocked()) return;
    if (event.key === "Escape" && open) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      trigger.current?.focus();
      return;
    }
    if (event.key === "Tab") {
      setOpen(false);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (open) choose(highlight);
      else show();
      return;
    }
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      if (!open) {
        show(
          event.key === "End" || event.key === "ArrowUp"
            ? ([...options]
                .map((option, i) => (option.disabled ? -1 : i))
                .filter((i) => i >= 0)
                .at(-1) ?? 0)
            : event.key === "Home"
              ? 0
              : selected,
        );
        return;
      }
      const enabled = options
        .map((option, i) => (option.disabled ? -1 : i))
        .filter((i) => i >= 0);
      const current = enabled.indexOf(highlight);
      const next =
        event.key === "Home"
          ? enabled[0]
          : event.key === "End"
            ? enabled.at(-1)
            : enabled[
                (current +
                  (event.key === "ArrowDown" ? 1 : -1) +
                  enabled.length) %
                  enabled.length
              ];
      if (next !== undefined) setHighlight(next);
      return;
    }
    if (
      event.key.length === 1 &&
      !event.altKey &&
      !event.metaKey &&
      !event.ctrlKey
    ) {
      event.preventDefault();
      const now = Date.now();
      const typed =
        (now - buffer.current.time < 700 ? buffer.current.text : "") +
        event.key.toLocaleLowerCase();
      buffer.current = { text: typed.slice(-64), time: now };
      const query = [...typed].every((char) => char === typed[0])
        ? typed[0]
        : typed;
      const order = options.map((_, i) => (highlight + i + 1) % options.length);
      const match = order.find(
        (i) =>
          !options[i].disabled &&
          options[i].label.toLocaleLowerCase().startsWith(query),
      );
      if (match !== undefined) {
        if (!open) window.dispatchEvent(new Event("octode-dismiss-popovers"));
        setHighlight(match);
        setOpen(true);
      }
    }
  };
  const data = Object.fromEntries(
    Object.entries(rest).filter(([key]) => key.startsWith("data-")),
  );
  const name = props["aria-label"] ?? (label || undefined);
  const nativeControl = useMemo(
    () => (
      <select
        {...rest}
        ref={native}
        id={`${id}-native`}
        className="custom-select-native"
        hidden
        aria-hidden="true"
        tabIndex={-1}
        disabled={disabled}
        value={selectedValue}
        onChange={props.onChange}
      >
        {children}
      </select>
    ),
    [props, id, selectedValue],
  );
  return (
    <>
      {nativeControl}
      <button
        {...data}
        ref={trigger}
        id={id}
        type="button"
        role="combobox"
        className={`custom-select ${className}`}
        style={style}
        title={title}
        disabled={disabled}
        autoFocus={autoFocus}
        tabIndex={tabIndex}
        aria-label={name}
        aria-labelledby={props["aria-labelledby"]}
        aria-describedby={props["aria-describedby"]}
        aria-invalid={props["aria-invalid"]}
        aria-required={props.required || props["aria-required"]}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={open ? `${id}-options` : undefined}
        aria-activedescendant={
          open && options[highlight] ? `${id}-option-${highlight}` : undefined
        }
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={keyDown}
      >
        <span className="custom-select-label">
          {triggerContent ?? (options[selected]
            ? (renderLabel?.(
                options[selected].value,
                options[selected].label,
              ) ?? options[selected].label)
            : "Choose…")}
        </span>
        {triggerContent === undefined && <ChevronDown size={14} aria-hidden="true" />}
      </button>
      {open &&
        createPortal(
          <div
            ref={popup}
            id={`${id}-options`}
            className="custom-select-popup"
            role="listbox"
            aria-label={`${name ?? "Select"} options`}
            onKeyDown={keyDown}
          >
            {options.length ? (
              options.map((option, index) => (
                <button
                  key={`${option.value}:${index}`}
                  type="button"
                  role="option"
                  id={`${id}-option-${index}`}
                  data-index={index}
                  data-method={option.method}
                  aria-selected={option.value === selectedValue}
                  disabled={option.disabled}
                  tabIndex={-1}
                  className={`custom-select-option ${highlight === index ? "active" : ""}`}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseMove={() => !option.disabled && setHighlight(index)}
                  onClick={() => choose(index)}
                >
                  <span>
                    {renderLabel?.(option.value, option.label) ?? option.label}
                  </span>
                  {option.value === selectedValue && (
                    <Check size={15} aria-hidden="true" />
                  )}
                </button>
              ))
            ) : (
              <p>No options available.</p>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
