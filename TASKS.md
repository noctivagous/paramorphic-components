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

## Evidence log

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

## Decisions to resolve with evidence

- [ ] Decide the public role of Graph, the runtime packaging model, and whether Ocelot XML is needed for interchange. Keep JSON as the stored format until a different decision is supported.
- [ ] Decide reversibility when morphs interact, including rules with irreversible effects; document when replay, inverse data, or snapshots are required.
- [ ] Resolve overlap, layer policies, and repeated expansion through composite-app tests. Decide whether Protocol needs streaming time and how it relates to traversal.
- [ ] Revisit additional domains, including ML, only after the core components and executable-plan contract have evidence from the validation ladder.
