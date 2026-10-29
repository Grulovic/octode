// @vitest-environment jsdom
import { act, StrictMode, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import CustomSelect from "./CustomSelect";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
beforeEach(() => {
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById("root")!);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.restoreAllMocks();
});
const trigger = () =>
  document.querySelector<HTMLButtonElement>('[role="combobox"]')!;
const popup = () => document.querySelector<HTMLElement>('[role="listbox"]');
const key = async (value: string) =>
  act(async () => {
    trigger().dispatchEvent(
      new KeyboardEvent("keydown", {
        key: value,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
const click = async (element: HTMLElement) => act(async () => element.click());
function Field({
  change,
  locked = false,
}: {
  change: (value: string) => void;
  locked?: boolean;
}) {
  const [value, setValue] = useState("a");
  return (
    <fieldset disabled={locked}>
      <label>
        <span>Engine</span>
        <CustomSelect
          value={value}
          onChange={(event) => {
            change(event.target.value);
            setValue(event.target.value);
          }}
        >
          <option value="a">Alpha</option>
          <option value="b" disabled>
            Blocked
          </option>
          <option value="c">Charlie</option>
          <option value="d">Delta</option>
        </CustomSelect>
      </label>
    </fieldset>
  );
}
it("uses a styled portalled menu and real form change events while hiding the native popup", async () => {
  const change = vi.fn();
  await act(async () => root.render(<Field change={change} />));
  expect(document.querySelector("select")?.hidden).toBe(true);
  expect(trigger().getAttribute("aria-label")).toBe("Engine");
  await click(trigger());
  expect(popup()?.parentElement).toBe(document.body);
  expect(trigger().getAttribute("aria-expanded")).toBe("true");
  expect(document.activeElement).toBe(trigger());
  await click(
    document.querySelectorAll<HTMLButtonElement>('[role="option"]')[2],
  );
  expect(change).toHaveBeenCalledExactlyOnceWith("c");
  expect(trigger().textContent).toBe("Charlie");
  expect(document.querySelector("select")?.value).toBe("c");
  expect(popup()).toBeNull();
});
it("supports arrows, typeahead and Enter, skips disabled choices, and cancels with Escape", async () => {
  const change = vi.fn();
  await act(async () => root.render(<Field change={change} />));
  await key("ArrowDown");
  await key("ArrowDown");
  expect(trigger().getAttribute("aria-activedescendant")).toContain("option-2");
  expect(change).not.toHaveBeenCalled();
  await key("Enter");
  expect(change).toHaveBeenLastCalledWith("c");
  await key(" ");
  await key("Home");
  await key("Escape");
  expect(trigger().textContent).toBe("Charlie");
  expect(change).toHaveBeenCalledOnce();
  await key("d");
  await key("Enter");
  expect(change).toHaveBeenLastCalledWith("d");
  await click(trigger());
  await key("Tab");
  expect(popup()).toBeNull();
});
it("respects disabled fieldsets, including a control disabled while its menu is open", async () => {
  const change = vi.fn();
  await act(async () => root.render(<Field change={change} />));
  await click(trigger());
  expect(popup()).not.toBeNull();
  await act(async () => root.render(<Field change={change} locked />));
  expect(popup()).toBeNull();
  await click(trigger());
  expect(popup()).toBeNull();
  expect(change).not.toHaveBeenCalled();
});
it("preserves label activation through StrictMode and dismisses on outside clicks", async () => {
  await act(async () =>
    root.render(
      <StrictMode>
        <Field change={() => {}} />
      </StrictMode>,
    ),
  );
  expect(document.querySelector("label")?.htmlFor).toBe(trigger().id);
  await click(document.querySelector("label")!);
  expect(popup()).not.toBeNull();
  await act(async () => {
    document.body.dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true }),
    );
  });
  expect(popup()).toBeNull();
});
it("opens above near the bottom of the viewport and keeps its menu within the window", async () => {
  await act(async () => root.render(<Field change={() => {}} />));
  vi.spyOn(trigger(), "getBoundingClientRect").mockReturnValue({
    top: 700,
    bottom: 736,
    left: 1000,
    right: 1120,
    width: 120,
    height: 36,
  } as DOMRect);
  await click(trigger());
  const menu = popup()!;
  expect(Number.parseFloat(menu.style.top)).toBeLessThan(700);
  expect(
    Number.parseFloat(menu.style.left) + Number.parseFloat(menu.style.width),
  ).toBeLessThanOrEqual(window.innerWidth - 8);
});
it("scrolls long menus with keyboard selection and retains the selected option checkmark", async () => {
  await act(async () =>
    root.render(
      <CustomSelect aria-label="Branch" value="0" onChange={() => {}}>
        {Array.from({ length: 30 }, (_, i) => (
          <option key={i} value={i}>
            Branch {i}
          </option>
        ))}
      </CustomSelect>,
    ),
  );
  await click(trigger());
  const menu = popup()!;
  menu.getBoundingClientRect = () => ({ top: 100, bottom: 280 }) as DOMRect;
  [...menu.querySelectorAll<HTMLElement>('[role="option"]')].forEach(
    (option, i) => {
      option.getBoundingClientRect = () =>
        ({
          top: 100 + i * 36 - menu.scrollTop,
          bottom: 136 + i * 36 - menu.scrollTop,
        }) as DOMRect;
    },
  );
  for (let i = 0; i < 15; i++) await key("ArrowDown");
  expect(menu.scrollTop).toBeGreaterThan(0);
  expect(trigger().getAttribute("aria-activedescendant")).toContain(
    "option-15",
  );
  expect(menu.querySelector('[aria-selected="true"]')?.textContent).toBe(
    "Branch 0",
  );
  await key("Home");
  expect(menu.scrollTop).toBeLessThanOrEqual(5);
});
it("keeps only one menu open when another dropdown is activated without pointer events", async () => {
  await act(async () =>
    root.render(
      <>
        <CustomSelect aria-label="First" value="a" onChange={() => {}}>
          <option value="a">Alpha</option>
        </CustomSelect>
        <CustomSelect aria-label="Second" value="b" onChange={() => {}}>
          <option value="b">Beta</option>
        </CustomSelect>
      </>,
    ),
  );
  const buttons =
    document.querySelectorAll<HTMLButtonElement>('[role="combobox"]');
  await click(buttons[0]);
  await click(buttons[1]);
  expect(document.querySelectorAll('[role="listbox"]')).toHaveLength(1);
  expect(popup()?.getAttribute("aria-label")).toBe("Second options");
  expect(buttons[0].getAttribute("aria-expanded")).toBe("false");
});
