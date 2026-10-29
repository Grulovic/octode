import { useMemo, useState } from "react";

class JsonNumber {
  constructor(readonly source: string) {}
}
type Json =
  | null
  | boolean
  | JsonNumber
  | string
  | Json[]
  | { [key: string]: Json };
function parseJson(body: string): Json {
  // Preserve integer IDs, decimals, exponents and -0 exactly as received.
  // Replacing numeric tokens before parsing avoids IEEE-754 rounding.
  const marker = `\0${crypto.randomUUID()}:`;
  const numbers: string[] = [];
  const encoded = body.replace(
    /"(?:\\.|[^"\\])*"|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,
    (token, number: string | undefined) => {
      if (number === undefined) return token;
      return JSON.stringify(marker + (numbers.push(number) - 1));
    },
  );
  return JSON.parse(encoded, (_key, value) =>
    typeof value === "string" && value.startsWith(marker)
      ? new JsonNumber(numbers[Number(value.slice(marker.length))])
      : value,
  ) as Json;
}
function Value({ value, depth = 0 }: { value: Json; depth?: number }) {
  const [expanded, expand] = useState(true);
  const [shown, show] = useState(100);
  if (value instanceof JsonNumber)
    return <span className="json-number">{value.source}</span>;
  if (value === null) return <span className="json-null">null</span>;
  if (typeof value !== "object")
    return (
      <span className={`json-${typeof value}`}>{JSON.stringify(value)}</span>
    );
  const array = Array.isArray(value);
  const entries = Object.entries(value);
  if (!entries.length) return <span>{array ? "[]" : "{}"}</span>;
  // Closed branches don't mount their children; large responses stay responsive.
  // Bound nesting as well as siblings, even for adversarial JSON responses.
  if (depth >= 40)
    return (
      <span className="json-summary">
        {array ? "Array" : "Object"} ({entries.length} items · nesting limit)
      </span>
    );
  return (
    <span className="json-container">
      <button
        className="json-toggle"
        aria-expanded={expanded}
        onClick={() => expand(!expanded)}
      >
        <span aria-hidden="true">{expanded ? "▾" : "▸"}</span>{" "}
        {array ? "[" : "{"}
        {!expanded && (
          <span className="json-summary">
            {" "}
            {entries.length} {array ? "items" : "properties"} …{" "}
            {array ? "]" : "}"}
          </span>
        )}
      </button>
      {expanded && (
        <>
          <span className="json-children">
            {entries.slice(0, shown).map(([key, child], index) => (
              <span className="json-line" key={key}>
                {!array && (
                  <>
                    <span className="json-key">{JSON.stringify(key)}</span>
                    :{" "}
                  </>
                )}
                <Value value={child} depth={depth + 1} />
                {index < entries.length - 1 ? "," : ""}
              </span>
            ))}
            {entries.length > shown && (
              <button className="json-more" onClick={() => show(shown + 100)}>
                Show next {Math.min(100, entries.length - shown)} of{" "}
                {entries.length - shown} remaining
              </button>
            )}
          </span>
          <span>{array ? "]" : "}"}</span>
        </>
      )}
    </span>
  );
}
export default function JsonResponse({
  body,
  formatted,
}: {
  body: string;
  formatted: boolean;
}) {
  const parsed = useMemo(() => {
    try {
      return { value: parseJson(body) };
    } catch {
      return null;
    }
  }, [body]);
  return parsed && formatted ? (
    <div className="response-body json-response">
      <Value key={body} value={parsed.value} />
    </div>
  ) : (
    <pre className="response-body">{body}</pre>
  );
}
