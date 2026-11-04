// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { installSaveShortcut, registerSaveTarget, saveActiveSection } from "./saveShortcut";

it("routes Cmd/Ctrl+S from inputs and editors only to the visible section", () => {
  const hidden = vi.fn(), save = vi.fn();
  const removeHidden = registerSaveTarget({ active: () => false, save: hidden });
  const remove = registerSaveTarget({ active: () => true, save });
  const stop = installSaveShortcut();
  const input = document.createElement("textarea");
  document.body.append(input);
  input.addEventListener("keydown", (event) => event.stopPropagation());
  try {
    for (const modifier of ["metaKey", "ctrlKey"]) {
      const event = new KeyboardEvent("keydown", { key: "s", [modifier]: true, bubbles: true, cancelable: true });
      input.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
    }
    expect(save).toHaveBeenCalledTimes(2);
    expect(hidden).not.toHaveBeenCalled();
    for (const extra of [{ shiftKey: true }, { altKey: true }, { isComposing: true }, { repeat: true }]) {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "s", metaKey: true, bubbles: true, ...extra }));
    }
    expect(save).toHaveBeenCalledTimes(2);
  } finally { stop(); remove(); removeHidden(); input.remove(); }
});

it("native Save and keyboard Save use the dialog's explicit Save without saving the section underneath", () => {
  const save = vi.fn(), modalSave = vi.fn();
  const remove = registerSaveTarget({ active: () => true, save });
  document.body.innerHTML = '<div aria-modal="true"><button data-save-shortcut>Save settings</button></div>';
  const button = document.querySelector("button")!;
  button.onclick = modalSave;
  try {
    saveActiveSection();
    expect(modalSave).toHaveBeenCalledOnce();
    button.disabled = true;
    saveActiveSection();
    button.remove();
    saveActiveSection();
    expect(modalSave).toHaveBeenCalledOnce();
    expect(save).not.toHaveBeenCalled();
  } finally { remove(); document.body.innerHTML = ""; }
});

it("ignores dialogs retained inside hidden tools", () => {
  const save = vi.fn();
  const remove = registerSaveTarget({ active: () => true, save });
  document.body.innerHTML = '<div style="display:none"><section aria-modal="true">Retained Git preview</section></div>';
  try {
    saveActiveSection();
    expect(save).toHaveBeenCalledOnce();
  } finally { remove(); document.body.innerHTML = ""; }
});
