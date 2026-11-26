import { projectColor } from "../lib/projectColors";
import { colors } from "./palette";

function mix(accent: string, background: string, weight: number) {
  const channels = [1, 3, 5].map((offset) => Math.round(
    parseInt(accent.slice(offset, offset + 2), 16) * weight +
    parseInt(background.slice(offset, offset + 2), 16) * (1 - weight),
  ).toString(16).padStart(2, "0"));
  return `#${channels.join("")}`;
}

export function projectAccentTokens(color?: string) {
  const accent = projectColor(color);
  return {
    "--oc-accent": accent,
    "--oc-accent-ink": colors.accentInk,
    "--oc-accent-tint": `${accent}1f`,
    "--oc-focus-ring": `0 0 0 3px ${accent}40`,
    "--oc-selection": mix(accent, colors.panel, 0.14),
    "--oc-border": colors.border,
    "--oc-border-subtle": colors.borderSubtle,
    "--oc-border-strong": colors.borderStrong,
  };
}

// Set these on the root so menus and dialogs portaled to body share the accent.
export function applyProjectAccent(color?: string) {
  for (const [name, value] of Object.entries(projectAccentTokens(color))) {
    document.documentElement.style.setProperty(name, value);
  }
}
