# Deep Ocean redesign

The original October 29 design handoff is maintained separately. Copied reference HTML, images, and QA screenshot galleries are not included in the repository. Fictional Harbor/example.test content from the references is not application data.

`src/theme/tokens.css` contains the runtime CSS tokens. `src/theme/palette.ts` defines runtime color values for Monaco interface colors and xterm; editor syntax colors use the earlier Deep Ocean mapping in `src/editor/deepOcean.ts`. `src/theme/redesign.css` defines shared shell, controls, dialogs, density, and section layouts. Existing section CSS now uses semantic tokens, including flows listed as not designed. Matching icons use the supplied SVG paths through `DesignIcons.tsx`; specialist icons with no handoff equivalent retain their existing glyphs. Inter and JetBrains Mono are bundled locally with their licenses.

Implemented layouts include the project list and folder/branch chips, parked-workspace badge, compact rail with active edge, title search, shared save/change review, server header actions and fingerprint panel, API URL header/tabs/counts, public URL preview and inline request errors, database connection/table navigation and filtering, compact typed table cells and NULL tags, selection bar, JSON drawer and date editor styling, SQL reviews and inline errors, code tree/tabs, file-grouped search results with highlighted matches, Git collapsible groups and editor-scoped diff, settings rows, and two-column shortcuts.

The three behavior adjustments from the handoff are included:

- The resolved API URL includes enabled public query parameters. Secret/stored/unknown variables, secret parameters and embedded authority credentials suppress the preview. Native sending remains authoritative.
- Writable SQL execution keeps a native confirmation with **Run SQL** as its action label.
- Git diffs render over the editor area, retaining access to the staging panel. Existing busy guards still apply during Git operations.

Code autosave, explicit tool saves, project workspace retention, database Review + Apply, NULL semantics, row CSV copy with headers, draggable column widths without persistence, shortcuts, and disabled autocomplete remain in place. Existing terminal/SSH/SFTP/import/conflict flows retain their layouts and inherit the theme.

## Validation

204 frontend tests pass across 38 files, including the existing workflow suite, secret-safe URL previews, and a regression test for editor-scoped Git diffs. TypeScript/Vite production build passes. The existing Monaco chunk-size advisory remains; no new suggestion engines or network font dependencies were added.

Native visual checks used the isolated **Octode Search Check** profile, fictional projects, and the disposable local SQLite fixture. No live SSH/HTTP services were contacted, no remote Git actions were performed, and no database writes were applied.

Representative checks cover Projects/new-project dialog, API request/unsaved review, Servers settings, Database settings/table/JSON/console, PHP editor, Git diff, and settings. The native SQL prompt was checked and cancelled. These are representative checks, not an automated pixel comparison of all 57 states.

## Visual differences retained

Existing saved sidebar/window dimensions are respected; the new default sidebar is 268px. Native window controls, native SQL alerts, system pickers, and platform checkbox rendering follow macOS. The Code editor retains its existing per-file status details in addition to the application status bar. Forms/tables use real project data and engine metadata, so content, wrapping and column distributions differ from the fictional reference. Some early verification captures include extra white canvas from native display scaling. The JSON palette was tightened after its capture to explicitly override inherited Monaco string/keyword colors, and the final dialog scrim omits the legacy blur.

## Follow-up refinements

Project hover/focus now fills the whole row, repeated root paths are removed, and rows are more compact. The octopus logo is restored, Mac traffic lights are centered in the 40px title bar, and the current project name uses a filled project-color pill. The Code folder selector now precedes Files/Search/Git and uses larger folder and branch typography. The title bar was visually checked in the QA app; all 50 App/CustomSelect integration tests pass.

The Code terminal dock now has its own positioned layer above editor-scoped Git diffs, so terminal tabs and the resize/input area remain visible with a diff open. Native QA confirmed the terminal panel displays over the comparison. Production build passes.

### Dialog reference correction

Revisited source Projects (02/03) and Code settings/shortcuts (56/57). Project creation uses an explicit padded body with 32px input/action controls, compact header, swatches and folder rows. Settings uses a 52px header, aligned 44px rows and a 52px launch-command row with separate help text, plus plain explanatory text and a spaced footer. Shortcuts are grouped into Sections and Edit & search, with 34px rows and keycaps. Extra existing shortcuts remain listed in the second group. Native QA visually exercised all three; corrected the inherited shortcut-title bottom margin discovered during review. All 44 App integration tests and the production build pass.

Edit-project follow-up also matches the supplied comparison: folder count, boxed two-line folder rows with home-relative paths, caution icon and text, and a bordered removal row with title/help text and a separate Remove button. Existing removal confirmation and disk-preservation behavior stay intact.
