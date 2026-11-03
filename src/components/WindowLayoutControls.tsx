import { useState } from "react";
import { desktop } from "../lib/bridge";
import { arrangeWindow, type WindowLayout } from "../lib/windowLayout";
import { WindowLeft, WindowRight, WindowCenter, WindowFull } from "./DesignIcons";

const layouts = [
  { id: "left", label: "Left half", Icon: WindowLeft },
  { id: "right", label: "Right half", Icon: WindowRight },
  { id: "center", label: "Center half", Icon: WindowCenter },
  { id: "full", label: "Fill screen", Icon: WindowFull },
] as const;

export default function WindowLayoutControls({ onError }: { onError: (message: string) => void }) {
  const [busy, setBusy] = useState(false);
  async function arrange(layout: WindowLayout) {
    if (busy) return;
    setBusy(true);
    try { await arrangeWindow(layout); }
    catch (reason) { onError(String(reason)); }
    finally { setBusy(false); }
  }
  return <div className="window-layout-controls" role="group" aria-label="Window position">
    {layouts.map(({ id, label, Icon }) => <button
      key={id} type="button" aria-label={label}
      title={desktop ? label : `${label} (desktop app only)`}
      disabled={!desktop || busy} onClick={() => void arrange(id)}
    ><Icon size={16} /></button>)}
  </div>;
}
