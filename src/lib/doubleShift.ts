// Require two clean Shift taps: holding Shift or typing Shift+letter never opens search.
export function installDoubleShift(
  target: Window,
  open: () => void,
  blocked: () => boolean = () => false,
) {
  let released: number | null = null;
  let cleanPress = false;
  const reset = () => {
    released = null;
    cleanPress = false;
  };
  const down = (event: KeyboardEvent) => {
    if (
      event.defaultPrevented ||
      event.isComposing ||
      blocked() ||
      event.key !== "Shift" ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey
    ) {
      reset();
      return;
    }
    if (event.repeat) {
      reset();
      return;
    }
    if (released !== null && Date.now() - released <= 350) {
      reset();
      event.preventDefault();
      open();
    } else {
      released = null;
      cleanPress = true;
    }
  };
  const up = (event: KeyboardEvent) => {
    if (event.key === "Shift" && cleanPress) {
      released = Date.now();
      cleanPress = false;
    }
  };
  target.addEventListener("keydown", down, true);
  target.addEventListener("keyup", up, true);
  target.addEventListener("blur", reset);
  return () => {
    target.removeEventListener("keydown", down, true);
    target.removeEventListener("keyup", up, true);
    target.removeEventListener("blur", reset);
  };
}
