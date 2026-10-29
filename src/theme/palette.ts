// Runtime theme values. Keep app colors aligned with tokens.css.
export const colors = {
  "bg": "#091014",
  "panel": "#0e1d24",
  "surface": "#14242b",
  "raised": "#182b33",
  "selection": "#173138",
  "border": "#1a2d34",
  "borderSubtle": "#16282f",
  "borderStrong": "#26414b",
  "text": "#c6ccd3",
  "textStrong": "#e3e7ea",
  "muted": "#8d9aa3",
  "faint": "#7d8c96",
  "disabled": "#5c6b74",
  "accent": "#80cbc4",
  "accentInk": "#06201d",
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
  "scrim": "rgba(4,8,10,0.62)"
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
