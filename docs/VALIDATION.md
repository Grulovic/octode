# Native foundation validation

Validated on this macOS/Apple Silicon machine on 2026-10-26 with Node 20.20.2 and Rust/Cargo 1.99.1. All locked dependencies declare Rust requirements at or below the application's 1.90 minimum; other compiler versions have not been tested.

## Automated checks

| Check                                                                                      | Result                                                                                                                                          |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run build`                                                                            | Production TypeScript/Vite build passes                                                                                                         |
| `npm test`                                                                                 | 32 tests pass, including Code autosave timing/concurrency/failure checks, workspace, terminal input, browser workflows, and syntax tokenization |
| `cargo check --offline --manifest-path src-tauri/Cargo.toml`                               | Full native backend compiles                                                                                                                    |
| `cargo test --offline --manifest-path src-tauri/Cargo.toml`                                | 23 tests pass, including SQLite sessions and migration backup                                                                                   |
| `cargo clippy --offline --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` | Passes                                                                                                                                          |
| `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`                                | Passes                                                                                                                                          |
| `npm run tauri -- build --debug --bundles app --no-sign --ci`                              | Creates the local macOS development app                                                                                                         |

Native bundle: `src-tauri/target/debug/bundle/macos/Octode.app`. This uses production frontend assets and debug Rust code; it is not a signed/notarized distribution build. The syntax-only runtime reduces the minified lazy editor chunk from approximately 3.32 MB to 2.59 MB and removes four language-service worker bundles totaling approximately 8.06 MB. The core editor worker remains. Startup, memory, typing latency, and sustained output throughput have not been benchmarked.

## Native UI smoke checks

The locally built app was exercised through macOS Computer Use against the disposable `.tools/native-check` workspace:

- Select a folder through the native picker; create a project and open its separate window.
- Use Cmd+1 to open Code, browse local files, and load a file in the bundled Monaco editor.
- Edit the sample file and save; verify the changed bytes directly on disk.
- Start the local PTY shell and execute a command that creates a known marker inside the selected project folder; verify the marker on disk.
- Read the Git branch/status of the disposable repository.
- Use Cmd+P to find and open a nested PHP file without expanding its parent folder.
- Use Cmd+Shift+F to search saved files and select a matching line.
- Switch to Database, close/reopen the project, and verify the active tool, both open files, and active file restore. Verify that no terminal reconnects automatically.
- Change the sample file outside the editor, attempt to save its dirty buffer, and verify that the external disk contents remain intact and the app reports the conflict.
- Request window close with a dirty buffer and observe the native confirmation prompt. Native cancellation of that prompt was not conclusively checked; cancellation is covered in the browser-component tests.

The disposable test project remains available as **Octode native check**. Its files are under the ignored `.tools` directory.

After autocomplete removal, the syntax-only runtime passes nine tokenization scenarios and production/native builds. The explicit-height editor host was rechecked on 2026-10-27 in an isolated native app instance: the editor viewport displays correctly, Cmd+F focuses Find, and searching a known string reports one matching result. This replaces the earlier UI recheck blocked by `cgWindowNotFound` in the original app instance.

## Remaining foundation checks

- Navigation-only definition/file lookup and Sail formatting. Autocomplete and general PHP/TypeScript language-server integration have been removed from scope.
- Database driver and SSH tunnel proof of concept.
- Native terminal resize, rapid input, large output, long-running child shutdown, and repeated window lifecycle stress tests.
- Core editor worker behavior and highlighting/folding across large repositories; no language-service diagnostics or completion engines.
- Performance targets on production Rust builds; Windows/Linux builds and UI behavior.

The frontend browser sandbox and native app use different editor/terminal implementations. Browser-only tests do not substitute for the native smoke checks above.

## Code autosave update — 2026-10-27

Code now autosaves after a 600 ms typing pause and flushes on focus loss, tool switches, tab close, and project-window close. Writes are serialized per file; a failed write pauses automatic retries for that file, preserves the buffer, and exposes Retry. Cmd/Ctrl+S forces an immediate attempt. Other tools retain explicit Save/Apply semantics. No crash/force-quit recovery is claimed.

Automated coverage includes debounce timing, independent inactive tabs, edits/undo during an in-flight write, external conflicts, immediate flush, cancellation on disposal, explicit retries, synchronous transport failures, and browser workflows for automatic saving and close-time saving.

Native autosave verification on 2026-10-27 used a separate `dev.octode.autosavecheck` app identifier and `.tools/autosave-check` workspace. Typing into Monaco without pressing Save wrote the expected bytes to disk and changed the status from pending to Autosaved. Editing and closing the tab also preserved the new contents without a save prompt. Native Find focused the correct field and reported the expected match. This isolated check did not modify the normal app's project database.

The isolated native project-window close check also passed: a fresh Code edit followed immediately by Cmd+W persisted the latest bytes and returned to the project list without a discard prompt.

## Service tools and single-window navigation — 2026-10-27

The current source replaces the API, Servers, and Database placeholders with native-backed tools. Projects now open in the main window, and Projects beside the logo returns to the list. Code retains autosave; the three service tools use explicit Save and preserve drafts across tool switches.

Checks passed with Node 20.20.2 and Rust/Cargo 1.99.1:

- Production TypeScript/Vite build and **35 Vitest tests**. New browser workflows verify API draft retention, explicit Save, unsaved-leave protection, saved request restoration, and actual server/database forms.
- **31 Rust tests**, including native HTTP request construction (query encoding, auth, environment substitution, project-scoped credentials), host-key pin mismatch rejection, owned operation cancellation, isolated tool metadata, and SQLite integration.
- SQLite integration covers exact 64-bit integers, NULL/binary values, computed columns including COUNT, read-only writes being rejected, identifier escaping, filter validation, and closed-session rejection.
- Rust formatting and Clippy for all targets with warnings denied.
- An unsigned debug native bundle with production frontend built at `src-tauri/target/debug/bundle/macos/Octode.app` (**74.81 MiB**). This is a development build, not a signed release or a performance benchmark.

Native UI checks used an isolated `Octode Check.app` / `dev.octode.autosavecheck` profile and disposable files in `.tools/autosave-check`:

1. Opened the existing QA project, switched tools with Cmd+2/3/4, and returned to Projects in the same native window.
2. Created and explicitly saved an API request, sent a GET to `https://example.com`, and observed **200 OK**, 577 response bytes, with the HTML displayed as inert text.
3. Created/saved a SQLite connection to a 405-row fixture. Connected, listed the table, loaded 200 rows, and verified page 2 starts at ID 201. A quick WHERE of `id > 400` returned five rows with Next disabled.
4. Edited a SQL draft, verified the unsaved-project-leave prompt, cancelled leaving, saved, and returned to Projects. Restart restored the connection settings and saved SQL while leaving the database disconnected until explicit Connect.
5. Native testing caught computed SQLite values being decoded using incomplete static metadata. After fixing runtime type selection and adding regression coverage, rerunning `SELECT 9007199254740993 AS exact_id, COUNT(*) AS count FROM checks` displayed the exact integer and **405**, both typed INTEGER.
6. Created/saved a server profile and verified Connect refuses to proceed before its host fingerprint is trusted. No untrusted SSH connection was accepted.

Remaining integration work: real SSH authentication/shell/SFTP/tunnels, MySQL/MariaDB and PostgreSQL, OS credential-store dialogs/failure behavior, and fixture-based HTTP edge cases/cancellation. The shell sandbox rejects listening sockets, so local network fixture servers could not be started there; the normally launched desktop app successfully made the HTTPS request above. Windows/Linux behavior and production performance are unverified.

Database TLS hostname verification through SSH is explicitly refused until implemented. Direct connections default to full TLS verification. Query Stop drops the connection and does not claim that a server-side write has been rolled back. Visual row/schema editing, SQL syntax highlighting/metadata inspection, query history, and transfer queues/progress remain on the roadmap.

## Code and Git implementation — 2026-10-27

Implemented Code file/folder creation, rename/move to an existing destination folder, and confirmed permanent deletion of files/empty folders. Paths are project-scoped; existing destinations, project roots, Git internals, and symlink mutations are refused. Open tabs follow renamed paths. Open text files are checked every two seconds while Code is visible; expanded folders refresh every ten seconds. Clean buffers reload automatically. A dirty buffer with external changes pauses autosave and exposes a read-only disk/editor diff, explicit reload, or conflict-aware replacement.

Cmd/Ctrl-click and F12 now find project declarations and relative file references, with candidate selection and back/forward history. This bounded lexical finder skips generated/dependency folders and is not semantic PHPStorm navigation. References, aliases/inheritance/dynamic dispatch, dependency navigation, and a persistent navigation index remain upcoming.

The Git panel now supports file diffs, whole-file stage/unstage, staged commits, recent commit summaries, local branch create/switch, fetch, fast-forward-only pull, push, stash/apply, and review-before-commit merging. Text merge review shows base/ours/theirs and an editable Code-autosaved result; remaining markers prevent resolution staging. Merge abort requires explicit confirmation. Hunk staging, binary/add-delete visual conflicts, historical commit diffs, richer branch/remotes management, and advanced Git operations remain upcoming.

Verification passed:

- **43 frontend tests**, including file create/rename/delete with autosave, clean external reload, preserving dirty conflicts, autosave pause/resume, a single clickable Projects/project/tool breadcrumb, and direct Monaco model binding/reload/late-event tests.
- **42 Rust tests**, including path safety, no-overwrite file operations, relative-reference/declaration navigation, literal/Unicode Git paths, staging/unstaging, renamed-path unstaging, expected-HEAD/index checks, stale reviewed diff rejection, branch changes, conflicting merges/resolution commits, explicit abort, and local-remote push/fetch/pull.
- Production TypeScript/Vite build, Rust formatting, and all-target Clippy with warnings denied. The normal unsigned macOS development bundle is about **76.06 MiB**; this is not a release performance measurement.

Native QA used only `.tools/autosave-check` and the isolated `dev.octode.autosavecheck` app metadata. A disposable Git repository was created there. Verified native Git diff review, file staging, an explicitly confirmed commit, merge initiation, three-way source display, editable result autosave, and validated resolution staging. Cmd-click opened the PHP declaration. Native file creation and rename retained the correct disk contents and open-tab path. An external clean-file update reloaded. A read-only file produced a preserved draft; disk/editor comparison displayed both versions, explicit replacement succeeded after permissions were restored, and Reload correctly replaced the editor draft with the reviewed disk text.

Native testing found two editor issues: an old model-change callback could target the preceding tab, and read-only prop synchronization could leave a reload showing stale contents. The editor now binds directly to Monaco with a model per file, suppresses programmatic flush events, synchronizes external text deliberately, and ignores events from disposed editors. Dedicated regression tests cover those cases. Repeated native tab switches and reopening/editing a merge result left unrelated tracked files unchanged. The comparison view also uses explicit Monaco layout sizing and was visually checked in the native WebKit window.

The header now has one breadcrumb next to the logo: **Projects / project name / current tool**. Projects returns to the project list; the project-name button returns to its launcher. The separate centered tool label and duplicate project-home breadcrumb were removed.


## Expanded daily tools — 2026-10-27

This section records the current build and supersedes earlier feature limitations and test counts above. The app remains in one window, uses `Projects / project / tool`, has no autocomplete, and autosaves only Code. Service settings and SQL drafts require Save; row edits and CSV imports require reviewed Apply; SQL and HTTP requests execute explicitly.

Current checks passed with Node 20.20.2 and Rust/Cargo 1.99.1:

- **59 frontend tests in 11 files**, including recovery serialization/restore decisions, terminal tabs, explicit row review/Apply, CSV quoting/mapping/empty-row preservation, schema SQL generation, and credential-redacted collection interchange.
- **55 Rust tests**, including selected-hunk staging/unstaging, historical commit patches, ignored-file search/regex replacement preview, project metadata changes without deleting sources, version-4 draft persistence, transactional row edits, temporary-copy PHP formatting, streaming transfer progress, and SSH/SFTP transport integration.
- **19 standalone native-core tests** (filesystem, terminal flow, search), without compiling Tauri or fetching dependencies. These overlap the full Rust suite.
- Production TypeScript/Vite build, Rust formatting, and all-target Clippy with warnings denied. Vite reports large Monaco chunks; this is recorded rather than treated as a performance measurement.
- The regular unsigned debug macOS bundle was rebuilt at `src-tauri/target/debug/bundle/macos/Octode.app`, about **84.79 MiB**. The production frontend is embedded, but Rust uses its development profile. No signing, release performance, Windows, or Linux claim is made.

Native QA used the separate `dev.octode.autosavecheck` identifier and disposable `.tools/autosave-check` workspace/database:

1. Displayed a persisted Code recovery prompt and restored its draft; the recovered bytes reached disk and the prompt cleared. Metadata migrated to version 4. Backups are debounced 250 ms and bounded to 100 files / 20 MB per project, with a 5 MB file limit; the most recent unbacked interval can be lost in a hard crash. Draft restoration never silently overwrites an externally changed file.
2. Reviewed two separated Git hunks and staged only the first. Independent disk checks confirmed that the index contained the first change and the unstaged diff contained only the second. Inspected a historical commit's full patch in the native UI.
3. Opened synchronized split editing and two independent local terminal tabs. Ran commands in each tab that wrote separate QA marker files; switching tabs preserved the first shell. No shell is restored automatically on startup.
4. Confirmed the database's default read-only state disables visual editing/schema actions. Explicitly saved writable settings and reconnected to the disposable SQLite fixture.
5. Loaded metadata and rows including exact ID `9007199254740993`. Edited that row's name, queued the edit, and reviewed parameterized SQL with original values. A direct SQLite read while the Apply confirmation was open showed the original value. After confirming Apply, the expected name appeared in both the grid and file while the ID remained exact.
6. Generated an Add Column statement with the table designer. Moving it into the syntax-highlighted SQL console did not execute it. Cmd+Enter opened the SQL execution confirmation; confirming added the column, recorded session query history, and retained the query as an explicitly saved draft. Visually inspected native Monaco SQL highlighting and layout.
7. Selected a CSV file through the native file dialog, verified automatic column mapping and the preview (including an embedded comma and empty text field), reviewed generated bound INSERT SQL, and explicitly confirmed Apply. The new row appeared with empty text separate from NULL. Additional automated regression tests prevent dropping entirely empty CSV records and exported empty values.
8. Sent the saved HTTPS request to example.com and received **200 OK**, 577 bytes. Session response history populated without saving/replaying the request. Collection and response export controls are present; native file-export/import UI round trips remain to be exercised separately.
9. Opened the command palette with Cmd+Shift+P, navigated to settings, saved editor preferences explicitly, returned to Projects in the same window, and saved the existing project's metadata through Edit project.

The SSH integration test uses actual encrypted russh client/server traffic over an in-memory duplex stream, so it does not need the listening sockets blocked by the shell sandbox. It verifies pinned host handling, rejected/accepted password authentication, PTY shell and direct-channel traffic, SFTP listing, a 180,000-byte upload/download with progress, rename/delete, and session cancellation. It exercises production session/transfer code, but it does not substitute for external-server key/agent authentication or a database tunnel end-to-end check.

PHP formatting tests use a mock Compose runner to verify the temporary file, container-relative path, cleanup, stopped-service refusal, and conflict-aware final replacement. Actual Docker/Sail/Pint execution remains unverified. The app does not start containers.

Remaining work: real MySQL/MariaDB and PostgreSQL integration; external SSH private-key/agent/credential-store behavior and tunnel failure handling; full TLS hostname verification through SSH (currently explicitly refused); advanced schema/foreign-key editing and dump/restore; binary/add-delete Git conflict UI; native filesystem events; semantic navigation/reference indexing; full Postman compatibility and HTTP edge cases; orphan-secret cleanup; light/system appearance; release signing/installers; production performance and cross-platform verification.


## Double-Shift search and API sidebar actions — 2026-10-27

Added Code Search Everywhere on two clean Shift taps (350 ms interval), plus a toolbar entry. It combines project filenames, class/interface/trait/enum declarations, named functions/methods and common JS/TS arrow functions, with name/path matching, result type and location, arrow-key navigation, Enter to open at the declaration line, Escape to close, and focus restoration. Ordinary Shift typing, key repeat, other modifiers, focus loss, open dialogs, terminals, and non-Code tools do not trigger it.

The native navigation-only snapshot is built off the UI thread when the popup opens: up to 5,000 files, 32 MB of source text, 25,000 entries, 50,000 directory entries, and three seconds, with a 1 MB source-file limit. It skips symlinks and generated/dependency folders. Results filter locally while typing and are capped at 100; reopening refreshes the snapshot while showing cached results. Declaration extraction is lexical, not semantic; dynamic/generated declarations and some language syntax are not indexed. This adds no autocomplete service.

API request rows now expose Duplicate and Delete beside the request name. Duplication selects a deep copy in the same folder, gives it a unique copy name, preserves settings/auth, and changes neither the original nor saved metadata. Existing saved secret references are retained because vault values are immutable: edited secret values receive new IDs on Save. Delete confirms, clears that request's retained response/history, and is disabled during an active request. Both actions change the draft only and require Save.

Verification: **66 frontend tests in 13 files**, **57 Rust tests**, production TypeScript/Vite build, Rust formatting, and all-target Clippy with warnings denied. The regular unsigned debug macOS app was rebuilt, approximately **84.93 MiB**.

Native checks used a new `dev.octode.searchcheck` profile with disposable `.tools/search-check` fixtures; the user's currently open profile was left running. Verified combined filename/class/function results, native arrow-key/Enter opening of the function's source file, and result layout. The Computer Use driver rejects modifier-only key presses, so the actual double-Shift gesture was covered by synthetic keyboard-event unit/workflow tests rather than native key automation. Native API checks verified that Duplicate retained the URL, that Cancel preserved a copy, that confirming Delete removed only the copy, and that duplication/deletion reached SQLite only after explicit Save. No HTTP request was sent. The existing `Octode Check.app` bundle was also rebuilt so the currently used profile can load these changes after restart; its metadata was not edited.


## API sidebar folder moves — 2026-10-27

Removed the request form's Folder select. Request names now occupy the available form width. Sidebar request rows can be dragged into any folder or back into Unfiled; folders highlight as drop targets and retain enough height when empty. A move preserves the selected request, URL, headers, body, auth, and response state. It changes only the API draft until Save.

The drag source uses a local request reference, accepts only this sidebar's active request drag, validates the destination against current folders, and clears its state on drop/cancel. Native HTML dragging uses a draggable row with WebKit drag styling and text selection disabled.

All **67 frontend tests** pass, including moving into an empty folder, returning to Unfiled, ignoring unrelated drops, preserving the active request, checking target feedback, and inspecting the folder ID passed only on explicit Save. Production TypeScript/Vite compilation passed and both normal Octode and the currently used Octode Check development bundles were rebuilt. No Rust behavior changed.

Native QA in the disposable `dev.octode.searchcheck` profile confirmed the form layout and sidebar folder controls. The desktop automation driver did not reliably complete the coordinate-based drag gesture; the full move workflow was verified through browser drag events rather than claimed as a successful native gesture. The user's active project metadata was not edited.


## Autosave, service fixes, and Deep Ocean — 2026-10-27

This update supersedes the manual-Save policy in earlier entries. API request/folder/environment settings, SSH profiles, database connections and SQL drafts now autosave after a 400 ms pause. Writers serialize edits that arrive during a save, flush before project/window close and Quit, verify the saved native document by reading it back, and use SQLite FULL synchronous writes. Failed writes preserve the open settings, display Not saved with Retry save, and block normal closure. They do not execute requests, connect SSH/databases, run SQL, or Apply database edits. A force kill/power loss before a change reaches its save interval can still lose that latest interval; no absolute guarantee is claimed.

The last active project/tool, selected API request/environment, selected server/database connection and SQL query restore. Live connections and shells do not start automatically. Code retains its conflict-aware autosave and recovery. Settings now save automatically, while Save now remains as a retry/immediate-flush control.

The API URL input highlights `{{variables}}` red without changing its text value or normal editing/selection behavior. Horizontal scrolling is mirrored. Delete moved beside the request name and remains in the sidebar. Request moves use in-app pointer/mouse handling instead of depending on native HTML drag handling; folders and Unfiled are drop targets. Normal clicks remain supported: native QA caught and fixed pointer capture on mouse-down swallowing request selection; capture now starts only after drag movement. Automated coverage verifies threshold handling, destination feedback, preserving request data, and actual folder reassignment. Coordinate automation has not reliably completed the native drag gesture, so end-to-end native drag confirmation is not claimed.

Server sidebar items expose Duplicate/Delete (disconnect before deletion). Private-key selection resolves the current user home through Tauri and opens `.ssh` directly, falling back to home when it does not exist. Native QA verified the actual file dialog's Where value was `.ssh`; no private key was opened or transmitted.

MySQL schema/table identifiers are explicitly requested as UTF-8 text, and metadata-only binary UTF-8 fields are decoded as text. Binary user table data stays binary. A regression test covers Unicode names and invalid UTF-8 binary bytes. Selecting a table now fetches page one immediately, including its metadata and paging controls; filtering/sorting resets for the selected table. Native read-only SQLite QA verified automatic 200-row loading and page two starting at ID 201. The MySQL-specific fix still needs confirmation against the user's server.

Each folder in Code has its own branch badge and entry to that folder's Git panel. The global branch label was removed from the Files view, and switching repositories remounts Git panel state. A test verifies distinct API/frontend branches and that each control selects its own folder. A non-repository folder does not borrow its parent's branch.

The default code/app/terminal palette adapts Kostya Safonov's Deep Ocean theme. The original 3,520-line scheme was downloaded from the repository; extracted color/attribute rules are recorded in `src/editor/deepOceanSource.json`, with provenance and mapping limitations in `docs/THEME.md`. PHP class/function token categories were added without autocomplete. Native visual inspection confirmed the app palette and red variables; token tests verify PHP keywords, variables, class names and functions. JetBrains semantic-only categories have no exact counterpart in a syntax-only Monaco editor.

Checks: **74 frontend tests in 15 files**, **58 Rust tests**, production TypeScript/Vite build, Rust formatting, and all-target Clippy with warnings denied. Normal Octode and the existing Octode Check development bundles were rebuilt (about **85 MiB**). These remain unsigned debug Rust builds.

Persistence QA used only the isolated `dev.octode.searchcheck` app/profile and disposable files. Edited a request name/URL without pressing Save, quit and reopened the native app, and verified the project/tool/request selection and exact values restored. Independently read the profile's SQLite file to confirm durable metadata. Native QA also verified server sidebar actions, private-key chooser location, SQLite automatic browsing/pagination, and Code folder Git controls. The user's active profile was not edited for these tests.

## Octopus identity — 2026-10-27

Recreated the supplied octopus reference as shared SVG geometry in the Deep Ocean
palette. Visually inspected the generated app-icon PNG for the head, eyes, eight
arms, nodes, symmetry, and padding. Updated title-bar/welcome artwork, favicon,
touch icon, and Tauri icon configuration. Generated ICNS, ICO and PNG platform
assets with the installed Tauri CLI. Production frontend build and both unsigned
macOS debug bundles (`Octode.app`, `Octode Check.app`) completed successfully.
The bundle Info.plist selects `icon.icns`. Windows/Linux artifacts were generated,
but their native packaging was not run on this Mac. No app data was changed.

## Navigation, Git, services, and API response UI — 2026-10-27

- Monaco marks the hovered word or quoted path with an underline and pointer
  while Command/Control is held, including when the key is pressed after hover.
  Release, pointer leave, blur, and editor disposal clear the decoration. The
  underline and click use the same token/range; no autocomplete was added.
- Git has a directly actionable branch selector at the top of the selected
  folder's panel, rather than requiring a separate Switch action in a collapsed
  section. Progress, success and errors are visible beside the controls. Native
  switching now lets Git preserve compatible dirty/untracked files, while Git
  still refuses any overwrite. Tests cover both cases and folder-scoped UI calls.
- Opening Terminal or SFTP connects on demand, and SFTP immediately lists using
  the new session ID. Existing sessions are reused. Busy operations are guarded
  against duplicate connection attempts. Fingerprint verification remains enforced.
- Table selection sets the view immediately and fetches rows independently of
  schema/index metadata. Slow/failed metadata no longer hides rows; load errors
  are shown inline with retry. Empty results can use metadata for column headings.
  Connections, Tables and Saved queries collapse; their state is persisted.
- HTTP methods have individual colors in the sidebar and request method control.
  JSON bodies render colored keys/values and foldable objects/arrays, with bounded
  child rendering, more-items controls, inert string rendering, raw-text fallback,
  and exact numeric spelling (including large integer IDs). Export keeps the raw
  response. The Format JSON toggle switches between the tree and raw response.
- On macOS, an overlay title bar puts the native window controls and the compact
  48px logo/breadcrumb header in one row. Native controls remain native.
- Search combines folder/path, filename and class/function declarations, including
  other declarations in the same file. Exact and prefix matches rank ahead of
  loose matches, with additional evidence improving the rank. All query terms
  must match; `model room` finds the `Room` class in `app/Models/Room.php` first.

Validation: 84 frontend tests in 18 files, 59 Rust tests, all-target Clippy with
warnings denied, production TypeScript/Vite build, and unsigned macOS debug
bundles. Native UI QA in the isolated Search Check profile verified first-page
loading (200 rows), pagination (row 201 on page 2), collapsing Tables, method and
variable colors, compact title-bar layout, and combined folder/class search
opening the first-ranked Room declaration. The automation driver cannot send a
modifier-only Shift tap, so double-Shift detection remains covered by the existing
workflow test; native search was opened through its toolbar button. Server tab
connections and metadata-denial behavior were tested with mocked IPC. No real
SSH server or remote MySQL/PostgreSQL database was contacted in this pass.

## Sidebar layout, automatic refresh, and terminal sizing — 2026-10-27

Removed the redundant project-name/Refresh row from Code; Files/Search/Git now
start at the top. Expanded file-tree directories refresh every two seconds and
on window focus/visibility restore, preserving expansion and avoiding unchanged
child-list updates. Hidden tools and collapsed directories do not poll. Collapse
All is the first file-action icon and collapses every workspace root.

All four resource sidebars use a shared draggable divider with bounded width and
persisted sizes. The local-terminal panel uses a top-right grip that increases
height when dragged upward. Divider arrow keys resize by 10px (40px with Shift),
with focus and accessible size values. Xterm fitting continues to notify the PTY
when the terminal dimensions change. Terminal surfaces and xterm backgrounds now
use the editor's `#0E1D24`, including the SSH terminal.

Middle-click on file tabs and local-terminal tabs follows their existing close
flows: files flush autosave and preserve failed-save drafts; terminal tabs still
confirm before interrupting their shells. Fixed tool/section navigation buttons
are not removable document tabs.

Checks: 89 frontend tests in 20 files, including automatic directory refresh,
collapse state, sidebar/terminal drag direction and limits, keyboard sizing,
persistence, file middle-click autosave, and terminal-close cancellation. The
production TypeScript/Vite build succeeded. Native QA visually checked the compact
Code toolbar, first Collapse All icon, terminal grip placement, and matching
terminal background in the isolated Search Check app. The native automation
coordinate drag did not reliably target the grip; pointer behavior is verified
by the event/DOM regression tests rather than claimed as a native drag pass.
Both normal and Octode Check unsigned macOS debug bundles were rebuilt. No Rust
behavior changed in this pass.

Additional native checks confirmed sidebar width changed from 238px to 278px
through its focused divider, remained 278px after restarting, and the terminal
height changed from 260px to 300px through its top-right handle. The native
middle-button automation did not reliably produce a tab-close event, so that
specific gesture is not claimed as a native pass. Both mouse-release and auxclick
handlers are implemented for WebKit compatibility, with duplicate-event
suppression; regression workflows verify closing and autosave/cancellation.

## Restore manual saves outside Code — 2026-10-27

Per the latest request, only Code files autosave. API, Server and Database
settings now write only when their Save button is pressed. Editing, blur, tool
navigation, unmount, and leaving/closing do not start saves. Closing waits only
for a Save the user already started and warns before discarding unsaved settings.
A Save writes the clicked snapshot; edits made during that write remain dirty
until another explicit Save. Failed saves retain the draft for retry, and failed
loads cannot overwrite stored settings. Editor preference changes also require
Save settings. UI messages and current README/roadmap match this behavior.
Already saved connections/requests/settings remain in the metadata store.

Validation: all 89 frontend tests passed, including no writes after a typing
pause/blur/unmount/leave, explicit Save persistence, pending-save concurrency,
failed-save retry, and Code autosave regression coverage. Additional app workflow
checks verify editor preferences save only on submit. The production build and
both unsigned macOS debug bundles were rebuilt. No Rust behavior changed.

## Workflow/layout revision — 2026-10-27

Implemented the requested changes together:

- Strong red top banners, stored per tool so a Server/Database/API failure is
  visible only in that tool. Local terminal errors stay inside its shared dock.
- Explicit empty title-bar drag region calls the native window drag command;
  the corresponding window permission is included.
- One shared local-terminal DOM host moves between Code/Servers/Database/API
  docks after their sidebar, preserving sessions and output. Cmd/Ctrl+2 toggles
  it; shortcuts are now 1 Code, 3 Servers, 4 Database, 5 API, 0 Projects.
- Code has its own sidebar title, larger full-width Files/Search/Git tabs, and
  one editor column. Split-editor controls and rendering were removed.
- A per-file rollback control on tracked unstaged changes restores the worktree
  from the index after confirmation. Staged content is retained. HEAD, index
  revision, and reviewed diff are checked before rollback; unsupported worktree
  renames, untracked files and conflicts are refused.
- Monaco find controls load the Codicon font and keep native title tooltips from
  their accessible labels. Native rendering showed the expected find glyphs.
- JSON object/array properties start expanded; bounded sibling rendering and a
  nesting limit still protect responsiveness. Strings stay inert and numeric
  spelling is preserved.
- Project entry goes directly to Code; the four-square control and Cmd/Ctrl+0
  return to Projects. Removed the launchpad, promotional strip, and dashboard
  footer. Project create/edit has ten colors, stored in metadata schema v5 and
  applied to card accents, titles and the project breadcrumb. v1-v4 metadata is
  backed up before migration; old projects get the default turquoise.
- Server list actions moved beside the connection name and into settings; the
  redundant New server row is gone. Authentication/engine/TLS/SSH selects match
  input height, and small disclosure/action icons were enlarged.
- Database connection profiles/settings are separate from a connected workspace
  containing Tables and Query Console/Saved queries. Back to Connections retains
  the active session; Disconnect releases it. Returning to table data fetches its
  page again. Queries remain scoped to their connection. The generated-column
  metadata alias is now `octode_generated`, avoiding MySQL's reserved GENERATED
  syntax; MySQL engine-name metadata also uses the UTF-8 metadata decoder.
- API environments moved out of the sidebar into a labeled dropdown with
  create/edit/delete controls and a separate editing screen. Explicit Save
  remains required outside Code.

Checks: 96 frontend tests in 20 files, 61 Rust tests, production TypeScript/Vite
build, Rust formatting, and all-target Clippy with warnings denied. Regression
coverage includes shared terminal identity across all four sections, shortcut
mapping, scoped errors, direct Code entry/Projects navigation, environment
management, color selection/persistence/migration, expanded JSON, database screen
transitions, and rollback's staged-content/stale-review protections.

Native QA used the isolated Search Check profile, not the user's real project.
A local PTY command printed OCTODE_SHARED_SESSION_CHECK in Code; switching to API
retained that output in the same dock. The read-only SQLite fixture connected
into its own Tables workspace and loaded 200 rows. Native screenshots verified
find icons/labels, the red validation banner, absence of Server errors in Code,
matching Authentication/input heights, server actions in their new positions,
and a saved purple project color on both its card and breadcrumb. Native window
movement could not be conclusively observed through the coordinate automation;
the drag command/permission are wired but that gesture needs a manual check.
No real remote SSH/MySQL/PostgreSQL endpoint was contacted. The MySQL SQL change
therefore still needs confirmation against the user's server.

Normal Octode and Octode Check were rebuilt as unsigned macOS debug apps.

## Direct database tab lists — 2026-10-27

Removed the redundant Tables and Saved queries disclosure headings beneath their
matching tabs. Each tab now shows its entries directly; New query remains a
visible action. Old collapsed-list preferences no longer hide those entries.
The four service-navigation regression tests and production frontend build pass.
Both normal Octode and Octode Check unsigned debug apps were rebuilt.

## Database navigation labels — 2026-10-27

The sidebar is the only Tables / Query Console tab strip. Query Console displays
a plain Saved queries heading above its list and New query action. Removed the
redundant tab strip from the main content. The four service-navigation tests
verify switching back to table rows and the absence of main-panel tabs; the
production build passes. Both Octode and Octode Check debug apps were rebuilt.

Database connection navigation now uses one back-arrow button labeled with the
connection name, replacing the separate Connections button and name. Long names
truncate within the sidebar; the tooltip explains Back to connections. The four
service-navigation tests and production build pass; both debug apps rebuilt.

The Database Connections screen now uses a fixed heading and always-visible list,
without a disclosure or stored collapse preference. Navigation regression checks
and the production build pass; normal Octode and Octode Check were rebuilt.

The connected Database header now has a single connection / Tables / table-name
breadcrumb. Parent labels are light gray; only the active table name is accented.
Removed the repeated schema/table heading below it and the Create/alter action
and its modal entry point; that flow is deferred. Four service-navigation tests
and the production build pass, and both debug app bundles were rebuilt.

Table info is now a header action immediately left of Disconnect for the selected
table. It switches the main panel to directly visible Columns, Indexes and
Relationships sections, with empty-state text and no metadata disclosures. Table
data returns to the same result/page without querying again. Selecting another
table or tab resets the info view. Five service-navigation regression tests,
including button order, visible metadata and data-page preservation, and the
production build pass. Both Octode and Octode Check debug apps were rebuilt.

API folders now expand/collapse through an accessible chevron and remember their
layout state. Removed the visible Unfiled heading and tightened root requests
against Requests. The Requests heading accepts drops to move requests out of a
folder; collapsed folders remain valid drop targets. Database's sidebar tab and
breadcrumb use the shorter Console label, with nowrap on its tabs. All 98
frontend tests and the production build pass; folder collapse/expand, dragging
into a collapsed folder and back to root are covered. Both debug apps rebuilt.

## Temporary footer Restart — 2026-10-27

Added Restart at the bottom left throughout the app. It saves Code, waits for
any Save already in progress, asks before discarding unsaved tool settings/row
edits, and flushes the workspace layout. Failed Code/settings/layout saves block
restart. Other tool settings never autosave as a side effect. The native command
is restricted to the main window, closes local shells/remote connections and
owned operations, and uses Tauri's restart API for the same bundle/profile.
The quit guard allows the explicit restart exit code after those save checks.

A profile-scoped, synced one-shot restart-state record preserves the active
project through process relaunch without relying on WebKit localStorage flush
timing. It is consumed on startup, and preserves Projects if restart began there.
No secrets are stored in this handoff.

Checks: 101 frontend tests in 21 files, 62 Rust tests, production frontend build,
Rust formatting, and all-target Clippy with warnings denied. Tests cover pending
Code saves, explicit-save failure, discard cancellation, ordered layout flush,
and profile-scoped one-shot handoff. Native UI QA clicked Restart in the isolated
Search Check project: the app automatically relaunched with the same bundle ID,
returned directly to Search check / Code, and restored SearchFixture.php and
Room.php. Both normal Octode and Octode Check debug bundles were rebuilt.

## Global selected-text case cycle — 2026-10-27

Option/Alt+Shift+U cycles selected editable text through snake, camel, Pascal,
screaming snake, kebab, dot, lower-space, title-space, and upper-space styles.
Equivalent outputs are deduplicated (single words still cycle properly). Acronym
boundaries and Unicode letters are supported; line breaks, indentation and
non-style punctuation remain intact. Selection remains highlighted after each
change. Monaco edits use its multi-selection edit API and explicit undo stops;
native text fields use editing commands to retain undo history, with setRangeText
as a compatibility fallback. Contenteditable selections are supported while
protecting locked descendants. Read-only/disabled fields, password fields, and
terminal output are excluded. Shortcut matching uses KeyU so the Option-modified
macOS character does not break it. No OS-wide key capture is registered: the
shortcut applies throughout Octode. It is listed in Keyboard shortcuts.

All 108 frontend tests in 22 files and the production build pass, covering full
style cycling, acronyms/Unicode, selection boundaries, inert/locked targets,
contenteditable, editor dispatch cleanup and React API-field synchronization.
Native QA in Search Check selected room_name in CaseCycleFixture.ts and pressed
the shortcut twice. Disk readback after Code autosave showed roomName, then
RoomName. Cmd+Z restored roomName as one undo step, then room_name. In an API
request-name field, the selected phrase changed to Title Case, updated the
sidebar and showed Unsaved changes; Cmd+Z restored its exact saved value and
Saved state. No request was sent or settings saved. Both debug apps rebuilt.

## Global double-Shift search (2026-10-27)

Moved the shortcut and modal to the app shell so they work in Code, Servers, Database, API, and the local terminal. The existing combined file/path/declaration ranking now also covers saved tool list names and mounted unsaved drafts. API request folder names provide matching context; saved query results include their connection name. Loaded database tables are indexed from the active session without creating connections for indexing. Credentials, request bodies/URLs, environment values, and SQL text are excluded from the tool index. Selecting a connection opens its settings; selecting a query opens its console without running SQL. An existing connection must be disconnected before selecting another database.

Automated validation: 111 frontend tests across 23 files pass and the production TypeScript/Vite build passes. Integration checks open search from different sections, navigate into previously unvisited tools, open saved queries/environments/requests, preserve live unsaved names, and verify that navigation does not save settings or initiate connections/requests. Existing file/class/function declaration navigation tests pass. Section-index tests cover partial load failures, project isolation, folder context, and exclusion of secrets and body text.

Native smoke check: rebuilt the normal app, Octode Check, and isolated Octode Search Check. In the isolated app, Search Everywhere found the saved API request by name and Enter opened that exact request in API with its folder expanded, saved state intact, and no response/request sent. The automation interface cannot send standalone modifier taps, so double-Shift timing and cross-section shortcut delivery are covered by the automated tests.

## Separate in-file Find and Search Everywhere (2026-10-27)

The editor magnifying glass now explicitly opens Monaco Find / Replace in the active file; Cmd/Ctrl+F opens the same control even when the toolbar has focus. The four-point sparkle and double Shift retain cross-section Search Everywhere, while Cmd/Ctrl+P retains the filename picker. Find requests are consumed once so switching files does not reopen the Find bar.

113 frontend tests pass, including independent Find button/Cmd+F routing, Monaco Find action dispatch, and filename quick-open via Cmd+P. Production build and normal/Check desktop bundles pass. Native isolated-app verification confirmed the magnifying glass opens Find / Replace, Escape followed by Cmd+F reopens Find, and the sparkle opens the separate global-search dialog. No fixture files were edited.

## Search Everywhere keyboard scrolling (2026-10-27)

Arrow-key selection now measures the selected result against the list viewport and adjusts that list's scroll position before paint. This avoids relying on WebKit's nested scrollIntoView behavior. Hover selection uses mouse movement instead of mouse entry, preventing rows revealed by keyboard scrolling from stealing selection beneath a stationary pointer. A regression test moves ten rows down and back to the top, verifies the selected row stays visible, confirms hover-entry events do not reset selection, and preserves input focus. All 114 frontend tests pass; production build and both normal/Check desktop bundles were rebuilt.

## Deep Ocean scrollbars (2026-10-27)

Native WebView scroll containers now use thin scrollbars, transparent tracks/corners, rounded muted blue-gray thumbs, and brighter hover/drag states. Monaco's custom vertical and horizontal scrollbars use 8px sizing and matching Deep Ocean thumb colors without scroll shadows. The production build and normal/Check bundles pass. Native isolated-app verification used a temporary long file to confirm scrolling and the slim, subdued editor thumb; the fixture tab was closed and temporary file removed afterward.

Follow-up: reduced both WebView and Monaco scrollbars to 4px at the user’s request. WebKit uses explicit scrollbar sizing rather than the platform-dependent `thin` value; other browsers retain the standard thin fallback. Production build and normal/Check bundles rebuilt.

## Keep database rows visible during sorting (2026-10-27)

Browsing the same table retains the current grid and metadata while new rows load, including sorting, paging, and refresh. Results, page, and sort direction update together only after a successful query. Failed refreshes keep the last successful rows and sort indicator with the inline error. Switching to another table still clears the previous table’s data. The existing browse-generation checks reject stale responses.

All 115 frontend tests pass. The new deferred-query regression checks that sorting preserves the same grid DOM and old rows until completion, commits the returned rows and direction together, preserves the last successful result after a sort failure, and clears rows when selecting a different table. Production build and normal/Check desktop bundles rebuilt.

## Cmd/Ctrl+W closes tabs (2026-10-27)

Replaced native Close Window menu accelerators with File → Close Tab and routed native menu events and keyboard events through a shared tab-closure handler. Code tabs use existing autosave/discard checks. Focused local terminal tabs use their existing shell-interruption confirmation. With no closable tab, or while a modal is open, the app stays open. Duplicate native/keyboard delivery is coalesced and pending closes cannot run concurrently. Fixed a pre-existing render crash when the final terminal tab closes by making its initial active-tab lookup lazy.

Native isolated-app verification closed three Code tabs successively with Cmd+W, including the final tab, then pressed Cmd+W again with no tabs; the same project window remained open. Frontend tests cover Code autosave on close, no-tab shortcut consumption, focused terminal confirmation/cancellation and final-tab closure, handler cleanup, priority, duplicate delivery, and modal blocking. All 62 Rust tests pass and Clippy passes with warnings denied.

## API Requests / History sidebar tabs (2026-10-27)

Separated request folders/list/actions and session history into two full-width sidebar tabs. The selected tab is remembered per project, hidden panels preserve state, keyboard arrows/Home/End switch tabs, and global API search navigation reveals Requests. History entries restore the matching request/response without resending it, and Clear only clears the session history. The empty History panel explains its session scope.

All 120 frontend tests pass, including a mocked request workflow that switches Requests/History, restores the response, clears history without clearing the response, and verifies there is exactly one send and no settings save. Production build and normal/Check desktop bundles rebuilt.

## API header collection and environment controls (2026-10-27)

Moved Import collection / Export collection and the environment selector/create/edit/delete controls into the API toolbar alongside Save. The create action now shows “New environment” next to the plus icon. Removed the request-variable/save helper sentence from the editor. Header actions wrap at smaller widths, the environment dropdown matches the 36px buttons, and controls are disabled until settings load. Other tools keep their existing toolbar layout.

All 120 frontend tests pass, including header placement, the visible New environment label, absent collection actions in the sidebar, removed helper text, and the existing create/edit/delete environment workflow. The production build and normal/Check desktop bundles pass. Native isolated-app inspection confirmed the relocated controls and freed sidebar/editor space without sending requests or changing saved settings.

## File context menu and reveal active file (2026-10-27)

Added file-tree/document-tab context menus for Copy, Paste, Cut, Copy Path, Rename, Duplicate, and Open in Finder (File Explorer/file manager on other platforms). The internal file clipboard is scoped to the project; Paste uses the clicked folder or clicked file’s parent. Copy/Cut/Duplicate operate on regular files. Copies use exclusive creation and unique names; moves refuse replacement. Code saves flush before mutation, stale open-file disk versions are checked, and open tabs/history follow moved or renamed paths. Copy Path writes the absolute path to the system clipboard. Root mutation and Git-internal/outside-project paths remain blocked. Menu placement is bounded by the viewport and supports keyboard navigation/dismissal.

Native isolated-app verification showed all seven menu actions, duplicated a temporary fixture with identical bytes, and revealed the copy selected in Finder. The Finder verification tool was slow and detected subsequent user interaction, so no further Finder actions were taken. The isolated Octode app was closed and unmodified test fixtures were removed.

Added Reveal active file immediately after Collapse All. It expands only the owning root and ancestor folders, scrolls the selected row within the file list, updates the active root selector, and consumes the reveal request after completion so manual collapse stays respected. Repeated reveals work without opening another tab.

All 123 frontend tests and 65 Rust tests pass; Clippy passes with warnings denied. Regression coverage includes saving/copying a draft, Cut/Paste tab remapping, duplication, Copy Path, Rename, keyboard context-menu navigation, binary copies, duplicate names, move conflicts, stale versions, project boundaries, symlinks, automatic ancestor expansion, row highlighting/scrolling, and repeated reveal after Collapse All. Production builds and normal/Check desktop bundles rebuilt.

API environment toolbar follow-up: removed the New environment button text at the user’s request. Create/Edit/Delete now share compact 30px square buttons with 16px icons, accessible names, and tooltips. All 34 App workflow tests pass; the production build and normal/Check bundles rebuilt.

API tab alignment follow-up: moved Params / Headers / Body / Auth to the top of the main pane, above the request fields. Their top inset, font size, and button height match the Requests / History sidebar tabs. Environment editing still hides the request tabs. All 34 App workflow tests and the production build pass; normal/Check desktop bundles rebuilt.

## Code folder-scoped explorer and boxed database heading (2026-10-27)

The Code root selector now controls which project folder appears in the file tree. Opening a file through quick-open, search, navigation, or an existing tab switches the selector to the owning root; longest-root matching handles nested roots and avoids sibling-prefix matches. Manually choosing a different root remains possible while a file from another root stays open, and clicking that file’s tab switches back. The changing selected-entry label beside the file-action icons was removed. The Database Connections heading and its existing plus action now share a bordered panel.

All 125 frontend tests pass. Added root-ownership tests for nested/sibling/Windows paths and an application workflow that selects folders, verifies a single visible root, clicks an already-active tab to restore its owning root, and opens a file in another root through quick-open. Production build and normal/Check desktop bundles rebuilt.

## Shared custom dropdown menus (2026-10-27)

Replaced all application-native select popups with a shared CustomSelect control. Menus use the file-context-menu palette, border, corners, hover treatment, and shadow, with selected checkmarks and the existing thin scrollbars. Migrated project-folder and terminal-folder selectors, Git branch/remote/merge selectors, server authentication, database engine/TLS/SSH choices, API environment/method/body/auth, settings, schema forms, and CSV mapping. Existing trigger dimensions and HTTP method colors are retained. A hidden native form control carries standard React change events/form state; it is not displayed or keyboard-accessible.

The custom combobox supports Arrow/Home/End navigation, typeahead, Enter/Space confirmation, Escape cancellation, Tab/outside dismissal, and list scrolling that keeps keyboard selection visible. Menus portal outside clipped panes, flip above near viewport edges, respect disabled fieldsets (including while open), and dismiss each other and file context menus. Hidden native options and parsed option data are retained between highlight changes to avoid repeated updates for long branch lists. Labels remain associated with the visible trigger, including StrictMode remount checks.

All 132 frontend tests across 26 files pass and the production build passes. Seven control-specific tests cover native-form event delivery, keyboard/disabled choices/cancellation, fieldset changes, StrictMode labeling, viewport placement, long-menu scrolling, and single-popup behavior; existing settings/API/database/Git-adjacent workflow tests pass. Native isolated-app inspection confirmed the custom project-folder combobox rendered. Further native popup inspection was interrupted by intervening user input, and the isolated test app was closed without editing connection/request settings. Normal and Check desktop bundles rebuilt.


## Selected folder contents and terminal command shortcut (2026-10-28)

The Files selector now scopes the explorer to the selected registered root and shows its children directly. It no longer repeats workspace root rows or per-row branch chips. Collapse All collapses descendants while keeping root contents visible; Reveal expands and highlights nested files. The selector includes folder / branch labels using a bounded native branch-only Git command, avoiding a full worktree status scan for each label. The Git branch selector keeps raw branch values for switching while displaying folder / branch labels.

Terminal tabs occupy the full toolbar height and share its available width, with adjacent borders and the existing Deep Ocean colors. Cmd/Ctrl+2 toggles immediately; a clean second press within 400 ms creates a dedicated terminal tab and sends the configured command only after its PTY is created. Settings defaults the command to `codex`, migrates old preferences, validates a single line, and requires Save. Restoring a project, changing sections, or saving settings does not launch commands. Existing running terminals are never used for command injection; unavailable roots and the six-tab limit produce terminal errors.

Frontend verification: all 140 tests across 29 files pass, including direct folder contents/switching, Collapse All and nested Reveal, branch values, command settings persistence/validation, shortcut timing/reset, dedicated tabs and capacity, and PTY readiness/failure/late unmount. PTY command execution was mocked; Codex was not launched during verification. Production build passes. All 66 Rust tests pass, including branch-only lookup for unborn and detached HEAD states; Rust formatting and all-target Clippy with warnings denied pass. Both normal Octode and Octode Check unsigned macOS development bundles were rebuilt successfully (85.36 MiB each). A browser visual preview could not start because the sandbox denied binding the local preview port; this change was verified through component/integration tests and production/native builds.


### Branch pill in folder selector

Moved branch presentation next to the folder name in the Files dropdown trigger and each menu option, retaining the small Deep Ocean pill styling. The file list continues to show only selected-root contents without repeated root/branch rows. CustomSelect keeps plain-text native option labels and values for form changes and keyboard search while optionally rendering styled labels. Existing folder-switching integration coverage now checks the branch pill in the selector and its absence in the tree. All 140 frontend tests and the production build pass; both normal and Check app bundles rebuilt successfully.


### Git changed-file labels

Changed-file rows in Conflicts, Unstaged, and Staged show the filename first and its parent folder afterward in muted text. The path yields space to the filename as the sidebar narrows; full paths and rename origins remain available in the row tooltip, and Git operations continue using the complete original relative path. Existing GitPanel tests (2) and the production build pass. Normal and Check desktop app bundles rebuilt successfully.


### Terminal label readability

Added an 8px gap between terminal tabs and the folder selector. Terminal labels use 12px medium text, muted light gray for inactive tabs and brighter foreground for the active tab. Full-height adjacent tabs and existing panel colors remain. Production build and both normal/Check desktop bundles pass.


### Connections sidebar headers

Servers and Database now share a 36px full-width Connections header flush with the sidebar edges, separated from the list by a bottom border. The database header no longer has an inset rounded surface or enclosing border. The plus remains a separate add action. Six service-navigation tests and the production build pass; normal and Check desktop bundles rebuilt.


### API tab layout

API sidebar Requests/History now extend to both sidebar edges with no top inset. Request Params/Headers/Body/Auth tabs fill the main view width without outer margins. Both rows share the Code tab height, padding, font sizing, equal-width buttons and thin active underline; response Body/Headers uses the same styling within the response panel. All 36 application workflow tests and the production build pass; normal and Check app bundles rebuilt.


### Active navigation labels and connection Save controls

Code, Servers, Database and API labels now appear beneath their active main-sidebar icons (Database uses DB); the shared terminal icon shows Terminal while open. Removed the Code sidebar title and the Servers/Database title toolbars. API retains its toolbar controls and Save without its title. Shared explicit Save/status controls now sit beside Server/Database Connect; Database workspace also retains Save beside its connection actions for saved queries. Dirty empty connection lists retain a Save action so deleting the last profile can be persisted. All 140 frontend tests pass, including explicit connection Save flows and updated active-label/header expectations. Production build and normal/Check app bundles pass.


### Code tab-row alignment

Files/Search/Git and the open-file tab strip share a 43px height variable. Sidebar tab buttons fill the row without extra vertical padding, aligning both bottom borders. Production build and normal/Check app bundles pass.


### Navigation labels outside icon boxes

Active tool and local-terminal labels now sit below the 40px highlighted icon box in white. The icon retains its accent color; the outer button has no background and the label remains part of its click target. All 36 application workflow tests and the production build pass; normal/Check bundles rebuilt.


### Section-wide connection toolbar

Servers and Database now have a full-width toolbar with New connection at the left and the section-wide Save/status controls at the far right. Removed sidebar Connections headers/plus buttons and per-connection Save controls. Save remains available when the list is empty or when browsing database tables and saved queries. The Database create action returns to the connection settings screen. All 42 application/service-navigation tests and the production build pass; normal/Check app bundles rebuilt.


### Resizable full-width API response

API responses are now a full-width pane separate from the scrolling request form. The top border supports pointer dragging and keyboard resizing; height is stored as a layout preference. The response body fills the pane without an inset rounded border or fixed 430px cap, retaining Deep Ocean JSON highlighting and collapsible properties. Request settings remain independently scrollable; response height is capped to preserve access to the request form. The generic divider accepts a response-specific tooltip. All 140 frontend tests pass, including pointer/keyboard resizing through the real API response panel and existing response/history flows. Production build and normal/Check app bundles pass.


### Explicit API folder rename

Folder names are now part of the expand/collapse button. A compact hover/focus edit icon beside trash enters rename mode; Enter or blur commits a trimmed name, Escape cancels, and blank input retains the prior name. Newly created folders enter rename mode immediately. Existing application coverage now verifies name-click toggling, edit-icon activation, cancellation, new-folder naming, and request drag/drop with the revised labels. All 36 application tests and the production build pass; normal/Check desktop bundles rebuilt.


### Unsaved changes in main navigation

Main-navigation icons show a small Deep Ocean orange dot for unsaved Code, Server, Database or API changes, including inactive sections. Existing immediate dirty refs remain responsible for close/restart guards; deduplicated React state drives the visual indication. Code clears its dot after successful autosave, manual sections after explicit Save, and Database includes pending row edits through its existing combined dirty callback. Project changes reset the indicators. All 140 frontend tests pass, with checks for Code autosave, API persistence across section switches, and independent Server/Database indicators and saves. Production build and normal/Check app bundles pass.


### Readable Git diff comparison

Working-tree and staged hunks now use aligned Before/After columns with source line numbers, red removal backgrounds, green addition backgrounds, and stronger changed-character highlights. Each side uses the editor's Monaco syntax grammars and Deep Ocean token rules, with cached token styles and asynchronous grammar loading rather than creating editor instances for every hunk. Source text is rendered as React text nodes. New and deleted file hunks receive the same display; untracked text files get a display-only added-file hunk. Raw/commit fallback views color addition and deletion lines, and patch metadata is collapsed into Patch details for hunk views.

Hunk selection and whole-file staging controls remain explicit. Only parsed display copies are used for presentation; staging sends the exact original reviewed patch with the existing head/index guards. All 145 frontend tests across 30 files pass. New coverage checks hunk alignment/counts, real line numbers, blank/new/deleted files, missing final newlines, malformed/truncated patch rejection, Unicode-safe character ranges, syntax styling integration, and the unchanged staging request. Production build and normal/Check app bundles pass (85.38 MiB). No native Git operations were performed on user repositories during verification.


### Commit and Commit and Push

Replaced the single commit button with Commit and Commit and Push… actions. Commit retains the local commit flow. Commit and Push opens a destination confirmation with branch, remote and commit message; only confirmation starts the operation. Commit uses the reviewed HEAD/index guards, then Push uses a fresh post-commit snapshot and rejects a changed active branch. If committing fails no push is attempted and the message stays; if pushing fails the local commit remains and the UI explains how to retry Push without duplicating the commit. Push is disabled without a configured remote or in detached HEAD. Buttons wrap only when the sidebar is too narrow.

All 149 frontend tests pass, including commit-only behavior, destination confirmation before actions, updated push guards, commit failure and push failure. Native Git actions were mocked; no real commits or pushes were made during verification. Production build and normal/Check app bundles pass.


### New terminal tab shortcut

Cmd/Ctrl+T creates and selects a plain terminal tab using the Folder for new terminal selection when focus is inside the visible shared terminal. It captures the key before xterm consumes it, dismisses open popovers, ignores auto-repeat and modified/composing input, respects modal dialogs, and retains the six-tab limit. Other sections keep their normal keyboard behavior. Added shortcut help and the New terminal tooltip. All 150 frontend tests pass, including focus/visibility, selected folder, repeat/modifier/modal handling, Ctrl alias, tab limit and plain-shell behavior. Production build and normal/Check app bundles pass.


### Folder scopes in Search Everywhere

Search Everywhere now opens on All with a tab per registered project root. All retains file/symbol and section results; a folder scope filters file/class/function entries to that exact root before ranking and the 100-result limit. Unmodified Left/Right cycles scopes while preserving the query, resetting result selection/scroll, and keeping the active tab visible. Mouse tabs restore input focus; Tab/Shift+Tab include the active scope tab, and modified arrows retain input editing behavior. The dialog is height-bounded so adding tabs does not push results/footer beyond the window.

All 151 frontend tests pass, including cross-folder filtering beyond the global result limit, API results in All, scope cycling/wrapping, query preservation, name-click scope changes, selection/scroll reset, opening a scoped result, and reopening on All. The scope component tests were repeated after a React event typing fix. Production build and normal/Check desktop bundles pass.


### Per-project live cache and follow-up shortcuts (2026-10-28)

Each opened project now owns a retained React portal host and its own workspace controller, terminal dock, file/editor state, tool drafts, responses, database/SSH state, errors and unsaved indicators. Switching to Projects detaches that host from the visible document without unmounting it or calling close_project_services. React and native PTY sessions stay alive; file/Git polling and terminal shortcuts respect the active project. Only the visible host participates in document-wide focus/modal queries. Code models and SQL/merge editor identities are namespaced by project so shared file paths do not share buffers. Cold workspace startup also restores the last selected section.

Quit and Restart flush Code/layout queues and inspect manual settings/row edits across every parked project. Ordinary switching does not autosave manual settings, discard drafts, reconnect services, resend HTTP, or rerun commands. Removing a project evicts its cache; explicit root changes reset its parked workspace, while name/color edits keep it. Live terminal processes persist through project switches, not app shutdown/restart.

Cmd/Ctrl+1 selects Code's Files tab even from Git/Search or another section. Local terminals accept native Finder drops and internal file-tree drags into the active output area. Native physical positions are converted to CSS coordinates; background, detached and inactive terminal panes ignore drops. Dropped absolute paths are safely quoted and pasted through xterm's normal input stream without Enter; multi-file drops and file URLs are handled, control characters are rejected, and listeners clean up with the PTY. No file content is uploaded or executed by dropping. The main Git actions are explicitly labeled Commit and Commit & Push….

All 161 frontend tests pass. Coverage includes two-project DOM/session identity retention, separate API drafts/results and terminal tab counts, no HTTP resend or implicit settings save on switching, project-scoped models, background quit/restart guards, Cmd+1 from Git/Search/API, native scaled drop coordinates, active/hidden/detached drop routing, quoted paths reaching the PTY without a newline, and both Git button labels. Production TypeScript/Vite build passes. Normal Octode, Octode Check and isolated Search Check app bundles rebuilt successfully (85.38 MiB). File-drop and PTY checks used mocked native events/writes; no user server, database, HTTP endpoint or shell command was exercised.


### Cmd+T in an empty terminal pane

The visible terminal pane now accepts Cmd/Ctrl+T when all its tabs are closed, even though there is no remaining session to hold focus. Closing the final tab focuses the pane. Focus gating still applies to nonempty terminals, and hidden/parked panes and modal dialogs do not receive new sessions. All five terminal-panel tests pass, including last-tab close, empty-pane focus, modal/hidden guards and creating the first replacement session. Production build and normal/Check bundles pass.


### Bulk Git staging controls

Unstaged now has a right-aligned Select all action; Staged has Deselect all. Each applies the existing stage/unstage operation sequentially to its displayed files in the selected root, avoiding concurrent index locks. Conflicted files remain separate. Code is flushed before changing Git; busy/empty groups disable their action, and the snapshot refreshes after success or failure.

All 164 frontend tests pass, including both bulk actions operating on multiple files, excluding conflicts and disabling once their group empties. Production TypeScript/Vite build and normal/Check macOS bundles pass. Git operations were mocked in these UI tests.


### Database password saved state and required database name

Saving a password seals its plaintext into the system credential store and returns an empty value plus a stored-secret reference. Secret fields now display masked dots and a Saved indicator for that reference, instead of appearing empty; typing replaces it and Clear removes the reference. The database UI disables Connect for blank/whitespace-only MySQL/PostgreSQL database names. Both the UI handler and native connection entry point reject those names before opening tunnels, reading credentials or connecting. SQLite continues to use its file field.

All 165 frontend tests and 68 Rust tests pass, as does Clippy with warnings denied. The database integration test covers entering/saving a password, the masked saved state, passing its reference to Connect, replacing it, and blank-name gating. The native memory-vault test verifies password resolution after serialization/reload and a later settings save; the native blank-name test covers both remote engines without accessing a real credential store or database. Production TypeScript/Vite build passes.
Normal Octode and Octode Check macOS app bundles rebuilt successfully.


### Octode-side server terminal highlighting

Remote terminals now use shared client-side xterm decorations for plain prompt identities, paths/URLs, common source filenames, error/warning/success words and dotted/colon-separated numeric values. Existing foreground/background colors and inverse cells are preserved. Output bytes, terminal input, buffers and copied text remain untouched; no shell commands, server configuration changes or package installs are involved. Highlighting pauses in alternate-buffer full-screen programs and inactive/detached panes.

A Highlighting on/off control in each server terminal changes a single remembered preference shared across mounted server terminals. Turning it off disposes decorations immediately on the next animation frame. Work is limited to visible rows and coalesced per animation frame; markers and listeners are cleaned up on session teardown, output changes, scroll and resize. UTF-16 offsets map to terminal cell widths so Unicode does not shift decorations. Pattern matching is heuristic and does not provide full shell or arbitrary program syntax parsing.

All 170 frontend tests pass. New tests cover prompt/severity/path matching, nonoverlapping ranges, existing ANSI styles, Unicode cell mapping, hidden panes, alternate screens, switching off, and disposal. A real xterm parser test verifies unchanged output, existing colored warning text, alternate-buffer suspension and marker cleanup. Production TypeScript/Vite build passes. No live SSH server or user command was used for verification; native UI appearance remains to be tried in the rebuilt app.
Normal Octode and Octode Check macOS app bundles rebuilt successfully with the shared server-terminal highlighting.


### Projects page cleanup

Removed the welcome eyebrow, headline, subtitle and decorative logo block from Projects, along with the duplicate Create a project card. The Projects toolbar retains search and its single New project action; the grid starts directly below it with reduced top spacing. Removed obsolete hero/card CSS. Browser preview entry now uses the remaining toolbar button. All 39 App integration tests pass after moving their preview entry to that button, including a Projects return check asserting the removed blocks stay absent and exactly one New project action remains.
Production TypeScript/Vite build and normal/Check macOS app bundles pass.


### Database connection action buttons

Database settings now reuse the existing connection-actions layout: a red outlined Delete connection button followed by Duplicate connection, with matching icons and spacing. Duplicate clones the selected connection's settings and stored password reference, assigns a fresh connection ID and a copy suffix, selects the copy and resets its query editor. Saved queries remain associated with the original connection. These controls are disabled while connected or busy; duplication stays unsaved until explicit Save.

All 40 App integration tests pass, including new checks for button style/order, a distinct connection identity, retained settings/credential reference, separate edits, unchanged original queries, no service connection and no implicit save.
Production TypeScript/Vite build and normal/Check macOS app bundles pass.


### Double-click database cell editing, JSON drawer and CSV Save dialog

Table results now support double-click (or Enter on an editable cell) to edit one value in place. Enter or leaving the field opens a before/after review with the column, table and original primary key; Shift+Enter preserves multiline text and Escape cancels. Apply update immediately uses database_row_plan/database_apply_rows with the exact original full row and reviewed plan, then refreshes the current table/page/filter/sort. Typing never writes. Failures retain the draft and require a fresh review. NULL remains distinct from an empty string. Existing insert/delete/batch row editing remains available. Table navigation is blocked during an open edit independently of query-loading state.

JSON/JSONB columns and valid object/array text open a right-side Monaco editor with the existing Deep Ocean syntax theme and formatted JSON. Formatting preserves numeric spelling (including large IDs, decimal zeros, exponents and negative zero), escaped strings, duplicate keys and order. Invalid JSON cannot be applied; formatting is bounded by size/depth. Each editor has its own disposable model identity. Read-only/unsupported tables can inspect JSON without enabling writes. Generated columns, binary/unsupported rows, tables without primary keys and read-only sessions retain the native editing restrictions.

The main-window capability now includes dialog:allow-save, which was missing even though CSV and other exports already called the native Save dialog. This resolves the dialog.save permission error without changing export contents or destination handling.

All 179 frontend tests pass, including seven grid/formatting tests and an App integration covering connection, table browse, double-click editing, parent navigation locking, exact large-ID row identity, review-only planning, single explicit Apply and refreshed rows. Coverage includes cancellation, unchanged edits, blur review, invalid JSON, precise formatting, multiline text, NULL, apply errors retaining drafts, and read-only/generated/binary restrictions. Database IPC calls are mocked in these new tests; no live user database was modified. The existing native transactional Apply and concurrent-row checks are reused unchanged.
Production TypeScript/Vite build and normal/Check macOS app bundles pass, including capability validation for the Save dialog permission. Native UI appearance and the actual Save dialog were not exercised in this check.


### Unblock individual cell edits when another displayed value is unavailable

The original grid predicate required every cell in a row to be text/NULL, which silently made both scalar and JSON cells non-editable if any unrelated column was binary, unsupported or over the 64 KB display limit. Cell editing now checks the selected value, non-generated column, writable metadata and the complete readable primary key. Unavailable sibling values are omitted from the original snapshot instead of sending their display placeholders.

A dedicated update-cell native plan accepts exactly one replacement, requires its original value and every non-null primary-key field, and compares all supplied original values transactionally. Existing batch updates/deletes still require the full original row. This permits independent cell updates while retaining same-cell/identity concurrency checks; unrelated unavailable columns are untouched. Blocked scalar edits now show a reason below the grid, and read-only JSON drawers explain the restriction.

All 180 frontend tests, 69 Rust tests, production TypeScript/Vite build and warning-denied Clippy pass. New UI coverage verifies an editable JSON cell alongside an unavailable large text field and excludes the placeholder from the update snapshot. Native checks cover missing keys, missing originals, multiple replacement columns and unchanged full-row batch validation across MySQL/PostgreSQL/SQLite plan generation. A disposable SQLite integration uses a 70,000-character sibling value, applies a JSON cell change, verifies exact large-ID JSON text and unchanged sibling size, then rejects the stale repeated update. No live user database was accessed; this reproduces a blocking condition found in code rather than inspecting the user's row.
Normal Octode and Octode Check macOS app bundles rebuilt successfully.


### MySQL TIMESTAMP display

MySQL TIMESTAMP values were routed through SQLx's checked NaiveDateTime decoder, whose Type implementation accepts DATETIME only. The mismatch returned the generic unsupported display cell for ordinary created_at/updated_at values. TIMESTAMP now uses SQLx's compatible DateTime<Utc> decoder and formats its naive_utc fields, retaining the server-returned date/time and fractional seconds without a display-time timezone conversion. DATETIME, DATE and NULL handling are unchanged. Timestamp cells now reach the grid and CSV export as text and can participate in existing guarded cell editing.

All 70 Rust tests pass. The regression test reproduces the exact Type compatibility mismatch from the installed SQLx version and checks compatible decoding type plus display formatting for ordinary, microsecond and early timestamp values. No live user database was accessed; raw timestamp decoding uses the driver's existing implementation.
Warning-denied Clippy and normal/Check macOS app bundles pass (85.40 MiB). Frontend source and its existing production assets are unchanged.


### Hide the connection toolbar inside database workspaces

ToolLayout now accepts an optional showToolbar flag (default true). Database shows the New connection / Saved / Save header only on its Connections screen; entering Tables or Console removes the whole header and its occupied height. Returning to Connections restores it. The Console retains a Save query action alongside Run SQL so query drafts can still be saved without restoring the connection toolbar. Other tools keep their current headers.

All 41 App integration tests pass, including header absence in connected Tables and Console, a query Save action in Console, restored connection header/Save when going back, and hiding again when reopening the connection.
Production TypeScript/Vite build and normal/Check macOS app bundles pass.


### Calendar picker alongside editable database date text

Date/timestamp cell edits now retain their text field and add a calendar icon. The dropdown shows a month calendar with navigation and a time field for datetime/timestamp columns. Use date fills the same text draft; it does not review or apply the database update. Cancel/Escape preserves the prior text, and picking a value for NULL clears the NULL flag. Explicit DATE, DATETIME, TIMESTAMP/TIMESTAMPTZ metadata and ISO date/date-time text are recognized; ordinary text and TIME-only cells keep their existing editor.

Calendar arithmetic uses UTC date components without converting stored date/time values. Picking a different date preserves the existing time, fractional-second spelling, separator and timezone suffix. Invalid calendar dates/times cannot be committed from the picker. The dropdown is anchored within the current tool's retained DOM host, so it stays isolated from other cached projects. Focus moving between the text field and dropdown does not trigger blur review prematurely; Use date returns focus to the field. Existing Review/Apply remains the only database write path.

All 185 frontend tests and the production TypeScript/Vite build pass. Tests cover leap years/month boundaries, temporal type recognition, precise fractions/offset preservation, invalid date/time rejection, combined text/calendar timestamp editing, cancel/reopen selection, NULL date picking, and absence of database IPC writes until explicit review. Native source and the 70-test native suite are unchanged by this UI feature.
Normal Octode and Octode Check macOS app bundles rebuilt successfully.


### Keep database date edits open during calendar mouse interactions

The date icon and non-input calendar controls now prevent the WebKit mouse default that can blur a text field to body instead of focusing the clicked button. The picker also reports its open state synchronously to the grid, suspending blur review throughout calendar interaction even when relatedTarget is null. Closing or unmounting clears the guard; outside pointer clicks close the picker, and genuine keyboard focus leaving it restores ordinary blur behavior. Use date fills the draft, clears NULL and returns to the text editor without applying.

All 187 frontend tests pass. Added two regressions for existing and NULL dates which simulate mouse down, the WebKit-style blur-to-body default, click, an additional focusout with null relatedTarget, choosing a different day and Use date. Both retain the cell editor and selected value, clear NULL, and make no database IPC calls. Production TypeScript/Vite build and normal/Check macOS app bundles pass. This is a simulated focus-sequence check; no live user database or native GUI was exercised.


### Optional WHERE keyword in database quick filters

The quick-filter input accepts either a condition (id = 417) or a leading WHERE keyword in any letter case, with whitespace or an opening parenthesis. The native browse path validates the original input and strips that optional keyword before adding its own WHERE wrapper. Identifier/literal text is preserved; an empty WHERE reports an actionable condition example. Existing length, balanced quote/parenthesis and single-expression restrictions remain in place. The input placeholder, tooltip and table hint now explain that WHERE is optional.

All 71 native tests pass. New normalization cases cover bare/prefixed/mixed-case/newline/parenthesized conditions, ordinary identifiers containing where, empty prefixes, comments/separators and unbalanced expressions. The disposable SQLite browse integration executes bare, uppercase and lowercase WHERE filters against the same large-ID row and verifies a nonmatching prefixed filter returns no rows. No live user database was queried.
Warning-denied Clippy, production TypeScript/Vite build and normal/Check macOS app bundles pass (85.41 MiB).


### Selected database rows copied as CSV

Database result grids now include a narrow sticky row-number column. Clicking a number selects one row, Shift-click selects an anchored range, and Cmd/Ctrl-click toggles individual rows; Cmd/Ctrl+Shift extends the selection. Selected rows use a subtle teal background. The selection toolbar shows the count, Copy CSV and Clear. Row numbers are UI headers only and never appear in exported CSV.

The native copy event (Cmd/Ctrl+C or browser Copy) copies selected rows with column headers in displayed order using the existing resultCsv escaping, NULL and binary display conventions. Native copying of selected text and all input/editor copying are preserved. The row button explicitly focuses after clicking for WebKit keyboard routing, and selection clicks clear unrelated text ranges. Copy CSV uses the Clipboard API with a selection/execCommand fallback; a temporary copy listener preserves the original CSV rather than normalizing CRLF through a textarea. Temporary fields/listeners are removed and focus restored. Errors are shown in the selection toolbar.

Selection resets on a new result object or table/page/sort/filter context. Background detached grid copy events are ignored. Selecting/copying never changes rows or marks settings dirty, and selection controls are disabled during cell editing/loading. Existing data-cell double-click editing and JSON/date pickers remain unchanged.

All 193 frontend tests and the production TypeScript/Vite build pass. Six new tests cover modifier/range selection and highlighting, clear, native copy-event data with exact IDs/quotes/commas/embedded newlines/NULL, displayed copy order, Copy CSV through the Clipboard API, selected text and inline-editor copy bypass, context/result resets, and a blocked-API fallback retaining exact CSV and restoring focus. All existing cell/date and App integration tests still pass. Clipboard operations are mocked in tests; no user clipboard or live database was accessed.
Normal Octode and Octode Check macOS app bundles rebuilt successfully (85.41 MiB).


### NULL checkbox mouse handling in database cell edits

The shared NULL control now prevents the WebKit mouse default and explicitly focuses its checkbox under a short synchronous focus guard. This avoids blur review/cancellation before a checkbox or its label can toggle. Inline NULL values show an empty, read-only text field with a NULL placeholder, rather than disabling a focused field and triggering another blur. The original text draft is retained and returns when NULL is unchecked; review/apply continues to send actual null, not the string NULL or an empty string.

All 195 frontend tests and the production TypeScript/Vite build pass. Two new regressions simulate mouse down/blur/click on both the checkbox and its label for a timestamp cell, verify the editor stays open with checked NULL and a blank read-only display, restore the original date on uncheck, then verify reviewed/applied replacement values are null. Existing calendar, JSON, row-copy and App integration tests remain green. These checks use simulated WebKit focus behavior and mocked database writes; no user database was modified.
Normal Octode and Octode Check macOS app bundles rebuilt successfully.


### Compact database browse controls

Removed the rows-per-page/WHERE/sorting hint beneath the table filter toolbar. The database browse controls now use 12px top and 4px bottom padding, and the toolbar has no trailing margin, bringing row counts and results closer to the controls. The WHERE input tooltip remains available. All 41 App integration tests and the production TypeScript/Vite build pass.
Normal Octode and Octode Check macOS app bundles rebuilt successfully.


### MySQL false conflicts in batch row Apply

MySQL row predicates now cast JSON parameters with CAST(? AS JSON) for both the preflight count and the final update/delete predicate, as well as JSON assignments. A plain text-bound parameter can otherwise be compared as a JSON string containing the serialized document rather than the original document value; see the primary MySQL JSON comparator specification: https://dev.mysql.com/worklog/task/?id=8249 . Integer columns use CAST(? AS DECIMAL(65,0)) so unsigned/large primary keys do not fall through floating-point string comparison.

MySQL BOOLEAN/TINYINT(1) cells now decode as their exact signed or unsigned integer, retaining 0/1 and other legal stored integer values rather than converting them into true/false strings (or normalizing all nonzero values to true). JSON/JSONB values use SQLx Json<Box<RawValue>> with serde_json's raw_value feature, preserving numeric tokens, escapes, duplicate keys and ordering from the server without reserializing through a floating-point/map representation. SQL NULL stays distinct from JSON null.

All 74 native tests and warning-denied Clippy pass. New regressions verify JSON casts in both guard and mutation SQL for batch updates/deletes, exact integer-key casts and original parameter strings, boolean signedness decoder compatibility, and lossless JSON snapshots. Existing disposable SQLite integration continues to verify transactional Apply and rejection/rollback of real stale edits. The conflict guard and reviewed-plan comparison remain enabled; no live user database was touched. Docker was unavailable in the sandbox (socket access denied), so actual MySQL execution was not exercised; MySQL predicate behavior was checked against its primary comparator specification and generated-plan tests. Frontend source/assets are unchanged.
Normal Octode and Octode Check macOS app bundles rebuilt successfully.


### Fill remaining database table height

The table-data screen now uses a bounded flex layout from service-main through database-results and the selectable-results wrapper into the grid. Its grid overrides the previous 500px maximum and fills the remaining vertical space after breadcrumbs, filter controls, notices, row actions and the optional selection toolbar. Those controls do not shrink; the result wrappers use min-height: 0 and keep scrolling inside the grid. Existing sticky headers, row numbers and horizontal scrolling remain in place. Console, connection settings and table-info layouts retain their current sizing.

All 41 App integration tests and the production TypeScript/Vite build pass. This is a CSS/layout change; no new implementation-mirroring test was added, and native UI geometry was not visually exercised in this check.
Normal Octode and Octode Check macOS app bundles rebuilt successfully.


### Persistent WHERE field label

Added a visible WHERE label to the left of the table filter input, using a native wrapping label so clicking the text focuses the field. It remains visible when the input contains a condition. All 41 App integration tests, production TypeScript/Vite build and normal/Check macOS app bundles pass.


### Flush database connection navigation and tabs

The connected database sidebar's back row is now a full-width, 36px navigation row with a bottom border, no rounded button box, and a hover/focus treatment. The entire connection-name row remains clickable. The surrounding navigation cancels the sidebar's top/side inset and removes its internal gap, placing equal-width Tables/Console tabs immediately beneath it. Tabs reuse the Code tab strip's 43px height, 13px font and 1px active underline.

All 41 App integration tests, production TypeScript/Vite build and normal/Check macOS app bundles pass. Existing checks exercise Back to connections and switching between Tables/Console. Native UI appearance was not visually exercised in this check.


### Taller database back row

Increased the database sidebar connection back row from 36px to 43px, matching the tab strip height while keeping its flush bottom-border design and full clickable area. Production build and macOS bundle results are recorded below.
Production TypeScript/Vite build and normal/Check macOS app bundles pass.


### Teal accent checkboxes throughout the app

Checkboxes now explicitly use the shared mint/teal accent variable (#80cbc4), including service-tool checkboxes which previously overrode the global accent with gray. Git hunk checkboxes use the same variable, and checkbox keyboard-focus outlines match it. Native checkbox semantics, dimensions, checked/indeterminate behavior and disabled styling remain unchanged. No tests added for this reversible CSS color change.
Production TypeScript/Vite build and normal/Check macOS app bundles pass.


### Review unsaved settings and locate modified API requests

The shared API/Servers/Database Save controls now make Unsaved changes (or Not saved after a failed save) a clickable review action. A dialog lists named additions/removals, changed fields and reordered lists relative to the last successful Save, with Close and explicit Save changes. It never saves merely by opening the review. Field summaries omit values, including passwords/tokens, request bodies and URLs; secret replacements are explicitly described as hidden. The document hook returns its saved baseline and memoized field summaries, retaining existing save-concurrency behavior.

API request rows have a small orange dot when added or changed relative to the saved baseline. Folder headings aggregate changed requests, including additions, moves and deletions, and folder edits themselves. Both old and new folders are marked when moving a request. Folder dots remain visible while collapsed and clear after Save or reverting to saved content. Request name truncation uses its own class so a trailing dot does not take over the flex/ellipsis rule. Deleted requests remain discoverable in the change review and surviving folder indicators.

All 197 frontend tests pass. New coverage verifies safe named summaries and secret/body redaction, the request dot, collapsed-folder dot, clicking the Unsaved changes summary, no implicit save, explicit review Save and cleared indicators. Existing tests now target Save by its accessible label rather than the first toolbar button, since the status is now interactive. Production build and bundle results recorded below.
Production TypeScript/Vite build and normal/Check macOS app bundles pass.


### Database sidebar table search and resizable result columns

The connected Tables sidebar now has a flush 36px search row immediately below its tabs, with a left search icon and bottom border. Search filters table names only, case-insensitively, without issuing database queries or changing the open table. Empty matches show a small No matching tables message. The search does not affect connections, saved queries or the SQL WHERE condition.

Result column headers now expose right-edge drag handles. The first drag measures all displayed data-column widths, then switches to explicit colgroup sizing and fixed table layout so the selected column resizes independently. Widths are bounded to 64–2000px; keyboard Left/Right adjusts by 10px (Shift: 40px). Pointer capture and cancellation isolate resizing from sort clicks. The row-number column stays narrow/sticky and the grid retains horizontal scrolling. Widths remain only in the mounted grid's memory, survive row refresh, reset when column identities change, and are never persisted.

All 198 frontend tests pass. The App integration checks no-match and case-insensitive table-name filtering before opening/editing the table. The new resize test covers drag, keyboard adjustment, no sort callback while dragging, row-copy compatibility, refresh retention and resetting on changed columns. Existing editing, date, JSON and selection workflows remain green. Native UI geometry was not visually exercised; no user database or clipboard was accessed by these checks.
Production TypeScript/Vite build and normal/Check macOS app bundles pass.


### Fit short table grids to their content

Changed the table-data grid from growing flex sizing to flex: 0 1 auto. Short results now end immediately after their last row, placing the horizontal scrollbar there instead of at the bottom of an empty stretched grid. Long results can still consume the entire remaining result area and shrink into an internally scrolling grid; the old fixed-height cap remains removed. This is a reversible CSS-only adjustment with no new implementation-mirroring test.
Production TypeScript/Vite build and normal/Check macOS app bundles pass. Native layout was not visually exercised in this check.


### Table search clear icon

Added a right-aligned SVG X button to the table search row, shown only when text is present. Clear resets the filter, restores the full table list and returns focus to the input. The row uses a div instead of a label to keep its button and input independent semantic controls. The existing App table-search integration now checks clear, empty-value behavior, hidden clear icon and restored input focus; selectors target actual table rows separately from the new search button.
All 42 App integration tests, production TypeScript/Vite build and normal/Check macOS app bundles pass.


### API sidebar request search

Added a flush search row below Requests/History tabs and above the folder/request action toolbar, with a left SVG search icon and a right clear X when text is present. Search matches request names, methods and URLs case-insensitively; matching folder names show that folder's requests. Folders without matches are hidden, matching requests are visible even if their folder was collapsed, and clearing restores the saved collapse layout and returns focus to search. Folder expansion icons and accessible expanded state reflect the temporary search expansion. History remains unchanged and a no-match message is shown when no requests match. Searching never changes the API document, saves, or sends requests.

All 199 frontend tests pass, including name/method/URL/folder searches, results in collapsed folders, no-match handling, clear/focus behavior, restoration of collapsed state and no implicit save. Production build and bundle results recorded below.
Production TypeScript/Vite build and normal/Check macOS app bundles pass.


### October 29 Deep Ocean redesign

204 frontend tests across 38 files pass, including safe resolved URL previews, project/cache/save workflows, row editing and selection, and editor-scoped Git diff regression coverage. TypeScript/Vite production build passes. Native visual checks used isolated fictional fixtures and a local SQLite database; the Run SQL prompt action was checked and cancelled. Normal and Check macOS bundles rebuilt. See [redesign notes](REDESIGN.md) for capture coverage and retained visual differences.


### Password saving and follow-up UI fixes

Save now adopts sealed credential references even when another field is edited during the request, while retaining later password replacements and unsaved settings edits. Credential sealing reads back newly written values before returning success, and verifies existing saved references before resaving. Keychain failures retain the draft and report actionable errors without secret contents. Regression tests cover failed/mismatched readback, missing references, concurrent edits, replacement/clear/reorder cases, and the hook integration.

Inline database edits expand narrow columns to 360px and remove the cell clipping constraint while editing. Composite API/table searches focus their outer controls; API folder actions use larger icons and occupy space only while hovered/focused. API URL input has square corners at the method junction. Database settings use equal columns. Cmd/Ctrl+2 is enabled with dialogs open, with the terminal dock above overlays across tools.

209 frontend tests and 78 native tests pass (one opt-in native Keychain test is ignored in the ordinary suite). Production build passes. The command-line Keychain probe cannot obtain macOS authorization in this environment; it is not evidence of missing user credentials. Earlier native QA could save/read a dummy reference in the desktop app, but a full final-build Keychain restart round trip has not been verified. No user credential values were logged or changed.
