export type WindowLayout = "left" | "right" | "center" | "full";

export function windowLayoutBounds(
  layout: WindowLayout,
  area: { position: { x: number; y: number }; size: { width: number; height: number } },
) {
  const width = layout === "full" ? area.size.width : Math.floor(area.size.width / 2);
  const offset = layout === "right" ? area.size.width - width
    : layout === "center" ? Math.floor((area.size.width - width) / 2) : 0;
  return { x: area.position.x + offset, y: area.position.y, width, height: area.size.height };
}

export async function arrangeWindow(layout: WindowLayout) {
  const { getCurrentWindow, currentMonitor, primaryMonitor, PhysicalPosition, PhysicalSize, LogicalSize } = await import("@tauri-apps/api/window");
  const monitor = await currentMonitor() ?? await primaryMonitor();
  if (!monitor) throw new Error("No display is available to position the window.");
  const current = getCurrentWindow();
  const bounds = windowLayoutBounds(layout, monitor.workArea);
  if (await current.isFullscreen()) await current.setFullscreen(false);
  if (await current.isMaximized()) await current.unmaximize();
  // Allow half-screen layouts on laptop displays below 1600 logical pixels wide.
  await current.setMinSize(new LogicalSize(Math.min(800, bounds.width / monitor.scaleFactor), Math.min(600, bounds.height / monitor.scaleFactor)));
  await current.setSize(new PhysicalSize(bounds.width, bounds.height));
  await current.setPosition(new PhysicalPosition(bounds.x, bounds.y));
}
