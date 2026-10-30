import { useMemo, useState, type ReactNode } from "react";
import { desktop, invoke } from "../lib/bridge";
import { marked, type Token, type Tokens } from "marked";

function decode(value: string) {
  return value.replace(/&(?:#[0-9]+|#x[0-9a-f]+|[a-z][a-z0-9]+);/gi, (entity) => {
    const textarea = document.createElement("textarea");
    textarea.innerHTML = entity;
    return textarea.value;
  });
}
function safeUrl(value: string, image = false) {
  value = decode(value);
  if (/[\x00-\x1f\x7f]/.test(value)) return undefined;
  if (value.startsWith("#") && !image) return value;
  try {
    const url = new URL(value);
    return (image ? ["http:", "https:"] : ["http:", "https:"]).includes(url.protocol) ? url.href : undefined;
  } catch { return undefined; }
}
// Render tokens through React rather than inserting HTML from note contents.
function content(tokens: Token[]): ReactNode {
  return tokens.map((token, key): ReactNode => {
    const children = "tokens" in token && token.tokens ? content(token.tokens) : null;
    switch (token.type) {
      case "space": return null;
      case "heading": {
        const Tag = `h${token.depth}` as "h1";
        return <Tag key={key}>{children}</Tag>;
      }
      case "paragraph": return <p key={key}>{children}</p>;
      case "text": return children ?? decode(token.text);
      case "escape": return decode(token.text);
      case "html": return token.text;
      case "strong": return <strong key={key}>{children}</strong>;
      case "em": return <em key={key}>{children}</em>;
      case "del": return <del key={key}>{children}</del>;
      case "codespan": return <code key={key}>{decode(token.text)}</code>;
      case "code": return <pre key={key}><code>{token.text}</code></pre>;
      case "br": return <br key={key} />;
      case "hr": return <hr key={key} />;
      case "blockquote": return <blockquote key={key}>{children}</blockquote>;
      case "link": {
        const href = safeUrl(token.href);
        return href ? <a key={key} href={href} target="_blank" rel="noopener noreferrer">{children}</a> : <span key={key}>{children}</span>;
      }
      case "image": {
        const src = safeUrl(token.href, true);
        return src ? <img key={key} src={src} alt={token.text} title={token.title ?? undefined} loading="lazy" /> : token.text;
      }
      case "list": {
        const Tag = token.ordered ? "ol" : "ul";
        return <Tag key={key} start={token.ordered ? Number(token.start) : undefined}>{token.items.map((item: Tokens.ListItem, index: number) => <li key={index}>{item.task && <input type="checkbox" checked={!!item.checked} disabled aria-label={item.checked ? "Completed task" : "Incomplete task"} />}{content(item.tokens)}</li>)}</Tag>;
      }
      case "table": return <div key={key} className="notes-markdown-table"><table><thead><tr>{token.header.map((cell: Tokens.TableCell, index: number) => <th key={index} style={{ textAlign: token.align[index] ?? undefined }}>{content(cell.tokens)}</th>)}</tr></thead><tbody>{token.rows.map((row: Tokens.TableCell[], index: number) => <tr key={index}>{row.map((cell: Tokens.TableCell, col: number) => <td key={col} style={{ textAlign: token.align[col] ?? undefined }}>{content(cell.tokens)}</td>)}</tr>)}</tbody></table></div>;
      default: return "raw" in token ? token.raw : null;
    }
  });
}
export default function MarkdownPreview({ text }: { text: string }) {
  const [error, setError] = useState("");
  const rendered = useMemo(() => content(marked.lexer(text, { gfm: true })), [text]);
  return <article className="notes-markdown" aria-label="Markdown preview" onClick={(event) => {
    const link = (event.target as HTMLElement).closest("a");
    if (!desktop || !link || link.getAttribute("href")?.startsWith("#")) return;
    event.preventDefault();
    setError("");
    void invoke("open_terminal_url", { url: link.href }).catch((reason) => setError(`Could not open link: ${String(reason)}`));
  }}>{error && <div className="error-banner" role="alert">{error}</div>}{rendered}</article>;
}
