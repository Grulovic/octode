import { useEffect, useState } from "react";
import { deepOcean } from "../editor/deepOcean";
/** Monaco's syntax renderer escapes source text and never enables editing or suggestions. */
export default function SyntaxCode({ text, language = "sql" }: { text: string; language?: string }) {
  const [html, setHtml] = useState("");
  useEffect(() => {
    let cancelled = false;
    setHtml("");
    void import("../editor/runtime").then(async ({ monaco }) => {
      monaco.editor.defineTheme("octode", deepOcean);
      monaco.editor.setTheme("octode");
      const colored = await monaco.editor.colorize(text, language, { tabSize: 4 });
      if (!cancelled) setHtml(colored);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [text, language]);
  return html ? <pre className="syntax-code" dangerouslySetInnerHTML={{__html: html}} /> : <pre className="syntax-code">{text}</pre>;
}
