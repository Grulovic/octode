# Octode

A calmer place to build. A local desktop workspace for Code, Servers, Database, and API tools.

## Working build

Octode combines a code review workspace with saved API requests, SSH/SFTP connections, and database tools. It runs in one native window. The header uses one breadcrumb: Projects / project name / tool. Projects returns to the project list and the project name opens its launcher. Code/Git, SSH/SFTP, database browsing/editing, and API requests are implemented. Semantic navigation, advanced Git operations, database dump/restore, and release hardening remain upcoming.

Autocomplete is out of scope across the whole app: no suggestion popups, inline completions, parameter hints, word completions, snippets, or SQL completion. Syntax highlighting, search, and file navigation remain core features. Cmd/Ctrl-click and F12 find project declarations and relative file references without completion providers.

Implemented source:

- React workspace shell, project cards, multi-folder project creation/editing/removal, and one native window for the whole app.
- Newly opened projects start in Code; returning to a parked project restores its last section. Cmd/Ctrl+1 selects Code → Files, +2 toggles the shared local terminal, +3 selects Servers, +4 Database, +5 API, and +0 returns to Projects.
- Shared custom dropdown menus use the same Deep Ocean surfaces as file context menus throughout Code, Git, terminals, Servers, Database, API, imports, and Settings. They support keyboard navigation/typeahead, checked selection, viewport-aware placement, and thin scrolling.
- The Code folder dropdown scopes the file tree to one project root. Opening or selecting a file tab switches to its owning root; the action toolbar no longer repeats the selected path/name.
- Native SQLite project metadata, lazy file browsing, text file reads, and Code autosave after a 600 ms typing pause.
- Reveal active file beside Collapse All expands its containing folders, scrolls the row into view, and highlights it.
- File-tree and document-tab context menus: Copy/Paste/Cut files within the project, Copy Path, Rename, Duplicate, and reveal in Finder/File Explorer. Copies use unique names; moves refuse replacement; open tabs follow moved/renamed files.
- Monaco editor with syntax grammars, a core editor worker, highlighting, find/replace, folding, document tabs, a single editor column, and unsaved-change prompts. Completion engines and language-service workers are excluded.
- Per-project live workspace cache preserves open files, editor state, local terminals and running commands, SSH/database connection views, API request drafts/history/responses, and unsaved indicators while switching projects. Background file/Git polling pauses. Live processes end when Octode quits or restarts.
- Drop Finder files/folders or file-tree items into the local terminal to paste safely quoted paths without executing them. Cmd/Ctrl+T adds a plain terminal tab when it has focus.
- Up to six independent local PTY terminal tabs with folder selection, a shared dock across all sections with a draggable top border for resizing, buffered-output search, clear/restart, xterm.js, resize handling, bounded output, ordered background input, Unicode-safe paste chunks, and window/session ownership checks.
- Folder-specific Git branch badges open that folder's Git panel; switching repository folders resets panel state. Git staged/unstaged diffs, file and text-hunk staging/unstaging, staged commits, historical commit diffs, recent history, per-file unstaged rollback (preserving the index), local branch creation/switching, fetch, fast-forward-only pull, push, explicit stash/apply, and review-before-commit merging. Three-way text conflict review has an editable result that Code autosaves, marker validation before staging, and explicit merge abort.
- File/folder creation, file/folder rename or move to an existing destination folder, and confirmed permanent deletion (files and empty folders). Open documents follow renamed paths.
- Open-file external-change checks every two seconds and expanded-folder refresh every two seconds while Code is visible. Clean buffers reload automatically; edited buffers pause autosave and expose a disk/editor comparison with explicit reload or replacement.
- Cmd/Ctrl-click and F12 navigation for project declarations and relative imports, candidate selection when ambiguous, and back/forward navigation. This is a bounded source declaration finder, not full language-server analysis.
- Double-Shift Search Everywhere works from every section, including the local terminal. Search project files/classes/functions, server and database connections, API request names/folders/environments, saved queries, and tables from the open database connection. Results open the matching section and item; live unsaved list names are searchable. Opening search does not connect or send requests. File navigation keeps combined name/path ranking and declaration-line jumps; dependency folders and symlinks are skipped.
- Quick-open by filename/path with Cmd/Ctrl+P, and project-wide literal/regex search with Cmd/Ctrl+Shift+F, case matching, configurable exclusions, Git ignore filtering, and jumps to matching lines. Project replace previews per-file diffs and requires explicit Apply.
- SQLite workspace restore for open file paths, the active file, active project folder, and selected tool. Projects have ten persistent color choices applied to cards and breadcrumbs. Older metadata is backed up before migration to version 5. Pending Code drafts have bounded recovery backups, with explicit review/restore/discard on reopening.
- Per-folder Compose/Sail PHP formatting settings: service, container project directory, and formatter executable. Formatting uses a temporary copy, checks the original before replacement, and refuses stopped services.
- Cmd/Ctrl+W closes the active Code tab through autosave, or a focused local terminal tab through its existing close confirmation. With no closable tab it keeps the app window open; native File → Close Tab follows the same behavior.
- Option/Alt+Shift+U cycles highlighted editable text through snake_case, camelCase, PascalCase, SCREAMING_SNAKE_CASE, kebab-case, dot.case, lower case, Title Case, and UPPER CASE. Selection stays highlighted; Code changes are undoable and follow Code autosave, while tool edits still require Save. Works across native code/SQL editors and text fields.
- Deep Ocean editor/app/terminal palette (see [theme mapping](docs/THEME.md)); explicitly saved editor font/indent/wrap settings, plus Cmd/Ctrl+Shift+P command palette and project settings.
- An explicitly labeled browser sandbox using sample files and a plain-text preview editor.

- API: saved folders/requests/environments, sidebar Duplicate/Delete actions and drag-and-drop between folders/Unfiled (changes require Save), HTTP methods, headers, query parameters, bearer/basic auth, JSON/text/form/multipart bodies, explicit Send/Cancel, and bounded response/headers display. The API header contains collection Import/Export, the Environment selector, and compact environment create/edit/delete icon actions; environment editing opens its own screen. The sidebar has Requests / History tabs. Includes session response history, Deep Ocean JSON coloring with initially expanded foldable properties, response export, Octode collection import/export with credential values removed, and basic Postman v2 import. Native requests bypass browser CORS restrictions; redirects are deliberately not followed.
- Servers: saved connections, explicit SHA-256 host-key trust, password/private-key/passphrase/Unix-agent auth, xterm SSH shells, Duplicate/Delete beside the connection name and in settings, private-key selection starting at the current user's `.ssh`, and SFTP browsing/upload/download/rename/mkdir/delete. Transfers stream rather than buffering whole files, with a bounded queue, byte progress, cancellation, and dropped-session cleanup.
- Database: separate connection selection/settings and connected Tables/Query Console screens. SQLite, MySQL/MariaDB, PostgreSQL connections; schema/table list with MySQL metadata decoded as UTF-8; clicking a table fetches its first page automatically; paged table results with sort and quick WHERE; saved SQL drafts, explicit Run/Stop, result limits, and default read-only connections. Writes require a confirmation when enabled. SQL highlighting, selection execution, session query history, column/index/foreign-key inspection, displayed-result CSV export, reviewed transactional row editing, and CSV import are available. Table create/alter UI is deferred to a future flow.
- SSH tunnels for server databases reuse saved Server profiles. Passwords, passphrases, auth tokens, secret variables, and sensitive headers are stored through the OS credential store; metadata stores references. Other request bodies/URLs are saved as entered, so put sensitive values in secret environment variables.
- Tool settings survive tool navigation and persist when Save is pressed. Leaving or closing warns about unsaved settings. Leaving a project closes its native services.

## Run

Requirements: Node **20.19+** (or a current supported LTS), Rust **1.90+**, and the [Tauri OS prerequisites](https://v2.tauri.app/start/prerequisites/). macOS needs Xcode Command Line Tools. Git status requires Git on PATH. The first build downloads Rust crates and may take several minutes.

```sh
cd /Users/grula/PhpStormProjects/Octode
npm install
npm run desktop
```

Open **New project**, select one or more folders, and create the project. Its workspace opens in the same window. Use **Projects** next to the logo to return. Choose Code, expand a folder, and open a file. Code changes save automatically after a 600 ms typing pause, on focus loss/tool switching, and before closing a tab or leaving the project. The status bar shows pending, saving, saved, or failed states. Cmd/Ctrl+S remains an immediate-save shortcut; Code has no normal Save button. Use Cmd/Ctrl+2 or the terminal button to open the local terminal in the selected project root from any section.

A temporary **Restart** button at the bottom left relaunches the current app/profile after saving Code, waiting for pending explicit saves, and warning about unsaved tool settings. This loads the latest rebuilt app at the same path.

Only Code files autosave. API requests/environments/folders, Server profiles, and Database connection/query settings require **Save**. Editing, changing tools, losing focus, or leaving/closing never saves these settings automatically. Switching to Projects parks the live workspace without discarding drafts or closing terminals/connections. Quitting or restarting checks unsaved work across all parked projects and waits for any Save already in progress. Native saves are read back to verify persistence, and SQLite uses full synchronous writes. A failed Save preserves edits for retry. HTTP requests, SSH connections, SQL queries, transfers, database Apply, and schema execution remain explicit actions.

The built development app is at `src-tauri/target/debug/bundle/macos/Octode.app`. Open it directly to run without a development server. Rebuild it with:

```sh
npm run tauri -- build --debug --bundles app --no-sign --ci
```

Browser-only layout preview:

```sh
npm run dev
```

Open `http://127.0.0.1:1420`, then **New project** to open the sample workspace. Preview edits stay in memory for that page session. It cannot access local folders or execute shell commands.

## Checks

```sh
npm run build
npm test
npm run test:search-core
npm run test:native-core
npm run doctor
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
```

The Files dropdown shows only the selected folder’s contents and displays its branch when available. Terminal tabs fill their toolbar without gaps. Press Cmd/Ctrl+2 once to toggle the shared terminal, or twice within 400 ms to start the configured command in a new terminal tab. Change the command in Settings → Terminal launch command; the default is `codex`. Saving settings or reopening a project does not run it.

Verified with Rust/Cargo **1.99.1** and Node **20.20.2**: the production TypeScript/Vite build, all **199 Vitest tests** (including autosave timing/concurrency/failure checks and syntax-tokenization and PHP theme token tests), all **74 Rust tests**, and Clippy with warnings denied. The macOS development bundle built successfully. Native UI checks covered project creation, folder selection, Monaco editing/saving, PTY commands in the selected folder, Git status, quick-open, text search, session restore, external-save conflict protection, and the unsaved-close prompt. See [validation details](docs/VALIDATION.md) for the checks and remaining limits.

Both dependency lockfiles are now present. Downloads and local server ports remain restricted inside the agent environment; the installed caches allow offline Rust checks and native app builds. After cloning, use `npm ci` and `cargo fetch --locked --manifest-path src-tauri/Cargo.toml` from a terminal with network access.

`npm run test:native-core` tests the production filesystem, terminal-flow, and search modules using only Node and the installed Rust compiler; it downloads nothing and does not compile Tauri. `npm run test:search-core` runs just the search tests. The regular `npm test` suite includes workspace, terminal-input, and browser-sandbox tests and needs the declared npm dependencies installed. `npm run doctor` checks development prerequisites and returns a failing exit code when something is missing.

To populate dependency caches from a normal terminal with network access:

```sh
cd /Users/grula/PhpStormProjects/Octode
npm ci
cargo fetch --locked --manifest-path src-tauri/Cargo.toml
```

Then run the build/check commands above. Keep both lockfiles for reproducible builds.

A standalone browser preview generated during development is available at `.tools/preview/Octode.html`. Open it directly to explore the layout, sample files, quick-open, and text search. It is a generated, ignored artifact, not a desktop executable.

## Structure

```text
src/
  components/       File tree, code workspace, editor, terminal, browser preview
  lib/              Native bridge and workspace helpers
  App.tsx           Welcome screen, project launcher, navigation
src-tauri/src/
  projects.rs       SQLite project metadata and root authorization
  files.rs          Bounded UTF-8 reads and conflict-aware saves
  file_core.rs      Dependency-free filesystem implementation and tests
  terminal.rs       PTY lifecycle and bounded output flow
  terminal_core.rs  Bounded terminal flow and background input worker
  search_core.rs    Bounded, cancellable project text/file search
  http_client.rs    Native bounded HTTP requests and environment expansion
  ssh.rs            Pinned SSH connections, shells, SFTP, and TCP tunnels
  database.rs       SQLx drivers, typed cells, paging, and bounded query results
  secrets.rs        System credential storage and metadata sealing
  operations.rs     Owned cancellation tokens
  lib.rs            Window lifecycle and Tauri command interface
docs/ROADMAP.md     Decisions, milestones, and acceptance gates
```

Native metadata is stored in `octode.sqlite` in Tauri's application-data directory for `dev.octode.desktop`. Project source folders stay where they are. On reopening a project, source files are read fresh from disk; missing files are reported and skipped. Code recovery snapshots are saved after a 250 ms pause, up to 100 files / 20 MB per project, with a 5 MB file limit. The latest unbacked interval can be lost on a hard crash. Restoring a draft requires an explicit decision; changed/missing disk files pause autosave for review. Unresolved Code drafts can remain recoverable after leaving a project. The last active project and selected request/environment/connection/query restore on launch; project entry always starts in Code. Shells and remote/database connections do not reconnect automatically. Browser-sandbox files and workspace state remain in memory only.

## Current limits

- Text files must be UTF-8 and at most 5 MB; binary files are rejected.
- Save checks the current disk contents before replacing the file. It refuses detected external changes and offers reload/compare with explicit replacement. This is not a filesystem-level atomic compare-and-swap guarantee.
- External-change detection uses polling, rather than native filesystem events. Only open text files and expanded folders are refreshed. Deletion is permanent and requires confirmation; only empty directories can be removed. Symlink mutations, recursive deletion, cross-volume moves, and case-only renames are unsupported.
- Up to six local terminal tabs keep their original folders and shells when the selected Code root changes. Hiding the terminal or switching tools keeps its session alive.
- Git actions require the selected project folder to be the repository root. Partial staging supports ordinary text diffs; renamed/new/deleted/binary/mode-change files require whole-file staging. Remote branch checkout, rebase, cherry-pick, worktree UI, and richer history remain upcoming. Use the local terminal for these commands. Git subprocess output is bounded to 4 MB, operations are serialized per repository, and commands time out after 90 seconds.
- Visual conflicts currently support UTF-8 text conflicts with base/ours/theirs stages. Binary and add/delete conflicts require the terminal. Branch switches/pulls/merges require a clean working tree; merge results stop before committing. Abort explicitly discards the merge-result edits. Git hooks and credentials follow the repository/user configuration.
- Navigation scans at most 5,000 source files / 32 MB / three seconds and returns up to 100 candidates. Generated folders, vendor, node_modules, and symlinks are skipped. Dynamic dispatch, aliases, inheritance, references, and dependency navigation remain upcoming. It can return several lexical declarations rather than one semantic definition.
- Project search uses literal text or Rust regular expressions over saved files, with a 200-result cap, a 1 MB per-file text-search limit, and a bounded directory walk. It skips symlinks and common generated directories. Git supplies ignore filtering inside repositories; outside repositories only explicit/common exclusions apply. Regex search is line-based and does not support lookaround. Replace applies reviewed files separately and reports partial failures; it is not a multi-file transaction. Ripgrep acceleration remains upcoming.
- Database operations use a new connection per run (60-second timeout); transaction/session state does not span runs. SQL is one statement per run. Cells preserve large integers as strings; unsupported types are labeled instead of guessed. Results cap at 1,000 rows / 20,000 cells / 8 MB, with a 64 KB cell display limit. Visual row edits require a primary key and supported comparable types; MySQL requires InnoDB. Apply uses a transaction and original-row checks. CSV import is limited to 100 data rows / 4 MB per batch. Schema design covers create table, add column, and create index; complex migrations, foreign-key editing, multiple result sets, and dump/restore remain upcoming.
- Through SSH, full database TLS hostname verification is not implemented yet and is refused explicitly. Choose TLS required (without certificate verification) or TLS disabled only when appropriate for that tunnel. Direct connections default to full verification.
- Stopping SQL drops the query connection; it cannot guarantee server cancellation or rollback of an already committed statement. Verify outcomes before retrying writes. SQL connections never replay writes automatically.
- SFTP currently shows at most 10,000 entries, supports one active transfer plus up to 20 queued files per screen, and has no resume support. Upload cancellation can leave a partial remote file; downloads use a temporary sibling file. Symlink navigation and remote editing are not implemented.
- Real-network SSH authentication/agent behavior, MySQL/PostgreSQL servers and local HTTP fixtures remain to be verified. Encrypted SSH shell/direct-channel and SFTP integration is covered with an in-memory duplex transport and temporary files. A native HTTPS GET to example.com returned 200 OK. The agent sandbox blocks listening ports; SQLite is covered by real-file integration tests.
- API request bodies cap at 4 MB, multipart files at 10 MB each / 32 MB combined, responses at 2 MB, with four recent per-request responses plus a bounded 12-entry / 8 MB session history held in memory. Binary responses display as base64. Exports save displayed response data; collection exports retain entered URLs/bodies, so secret values belong in credential fields or secret variables. Basic Postman import does not execute scripts or inherit collection/folder auth; imported multipart file fields require manual local selection. Redirects, scripts, and collection runs are not implemented.
- Deleted secret references are no longer accessible through the tool UI; automatic orphan cleanup in the system credential store remains upcoming.
- Native Windows/Linux behavior is unverified. Installers, app signing, and automatic updates are not configured.

See [the roadmap](docs/ROADMAP.md) for the next implementation steps.
