# Tasks

This roadmap turns the goals in [README.md](README.md) into deliverable work. Complete the validation ladder with real apps, not just demonstrations. Keep this file and the README's runtime status current as evidence changes.

## 1. Establish a reliable baseline

- [ ] Add an automated test command and run it alongside typechecking and builds. Cover plan loading, morph application and inversion, history, traversal, tilings, and representative game rules.
- [ ] Record the current capabilities and limitations of each demo, including which apps have their own directories, save/open, executable plans, and tests. Distinguish working behavior from mockups and intended behavior.
- [ ] Define the app-validation measurements from README §11.1: shared versus app-specific code, plan and custom-code size, time to first working draft, first-try validity of AI-written plans, and review effort. Record method and results for each app.

## 2. Make morph plans executable and trustworthy

- [x] Define a versioned stored-plan contract: base state, ordered morphs, application context, and the relationship between a replayed result and any cached snapshot. Specify migration and snapshot-only compatibility.
- [x] Make load validate and replay a chain against its base before applying it. Check state-dependent constraints and the resulting state; report actionable errors with the failing step. Do not partially apply an invalid plan.
- [x] Make save produce a complete, replayable plan. Account for history limits, snapshot-only edits, undo/redo, and branching; never silently publish a partial chain as a complete one.
- [x] Add round-trip tests: save, reload, replay from the stored base, and compare the resulting state. Include invalid morphs, invalid resulting states, snapshot-only plans, history truncation, and undo followed by a new edit.
- [x] Define inverse capture and failure semantics. Test replacement, removal, missing inverse data, non-invertible steps, and snapshot fallback; ensure fallback cannot silently claim a faulty inverse succeeded.
- [x] Support inspecting the actual applied chain and determining which morphs are applicable to the current state, with parameters and validation errors useful to a human or AI.
- [x] Define removal or replacement of an earlier morph: replay dependent steps, detect invalid dependencies, and report conflicts. Test this separately from undoing the most recent edit.

## 3. Test and generalize the mechanism

- [x] Build a player note vocabulary and wire it through recording, undo, redo, save, load, validation, and replay. First attempt it without editing the registry, history, or plan validation; document any changes that become necessary. Verify actual UI state and saved-plan reconstruction.
- [x] Exercise a carried state field, such as a traversal cursor, without encoding it as a grid occupant. Decide whether seeking is persisted and undoable in the player; regardless, test the underlying state and history contract. Include inverse and snapshot fallback. (Carried-field proof only: `PlanState.cursor` rides on Grid state in `src/framework/morphs/registry.ts`; a genuinely independent state shape remains unproven.)
- [x] Refactor registry, history, and plan boundaries as evidence requires so state, validation context, and snapshots are not fixed to Grid occupants and dimensions. Preserve type safety, isolate registrations, and keep app vocabulary outside core mechanism. (`src/framework/morphs/scoped.ts` factory gives each scope its own map; `TreeState` carries only `nodes`; `history.ts` adds the generic `createHistory<S>` factory with the `PlanState` functions as its instance; Grid and Tree save paths publish through the shared `publishesFullChain` predicate.)
- [x] Prove the revised contract with a disjoint-state component and tests for independent vocabularies, registration, validation, replay, undo, redo, and serialization. Record what the tests establish and what remains unproven. (`src/framework/morphs/tree2.ts` + `loadTreePlan`/`chainForTreeSave` over `TreeState`; `verify:replay` §§25–26 cover vocabularies, isolation, validation, replay, undo, redo, serialization, file load, and save checkpoints. Grid-hosted `tree.*` kept for backwards compatibility.)

## 4. Deliver the validation ladder

Each app must run from its own validated plan, exercise real interactions, and have repeatable acceptance tests. Measure the results using the baseline above and feed missing reusable capabilities back into the framework.

- [ ] **Grid games:** build Tic-Tac-Toe, Checkers, and Chess on the same Grid, occupant, and turn kernel. Verify setup, legal moves, turns, outcomes, and termination; document rule coverage and any simplified chess behavior.
- [ ] **Tilings:** run the same painter on square and hex tilings by changing plan parameters. Verify coordinates, neighbors, directions, hit testing, and boundary behavior.
- [ ] **Store and browse:** build a notes app or photo album using working Logic, Tree, and Grid components, with persistent data, browsing, and tests.
- [ ] **Networked app:** build chat or sync using Protocol composed with other components and a network adapter. Verify framing, partial messages, delivery errors, and end-to-end interaction.
- [ ] **Composite app:** build a timeline editor or scene graph with state machine. Verify hosting, nesting, stacking, layout, input routing, and state transitions at app scale.

## 5. Complete shared components and platform boundaries

- [ ] Implement and test the common component contract: substrate, occupants, rules, interpretation, morph plan, and slots. Define each component's raw state before app-specific configuration.
- [ ] Turn Graph, Tree, Path, Protocol, and Logic mockups into working components with their own operations, validation, and plan vocabularies. Share the Graph kernel where appropriate; demonstrate each in the validation apps.
- [ ] Implement the composition conventions in README §8, including hosting without cycles, sizing, overlap, layers, events, and scope. Test nested components with distinct substrates.
- [ ] Separate rendering, input, storage, network, audio, and timing behind platform adapters. Demonstrate that a plan can run with another adapter or a test adapter without changing component logic.
- [ ] Expand the stock morph library based on repeated app needs. Document parameters, compatibility, reversibility, and examples; test each stock behavior independently and in composition.

## 6. Make AI-assisted assembly practical

- [ ] Document the plan schema, available components and morphs, validation messages, and a complete author-edit-replay workflow. Provide examples that can be copied and validated.
- [ ] Provide a machine-readable way to inspect current state, applied morphs, available next operations, and compatibility constraints.
- [ ] Evaluate AI-authored plans against the ladder apps: record prompts, first-try validity, corrections, resulting behavior, custom code, and review effort. Use failures to improve the schema, diagnostics, and stock library.
- [ ] Define how third-party morphs are registered, versioned, validated, and distributed once the core contract is demonstrated.
- [ ] Build an exporter that presents GUI documents and relation bindings as a standalone Vite, React and TypeScript project with no Paramorphic Components imports. Register emitters beside the control, definition and morph registries; publish a manifest that names emitted, vendored, template and unsupported pieces; and prove exported behaviour against the framework’s own checks. Export is a one-way fork, not a round-trip format.

## Evidence log

### Mechanical baseline

`npm test` uses Node's test runner for boundary regression tests, metrics checks, and the existing replay/browser verification scripts. `npm run lint:boundaries` checks core imports with TypeScript resolution; the framework entry point remains the assembly layer. CI runs these checks, typechecking, the metrics report, and all app builds. `npm run metrics -- --json` reports its counted files and nonblank lines; `measurements/README.md` defines how to record timing and review measures. §1 remains open: tiling, traversal, and game-rule coverage and measured app evaluations are still outstanding.

### Tiling and turn groundwork

`createTilingGeometry` exposes neighbors, normalized cell/point conversion, rotation, and distance for existing square and hex tilings. Exhaustive bounded checks cover symmetry, round trips, rotation order and inverse, and neighbor distance. Shared turn helpers enforce ownership and advance turns for placement and movement, including `samePlayerIfCapture`. `lint:rules` rejects direct `ruleSet.id` branches; it does not detect aliases or indirect checks. The requested morphable rules vocabulary, complete game plans, and full game acceptance tests remain open; current Chess and Checkers presets are simplified demos.

### 2026-11-03 — Spreadsheet on the app-kit shell

The spreadsheet boots through `AppShell` from the `spreadsheet` app-kit recipe (sidebar inspector + sheet, File/Edit/Help, toolbar, New-sheet field dialog, status). New kit pieces: `workspace` layout, `shell.status`, dialog fields/submit, menu shortcuts, document/history actions, and availability-aware chrome. Sheet data, undo, and save/open still use the Grid plan and `buildSheetSave`. `verify:browser` covers the recipe, morph chain, form dialog, shortcuts, and document actions.

### 2026-11-04 — Reusable plan inventory

Added a scoped recipe inventory and a spreadsheet recipe with dimensions, formula choice, and optional initial cells. Recipes generate ordinary validated, replayable plans; custom inventories can use another plan loader, and direct plan loading remains available. The spreadsheet shell can create a new sheet from the recipe. More recipes and app-kit composition remain future work.

### 2026-11-04 — Composable cell editing

Cell editing now combines parsing (`text` or `numberOrText`), expressions (`none` or `formula`), and clearing (`value` or `occupant`) independently. The spreadsheet plan selects the same behavior as before; legacy modes and plans without an explicit mode still load. Tests cover mixed policies, preservation of unrelated data, invalid configurations, and legacy compatibility. Date parsing remains future work.

### 2026-11-04 — Bind cell editing and derivation to plans

Grid interpretation now selects text or spreadsheet editing independently from presentation. Editable cells write the configured data fields, and spreadsheet formula evaluation reads and writes those same bindings. Text clearing preserves unrelated occupant data. Replay checks exercise custom fields through rendering, editing, undo/redo, saving, and loading; calendar event cards remain read-only.

### 2026-11-04 — Cell presentations: spreadsheet renders from its plan

New concept `interpretation.grid` (`src/framework/presentations.ts`): a cell presentation (`editableText`, `readOnly`, `eventCard`) plus `data.<field>` bindings, column/row header specs (`letters`/`numbers`/`none`), a pure binding resolver (missing fields render empty, never throw), the shared `commitCellText` helper (value/formula/clear/no-op), and header/error utilities. `loadPlan` validates the block with actionable errors; unknown kinds and non-`data.*` paths reject. `GridViewport` renders a presentation table (headers, bound cells, formula display with `#ERR`, blur/Enter commit) when the props are set; game rendering is untouched otherwise. The spreadsheet plan configures `editableText` bound to `data.value`/`data.formula`/`data.computed` with letter/number headers, and both the spreadsheet app and the demo shell render it through the viewport — `SpreadsheetView.tsx` is deleted. A calendar proof plan (7×5, 4 events, same letters/numbers headers via `eventCard`) boots in the demo shell through the identical code path. `verify:replay` §32 pins config validation, bindings, commits, and both plans (204 total) with `typecheck` and all four builds green. Shared-vs-custom for the sheet: 144 lines of presentation machinery reused by both grids; per-app code is plan JSON plus shell wiring.

### 2026-11-04 — Grid rendering and save regression fixes

Grid rows now stay aligned unless a stagger is supplied; keyboard offsets still come from its plan. Grid save validates the current board before publishing either a full chain or a checkpoint. Regression checks render the viewport with and without stagger and reject a matching invalid base and snapshot.

### 2026-11-04 — Keyboard geometry on the shared renderer

`GridViewport` now handles the irregular geometry itself: `mergeSpans` merges multi-cell occupants into one box (covered cells skip; box math in the pure `mergedBox` helper), `stagger` offsets rows from the plan (`staggerForRow`, fallback `DEFAULT_STAGGER`), `chrome={false}` hides the game toolbar/footer, and `onOccupantTap`/`onEmptyTap` bypass game logic for presses and layout edits. The keyboard shell renders through it with neutered rules; the custom `KeyboardView.tsx` is deleted. Shared-vs-custom for the keyboard is now the 78-line `key.*` vocabulary plus shell wiring over the untouched core, viewport, and placement checks; game shells are unaffected (all new props optional/defaulted). `verify:replay` §31 pins the wiring and the merged-box math (183 total) with `typecheck` and all four builds green.

### 2026-11-04 — Three reported bugs fixed (slots, tree-save throw, grid checkpoint)

Play mode dropped empty slots: it mapped anchors only, so Space (q=3) rendered against Alt (q=2). `KeyboardView` now renders `slotsForRow` (every column 0..width-1; empties hold position, covered span cells collapse into the anchor button) in both modes, and row offsets come from the plan (`interpretation.keyboard.stagger` via `staggerForRow`, `DEFAULT_STAGGER` fallback) instead of hardcoded constants. `chainForTreeSave` guarded its replay on a valid base: an invalid base with a valid chain threw in `cloneTreeState` instead of checkpointing a valid current state. `chainForSave`/`buildAppSave` are now fallible: a current board that fails `checkBoard` returns errors (surfaced in all three shells) instead of publishing a checkpoint its own loader rejects. `verify:replay` §30 pins all three (175 total, was 169) with `typecheck` and all four builds green. Open: the shared `GridViewport` still has no span/stagger geometry — the keyboard proves the state and morph machinery, not the shared renderer.

### 2026-11-04 — Unified morph machinery and keyboard proof

`src/framework/morphs/scoped.ts` is now the single implementation: per-scope registries with validate/check/replay/invert/chain-surgery (`removeAt`/`replaceAt`) and the shared save-publication predicate (`publishesFullChain`). The Grid registry (`src/framework/morphs/registry.ts`) is the `PlanState` instance of that factory; `src/framework/history.ts` adds the generic `createHistory<S>` factory with the `PlanState` undo/redo as its instance; `src/framework/save.ts` (`buildAppSave`) is the one save path all three Grid shells use; `plan.ts chainForSave` and `tree2.ts chainForTreeSave` publish through the same predicate, and disjoint Tree chains run surgery through the same core (`removeTreeMorphAt`/`replaceTreeMorphAt`). Spreadsheet and player shells are behavior-identical on the shared path (same plan files, same checkpoint semantics).

Keyboard proof (`apps/keyboard/`, `src/views/KeyboardView.tsx`, `src/framework/morphs/keys.ts`): 15×5 grid, 47 keys from a 47-morph `key.define` chain over an empty base; wide keys (Space 9 cells, Enter 4, Shift 5/3, Tab/Caps/Backspace 2–3) via occupant `span`; QWERTY stagger as view-only row offset, never state. Presses flash + tone as session state (never recorded/saved/undone); layout edits in EDIT LAYOUT mode record `key.define`/`key.remove` with undo/redo/save/open. First-try validity: the generated plan loaded clean on the first attempt. Shared vs custom: 78 lines vocabulary + 176 lines view + 47-morph plan are the real custom code; ~311 lines of shell are a player-shell clone (dedup is the known follow-up); the ~1,200-line framework core, registry, history, save, and placement checks are reused untouched. `npm run verify:replay` §§28–29 add 17 checks (169 total, was 152) with `typecheck`, `build`, `build:spreadsheet`, `build:player`, `build:keyboard` green.

### 2026-11-03 — Reject invalid Tree save state

`chainForTreeSave` now returns validation errors for an invalid current tree instead of producing an unloadable checkpoint. A valid current tree still checkpoints when its chain cannot be replayed. Regression checks cover duplicate, orphaned and malformed state, plus checkpoint reload.

### 2026-11-03 — Tree loader trust hardening

Follow-up reproductions showed `loadTreePlan` accepting an invalid tree base and a non-array morph chain, and `chainForTreeSave` publishing a chain its own loader rejects (`src/framework/morphs/tree2.ts`). Fixed: new `checkTreeNodes` validates shape, unique ids, live folder parents, and cycles on base and cached snapshots; non-array `morphs` is an error; save publishes whole only when the loader's own checked replay accepts the chain, otherwise checkpoints. `verify:replay` §27 adds 18 checks (149 total) with `typecheck` and all builds green.

### 2026-11-03 — TASKS §3 disjoint-state and scoped-registry proof

Review found §3 overstated: `PlanState` stayed `{ occupants, width, height, cursor? }`, `tree.*` reused Grid occupants, all vocabularies shared one `REGISTRY`. Fixed honestly: TASKS §3 items 2–4 and README §11.2 were downgraded to name the exact coupling before any code landed. Then `src/framework/tree-state.ts` (`TreeState = { nodes }`, no Grid fields), `src/framework/morphs/scoped.ts` (`createMorphRegistry<S>()` with per-scope maps), and `src/framework/morphs/tree2.ts` (disjoint `tree.addNode`/`removeNode`/`reparent` plus `loadTreePlan`/`chainForTreeSave`) proved the revised contract: disjoint vocabularies, validation, checked replay, undo/redo with snapshot fallback, JSON serialization, file load with tamper rejection, and save checkpoints. `verify:replay` §§25–26 add 24 checks (131 total, was 107) with `typecheck`, `build`, `build:spreadsheet`, `build:player` green. Honest limits: `history.ts` stays `PlanState`-typed (disjoint history reuses the snapshot+morph pattern through the scoped registry); Grid-hosted `tree.*` kept for backwards compatibility.

### 2026-11-03 — TASKS §3 complete

All four §3 items are done. `player.placeNote`/`player.removeNote`
(`src/framework/morphs/player.ts`) validate note-shaped data and needed zero
core edits — registerMorph alone sufficed, as the item asked to attempt first;
the core edits this session (shared `checkPlacement`, state-carrying history
snapshots) were driven by the cursor item, not the player one. `apps/player/`
records toggles through the vocabulary with undo/redo/save/open, boots from a
replayed `player.*` chain, and builds clean (`build:player`); the verify script
drives its record/undo/redo/save/reload round trip including mapping survival.
Decision, recorded: seeks are neither persisted nor undoable in the player —
transport position is session state, reset on load like the turn and step
display — while `cursor.seekTo` (`src/framework/morphs/cursor.ts`) keeps the
full inverse/snapshot-fallback contract, tested through history. `tree.*`
(`src/framework/morphs/tree.ts`) proves the revised contract off-Grid: unique
ids, childless-only removal, cycle-rejecting reparent, with tests for isolated
registration, validation, replay, undo, redo, serialization and plan-file load.
`npm run verify:replay` stands at 107 checks with `typecheck`, `build`,
`build:spreadsheet` and `build:player` green. A follow-up review caught three
further gaps, all fixed: `tree.addNode` now rejects children beneath files like
`reparent` does; every replay entry point spreads the base instead of
rebuilding it, so checked and plain replay carry the cursor and a valid seek
replays; and the independence claim is reframed honestly — the cursor is the
state-independence proof (non-occupant state through the same contract), the
tree is the vocabulary-independence proof (own invariants, isolated
registration), and a fully disjoint Tree state stays unproven. Browser run (Chrome MCP against
`dev:player`): boot renders the 3 replayed notes; PLAY flips to STOP with the
step advancing; toggling a cell records a note and enables UNDO; UNDO removes
it and enables REDO; REDO restores it (screenshot on file); reload replays the
chain clean; console shows zero errors/warnings after an empty-favicon fix in
both app shells. Honest limits: audible tones were not asserted headlessly;
and discovering applicable morphs still requires callers to supply candidate
parameters.

### 2026-11-03 — Stored morph chains replay to construct apps on load (eaabd07)

The missing piece from the session goal is closed for occupants and dimensions:
`loadPlan` (`src/framework/plan.ts`) now replays each file's `base` + `morphs[]`
chain and rejects the file when the result differs from the cached snapshot, so
a plan is never partially applied. All three stored plans carry explicit ordered
chains over an empty base — spreadsheet 11 `sheet.setCell`, sequencer 3 and chat
5 `grid.upsertOccupant` — and the spreadsheet shell boots and saves through the
same replay path while the demo shell reports the replayed provenance.
`npm run verify:replay` (23 checks: replay, tampered-cache rejection, save
round-trip, `grid.resize` inversion) passes alongside `typecheck`, `build` and
`build:spreadsheet`.

Partially evidenced: §2 items 1–2 (contract + replay-before-apply) and §2 item 4
(round-trip; history truncation and undo-then-new-edit paths not yet covered).
Still open at that point: chains cover occupants/dimensions only — tiling, rules and
interpretation remain configured snapshot fields; §2 items 5–7 (removal or
replacement of an earlier morph, applied-chain inspection); §3 player-note
vocabulary and second state shape (sequencer/chat reuse the generic
`grid.*` morphs, which keeps app vocabulary outside core but is not yet a
player-owned vocabulary).

### 2026-11-03 — TASKS §2 complete

All seven §2 items are now done and checked off. Morphs carry an optional
state-dependent `check` (bounds, presence) alongside `validate`; `checkMorphState`
tests a candidate morph against the exact state and `describeChain` reads the
applied chain in human terms; `removeMorphAt`/`replaceMorphAt` replay dependents
with step-indexed conflict reports; absent inverse data throws so undo falls
back to the snapshot instead of guessing (replacement, removal, missing-frame
and non-invertible paths all tested); `chainForSave` publishes the full chain
only when it still replays, otherwise an honest snapshot checkpoint that the
spreadsheet shell adopts with its undo history restarted. `npm run
verify:replay` grew from 23 to 52 checks covering every §2 path, with
`typecheck`, `build` and `build:spreadsheet` green. §1 item 1 stays open: the
script covers plan loading, morph application/inversion and history, but not
traversal, tilings or game rules.

### 2026-11-03 — §2 gaps closed after review

A review reproduced five holes; all are fixed and tested. Load now uses checked
replay (`replayMorphsChecked`: bounds, presence, collisions per step), validates
the final board (`checkBoard`), verifies base/cache even for empty chains, pins
`$schema` to `paramorphic-plan/1`, and reports malformed bases as errors without
throwing. Undo treats a content-free `{}` frame as missing (snapshot fallback,
never a guessed delete). Chain surgery and plan load re-derive inverse frames
from the replay (`capture` + `recaptureFrames`), so undo after surgery restores
what actually occurred. Spreadsheet save carries the opened file's settings via
the pure `buildSheetSave` helper (`apps/spreadsheet/src/save.ts`), which the
verify script drives through complete save/reload round trips for the clean,
truncated and branched cases. `npm run verify:replay` stands at 72 checks with
`typecheck`, `build` and `build:spreadsheet` green; all seven §2 boxes are
checked again. Known limit, kept as-is: discovering applicable morphs still
requires callers to supply candidate parameters.

### 2026-11-05 — Full spreadsheet: formula breadth, sheet operations, style layer, app wiring

The approved web-artifact spreadsheet preview was adapted into the repo as framework capabilities, not app-only code, in four slices. **Slice C (formulas):** `src/framework/morphs/formulas.ts` is now an AST parser/evaluator — `$` absolute refs, right-associative `^`, postfix `%`, `&` concatenation, string literals, comparisons yielding 1/0, and IF (lazy: an erroring untaken branch never fires), COUNT, COUNTA, ROUND, ABS, SQRT, POWER alongside SUM/AVG/MIN/MAX; a source scanner (strings and function names like LOG10 are never mistaken for refs) backs `formulaDependencies`, `translateFormula`, and `rewriteFormulaRefs`. **Slice A (sheet operations):** `src/framework/morphs/sheet-ops.ts` holds pure insert/delete row/column (occupants shift/drop, formulas rewrite, refs into a deleted band become `#REF!`, ranges shrink/expand Excel-style), TSV/CSV serialization with quoting, origin-aware paste through `commitCellText`, fill with series extrapolation and relative formula translation, clear, sort, and range style/format application; `morphs/sheet.ts` registers `sheet.setCells` (one undo step for bulk edits) and the four axis morphs, all with snapshot-style inverse frames. **Slice B (presentation):** cell presentations gain `style`/`format` bindings (validated as distinct `data.*` paths), `formatCellValue` (currency/percent/date/int/fixed2), `resolveCellStyle`/`resolveCellFormat`, plus `freeze` and `columnWidths` config; `GridViewport`'s presentation branch applies styles, formats, sticky freeze panes, and an optional `styleForCell` override, with game rendering untouched when the new bindings are absent. **Slice D (app):** `apps/spreadsheet` wires a toolbar (axis ops, B/I/U, alignment, number format, fill down/right, sort, freeze toggle, copy/cut/paste/clear, CSV export/import), Ctrl/Cmd+C/X/V and multi-cell Delete, selection aggregates in the shell status (the app-kit spreadsheet recipe gained Sum/Avg/Count/Min/Max status items), multiple sheet tabs with rename/duplicate/delete, an inspector chart of the selection, and one conditional-format rule (numeric ≥ threshold). The recipe and the stored plan carry the new bindings and freeze config; the seed gained a currency-formatted bold cell, an IF+ROUND formula, and a concatenation formula (11 → 14 morphs/occupants; the five seed-count assertions in `verify-morph-replay.ts` were updated to match). New `npm run verify:sheet` (`scripts/verify-sheet-ops.ts`, 79 assertions) covers the formula extensions, translation/rewrite rules, fill, TSV round-trips, formatting, binding validation, and bulk/axis morph undo. All checks green: typecheck, `npm test`, verify:replay (241), verify:selection, verify:sheet, verify:rules (51), verify:games (59), verify:turns, verify:tilings, verify:browser, both lints, metrics, and all five builds. Honest limits: Save/Open still covers the active sheet only (tabs are a shell model, not yet plan data); sort moves occupants without rewriting their formulas; freeze changes are settings, not undoable edits; cross-sheet formulas are not supported; clipboard read/write depends on browser permission; the spreadsheet app's interactions were verified by build and the framework checks, not by a live browser session.

### 2026-11-05 — GUI builder app + app-kit control registry, GUI document, layout resolvers

Three user-supplied web-artifact sources (a builder chassis, a pro-audio control lab, a grid-systems lab) were combined directly in the repo, backwards-deriving the reusable pieces into the app-kit. **Control registry (Deliverable 2):** `src/framework/app-kit/controls/` holds one documented contract (values live in `props`; edits are `onChange(patch)`; `interactive:false` renders inert for the design canvas), split so validation stays React-free — `registry-data.ts` carries 44 merged/deduped controls (19 generic: button, icon-button, segmented control, slider, knob with variant prop standard/endless/detented/bipolar, toggle, progress, label, input, text area, checkbox, panel, stack, grid-container, tab bar, toolbar strip, list box, image well, separator; 25 from the audio lab: tall/dual-range/fader-bank/XY pad/scrub/jog/LED/drum pad/rocker/radio/matrix/step sequencer/piano roll/clip launcher/mini piano/ADSR/EQ/automation/LFO editors/meters/wave scrubber/mod matrix) with family, default size, default props and a prop schema (text, number, slider, boolean, select, color, stringList), and `registry.tsx` binds a component to every type (`missingComponents()` is empty). `controls.css` maps the sources' pro dark theme onto `--gui-*` custom properties with repo-token fallbacks. **GUI document + resolvers (Deliverable 3):** `app-kit/gui-document.ts` defines `paramorphic-gui/1` documents (per-device rects, container `layoutMode` absolute/stack/grid, `StackCfg`/`GridCfg`, springs-&-struts flags), validates them in the `loadShellPlan` style (duplicate ids, orphan parents, cycles, unknown types, schema-kind violations, non-container parents all rejected, never partially applied), registers `gui.*` morphs (addNode, removeNodes, setProps, setLayout, reparent, setNode, setDocument) on a scoped registry with capture-frame inverses, and wires undo/redo through the generic `createHistory` factory. Save follows the spreadsheet pattern honestly: `chainForGuiSave` publishes the full replayable chain only when a checked replay lands exactly on the current document, otherwise a snapshot checkpoint flagged `checkpointed` — `loadGuiPlan` replays or restores accordingly. `app-kit/gui-layout.ts` is pure: `absoluteRects` parent chains, `stackLayout` (leading/center/trailing/spaceBetween/fill, spacing optionally in baseline units), `gridLayout` (col/row start+span, gutters, row heights), `applySpringsStruts`, and `resolvedRects` driving both canvas and renderer from the same code path. **Renderer + Inspector (Deliverable 4):** `GuiRenderer` runs a document with live controls and per-node lifted values; `Inspector` renders any prop schema generically — the builder contains no per-control inspector code. Both are exported from `src/framework/index.ts`. **Builder app (Deliverable 1):** `apps/gui-builder/` follows the per-app file pattern and runs on AppShell via a new `gui-builder` recipe in `app-kit/plans.ts` (columns layout: palette/canvas/inspector slots, File/Edit/Help menus, status items). The palette is generated from the registry (click or drag to add); the canvas selects/moves/resizes nodes with snap toggle, grid guides and zoom; Delete removes a subtree, Cmd/Ctrl+D duplicates; dropping a node onto a container parents it; device switcher honours separate-vs-linked layouts; the inspector adds per-device rect fields, grid placement for grid children, stack/grid container config, and struts toggles (container resizes apply springs & struts through the resolver as one history step); preview mode renders the document full-canvas through `GuiRenderer` with chrome hidden. Persistence replaces the source's records HTTP API (no counterpart in this repo) with plan-file Save/Open plus localStorage autosave, and a source-shaped Export JSON as a secondary action. The seeded starter document (19 nodes) exercises a toolbar strip, a stack-laid-out panel (slider/knob/toggle), an absolute panel with struts-pinned buttons, a grid-laid-out section, and fader-bank/XY-pad/ADSR/EQ controls. New `npm run verify:gui` (`scripts/verify-gui.ts`, 291 checks) covers registry completeness, every validation rejection case, resolver math, morph inversion, history undo/redo, chain and checkpoint save round trips, and the starter document. All checks green: typecheck, `npm test` (10/10), verify:replay (241), verify:selection, verify:sheet (79), verify:gui (291), verify:rules (51), verify:games (59), verify:turns, verify:tilings, verify:browser, both lints, metrics (gui-builder: 7,858 shared / 453 custom lines), and all six builds including `build:gui-builder`. Honest limits: the audio lab's bespoke curve/sequencer editors ship as compact renderers over editable encoded props (pattern/notes/cells strings), not the lab's full gesture editors; canvas drag moves nodes from the body with controls inert (the source builder's approach) rather than modifier-key live editing; device switching and separate-layout toggles are document edits and therefore undo steps; multi-morph gestures (duplicate, struts resize) undo via the history snapshot, and a save whose chain cannot reconstruct the document checkpoints instead of claiming replayability; the app was verified by build, typecheck and the framework checks, not by a live browser session.

### 2026-11-05 — Relations (R0): concept opened, design fitted to the repo

A Relation — a named function from input ports to output ports, definitions in a registry, bindings in plans — is opened as the next mechanism on the Graph kernel, generalising `derivation.ts` rather than sitting beside it. README §8.4 states the concept: forward-only evaluation, dependents-only live recompute, formula-style quarantine for domain violations and cross-binding cycles, scrub-versus-commit for hosts, and the Path note (a bézier is a Path under one interpretation per §6.4; sampled points are the guest state; no rename or unification needed). Slices, each one commit on `feat/relations` with its own gate: **R1** engine (`relations.ts`: ports, def registry, dependency graph over bindings, evaluation, quarantine) + plan bindings validated by `loadPlan` + the `sheet.formula` bridge rerouting spreadsheet recalc through the engine with verify outputs unchanged; **R2** `bezier.cubic`/`bezier.pointAt` defs, the Path guest rendering its real points, and a demo plan with draggable handles; **R3** `supershape.polar` + an `apps/supershape` whose sliders are generated from the def's ports; **R4** `path.ride` + traversal-cursor riding with triggers. A new `npm run verify:relations` gate grows slice by slice.

### 2026-11-05 — Relations (R1): engine, plan bindings, formula conformance

`src/framework/relations.ts` (mechanism, framework root beside `derivation.ts`) holds port/definition types (number, boolean, string, point, points, range; UI fields aligned with the app-kit `PropSchemaField`), the def registry, `DomainError`, the EntityRef grammar (`<occId>.data.<field>`, `<occId>.guest.points`, `<occId>.guest.state.<field>`, read-only `<occId>.anchor`), an occupant store that never mutates its input, and `evaluateItems` — the shared Kahn ordering with the spreadsheet's exact quarantine semantics (cycle members and their dependents quarantined as a group with the concrete loop reported; a throwing compute quarantined with its message; dependents of a failure quarantined without computing). `evaluateRelations` builds the cross-binding dependency graph from producer entities, supports dependents-only recompute via `changedRefs`, and writes outputs to the derived layer; `evaluatePlanRelations` applies it to occupants and records Path-guest quarantine in guest state. `LoadedPlan` gains `relations?: RelationBinding[]`; `loadPlan` validates bindings (unknown def/port, unwired required input, const type mismatch, read-only or unknown-occupant targets, duplicate ids) and rejects the whole plan on any problem. **Formula bridge:** `morphs/relation-defs.ts` registers `sheet.formula` (dynamic ports generated from a formula's reference tokens — a range is one `range` port — evaluate is the existing formula evaluator), plus `sheetFormulaBindings`/`sheetCellStore` synthesizing one binding per formula cell; `applyFormulas` now runs on `evaluateItems` instead of its private Kahn pass, with the error surface (`[framework] derivation cycle detected: …`, `depends on failed cell`, evaluator messages) byte-identical. `npm run verify:relations` (55 checks) covers engine ordering/quarantine, dependents-only recompute, DomainError and cross-binding-cycle quarantine, every loadPlan rejection case, and bridge conformance (synthesized bindings through the binding layer reproduce `applyFormulas` exactly, including cycle and division-by-zero behavior). Gate green with unchanged outputs: typecheck, `npm test`, verify:replay (241), verify:sheet (79), verify:gui (291), verify:relations (55), lint:boundaries. Honest note: `applyFormulas` runs on the shared engine directly; the `sheet.formula` binding layer is proven equivalent by the conformance checks rather than being the sheet's runtime path.

### 2026-11-05 — Relations (R2): bézier Path defs, real guest rendering, demo plan

`morphs/relation-defs.ts` gains `bezier.cubic` (inputs p0–p3 points; binding sample count; outputs sampled `points`, arc `length`, `bbox` — a new `bbox` port type) and `bezier.pointAt` (points + t in [0,1] → point; out-of-range t is a DomainError), with `cubicPoint` (Bernstein form), `cubicPointDeCasteljau` and `sampleCubic` exported as pure helpers. `GridViewport`'s Path guest panel now draws the guest's real `state.points` scaled to their own bounds (endpoints emphasized), draws a host `data.marker` point on the curve, and renders a quarantined guest dimmed with its reason — replacing the hard-coded demo squiggle. **Demo hosting choice:** a stored plan, `morph-plans/bezier.json` (registered in the demo's plan list), rather than a new app — four handle occupants on a 10×8 board wired by the curve binding to a preview occupant's Path guest, plus the pointAt binding marking t=0.5; the root shell gained the lightest possible wiring (a `relations` state fed by `applyPlan`'s new optional `setRelations` target, and the default Grid viewport rendering `evaluatePlanRelations` output derived per render, never stored back). Handles move through the shell's existing place-anywhere interaction — one committed move per placement, relations re-derive live; there is no separate handle-drag gesture, and the shell's plan serializer does not yet write bindings back out (loading the file again restores them). verify:relations grows to 77 checks: endpoints exact, de Casteljau matching the polynomial form at five t values, sampled length exceeding the chord, the shipped demo plan loading + evaluating to a 33-point guest curve with a correct marker and bbox, and invalid-point quarantine emptying the guest with the reason recorded. Full gate green: typecheck, `npm test` (10/10), verify:replay (241), verify:sheet (79), verify:gui (291), verify:relations (77), lint:boundaries, root build.

### 2026-11-05 — Relations (R3): supershape def + port-generated app

`supershape.polar` joins the def registry (inputs m, n1, n2, n3, a, b with ranges and defaults; output sampled outline points; `n1 ≤ 0`, `a = 0` or `b = 0` raise DomainError), with `supershapeRadius`/`supershapePoints` exported pure. `apps/supershape/` follows the per-app file pattern (dev/build/preview:supershape scripts added): `plans.ts` holds the whole app as plan data — a `ctl` occupant carrying the port values, a `preview` occupant hosting a Path guest, and the single binding between them; `save.ts` round-trips that plan through `loadPlan`; `App.tsx` is state + derivation + SVG — its slider grid is generated from the def's ports by `portToSchemaField(s)` (in `relation-defs.ts`: ranged numbers become sliders, booleans toggles, strings text/selects) rendered through the app-kit `Inspector`, presets (Circle, Star, Flower, Square-ish, Cushion) commit a full value set in one step, and the outline re-derives through `evaluatePlanRelations` on every edit, quarantine included. Metrics make the design claim concrete: supershape is 8,687 shared / 251 custom lines. verify:relations grows to 101 checks: the circle identity (n2=n3=2, a=b=1 ⇒ every sampled point within 1e-6 of radius 1, for five (m, n1) pairs), all four domain-quarantine cases both at the def and through the app binding, schema generation covering every input port of `supershape.polar` and `bezier.cubic` in order, the app wiring sampling 180 points, and the save round trip. **R3b skipped, deliberately:** assembling the same document in the GUI builder needs GUI-document nodes as relation write targets (outputs landing in node props), which the plan flags as an open design question — it needs its own design pass, not a bolt-on here. Full gate green: typecheck, `npm test` (10/10), verify:replay (241), verify:sheet (79), verify:gui (291), verify:relations (101), lint:boundaries, metrics, root + supershape builds. The app's interactions are verified by build and the framework checks, not a live browser session.

### 2026-11-05 — Relations (R4): path.ride and traversal-cursor riding

`path.ride` joins the registry (sampled points + t in [0,1] → interpolated point; empty list or out-of-range t are DomainErrors; `pointAlongPoints` exported pure), and `traversal.ts` gains `cellsAlongPoints` — the §8.4 bridge that normalizes a continuous point list onto an ordered cell list (consecutive duplicates dropped) the existing cursor walks unchanged. **Hosting choice:** the supershape app, since it already produces a closed sampled outline every edit. Its `plans.ts` adds the `ride` binding (preview guest points + rider occupant's `data.t` → rider's `data.point`, dependent on the shape binding through the guest entity) and gate occupants standing on the outline at quarter/half/three-quarter cells; `App.tsx` walks a `TraversalCursor` with a 90 ms interval (time lives in the app, per §8.3), maps cursor progress to t, renders the rider dot and gate markers in the preview SVG, flashes a gate when `collectTriggers` fires it, and restarts the ride when the outline changes. verify:relations grows to 118 checks: ride endpoints/interpolation/domain errors, a full simulated pass (cursor finishes on the final cell, every cell entered once, gates on singly-visited cells fire exactly once), the app's gates standing on path cells, and the ride binding placing the rider exactly on the first (t=0) and last (t=1) sampled points. Full gate green at the slice: typecheck, verify:relations (118), root + supershape builds. Verified by build and framework checks, not a live browser session — the interval/cursor/render loop itself is exercised headlessly only in its framework parts (cursor, triggers, binding).

### 2026-11-05 — Exporter (E0): export contract opened

README §8.5 states the contract before code: export is a plan’s second presentation, targeting a standalone Vite, React and TypeScript project with no Paramorphic Components imports; emitted helpers are owned source; generated statements trace back to plan identifiers; unsupported pieces are named in a manifest rather than silently omitted; and export is a permanent one-way fork. The work that follows is E1’s emitter core and CLI, E2’s GUI-document emission, and E3’s relation emission with a behavioural `verify:export` gate.

- 2026-11-05 — Exporter (E1): export core opened. `src/framework/export/` holds the deterministic code project, emitter registries keyed by runtime control/def/morph ids, `SourceProvider`, and a manifest with emitted / vendored / template pieces plus named diagnostics; `scripts/export-app.ts` is the disk host for `npm run export -- <input.json> <outdir>`. On the GUI starter document it writes the standalone skeleton + a partial manifest honestly listing all 19 unemitted nodes. Gate: CLI run, `npm run typecheck`, and `npm run lint:boundaries` pass.

- 2026-11-05 — Exporter (E1–E3): the exporter is real. E1: core + CLI (above). E2: GUI documents export to standalone JSX — layout resolved at export time with the app-kit's resolvers, all 44 controls vendored by usage via source extraction from `controls/registry.tsx` (no hand-written substitutes; extraction failure is a diagnostic), GuiRenderer-mirrored `useState`/`onChange(patch)` wiring, other devices' layouts manifest-noted, shell recipes emitted as simplified chrome when an input carries one (the starter document carries none, so it exports full-canvas, noted). E3: relation defs vendored by extracting evaluate bodies + pure helpers from `morphs/relation-defs.ts` (`bezier.cubic`, `bezier.pointAt`, `supershape.polar`, `path.ride`; `sheet.formula` is diagnostic-only — evaluator vendoring is E5), bindings emitted as `useMemo` chains in the engine's own producer/`evaluateItems` order with try/catch quarantine and `// binding: <id> (<def>)` trace comments; relation plans export as state + port-generated sliders + SVG Path preview, with out-of-plan host plumbing (file open/save, presets, rider animation) manifest-noted, not carried. New gate `npm run verify:export` (62 checks): per fixture (GUI starter, supershape plan, bézier plan) — complete manifest, zero paramorphic references in emitted sources, standalone `tsc` + Vite build, exported GUI SSR-matches GuiRenderer node-for-node (19/19, ids + rect styles in order), exported supershape passes the circle identity at 1e-6 and agrees point-for-point with the framework def, exported bézier endpoints exact and samples agree with `sampleCubic`. Coverage: controls 44/44 emitters, morphs 0/18 (E5, no fixture uses one).

## Decisions to resolve with evidence

- [ ] Decide the public role of Graph, the runtime packaging model, and whether Ocelot XML is needed for interchange. Keep JSON as the stored format until a different decision is supported.
- [ ] Decide reversibility when morphs interact, including rules with irreversible effects; document when replay, inverse data, or snapshots are required.
- [ ] Resolve overlap, layer policies, and repeated expansion through composite-app tests. Decide whether Protocol needs streaming time and how it relates to traversal.
- [ ] Revisit additional domains, including ML, only after the core components and executable-plan contract have evidence from the validation ladder.
