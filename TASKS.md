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
- [x] Exercise a second state shape, such as a traversal cursor, without encoding it as a grid occupant. Decide whether seeking is persisted and undoable in the player; regardless, test the underlying state and history contract. Include inverse and snapshot fallback.
- [x] Refactor registry, history, and plan boundaries as evidence requires so state, validation context, and snapshots are not fixed to Grid occupants and dimensions. Preserve type safety, isolate registrations, and keep app vocabulary outside core mechanism.
- [x] Prove the revised contract with a non-Grid component and tests for independent vocabularies, registration, validation, replay, undo, redo, and serialization. Record what the tests establish and what remains unproven.

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
