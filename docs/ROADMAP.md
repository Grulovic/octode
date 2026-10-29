# Octode implementation roadmap

## Product decisions

Build for the owner's PHP/Laravel and JS/TS daily workflow. macOS first, portable to Windows and Linux. Keep four focused tools inside each project: Code, Servers, Database, API. Local terminals share one persistent project dock across all sections.

Code is primarily for reading and reviewing agent-written changes. Autocomplete is removed from the entire product scope, including code/word/inline suggestions, signature hints, snippets, and SQL completion. Keep syntax highlighting, search, and navigation.

Code files autosave after a 600 ms typing pause, when leaving Code/losing focus, and before closing a tab or leaving the project. Serialize writes per file and preserve buffers on errors or external conflicts. API, Server and Database settings require explicit Save, with readback verification and unsaved-change warnings before leaving/closing. Sending requests, running queries and applying database changes remain explicit. A separate bounded Code draft recovery store requires explicit review/restore/discard.

A project groups several local folders/Git repositories, server connections, database connections, and API collections. One native window for the whole app. Projects beside the logo returns to the project list. The welcome screen shows project cards; projects open directly into Code. Cmd/Ctrl+1 selects Code, +2 toggles the shared local terminal, +3 Servers, +4 Database, +5 API; +0 returns to Projects. Keep tool state while switching.

Use a shared sidebar/main tabs/optional bottom panel layout. Default to the Deep Ocean theme; system/light appearance and configurable shortcuts follow. Keep uncommon options in contextual menus or expandable settings.

## Architecture

- Tauri 2 + Rust; React/TypeScript + Vite frontend.
- Monaco editor with selected editing controls and lazy syntax grammars. Exclude suggestion engines and JSON/CSS/HTML/TypeScript language-service workers. No general PHP/JS/TS language-server integration is planned.
- Keep Cmd-click definition/file navigation, history, and references as a separate navigation-only milestone. Introduce a navigation index when implementing that capability, without completion providers.
- xterm.js + portable-pty for local shells. Stream terminal output over Tauri channels, acknowledge rendered bytes, and bound pending output.
- Installed Git executable, always with argument arrays. The initial project search uses a bounded dependency-free Rust scanner; Git supplies ignore filtering; configurable exclusions and regex are implemented. Bundled ripgrep acceleration is later scope.
- SQLx adapters for MySQL/MariaDB, PostgreSQL, SQLite. Engine-specific metadata, SQL generation, cancellation, and schema-change behavior.
- russh/russh-sftp for shared SSH sessions, tunnels, and transfers. reqwest for API requests.
- SQLite for versioned app/project metadata. OS credential store for secrets. No required account, cloud sync, or telemetry.
- Typed commands for operations, channels for streams, explicit project/root/repository/connection/session IDs. Long operations report progress and cancellation state.

## Milestone 0 — Validate the technical slice

- [x] Create Octode repository source and Tauri configuration.
- [x] Implement desktop file/editor/terminal source and browser sandbox.
- [x] Compile a browser-target bundle with locally cached build dependencies; run workspace utility checks.
- [x] Pass all 199 Vitest tests and all 74 Rust tests, including autosave concurrency/failure handling, syntax highlighting, SQLite sessions, and migration backups.
- [x] Upgrade and verify Rust/Cargo 1.99.1; populate dependency caches from the user's terminal.
- [x] Move terminal input to an ordered background worker, bound output reservations and paste queues, test blocked-writer behavior and real shell I/O through pipes, and add development readiness checks.
- [x] Install declared dependencies and generate npm/Cargo lockfiles.
- [x] Complete the production TypeScript build, Rust tests, formatting, and Clippy with warnings denied.
- [x] Build and launch a native macOS development app; verify folder selection, single-window project navigation, Monaco editing/saving, native PTY commands, search, Git status, saved-session restore, and external-save conflict protection.
- [ ] Stress-test the core editor worker, terminal resize/large output/child cleanup, and repeated window lifecycles.
- [x] Remove autocomplete, inline suggestions, parameter hints, word suggestions, and snippets; load only syntax grammars and editing controls. Verify syntax tokenization across nine language scenarios.
- [ ] Verify navigation independently on real projects; no autocomplete or general language-server setup.
- [ ] Prove Sail formatting, one database query, and one SSH tunnel.
- [ ] Measure startup, input latency, memory, and concurrent workload behavior in production builds.

Gate: real-project highlighting, navigation, and container formatting work; search, terminal output, and queries do not freeze input.

## Milestone 1 — Complete the project shell

- [x] Project cards, project creation, multiple roots, single-window project navigation, direct Code entry, navigation shortcuts.
- [x] Edit/remove project metadata without deleting source folders.
- [x] Implement SQLite persistence for active tool/root, open files, and active file; add a metadata migration backup. Verify restoring the active tool and files in native windows without starting a shell automatically.
- [ ] Persist panel sizes, expanded folders, and other layout preferences; test restart behavior in the native app.
- [x] Editor font, indentation and wrap settings with explicit Save; command palette.
- [ ] System/light appearance and shortcut editing.
- [x] Refresh the welcome project list when returning through Projects; keep all tools in the main window.

Gate: backend/frontend project roots and single-window project navigation restore correctly without state leaking between projects. Network sessions reconnect explicitly after restart.

## Milestone 2 — Complete daily Code and local terminals

- [x] Lazy file tree, file tabs, native UTF-8 reads/saves, dirty indicators, external-change checks.
- [x] Monaco highlighting/find/replace source, local PTY source, Git status source.
- [x] File create/rename/move/delete (files and empty folders), automatic external-change polling, and reload/compare with conflict-aware replacement.
- [x] Split editor with synchronized Code autosave.
- [ ] Native filesystem event watching, symlink mutations, and recursive Trash flow.
- [x] Quick-open by path/name and cancellable literal saved-file search, match-case toggle, line navigation, and generated-folder exclusions.
- [x] Regex search, configurable/.gitignore-aware exclusions, and project replace with reviewed diffs.
- [x] Double-Shift Search Everywhere for filenames, classes and functions with declaration-line navigation.
- [ ] Search acceleration and persistent semantic navigation index.
- [x] Cmd/Ctrl-click and F12 for bounded project declarations and relative file references, candidate selection, and back/forward history.
- [ ] Semantic disambiguation, inheritance/aliases, dependency navigation, and references through a navigation-only index.
- [ ] Index dependencies only when required for navigation; provide no completion, parameter hints, or automated refactoring.
- [x] Per-root Compose service/container directory/formatter settings; temporary-copy PHP formatting inside Compose, expected-source replacement and stopped-service refusal.
- [ ] Verify against a real Sail/Pint container; general host/container path maps beyond one project-root mapping.
- [x] Multiple terminal tabs, search, clear, shell exit/restart, and root selection without unexpectedly replacing a running terminal.
- [x] Code autosave with pending/saving/failure states, immediate Cmd/Ctrl+S, close-time flushing, per-file serialization, external-conflict protection, and explicit retry. Remove Code's normal Save button.
- [x] Bounded Code draft recovery with explicit review/restore/discard; explicitly save tool settings while keeping database Apply explicit.

Gate: complete a small Laravel and React task using navigation, search, formatting, file operations, and local terminal commands.

## Milestone 3 — Daily Git and merge workflow

- [x] Selected-root repository detection, staged/unstaged whole-file diffs, staging/unstaging including renamed paths, staged commits with expected HEAD/index checks, recent commit summaries, local branch creation/switching, fetch, fast-forward-only pull, push, and explicit stash/apply (keeping the stash).
- [x] Review-before-commit merges, base/ours/theirs text comparison, editable autosaving result, marker validation before resolution staging, and confirmed merge abort.
- [x] Disposable repository integration tests cover Unicode/literal paths, rename unstaging, stale diff/index rejection, branches, local-remote push/fetch/pull, conflicts, resolution commits, and abort.
- [x] Stage/unstage selected text hunks with reviewed-patch/index checks and inspect historical commit patches.
- [ ] Full branch/remotes management, binary/add-delete conflict resolution, richer history, and broader remote-auth integration.

Three-way conflict editor: base/local/incoming plus editable result. Code autosaves; flush and validate before staging resolved files. Handle binary and delete/modify conflicts explicitly. Never silently stash, discard edits, or force-push. Advanced operations stay accessible through the terminal; interactive rebase/worktree/cherry-pick UI is later scope.

Gate: complete a feature branch and conflicting merge without losing edits.

## Current service implementation

- [x] Replace three placeholder tool screens with project-scoped explicit-save documents; retain drafts across tool switches and warn before discarding.
- [x] API request/folder/environment editing, params/headers/auth, JSON/text/form/multipart, native HTTP send/cancel, bounded inert response display. Test request construction, variable expansion, and project-scoped secret resolution.
- [x] Server settings, key fingerprint trust, auth adapters, SSH shell transport with bounded output, SFTP listing and streaming transfers/file actions, TCP tunnel infrastructure. Unit-test fingerprint mismatch rejection.
- [x] SQLx driver adapters for SQLite/MySQL/PostgreSQL, default read-only, typed cells, table enumeration, paged browsing/sort/WHERE, saved SQL drafts and run/stop. Test SQLite values, read-only behavior, and identifier/filter validation.
- [x] Version-4 metadata migration/backup, tool isolation, owned cancellation, OS secret-store references; secrets never silently fall back to plaintext.
- [x] Encrypted in-memory SSH password rejection/acceptance, PTY shell/direct-channel traffic, SFTP listing/upload/download/rename/delete and byte progress integration.
- [ ] Real-network SSH agent/key/tunnel verification, HTTP edge-case fixtures, and MySQL/PostgreSQL integration suite. Listening sockets are blocked in the agent sandbox.
- [ ] Database TLS hostname verification through tunnels; reject this mode until supported. Direct verification works through the driver.
- [x] Reviewed row edits, CSV import/export, table/column/index SQL designer, SQL highlighting, metadata inspection, session query/HTTP history, and transfer queue/progress.
- [ ] Full schema alteration/foreign-key editing, database dump/restore, and orphan-credential cleanup.

## Milestone 4 — Database browsing and SQL

Database comes before the full Servers UI. Build the shared SSH/tunnel infrastructure here.

- Connection cards, test connection, TLS, credential store, optional SSH tunnels for server engines; local file selection for SQLite.
- Lazy schema/table navigation, metadata inspector, table tabs with bounded pages, sort, structured filters, optional raw WHERE.
- Independent SQL consoles, selection/statement execution, multiple result sets, errors/timings, history, and cancellation.
- SQL editor uses syntax highlighting, manual queries, and schema/table/column inspection. SQL completion is out of scope.
- Preserve TLS host verification through tunnels. Broken tunnels invalidate affected sessions; reconnect without replaying SQL automatically.
- Result cells preserve NULL, large integers, decimals, timestamps, and binary values without JS precision loss.

Gate: browse/query all engine families, including a tunneled connection, while Code remains responsive. Verify cancellation against actual server state.

## Milestone 5 — Visual database management

- Pending row inserts/updates/deletes; review generated SQL and explicitly Apply/Discard. Use primary/suitable unique keys; keep unidentifiable rows read-only.
- Table create/alter, columns, primary keys, indexes, foreign keys. Generate dialect-specific SQL for review before applying.
- CSV import with mapping/preview; table/result CSV export.
- SQL dump/restore through configured native tools with progress/output/cancellation.
- Display actual partial failures. Never promise rollback of nontransactional DDL.

Gate: create/alter a table, edit rows, import/export, and recover from errors on every engine.

## Milestone 6 — Servers and SFTP

Connection cards; password/private-key/encrypted-key/agent auth; host-key verification; SSH terminal tabs; resize/disconnect/reconnect. SFTP browsing, upload/download, rename, directory creation, delete, transfer queue/progress/cancel, overwrite choices.

Remote file editing and full remote development are later scope. Downloads do not silently become synchronized remote files.

Gate: verify transfers both ways, cancellation, changed host keys, bad credentials, connection loss, and cleanup of dependent tunnels.

## Milestone 7 — API tester

Folders and saved HTTP requests; query params; headers; bearer/basic auth; JSON/text/form/multipart bodies and file uploads. Environments and missing-variable feedback. Response status/time/size/headers/formatted content, history, timeout/cancel.

Requests execute in Rust. Response bodies remain inert data. Secret environment values use the credential store. Bound displayed body size and support saving larger responses to disk.

Basic Postman v2 import and credential-redacted Octode collection import/export are implemented. Full Postman compatibility/export, scripts, response tests, collection runs, WebSockets, and GraphQL-specific tooling are later scope.

Gate: exercise a Laravel API with auth, environments, JSON, multipart upload, errors, timeout, and cancellation.

## Milestone 8 — Hardening and portability

Metadata migrations with backup, draft recovery, secret-free export/import, local diagnostics, dependency notices, signed macOS builds. Then Windows/Linux: shells/PTYs, paths, permissions, Git/SSH agents, credential stores, webview rendering, keyboard shortcuts. Manual updates first.

## Performance and validation

Initial production-build targets on the owner's Mac: interactive welcome under 2 s; revisiting loaded tools under 100 ms; typing p95 under 50 ms during background work; normal local source files open under 200 ms; idle CPU around 1% or less. Record hardware/repository size. Set a total memory regression budget after measurement, including webviews, the core editor worker, and terminal processes.

Lazy-load tools and workers; virtualize long lists/grids; bound data retention; debounce searches; avoid repeated whole-project scans. Test real concurrent indexing, terminal output, and database queries.

Unit coverage: path authorization/mapping, filters, SQL generation, variable expansion, migrations, external-save conflicts. Integration coverage: disposable Git repositories, databases, SSH/SFTP, HTTP fixtures. End-to-end coverage: project creation, saves/dirty-close behavior, shortcuts, merge resolution, row editing, API execution, and restart recovery.
