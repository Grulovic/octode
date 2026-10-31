// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import DatabaseTableInfo from "./DatabaseTableInfo";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
it("reviews schema SQL without executing and disables actions on read-only connections", async () => {
  const result = { columns: [], rows: [], rowsAffected: 0, elapsedMs: 0, truncated: false };
  const metadata = { columns: [{ name: "title", dataType: "text", nullable: true, primaryKey: false, defaultValue: null, generated: false }], indexes: result, foreignKeys: result, editable: true, reason: "" };
  const useSql = vi.fn(), host = document.createElement("div"), root = createRoot(host);
  const render = (readOnly: boolean) => root.render(<DatabaseTableInfo metadata={metadata} engine="postgres" schema="public" table="items" readOnly={readOnly} onUseSql={useSql} />);
  try {
    await act(async () => render(true));
    expect([...host.querySelectorAll<HTMLButtonElement>('.table-info-actions button')].every((button) => button.disabled)).toBe(true);
    await act(async () => render(false));
    const drop = [...host.querySelectorAll<HTMLButtonElement>('.table-info-actions button')].find((button) => button.textContent?.includes("Drop table"))!;
    await act(async () => drop.click()); expect(useSql).not.toHaveBeenCalled();
    const preview = [...host.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === "Preview SQL")!;
    await act(async () => preview.click()); expect(host.querySelector('pre')?.textContent).toBe('DROP TABLE "public"."items";');
    expect(useSql).not.toHaveBeenCalled();
    await act(async () => [...host.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === "Open SQL for review")!.click());
    expect(useSql).toHaveBeenCalledWith('DROP TABLE "public"."items";');
  } finally { await act(async () => root.unmount()); }
});
