# Octode working context

Octode is a local desktop development workspace: Code/Git, Servers/SSH/SFTP, Database, API, global Notes, and a shared terminal. It uses React + TypeScript + Vite, Tauri 2/Rust, Monaco, xterm, and SQLite for app metadata. The browser mode is a sample-data/layout sandbox, not the full native app.

## User preferences and scope

- Implement requested changes through completion; avoid repeated permission questions for routine, reversible work. Preserve unrelated edits and never commit unless asked.
- Batch the queued requests. **Rebuild once after the whole queued list is finished, not after each individual fix.** Do not interrupt an active app or restart it automatically when it may contain unsaved work.
- **Never run `buildProd`, `buildPord`, or an equivalent release-mode build unless the user explicitly requests a production release.** The user normally builds production themselves when a larger change is ready to share.
- Use the existing design files and shared components. The user values consistent spacing, icon sizes, dropdowns, colors, and keyboard behavior; avoid inventing another visual style.
- Autocomplete is out of scope: no suggestion popups, inline completions, parameter hints, word completion, snippets, or SQL completion. Keep syntax highlighting, find/replace, and navigation.
- Table info is intentionally **read-only** (columns, indexes, relationships). The new table/column rename/edit/drop UI was removed at the user's request. Schema changes belong in the SQL console; do not reintroduce the removed designer controls without a request.
- Notes Trash was explicitly rejected. Notes use confirmed direct deletion. Code files and whole folders instead move to the **system Trash**, with no permanent-delete fallback.

## Builds and verification

Run commands from the repository root. Typical local toolchain:

```sh
export PATH=/Users/grula/.cargo/bin:/Users/grula/.nvm/versions/node/v20.20.2/bin:$PATH
npx tsc -b
npm test
cargo test --manifest-path src-tauri/Cargo.toml --offline
npm run buildDev -- --offline
npm run buildDev -- --check --offline
```

- `npm run buildDev`: standalone debug `src-tauri/target/debug/bundle/macos/Octode.app`.
- `--check`: builds `Octode Check.app`, identifier `dev.octode.autosavecheck`. **This profile contains the user's real working data; it is not disposable.**
- `.tools/search-check.config.json`: isolated `Octode Search Check.app`, identifier `dev.octode.searchcheck`, used for QA fixtures. Keep test projects, databases, requests, and destructive checks isolated from real user data/services.
- Native bundle builds share a Cargo target directory; run them sequentially. Use targeted checks while editing and broaden when behavior warrants it. Documentation-only changes do not need an app rebuild.
- `scripts/build-desktop.mjs` selects a supported installed Node, includes Cargo on PATH, checks TypeScript, builds Vite, bundles Tauri, then signs with the persistent `Octode Local Development` identity and verifies the app. Run `npm run setupSigning` once per Mac; preserve that certificate/private key across builds. Preserve this final signing step: unsigned rebuilt bundles previously failed to launch. This is local self-signed signing, not Developer ID signing/notarization. Never silently fall back to ad-hoc signing, which changes Keychain identity across rebuilds.
- For a direct debug Tauri QA build, use the isolated config and sign/verify the completed `.app` with the same local identity too. Do not use release mode for QA.
- `npm run build` builds only the frontend. `npm run desktop` runs live Tauri development. `--offline` requires cached Rust dependencies.
- Rebuilding does not change an already running process. The app's bottom-left **Restart** loads the rebuilt bundle at that same path after save checks. A separate `/Applications` copy does not update with the repo bundle. Check which app/profile/version is running before diagnosing a regression; stale running builds have repeatedly explained apparent failures.
- Verify meaningful UI changes in the native app, not only browser tests. Use disposable fixtures and don't modify real notes, repositories, database rows, or API services during verification.

## Persistence and operation boundaries

- Only Code files autosave (600 ms pause, flush before navigation/close). Preserve disk-conflict checks, recovery drafts, and failed-save buffers.
- Notes, API collections/environments, Server profiles, and Database connection/query settings require explicit Save. Tool switching must not silently save them.
- Projects can be parked with their live drafts, terminal sessions, and connection state. Quit/restart checks unsaved work across all parked projects and waits for pending saves. Running processes/connections end on quit/restart.
- Metadata lives in `octode.sqlite` under the Tauri identifier's application-data directory. Project source folders remain at their original paths. Keep app-data migrations additive/backward compatible.
- Global Notes, including open unsaved drafts, are included in app-data export/import. Import creates copies with new IDs and preserves existing live drafts. App-data exports include credentials; collection export removes credentials. Avoid logging secrets or private export contents.
- Secrets use OS credential storage; metadata stores references. Unchanged secret references must not cause repeated Keychain prompts. Preserve reference validation and save verification.
- HTTP Send, SQL Run, database Apply, SSH commands, and transfers are explicit actions. A UI setting change or navigation must never execute them.

## Editors, keyboard shortcuts, and terminal

- Monaco configuration/grammars live in `src/editor/runtime.ts`; theme in `src/editor/deepOcean.ts`. Shared editor UI is `EditorPane.tsx`. Avoid language-service workers/completion providers.
- Retained Notes models preserve Undo across note switches and preview toggles (`src/lib/retainedEditorModels.ts`). Don't replace models/text on every render or dispose them while the note still exists.
- Base editing commands (Cmd/Ctrl+A/C/V/X/Z, redo, Backspace/Delete) must work in the focused editor and ordinary inputs. Native macOS menu accelerators may consume WebView key events. Inspect `src-tauri/src/tab_menu.rs`, `src/lib/selectAll.ts`, and editor/terminal focus routing before adding duplicate global handlers. Preserve native input and IME behavior.
- Cmd/Ctrl+1 opens Code → Files; +2 toggles the terminal globally; +3 Servers; +4 Database; +5 API; +6 global Notes; +0 Projects. Cmd/Ctrl+W closes the focused tab, not the sole app window.
- Terminal is a shared overlay across tools, including Notes and Git, covering the tool sidebar. Without an open project it uses the user's home directory.
- Terminal + and AI-star buttons open folder menus and launch immediately after selection. Cmd/Ctrl+T uses the active Code folder when terminal-focused. Double Cmd/Ctrl+2 launches the configured command in a new tab; configuration changes alone do not launch it.
- Code folder selection and terminal launch-folder selection stay synchronized. Preserve terminal URL handling, safe quoted path drops, independent PTY tabs, and input ordering.
- Notes syntax follows supported filename extensions; otherwise plain text. Notes and Code have MD preview toggles. Code preview keeps its editor mounted to preserve undo state.

## Database behavior

- Double-click cells to queue edits in the table grid. **Insert row** creates a local draft row; the row-end delete action queues deletion (or removes an unsaved insert). No database write occurs on blur, Enter, or cell confirmation.
- **Apply changes** submits the queued inserts, merged per-row updates, and deletes together using one reviewed transaction and original-value checks. Keep pending changes after validation/conflict failures; Discard and per-row/cell revert stay local. Do not bring back the removed Edit rows modal.
- NULL, empty string, and unset/default are distinct. An untouched insert field is omitted so the database supplies its default/generated value. Keep JSON precision, date pickers, primary-key checks, and read-only/generated-column restrictions.
- Block refresh, sorting, paging, table switching, disconnect, or console navigation while edits are pending so drafts cannot be silently lost. Report pending changes to global quit/restart checks.
- Current bounds: 100 row changes / 4 MB per Apply. Complete original values are required for row deletion; cell updates may omit unrelated unavailable/oversized cells. Native `update-cells` merges multiple edited cells into one update per row.
- WHERE filter is a normal single-line input with an inert SQL-highlighted mirror (`SqlFilterInput.tsx`, `sqlHighlight.ts`). Disable spellcheck/autocorrection. SQL string delimiters use straight quotes (`name LIKE '%stefan%'`); explain curly-quote errors without rewriting valid string contents.

## API and Git behavior

- API folders support nesting and moving requests/folders between parents, with cycle prevention. Keep the WebKit drag fallback; folder dragging previously failed with native HTML drag alone.
- Environment headers and bearer/basic authorization can be inherited; explicit request overrides win. Preserve backward compatibility for existing None auth, normalize pasted Bearer prefixes, and never send duplicate Authorization headers.
- Multipart files must be actual file parts. Let the multipart builder generate Content-Type/boundary and Content-Length; a stale manual header breaks server parsing.
- Git branch rename/delete, commit revert, and individual stash Apply/Drop are implemented. Preserve repository locks/stale HEAD/index checks. Branch deletion refuses current/unmerged branches; revert stages inverse changes for review rather than auto-committing. Stash actions verify both reference and hash to avoid acting on a shifted stash index.

## Design conventions and known pitfalls

- Deep Ocean tokens: `src/theme/tokens.css`, `palette.ts`, `redesign.css`; shared icons in `DesignIcons.tsx`, file-extension icons in `FileIcon.tsx`, dropdowns in `CustomSelect.tsx`.
- UI font is bundled Inter; code/terminal font is bundled JetBrains Mono. Fonts and SIL OFL notices ship in `public/fonts`; no runtime download/install is required.
- Composite search/filter controls own focus styling on the **whole wrapper**. Inner inputs must not show a second outline/ring. The broad `redesign.css` `:focus-visible` rule can beat component CSS; check selector specificity and native appearance. Notes search uses whole-bar background change.
- Do not let general input styles affect Monaco's hidden `.inputarea`, xterm helpers, or mirrored inputs. Mirror text and input must share font/padding/scroll geometry; avoid exposing raw HTML from user content.
- Use the existing safe Markdown renderer (`MarkdownPreview.tsx`); don't replace it with untrusted HTML injection.

Keep this file focused on durable decisions and workflow. Consult source and README/docs for current implementation details; do not treat old test counts or historical feature lists as authoritative.
