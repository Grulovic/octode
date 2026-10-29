// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import JsonResponse from "./JsonResponse";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
beforeEach(() => {
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById("root")!);
});
afterEach(async () => {
  await act(async () => root.unmount());
});
it("colors JSON values, collapses properties, and renders HTML as inert text", async () => {
  await act(async () =>
    root.render(
      <JsonResponse
        formatted
        body={
          '{"user":{"name":"<img src=x>","age":42,"active":true,"nothing":null}}'
        }
      />,
    ),
  );
  expect(document.querySelector(".json-string")?.textContent).toContain(
    "<img src=x>",
  );
  expect(document.querySelector("img")).toBeNull();
  expect(document.querySelector(".json-number")?.textContent).toBe("42");
  expect(document.querySelector(".json-boolean")?.textContent).toBe("true");
  const buttons = document.querySelectorAll<HTMLButtonElement>(".json-toggle");
  await act(async () => buttons[1].click());
  expect(buttons[1].getAttribute("aria-expanded")).toBe("false");
  expect(document.querySelector(".json-string")).toBeNull();
});
it("limits mounted array items and falls back to plain text for non-JSON responses", async () => {
  await act(async () =>
    root.render(
      <JsonResponse
        formatted
        body={JSON.stringify(Array.from({ length: 350 }, (_, i) => i))}
      />,
    ),
  );
  expect(document.querySelectorAll(".json-number")).toHaveLength(100);
  await act(async () =>
    document.querySelector<HTMLButtonElement>(".json-more")!.click(),
  );
  expect(document.querySelectorAll(".json-number")).toHaveLength(200);
  await act(async () =>
    root.render(<JsonResponse formatted body="not JSON" />),
  );
  expect(document.querySelector("pre")?.textContent).toBe("not JSON");
});

it("preserves large integer IDs and decimal/exponent spelling exactly", async () => {
  await act(async () =>
    root.render(
      <JsonResponse
        formatted
        body={
          '{"id":9007199254740993,"decimal":1.2300,"exponent":1e+40,"negativeZero":-0}'
        }
      />,
    ),
  );
  expect(
    [...document.querySelectorAll(".json-number")].map(
      (node) => node.textContent,
    ),
  ).toEqual(["9007199254740993", "1.2300", "1e+40", "-0"]);
});
it("opens nested response properties by default", async () => {
  await act(async () =>
    root.render(
      <JsonResponse formatted body={'{"data":{"room":{"nested":{"id":7}}}}'} />,
    ),
  );
  expect(
    document.querySelectorAll('.json-toggle[aria-expanded="true"]'),
  ).toHaveLength(4);
  expect(document.querySelector(".json-number")?.textContent).toBe("7");
});
