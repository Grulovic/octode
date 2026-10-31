import { deepOcean } from "../editor/deepOcean";
const rules = [...deepOcean.rules].sort((a, b) => b.token.length - a.token.length);
export function sqlHighlightParts(value: string, tokens: readonly { offset: number; type: string }[]) {
  return tokens.map((token, index) => ({
    text: value.slice(token.offset, tokens[index + 1]?.offset ?? value.length),
    color: `#${rules.find((rule) => rule.foreground && (rule.token === token.type || token.type.startsWith(`${rule.token}.`)))?.foreground ?? "cdd3de"}`,
  }));
}
