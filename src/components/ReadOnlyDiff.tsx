import { lazy, Suspense } from "react";
import { desktop } from "../lib/bridge";
import { language } from "../lib/workspace";
const CodeDiff = lazy(() => import("./CodeDiff"));
export default function ReadOnlyDiff({
  before,
  after,
  path,
}: {
  before: string;
  after: string;
  path: string;
}) {
  return (
    <div className="code-diff-surface">
      {desktop ? (
        <Suspense fallback={<div className="loading">Loading comparison…</div>}>
          <CodeDiff before={before} after={after} language={language(path)} />
        </Suspense>
      ) : (
        <div className="text-compare">
          <pre>{before}</pre>
          <pre>{after}</pre>
        </div>
      )}
    </div>
  );
}
