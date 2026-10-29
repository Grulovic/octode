// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import {
  installCaseShortcut,
  nextTextCase,
  registerCaseEditor,
} from "./textCase";
afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});
it("cycles through all common styles and wraps without losing word boundaries", () => {
  const expected = [
    "roomName",
    "RoomName",
    "ROOM_NAME",
    "room-name",
    "room.name",
    "room name",
    "Room Name",
    "ROOM NAME",
    "room_name",
  ];
  let value = "room_name";
  for (const next of expected) {
    value = nextTextCase(value);
    expect(value).toBe(next);
  }
  expect(nextTextCase("room")).toBe("Room");
  expect(nextTextCase("Room")).toBe("ROOM");
  expect(nextTextCase("ROOM")).toBe("room");
});
it("splits acronyms and Unicode words and preserves operators, quotes, line breaks and indentation", () => {
  expect(nextTextCase("getHTTPResponse")).toBe("get_http_response");
  expect(nextTextCase("član_sobe")).toBe("članSobe");
  expect(nextTextCase("  $room_name = 'room_id';\r\n    next_room\n")).toBe(
    "  $roomName = 'roomId';\r\n    nextRoom\n",
  );
  expect(nextTextCase("123")).toBe("123");
});
it("changes only the highlighted part, keeps it selected, and recognizes Option-modified KeyU", () => {
  document.body.innerHTML = '<input value="prefix room_name suffix">';
  const input = document.querySelector("input")!;
  input.focus();
  input.setSelectionRange(7, 16);
  const changed = vi.fn();
  input.addEventListener("input", changed);
  const remove = installCaseShortcut();
  try {
    const press = () =>
      input.dispatchEvent(
        new KeyboardEvent("keydown", {
          code: "KeyU",
          key: "¨",
          altKey: true,
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    expect(press()).toBe(false);
    expect(input.value).toBe("prefix roomName suffix");
    expect(input.value.slice(input.selectionStart!, input.selectionEnd!)).toBe(
      "roomName",
    );
    press();
    expect(input.value).toBe("prefix RoomName suffix");
    expect(changed).toHaveBeenCalledTimes(2);
  } finally {
    remove();
  }
});
it("leaves read-only, disabled, password, terminal and unselected text alone", () => {
  const remove = installCaseShortcut();
  try {
    for (const markup of [
      '<input readonly value="room_name">',
      '<input disabled value="room_name">',
      '<input type="password" value="room_name">',
      '<div class="xterm"><textarea>room_name</textarea></div>',
      "<textarea>room_name</textarea>",
    ]) {
      document.body.innerHTML = markup;
      const field = document.querySelector(
        "input,textarea",
      ) as HTMLInputElement;
      field.setSelectionRange(
        0,
        markup === "<textarea>room_name</textarea>" ? 0 : 9,
      );
      field.dispatchEvent(
        new KeyboardEvent("keydown", {
          code: "KeyU",
          altKey: true,
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
      expect(field.value).toBe("room_name");
    }
  } finally {
    remove();
  }
});
it("delegates to the focused code editor and unregisters closed editors", () => {
  document.body.innerHTML = '<textarea class="inputarea"></textarea>';
  const transform = vi.fn(() => true);
  const dispose = registerCaseEditor(transform);
  const remove = installCaseShortcut();
  try {
    const press = () =>
      document.querySelector("textarea")!.dispatchEvent(
        new KeyboardEvent("keydown", {
          code: "KeyU",
          altKey: true,
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    press();
    expect(transform).toHaveBeenCalledOnce();
    dispose();
    press();
    expect(transform).toHaveBeenCalledOnce();
  } finally {
    dispose();
    remove();
  }
});
it("supports selected contenteditable text and skips locked descendants", () => {
  document.body.innerHTML =
    '<div contenteditable="true" tabindex="0">room_name <span contenteditable="false">locked_name</span></div>';
  const host = document.querySelector("div")!;
  host.focus();
  const range = document.createRange();
  range.setStart(host.firstChild!, 0);
  range.setEnd(host.firstChild!, 9);
  const selection = document.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  const remove = installCaseShortcut();
  try {
    host.dispatchEvent(
      new KeyboardEvent("keydown", {
        code: "KeyU",
        altKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(selection.toString()).toBe("roomName");
    range.selectNodeContents(host);
    selection.removeAllRanges();
    selection.addRange(range);
    const before = host.textContent;
    host.dispatchEvent(
      new KeyboardEvent("keydown", {
        code: "KeyU",
        altKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(host.textContent).toBe(before);
  } finally {
    remove();
    selection.removeAllRanges();
  }
});
