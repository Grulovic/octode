import { useEffect, useRef, useState } from "react";
import { CaseSensitive, Search, X } from "lucide-react";
import {
  cancelSearch,
  searchWorkspace,
  previewReplacements,
  applyReplacements,
  type Replacement,
} from "../lib/bridge";
import type { Project, SearchResults } from "../types";
import "./search.css";
import ReadOnlyDiff from "./ReadOnlyDiff";
import { confirmAction } from "./ToolLayout";

export default function ProjectSearch({
  project,
  onOpen,
  focusToken,
  beforeReplace,
  onChanged,
}: {
  project: Project;
  onOpen: (path: string, line: number) => void;
  focusToken: number;
  beforeReplace?: () => Promise<boolean>;
  onChanged?: () => Promise<void>;
}) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
  }, [focusToken]);
  const [query, setQuery] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [regex, setRegex] = useState(false);
  const [excluded, setExcluded] = useState("");
  const [respectGitignore, setRespectGitignore] = useState(true);
  const [replacement, setReplacement] = useState("");
  const [showReplace, setShowReplace] = useState(false);
  const [preview, setPreview] = useState<Replacement[] | null>(null);
  const [checked, setChecked] = useState<string[]>([]);
  const [review, setReview] = useState<Replacement | null>(null);
  const [replacing, setReplacing] = useState(false);
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(
    () => () => {
      void cancelSearch("text").catch(() => {});
    },
    [],
  );
  useEffect(() => {
    let disposed = false;
    setResult(null);
    setError("");
    setLoading(Boolean(query.trim()));
    if (!query.trim()) {
      void cancelSearch("text").catch(() => {});
      return;
    }
    const timer = setTimeout(() => {
      void searchWorkspace(project, query, "text", matchCase, {
        regex,
        exclusions: excluded
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
        respectGitignore,
      })
        .then((data) => {
          if (!disposed) {
            setResult(data);
            setLoading(false);
          }
        })
        .catch((reason) => {
          if (!disposed) {
            setError(String(reason));
            setLoading(false);
          }
        });
    }, 220);
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [project, query, matchCase, regex, excluded, respectGitignore, revision]);
  const previewReplace = async () => {
    setReplacing(true);
    setError("");
    try {
      if (beforeReplace && !(await beforeReplace()))
        throw new Error(
          "Resolve Code save failures before replacing saved files.",
        );
      const changes = await previewReplacements(
        project,
        query,
        replacement,
        matchCase,
        {
          regex,
          exclusions: excluded
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean),
          respectGitignore,
        },
      );
      setPreview(changes);
      setChecked(changes.map((change) => change.path));
    } catch (reason) {
      setError(String(reason));
    } finally {
      setReplacing(false);
    }
  };
  const apply = async () => {
    if (!preview) return;
    setReplacing(true);
    try {
      if (beforeReplace && !(await beforeReplace()))
        throw new Error(
          "Resolve Code save failures before replacing saved files.",
        );
      const selected = preview.filter((change) =>
        checked.includes(change.path),
      );
      if (
        !selected.length ||
        !(await confirmAction(
          `Apply the reviewed replacement to ${selected.length} files? Each disk version will be checked again. A batch may partially succeed.`,
        ))
      )
        return;
      const results = await applyReplacements(project, selected);
      const failed = results.filter((item) => item.error);
      setPreview(
        (previous) =>
          previous?.filter(
            (item) =>
              !results.some(
                (result) => result.path === item.path && !result.error,
              ),
          ) ?? null,
      );
      setChecked(failed.map((item) => item.path));
      await onChanged?.();
      setRevision((value) => value + 1);
      if (failed.length)
        throw new Error(
          failed.map((item) => `${item.path}: ${item.error}`).join("\n"),
        );
      setPreview(null);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setReplacing(false);
    }
  };
  return (
    <section className="project-search">
      <div className="project-search-input">
        <Search size={13} />
        <input
          ref={input}
          aria-label="Search text in project"
          autoFocus
          placeholder="Search saved files…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          maxLength={256}
        />
        <button
          className={matchCase ? "active" : ""}
          aria-label="Match case"
          aria-pressed={matchCase}
          onClick={() => setMatchCase((value) => !value)}
        >
          <CaseSensitive size={17} />
        </button>
        {query && (
          <button
            aria-label="Clear project search"
            onClick={() => setQuery("")}
          >
            <X size={12} />
          </button>
        )}
      </div>
      <div className="search-options">
        <button
          aria-label="Use regular expression"
          aria-pressed={regex}
          className={regex ? "active" : ""}
          onClick={() => setRegex((value) => !value)}
        >
          .* Regex
        </button>
        <button
          aria-label="Toggle project replace"
          onClick={() => setShowReplace((value) => !value)}
        >
          Replace…
        </button>
        <details>
          <summary>Search options</summary>
          <label>
            Exclude patterns
            <input
              aria-label="Exclude search paths"
              placeholder="*.log, tests/**"
              value={excluded}
              onChange={(event) => setExcluded(event.target.value)}
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={respectGitignore}
              onChange={(event) => setRespectGitignore(event.target.checked)}
            />
            Respect .gitignore
          </label>
        </details>
      </div>
      {showReplace && (
        <div className="replace-controls">
          <input
            aria-label="Replace with"
            placeholder="Replace with…"
            value={replacement}
            onChange={(event) => setReplacement(event.target.value)}
          />
          <button
            disabled={!query || replacing}
            onClick={() => void previewReplace()}
          >
            {replacing ? "Preparing…" : "Preview replacements"}
          </button>
          <span>Regex replacements support $1 capture groups.</span>
        </div>
      )}
      <div className="search-summary">
        {loading ? (
          "Searching…"
        ) : error ? (
          <span role="alert">{error}</span>
        ) : result ? (
          `${result.matches.length}${result.truncated ? "+" : ""} matching lines`
        ) : (
          "Find text across your project folders."
        )}
      </div>
      <div className="search-results">
        {result?.matches.map((match, index) => (
          <button
            key={`${match.path}:${match.line}:${index}`}
            onClick={() => onOpen(match.path, match.line)}
            title={match.path}
          >
            <strong>{match.relative}</strong>
            <span>
              <code>{match.line}</code>
              {match.preview}
            </span>
          </button>
        ))}
      </div>
      {result?.truncated && (
        <p className="search-footnote">
          Results limited. Narrow your search to see more.
        </p>
      )}
      {Boolean(result?.skipped) && (
        <p className="search-footnote">
          {result!.skipped} large, binary, or inaccessible entries skipped.
        </p>
      )}
      {result?.warnings.map((warning, index) => (
        <p className="search-footnote" key={index}>
          {warning}
        </p>
      ))}
      <p className="search-footnote">
        Search uses saved files. Generated folders are excluded. In Git
        projects, ignored untracked files are excluded when enabled.
      </p>
      {preview && (
        <div className="code-modal-backdrop">
          <section
            className="code-review-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Preview project replacement"
          >
            <header>
              <strong>Review replacements · {preview.length} file(s)</strong>
              <button
                aria-label="Close replacement preview"
                disabled={replacing}
                onClick={() => {
                  setPreview(null);
                  setReview(null);
                }}
              >
                <X size={17} />
              </button>
            </header>
            <div className="replace-preview">
              <aside>
                {preview.map((item) => (
                  <label key={item.path}>
                    <input
                      type="checkbox"
                      checked={checked.includes(item.path)}
                      onChange={(event) =>
                        setChecked((previous) =>
                          event.target.checked
                            ? [...previous, item.path]
                            : previous.filter((path) => path !== item.path),
                        )
                      }
                    />
                    <button onClick={() => setReview(item)}>
                      {item.path.split("/").at(-1)} · {item.count}
                    </button>
                  </label>
                ))}
              </aside>
              <main>
                {(review && preview.includes(review) ? review : preview[0]) ? (
                  <ReadOnlyDiff
                    before={
                      (review && preview.includes(review) ? review : preview[0])
                        .before
                    }
                    after={
                      (review && preview.includes(review) ? review : preview[0])
                        .after
                    }
                    path={
                      (review && preview.includes(review) ? review : preview[0])
                        .path
                    }
                  />
                ) : (
                  <p>No changes to apply.</p>
                )}
              </main>
            </div>
            <footer>
              {error && <span role="alert">{error}</span>}
              <button
                className="primary-button"
                disabled={replacing || !checked.length}
                onClick={() => void apply()}
              >
                {replacing ? "Applying…" : `Apply to ${checked.length} files`}
              </button>
            </footer>
          </section>
        </div>
      )}
    </section>
  );
}
