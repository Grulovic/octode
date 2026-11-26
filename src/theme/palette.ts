// Neutral app UI palette. Keep values aligned with tokens.css.
export const colors = {
  "bg": "#141518",
  "panel": "#1b1c20",
  "surface": "#23252a",
  "raised": "#2b2d33",
  "selection": "#293537",
  "border": "#303239",
  "borderSubtle": "#27292f",
  "borderStrong": "#42454f",
  "text": "#c9cbd1",
  "textStrong": "#eceef2",
  "muted": "#9699a3",
  "faint": "#838792",
  "disabled": "#61656f",
  "accent": "#80cbc4",
  "accentInk": "#131518",
  "accentTint": "rgba(128,203,196,0.12)",
  "focusRing": "rgba(128,203,196,0.25)",
  "unsaved": "#ff9e60",
  "unsavedTint": "rgba(255,158,96,0.12)",
  "error": "#f07178",
  "errorText": "#f5a3a8",
  "errorTint": "rgba(240,113,120,0.08)",
  "errorBorder": "rgba(240,113,120,0.45)",
  "warning": "#ffcb6b",
  "diffAdd": "rgba(195,232,141,0.10)",
  "diffDel": "rgba(240,113,120,0.13)",
  "scrim": "rgba(8,9,11,0.62)"
} as const;

export const syntax = {
  "keyword": "#c792ea",
  "type": "#ffcb6b",
  "function": "#82aaff",
  "string": "#c3e88d",
  "number": "#f78c6c",
  "operator": "#89ddff",
  "comment": "#74909c",
  "plain": "#c6ccd3"
} as const;

export const monoFont = '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace';

// Share neutral surfaces with the app while retaining Deep Ocean text colors.
export const deepOceanColors = {
  ...colors,
  selection: "#34373f",
  text: "#c6ccd3",
  textStrong: "#e3e7ea",
  muted: "#8d9aa3",
  faint: "#7d8c96",
  disabled: "#5c6b74",
} as const;
