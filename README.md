# Paramorphic Components

## Q and A


> Most of the GUI in apps is rectangular, makes use of grids.

Yes. A grid is a strong foundation for a large share of GUI work: forms, tables, calendars, dashboards, timelines, menus, and many layouts all arrange things in rows and columns.

The opportunity is bigger than drawing rectangles. If the same grid also provides sizing, nesting, interaction, navigation, and rules, apps can share substantial behavior as well as layout.

> Even just for GUI, when we made our first demo, from the same generic (what we call paramorphic) component we were able to make layouts and basic interactive setups for chess, checkers, a calendar,
a timeline editor.  We recognized first that grids are the host and they have occupants.  Each interactive setup one stemmed from the same root component. It was recognized that they carry similar features and facets.

Chess, checkers, and a calendar look like different GUI problems, yet each can use the same underlying grid with different occupants, layout, and behavior. Reusing that foundation 
can eliminate substantial repeated UI work even before the full [paramorphic component] morph runtime exists.

> Our grid component is flexible enough to make keyboards, meaning that we know that elements will be offset and some will be larger than others.

A keyboard is a stronger example than a uniform table: keys vary in size and rows are offset. If your Grid represents those, that shows it can handle irregular layouts, not just equal-sized cells.

That broadens the case for using it as a common GUI foundation. The useful next proof is to build and test the keyboard from a plan, including resizing and interaction, so that capability is established in the current runtime.

> So even now it is quite a valuable base for setting up a variety of GUI components, and if AI is doing it would construct an app's GUI foundation quickly.

Yes. A flexible Grid that already supports varied sizes, offsets, and occupants can be a valuable foundation for many GUIs. AI could use it to assemble a first layout quickly while reusing consistent behavior instead of generating each interface from scratch.

The practical question now is how reliably AI can do that from a concise plan, and how much custom code remains afterward. Building a few different interfaces and measuring those would demonstrate the value you’ve identified.

> We should know what we are talking about in this project as we build it.  List off what each mean: morph, registery, vocabulary, etc. for our project.

Here’s a working vocabulary for this project. Some terms describe capabilities we have today; others describe the intended system.

- Paramorphic — The approach: start with a general component and progressively shape it into an application-specific form.
- Component — A reusable structure with data and behavior. Grid is the most developed example; Graph, Tree, Path, Protocol, and Logic are also envisioned.
- Substrate — A component’s underlying structure. For Grid, it is the arrangement of cells.
- Occupant — Something placed on a substrate, such as a chess piece, spreadsheet cell, sequencer note, or key.
- Rule — A constraint or behavior governing a component or its occupants, such as a piece’s legal moves.
- Interpretation — How shared data is understood or presented: for example, reading grid occupants as notes rather than spreadsheet cells.
- Morph — A named, parameterized transformation of state or configuration. Today, examples include setting a sheet cell and resizing a grid.
- Morph vocabulary — A related set of morphs, such as the sheet vocabulary’s set-cell and clear-cell operations. A vocabulary supplies meanings and behaviors; the shared machinery executes them.
- Registry — The catalog of known morph definitions. It lets the runtime find a morph by name and ask it to validate or perform an operation.
- Morph chain — An ordered sequence of morphs. Order matters because a later step can depend on an earlier one.
- Plan — A stored description used to construct or configure an app. In the current implementation, plans include configuration, a base, and optionally a morph chain; not all app behavior is expressed as morphs yet.
- Base state — The starting state to which a chain is applied.
- Replay — Applying a chain in order to its base to reconstruct a result.
- Snapshot — A stored copy of state at a particular moment. It can serve as a starting point, a cached result, or an undo fallback.
- Inverse — An operation that attempts to reverse a morph, using captured prior state when necessary.
- History — The record used for undo and redo. It may contain morphs and snapshots; it is not necessarily the complete construction plan.
- Validation — Checking that a plan, morph, or resulting state meets the system’s requirements before use.
- Introspection — Asking the system what morphs exist, what has been applied, or what can be applied next.
- Runtime — The machinery that loads and validates plans and carries out their operations.
- Action — A plan-described operation that runs in response to an event, such as opening a dialog or selecting an item. Components can bind events to named actions; the host supplies the capabilities an operation needs.
- Adapter — Code connecting the framework to a platform capability, such as audio, storage, rendering, or networking.
- Composition — Combining components, such as a Grid hosting another component inside an occupant. This remains a larger project goal.

The key distinction is: a component provides the structure; a vocabulary describes ways to change it; the registry and runtime carry out those changes; a plan records the intended construction.

Grid plans configure cell presentations, `data.<field>` bindings, and editing policies separately in `interpretation.grid`. A plan can choose text or number-or-text parsing, enable formulas, and decide whether clearing removes the bound value or the whole occupant. The spreadsheet combines number-or-text parsing, formulas, and occupant clearing; its formulas use the configured value, formula, and computed fields. Existing `text` and `spreadsheet` editing modes and plans with formula bindings remain supported. Date parsing is not implemented. Calendar event cards remain read-only; calendar navigation and editing are not yet a complete app.

For example, this editing configuration enables numeric cells without formulas and preserves an occupant's other data when its value is cleared:

```json
"editing": { "parse": "numberOrText", "expressions": "none", "clear": "value" }
```

> And then if you set up an app with our system, what does the directory filetree look like?

Today, the spreadsheet app has its own directory and plan:

```text
apps/spreadsheet/
├── index.html
├── vite.config.ts
├── morph-plans/
│   └── spreadsheet.json     # Configuration, base, and morph chain
└── src/
    ├── main.tsx             # Starts the app
    ├── App.tsx              # App shell: menus, history, save/open
    ├── plans.ts             # Makes the app's plans available
    └── save.ts              # App settings for the shared save helper
```

It uses shared pieces from elsewhere in the project:

```text
src/
├── framework/
│   ├── components/
│   │   └── GridViewport.tsx # Shared Grid renderer (boards, keyboards, sheets)
│   ├── morphs/              # Registry, shared machinery, and vocabularies
│   ├── plan.ts              # Plan loading, validation, and replay
│   ├── history.ts           # Undo and redo machinery
│   ├── save.ts              # Shared Grid app save helper
│   ├── presentations.ts     # Plan-configured cell presentations and headers
│   └── ...                  # Grid and other shared mechanisms
└── views/
    ├── PlayerView.tsx       # Sequencer transport (timed, not plan-rendered)
    └── ChatView.tsx         # Thread/message rendering
```

The player and keyboard also have their own directories and plans. The keyboard and spreadsheet use the shared `GridViewport` (geometry plus plan-configured cell presentations); the player keeps its own transport view. Each app's shell still supplies application-specific behavior, so its plan does not yet describe the entire app. The intended direction is to move recurring capabilities into shared components and stock morphs, leaving each app with a plan and a thin shell.

### Reusable plan inventory

The plan inventory is a catalog of parameterized starting recipes, separate from the registry of individual morphs. For example, the spreadsheet recipe accepts dimensions, whether formulas are enabled, and optional initial cells:

```ts
import { planInventory } from "./src/framework";

const result = planInventory.instantiate("spreadsheet", {
  width: 8, height: 6, formulas: true,
  cells: [{ q: 0, r: 0, value: 12 }, { q: 1, r: 0, value: "=A1*2" }],
});
if (result.ok) {
  // result.data is the ordinary serializable base + morphs plan.
  // result.plan is its validated and replayed state.
}
```

`planInventory.list()` describes available recipes and their parameters. The spreadsheet app can create a new blank sheet from the recipe. Generated plans are independent files: they can be edited, saved, and loaded without the inventory, and applications can still author plans directly. `createPlanInventory()` creates a separate catalog for custom recipes; pass a loader to support a different plan type. The inventory currently ships one spreadsheet recipe, not a complete app kit.

The separate `appKit` inventory supplies sidebar, split, columns, and browser shell recipes. Each produces a versioned base and morph chain that configures the layout, title, menus, toolbar, dialogs, and actions; `loadShellPlan` validates and replays it. Snapshot-only shell descriptions remain loadable. `GridLayout` hosts named panel content. The file-browser example (`npm run dev:browser`) uses a Tree of folder and file entries with a three-column Grid layout. It starts with sample data and can browse a user-selected local folder in browsers that support directory access. It previews text and images and is read-only. The browser is an initial composition example; it does not yet implement the full hosting contract or arbitrary filesystem access.

Actions are framework functionality (`src/framework/actions.ts`), not specific to the app kit. A plan can name an operation and its target, and a component can bind an event to that action. The runtime looks up a registered operation and invokes capabilities supplied by the host; it does not execute code from the plan. The browser shell uses actions for its menus and toolbar. Other components can use `dispatchActionEvent` with their own event bindings. Apps can register custom operations in a scoped action registry; the same registry must be supplied when validating and executing their plans. Most existing Grid views still use their own event handlers and have not yet adopted these bindings.

For example, a shell's `shell.actions` morph can add `{ "id": "about", "do": "dialog.open", "target": "about" }`. A menu item refers to that action by its `action` field (or its own `id` when omitted). Shell loading checks action operations and dialog references; capability availability and non-dialog targets are checked by the host when the action runs.


> Where are we on this project?

We have a working prototype of the foundation, with standalone spreadsheet, sequencer, keyboard, and file-browser demos.

The first three share Grid state, morph registration, replay, and undo machinery. The keyboard uses the shared Grid renderer for wide keys and staggered rows. The file browser combines a Grid layout with a separate Tree state and a read-only storage adapter; its shell configuration is replayed from morphs.

The larger vision is still ahead: plans configure parts of these apps, but custom code still supplies much of their behavior. Tree and the other component families aren’t yet demonstrated in complete apps, and we haven’t measured whether AI can reliably assemble varied interfaces faster from plans.

Run `npm test`, `npm run lint:boundaries`, and `npm run typecheck` for the automated baseline. CI also builds each demo. Core is the framework source excluding its assembly entry point, presets, morph vocabularies, app kits, plan kits, and platform adapters; the boundary check prevents core from importing those layers or app code. The entry point is intentionally allowed to assemble vocabularies. `npm run metrics` reports per-app nonblank source and plan lines, and `npm run metrics -- --json` lists the files counted. Reachable framework lines include barrel re-exports, not necessarily executed or shipped code. See `measurements/README.md` for how to record draft time, AI validity, corrections, and review effort; these are not inferred from source.

> How do we make it so that apps like checkers, chess, calendars, timeine editors etc. have less custom code ?

We reduce custom code by moving recurring capabilities into configurable shared components, then describing each app’s choices in its plan.

For example, the shared Grid could provide layout, sizing, selection, keyboard navigation, dragging, resizing, and hosting. Plans would specify how to use those capabilities:

- Checkers and chess: piece arrangements, movement rules, turns, and outcomes.
- Calendar: date-to-cell mapping, event occupants, navigation, and views.
- Timeline: time and track axes, clip spans, dragging, resizing, and snapping.

The important step is to implement these as reusable capabilities—not add a separate calendar mode or timeline mode for every app. App-specific behavior can remain a small named extension when the shared library cannot express it.

I’d start with calendar and timeline together: build both on the shared Grid, extract the layout and interaction features they actually share, and measure the remaining custom code. Their differences will show us which abstractions are useful without guessing the entire system upfront.



## 1. Thesis

Programmers today start from finished, application-shaped components (a data table, a calendar, a tiling map) that have nothing in common with each other. Checkers and chess therefore end up with separate code bases, and AI-generated code arrives in pages that do not reflect the programmer’s own approach and must be reviewed line by line.

A paramorphic component starts from a generic structural foundation, generic in both appearance and behavior, and is progressively configured toward the desired application. It is paramorphic rather than metamorphic because it is never replaced, only shaped step by step. The foundation stays recognizable, and each step should stay reversible.

Two payoffs follow. The code is the programmer’s own, because the programmer states the morphs instead of accepting generated pages. And review shrinks, because a morph plan is short, declarative and inspectable, so AI can assemble from it and a human can verify it quickly.

**Terminology decision:** “paramorphic” names the approach. “Parametric” is reserved for the parameters that drive each morph. The older use-case table that says “Parametric Customizations” should be retitled accordingly.

### 1.1 Purpose: a runtime for rapid app construction

The goal is a runtime or framework in which complete, quality apps are assembled from configured components at every level, by a programmer or by AI, with little custom code. Effort goes into choosing and ordering morphs, not into rewriting a board, a browser or a transport for each app. Quality compounds, because a stock morph is built and tested once and every app assembled from it inherits that behavior. AI assembles by writing plans, which are short and checkable (section 9.1), so review shrinks and the result stays in the programmer’s own terms.

### 1.2 What apps have in common

Checkers and chess share various facets and base structures, and that what the framework provides. Each differs in the parts below.

| Part | Checkers | Chess | Generic form |
| --- | --- | --- | --- |
| Space | 8×8 square grid | 8×8 square grid | A structure: tiling, tree or graph |
| Setup | Pieces on dark squares, three rows each | Standard back-rank and pawn arrangement | An initial arrangement of occupants |
| Moves | Diagonal steps and jumps | A move set per piece type | Rules over neighbors, directions and regions |
| Turns | Alternating | Alternating | Turn order |
| Outcome | Capture or block all opposing pieces | Checkmate or a draw condition | Win, loss and draw conditions, written as predicates over regions |
| End | The game stops when an outcome holds | The same | A termination test |

The same parts describe Tetris (empty well; fall and rotate; the stack reaches the top), Sudoku (the givens; place digits; every region satisfied) and a form wizard (blank form; fill and advance; validation passes). One rule-set shape of setup, moves, turns, outcome and end, defined once, is the contract the framework evaluates.

Beyond rules, most apps store information, browse it and connect to a network. Those are covered by the other components.

| Verb | Meaning | Components that cover it |
| --- | --- | --- |
| Store | Hold and persist records and relations | Logic (triples, typing, constraints), with Tree or Graph for structure |
| Browse | Navigate, search, filter and view | Tree (outlines, explorers), Grid (tables, albums, calendars), Path (maps, routes), with zoom and paging |
| Connect | Exchange data with other systems | Protocol (framing, reliability, security) |
| Act | Change state under rules | Grid or Graph with a rule set, plus occupants |

Starting recipes, to be tested rather than assumed:

| App | Recipe |
| --- | --- |
| Chess or checkers | Grid, occupants, rule set |
| Calendar | Grid with 7 columns and zoom from month to day, hosting Logic records |
| Photo album | Grid of thumbnails with zoom, plus a Tree of albums |
| File explorer | Tree hosting Grid previews |
| Chat | Tree of threads plus Protocol |
| Map and route planner | Path over Grid tiles, plus Protocol |
| Music sequencer | Grid plus Protocol (MIDI) |
| Timeline editor | Grid plus Path (section 7) |

The cases not obviously covered (free-form text editing, media playback, 3D scenes) are where validation should probe first.

## 2. Principles

1. **Generic first.** Every component has a defined raw state, in both look and behavior, before any application exists.
2. **Substrate, occupants, rules.** The structure, the things in it, and the logic governing them are kept separate.
3. **Data apart from interpretation.** Promoted from Paramorphic Path to a universal rule: the same underlying data can be rendered or used differently by changing its interpretation (a path as a Bézier shape, a map route or an animation trajectory; a grid as a calendar or a chess board).
4. **Morphs are declarative, stackable and reversible.** Each is a small named transformation, and any can be removed to pivot mid-design.
5. **Introspectable.** At any point you can ask what has been morphed so far. This is what makes AI co-design and fast review possible.
6. **Composable.** A cell may hold a tree, a node may hold a path, and so on, under the shared nesting, overlap, stacking and hosting conventions in section 8.
7. **Stock functions serve the components.** Platform widgets and utilities exist to support the paramorphic foundation, not the reverse.

## 3. The common template

Grid, Tree and Path each already follow most of this shape, but none follows all of it. Every component in the family is specified with these sections.

| Section | Question it answers |
| --- | --- |
| Substrate | What is the raw, generic structure? |
| Occupants | What can live in or on the substrate? |
| Form parameters | How is it laid out and rendered? |
| Behavior parameters | How does it respond to interaction and time? |
| Rules | What constraints and semantics can be attached (snapping, gravity, adjacency, typing)? |
| Interpretation | How is the same data read in different applications? |
| Morph chain | What is the step-by-step path from generic to a specific application? |
| Applications | What does it become? |
| Siblings | How does it relate to the other components? |
| Slots and composition | What can it host, and how does it nest, overlap and stack (section 8)? |

## 4. Family structure: decisions

The source documents disagree about what belongs in the family. The first list names Graphs, Networks, Timelines and Spatial Structures. The later tables name Protocol and Logic. Both lists also include Grid, Tree and Path. The following decisions resolve this and are proposals the author can overturn.

| Question | Decision | Reasoning |
| --- | --- | --- |
| Is Tree a kind of Graph? | Tree and Path remain first-class components, but both are built on a shared Graph kernel. | The source insists neither Tree nor Path requires the other, which holds at the user level. Structurally, a tree is an acyclic hierarchical graph and a path is an ordered walk through points. Sharing a kernel avoids reimplementation. |
| Is Timeline a component? | No. Timeline is a Grid configuration. | The NLE section already shows time as columns, tracks as rows, clips as multi-cell occupants and snapping as a rule plugin, with no bespoke Timeline class. A one-dimensional axis is a Grid with a single row or a continuous column metric. |
| Is Network a component? | No. It folds into Graph (topology) and Protocol (transport semantics). | Network has no substrate that Graph plus Protocol lacks. |
| Are Spatial Structures a component? | Deferred. | Coordinate systems, projections and transforms are already covered by Path’s spatial interpretation and Grid’s metrics. Revisit only if a distinct substrate appears (for example meshes or volumes). |
| What is Logic’s substrate? | A triple store, which is a Graph’s labeled edge set. | The source describes Logic’s base as an untyped relation graph, so it layers inference and typing over the Graph kernel instead of being a separate substrate. |
| Is Protocol distinct? | Yes. Its substrate is framed message streams, not a spatial or relational structure. | Its state machines are graphs, so it composes with Graph without being one. |

**Resulting family**

| Component | Substrate | Primary purpose | Tier |
| --- | --- | --- | --- |
| Grid | Tiled cells (square, hex, other) | Spatial arrangement and occupancy | Structural |
| Graph (kernel) | Nodes and edges | Relationships | Structural |
| Tree | Graph constrained to hierarchy | Hierarchical organization | Structural |
| Path | Points and segments | Geometry, connection, traversal | Structural |
| Protocol | Length-framed message streams | Communication | Semantic |
| Logic | Triples over the Graph kernel | Logic construction and inference | Semantic |

## 5. The shared Occupant

Grid defines Occupants, Tree has a “Node Occupant”, and Path has none. One abstraction now serves all of them: an **Occupant** is an entity that holds a position or region in a substrate and carries its own data and behavior.

| Field | Meaning |
| --- | --- |
| anchor and span | Where it sits. A set of cells in the tiling, with a w×h rectangle as the square-grid shorthand (Grid), a node (Tree, Graph), a point or segment (Path), a frame (Protocol), a triple (Logic). |
| data | Free-form payload (clip source, piece type, message body). |
| tags | Grouping and rule targeting (selection groups, effect attachment). |
| draw | How it renders, if it renders. |
| hooks | Rule participation: moves, gravity, collision, validation, data edits, derivation. |
| guest | An optional hosted component, which makes the occupant a host as well (section 8.2). |

Examples from the source: a chess piece is a single-cell occupant, a Tetris block is a multi-cell occupant that rotates and responds to gravity, a Breakout brick is a static multi-cell occupant that disappears when hit, a sequencer note is a toggled cell, and a video clip is a multi-cell occupant with duration.

## 6. Component specifications

### 6.1 Paramorphic Grid

| Section | Content |
| --- | --- |
| Substrate | A tiling of cells (square by default; hex and others by parameter, see 6.1a) with a generic look and behavior. |
| Occupants | Single- or multi-cell entities: pieces, blocks, notes, clips, cards. |
| Form parameters | Tiling, dimensions, alternating cell styles (two colors on squares, three on hexes), offsets (QWERTY), non-rectilinear deformation, gutters and headers, viewport clipping, zoom. |
| Behavior parameters | Selection, drag and drop, toggling, press-to-trigger, gravity, turn order, data editing, traversal triggers. |
| Rules | Adjacency and movement rules written against the tiling’s neighbor function, snapping (timebase, beats), per-row/column/box constraints (Sudoku), flipping (Othello). |
| Interpretation | Same grid as calendar, spreadsheet, board, keyboard, timeline, dashboard. |
| Morph chain | Bare grid, then 8×8, then alternating style, then occupants with move rules, then turn logic, an initial arrangement and win conditions, which gives checkers. Chess shares the grid, occupant and turn kernel and differs in piece types, move sets, setup and end conditions. |
| Applications | Board games, block games, sequencers and piano roll, drum pads, keyboards and remotes, tabs, paginators, split and zoomable views, spreadsheets, calendars, dashboards, NLE timelines. |

### 6.1a Grid geometry: the tiling parameter

A Grid is not tied to squares: its cell arrangement is a swappable **tiling**, and occupants, rules and behaviors are written against the tiling’s interface instead of against rows and columns. This is what lets layouts mix different grids and lets interactive controls be built from grids.

| Tiling | Neighbors per cell | Typical uses |
| --- | --- | --- |
| Square | 4 or 8 | Checkers, chess, spreadsheet, calendar, Tetris |
| Hex, horizontal rows (rows offset) | 6 | Hex painting, hex strategy boards, honeycomb menus |
| Hex, vertical columns (columns offset) | 6 | The same uses, with the opposite orientation |
| Other (triangular, isometric, radial) | Varies | Added later through the same interface |

Every tiling supplies the same interface.

| Tiling interface | Purpose |
| --- | --- |
| Cell shape and size | Polygon for drawing and hit-testing |
| Coordinate system | Offset coordinates for storage; axial or cube coordinates for hex math |
| Neighbors and named directions | Movement and adjacency rules (4 or 8 directions on squares, 6 on hexes) |
| Distance between cells | Range, snapping, flood fill |
| Cell to point and point to cell | Rendering and pointer hits |
| Style function over coordinates | Alternating styles: two colors keep square neighbors distinct, hexes need three |
| Span shapes | An occupant’s cells as coordinates relative to an anchor, rotating by the tiling’s steps (90° on squares, 60° on hexes) |
| Move vocabulary | Direction names belong to the tiling (a flat-top hex has N and S, not E and W), plus offset moves for jumps that no single direction expresses, such as the knight’s |

Three consequences follow:

- **Rules say “step to the neighbor in direction d”**, not “row plus one”, so the same rule runs on any tiling that defines d. A rule that needs one geometry (a bishop’s diagonal) states that requirement.
- **Layouts are grids of regions**, each region holding a grid with its own tiling. A square layout grid can hold a hex painting surface in one region and a hex keypad in another.
- **Controls are grids with press behavior.** A hex keypad, a hex pad controller, or a honeycomb menu is a hex grid plus a trigger behavior, in the same way a drum pad is a square grid plus one.

The existing hexagon painter, which paints by activating cells on a hex grid, is the sequencer’s toggle behavior on a hex tiling. The existing base code for horizontal and vertical hexes is the natural first implementation of this interface.

### 6.2 Paramorphic Graph (kernel)

| Section | Content |
| --- | --- |
| Substrate | Nodes and edges, with no constraints on direction, cycles or labels. |
| Occupants | Node content and edge content. |
| Form parameters | Layout algorithm (force, layered, grid-snapped), connector style, node renderer. |
| Behavior parameters | Select, connect, disconnect, drag, traverse, search, filter. |
| Rules | Directedness, acyclicity, degree limits, typing of nodes and edges. |
| Interpretation | Flowchart, wiring diagram, state machine, application scene graph, dependency graph, network topology, knowledge graph. |
| Morph chain | Untyped graph, then directed, then acyclic, then single-parent, which gives a tree. |
| Applications | Visual programming connections, circuit routing, data flow, topology views. |

This section is new. It exists to hold what Tree, Path and Logic share.

### 6.3 Paramorphic Tree

| Section | Content |
| --- | --- |
| Substrate | Nodes with parent-child relationships, a root and leaves. |
| Occupants | The Node Occupant: whatever entity a node represents. |
| Form parameters | Tree Layout (indented, top-down, radial), Node Renderer, Connector style. |
| Behavior parameters | Expand/collapse, select, multi-select, add child or parent, delete, reparent, reorder, drag and drop, search, filter, sort, traverse, annotate, lazy loading. |
| Rules | Single parent, sibling ordering, allowed child types, depth limits. |
| Interpretation | Same hierarchy as filesystem, organization chart, outline, menu, AST, skill tree, commit history. |
| Morph chain | Generic tree, then expandable branches, then typed folder/file nodes, then lazy loading, which gives a file explorer. |
| Applications | See the twenty-row applications table in the source, grouped as file systems, architecture, data, programming, UI, documents, organizations, projects, knowledge, commerce, web, education, biology, mathematics, AI, games, conversation, version control, animation and 3D. |

The Grid/Tree correspondences (cell and node, occupancy and content, adjacency and parent-child) are retained as the bridge between the two components.

### 6.4 Paramorphic Path

| Section | Content |
| --- | --- |
| Substrate | Points and connected segments. |
| Occupants | Added by this reconciliation: points, control handles, anchors and attached objects riding the path. |
| Form parameters | Stroke, fill, caps, joins, winding rules, clipping, gradients. |
| Behavior parameters | Point selection, drag, snap, add and remove points, traversal direction and speed. |
| Rules | Closed or open, continuity, traversal constraints. |
| Interpretation | Data kept separate from interpretation: Bézier shape, map route, motion trajectory, wire, signal curve. |
| Morph chain | Point list, then segments, then curves with handles, then fill and winding, which gives a vector shape. Replacing the interpretation with coordinates and waypoints gives a route. |
| Applications | Vector graphics, geographic routes, motion and animation, connection paths, audio automation. |

### 6.5 Paramorphic Protocol

| Section | Content |
| --- | --- |
| Substrate | A length-prefixed byte blob with a direction flag. |
| Occupants | Frames, messages and sessions. |
| Form parameters | Framing (chunked, delimited, multiplexed), encoding. |
| Behavior parameters | Reliability (ACK/NAK, windows, idempotency), topology (unicast, pub-sub, graph), security (signing, encryption). |
| Rules | State-transition tables, addressing rules. |
| Interpretation | Same envelope as REST, WebSocket, CAN frame, MIDI stream. |
| Morph chain | blob, varInt length frame, stream ordering, crc32 checksum, ack window of size 1, TLS wrapper, which gives an HTTP/2-lite. |
| Applications | Web and device communication, instrument and bus protocols. |

### 6.6 Paramorphic Logic

| Section | Content |
| --- | --- |
| Substrate | Triples of subject, predicate and object with no type system, held as the Graph kernel’s labeled edges. |
| Occupants | Facts, rules and constraints. |
| Form parameters | Presentation as table, graph or rule list. |
| Behavior parameters | Typing (strong, gradual, probabilistic), temporal and causal links, inference (forward chain, backward chain, SAT solving). |
| Rules | Cardinalities, type lattice, evaluation strategy, truth maintenance. |
| Interpretation | Same triples as SQL schema, Prolog knowledge base, rule engine, business process. |
| Morph chain | triples, type lattice, enforced cardinalities, timestamps, derived facts via the region derivation DAG, Datalog rules. |
| Applications | Schemas, knowledge bases, rule engines, process flows. |

## 7. Timeline: where the NLE material goes

There is no Timeline class. The NLE notes are a worked example of Grid composed with Path, kept as an appendix-style case study rather than a component.

| NLE concept | Construct |
| --- | --- |
| Time axis | Grid columns, continuous or quantized, with zoom as seconds per column |
| Tracks | Grid rows with metadata (height varies by track type) |
| Clips | Multi-cell occupants with duration, drawing thumbnails or waveforms |
| Transitions | Overlap or edge occupants |
| Markers and keyframes | Point or tiny-span occupants, used as snapping targets |
| Automation lanes | Path occupants inside a subgrid |
| Playhead and ruler | Special occupants in gutter rows |
| Snapping, ripple, roll, slip, slide | Rule plugins mapped to gestures |

This is the strongest evidence for the thesis, since a complex editor needs no new component type.

## 8. Composition

Components nest through occupants. Any occupant’s data or draw can host another component.

- A grid cell holds a tree (a dashboard panel with a file explorer).
- A tree node holds a path (a scene graph with vector objects).
- A grid occupant holds a path (an automation curve in a timeline lane).
- A protocol state machine is a graph, and a logic rule base is a graph with inference.

The rule for nesting is that the inner component keeps its own substrate, occupants and rules, and the outer one only provides position and size.

Nested grids need not share a tiling. A square layout grid can hold a hex painting surface in one region and a hex keypad in another (section 6.1a).

### 8.1 Nesting, overlap and stacking

Structures compose under one set of conventions defined once for every component, so a grid, tree, graph or path expands, nests, overlaps and stacks in the same way. The Luoshu, a 3×3 square whose rows, columns and diagonals each sum to 15, shows every case: each cell can expand into its own 3×3 (9×9 overall), squares can overlap where they intersect, several layers of numbers can sit on the same nine cells, and its arrangements can be enumerated and compared under rotation and reflection (there is one 3×3 magic square up to those eight symmetries).

| Operator | Meaning | Convention | Luoshu case |
| --- | --- | --- | --- |
| Expand | A cell, node or segment hosts a child structure | The child gets its own local frame and a transform to its parent. Address = path of local coordinates, such as 2.5.7 | Each of the nine cells holds a 3×3 |
| Overlap | Two structures share some cells or nodes | An explicit alignment (offset, or rotation by the tiling’s steps) maps one frame into the other. Shared cells are declared merge (one cell, one state) or coincide (two cells at one place) | Overlapping squares share the cells where they intersect |
| Stack | Several layers on the same substrate | Each layer has its own occupants, styles and rules, and an order. Address = layer@path | Several number sets on the same nine cells |
| Tile | Repeat a structure edge to edge | A repeat count and gaps; each repeat keeps its own frame | A 3×3 arrangement of Luoshu squares |
| Product | Build a structure from the combination of two | Axes multiply, so A×B has cells (a, b). Nesting is a product with local frames | 3×3 times 3×3 gives 9×9 |
| Transform | Rotate, reflect or scale a structure | Only the tiling’s own symmetries (8 on squares, 12 on hexes); configurations equal under a symmetry count as one variant | The eight orientations of the Luoshu |
| Enumerate | Generate the arrangements a rule set allows | A generator plus a rule check over regions | Every arrangement whose lines sum to 15 |

Six conventions make these operators combine without special cases:

1. **Local frames and path addresses.** Each nested structure has its own coordinate space and a transform to its parent. A cell is addressed by layer and path, such as `pieces@3.1.4`. A parent does not need to know its child’s tiling.
2. **Regions.** A region is a named set of cells or nodes that may overlap or nest freely. Rows, columns, boxes and diagonals are generated regions, so Sudoku’s overlapping row, column and box constraints and the Luoshu’s sums over lines use one mechanism. Rules and styles target regions.
3. **Identity on overlap.** The default is coincide: separate cells that happen to sit together, resolved by stacking. Sharing state requires an explicit merge, which prevents accidental shared state.
4. **Resolution per concern.** Draw order, input routing, rule evaluation and data reads each get their own policy across layers and overlaps: top wins, first hit, or combine (sum, union). A single z-order is not assumed to serve all four.
5. **Rule scope and inheritance.** A rule attaches to a structure, layer, region or occupant, applies downward into nested structures by default, and can be overridden locally.
6. **Lazy realization.** Expansion is virtual. Nested content is built when it enters view or is queried, up to a depth limit, as the NLE case virtualizes drawing outside the viewport.

These conventions use only “cell or node”, “frame” and “region”, so Tree, Graph and Path adopt them unchanged: a tree node expands into a subtree, a graph overlaps another by merging nodes, and a path becomes a layer stacked over a grid.

### 8.2 Hosting: any component can host any other

Every component exposes slots and can be placed in a slot, so a grid can host a tree, and a graph can serve as a state machine or as the application’s scene graph, with no component special-cased as the container.

| Side | Provides |
| --- | --- |
| Host, per slot | A frame (region and transform), clipping, lifecycle (mount, unmount, lazy), event routing and focus, inherited context (theme, rules, time) |
| Guest | Natural, minimum and maximum size, drawing and hit-testing inside its frame, event handling, its state and morph plan for introspection, events emitted upward |

What counts as a slot depends on the component.

| Component | Slot |
| --- | --- |
| Grid | A cell or a region |
| Graph | A node (or an edge) |
| Tree | A node |
| Path | A point or segment, as an attachment |
| Protocol | A message field or a session |
| Logic | The object of a triple, or a rule |

A plain occupant is the degenerate guest, one with no internal structure, so an occupant and a hosted component are one concept: an occupant may carry a guest. Hosting is not ownership. The guest keeps its own substrate, occupants and morph plan, and the host reads only its size hints and passes it events. A guest never hosts its own host, so hosting forms no cycles; references can cross freely.

The generic Graph shows why roles are interpretations (principle 3), not types.

| Role of a Graph | Nodes | Edges | Slots | Occupant example |
| --- | --- | --- | --- | --- |
| State machine | States | Transitions with guards and actions | A state can host the guest shown while it is active | The current-state token |
| Application scene graph | Screens, panels, objects | Containment and references | Each node hosts a Grid, Tree, Path or other guest | The active selection |
| Network topology | Devices, services | Links | A node hosts a Protocol endpoint | Packets |

The app skeleton that results is **the state machine selects and the scene graph hosts**. The state machine decides which scene nodes are mounted, active or visible, and the scene graph decides where each guest sits. Both are Graph configurations linked by reference, which keeps navigation logic apart from layout. Illustrative sketch only:

```
component: graph            # application scene graph
role: scene
nodes:
  board:  {host: grid, tiling: hex-rows}
  layers: {host: tree}
  curve:  {host: path}
machine:                    # a second graph, linked by reference
  component: graph
  role: state-machine
  states: {edit: [board, layers], preview: [board]}
```

The host and guest contract is defined once on the common component interface (substrate, occupants, rules, interpretation, morph plan, slots), so no component implements it differently and Grid is never the only possible container.

### 8.3 Traversal and triggers

A playhead is a cursor over an ordered cell list, not a transport. The framework walks a substrate (`linePath`, `createCursor`, `advanceCursor` in `src/framework/traversal.ts`) and reports which occupants the entered cells hit (`collectTriggers`); time itself lives outside, supplied by whatever ticks the cursor — an interval in a demo, a hardware transport on an instrument. The same operator serves sequencer steps, timeline rulers and path animation. Turning a hit into sound, light or motion is a platform adapter's job (layer 5), driven by plan data such as a pitch mapping — never by core code.

## 9. The morph plan format

The sources call for a concise declarative language and a runtime that can replay a plan. A morph plan is an ordered list of named morphs applied to a component. Illustrative sketch only, not final syntax:

```
component: grid
morphs:
  - size: {cols: 8, rows: 8}
  - style: alternating
  - occupants: {kind: piece, span: 1x1}
  - rules: {move: diagonal, capture: jump}
  - turns: {players: 2}
```

Swapping the last two lines for piece-specific move sets turns the same plan into chess. The point of the format is to make that difference a small, readable diff.

Requirements carried over from the sources: every morph is reversible or stackable, the runtime can answer what has been morphed so far, and the plan serializes for AI to read and generate. The source says the XML-based Ocelot system is the intended representation, but it is not defined in these notes, so whether plans are written in Ocelot XML or this YAML-style form is an open decision below.

### 9.0 Stored plans

The goal is for an app to be described by plans. Today, plans configure part of an app and app-specific shell code supplies the rest. Standalone apps own their JSON plans under `apps/`; the demo also has plans under `morph-plans/`. `loadPlan` validates Grid plans and checks and replays stored morph chains before applying them; it also validates configured Grid presentations. Shell plans use a separate `loadShellPlan`. JSON is the stored format; the demo's limited YAML and XML parsing are not lossless replacements. Text pasted into the demo goes through `parsePlan` first.

A real app is a directory with its own plans and its own run commands:

```
apps/spreadsheet/
  index.html            # entry; mounts src/main.tsx
  vite.config.ts        # root is this dir; server.fs.allow reaches the shared src/
  src/main.tsx          # mounts App, imports shared ../../src/index.css
  src/App.tsx           # thin shell: menubar, undo history, save/open
  src/plans.ts          # registry of this app's morph-plans
  morph-plans/*.json    # app configuration; validated by loadPlan on use
```

Rules: one app per directory; each app owns its morph-plans; framework and views stay shared by relative import with the shared toolchain — no per-app packaging until an app needs independent versioning. Run with `npm run dev:spreadsheet`, ship with `npm run build:spreadsheet` (player: `dev:player`, `build:player`). Menus, undo history and file save live in the shell; the plan file stays the source of truth, so save writes a morph-plan and open validates it back through `loadPlan`. `apps/spreadsheet/` and `apps/player/` both follow this shape; the player records through its own `player.*` vocabulary instead of the sheet's.

### 9.1 Runtime layers and AI assembly

If this exists as a runtime or framework, five layers separate what is written once from what is written per app.

| Layer | Contents | Who works here |
| --- | --- | --- |
| Apps | Plans, plus the few custom pieces left over | Programmer or AI |
| Morph library | Stock morphs and rule sets: move rules, end conditions, snapping, typing, framing, formula vocabulary, pitch mappings | Library authors, tested once |
| Components | Grid, Graph, Tree, Path, Protocol, Logic | Framework |
| Kernel conventions | Frames, addresses, regions, layers, slots, events, scope (section 8) | Framework |
| Platform adapters | Rendering, input, storage, network | One per target platform |

Because the platform sits behind adapters, the same plan runs wherever an adapter exists.

AI assembles apps under four rules:

- **AI writes and edits plans, not component code**, so a change is a few lines that a person can read at a glance.
- **Plans are validated before they run.** An unknown morph, an incompatible tiling, or a rule that needs a direction the tiling lacks is rejected with a message the AI can act on.
- **Introspection guides the work.** The AI asks what has been morphed so far and which morphs apply next, so it starts from the current state instead of guessing.
- **Custom code is the exception.** It lives in a named morph that can be reviewed alone.

Runtime status: the morph machinery is one generic core (`src/framework/morphs/scoped.ts`: per-scope validate/check/apply/invert/replay, chain surgery, and the shared save-publication predicate). The Grid registry (`src/framework/morphs/registry.ts`) is the `PlanState` instance of that core — replay via `replayMorphs`, introspection via `listMorphs`/`describeChain`; the disjoint Tree scope (`tree2.ts`) runs the same contract on `TreeState`, and all Grid shells save through the shared `buildAppSave`. Stored plans carry a `base` plus a `morphs[]` chain and are constructed by replay on load: `loadPlan` (`src/framework/plan.ts`) replays base + morphs and rejects the file when the result differs from the cached snapshot, so a plan is never partially applied. The generic occupant/dimension vocabulary lives in `src/framework/morphs/grid.ts` (`grid.upsertOccupant`, `grid.removeOccupant`, `grid.resize`); the spreadsheet, sequencer/player and chat files all boot from replayed chains (11, 3 and 5 morphs over an empty base), the spreadsheet shell boots and saves through the same path, and the demo shell reports the replayed provenance. Check with `npm run verify:replay` (236 checks: §2 paths plus player record/undo/redo/save/load, cursor history contract including cursor-preserving replay, tree registration/validation/replay/undo/redo/serialization, unified-core scope/history/save checks, the keyboard plan load/collision/save round trip, save/checkpoint regression fixes, shared-renderer geometry, and cell-presentation validation/bindings/commits). The keyboard app (`apps/keyboard/`, `key.define`/`key.remove` in `src/framework/morphs/keys.ts`) boots from a 47-morph plan and renders through the shared `GridViewport`: wide keys merge via occupant span, rows stagger from a plan offset, presses arrive as tap overrides and stay unrecorded. The spreadsheet configures its cells the same way (`interpretation.grid` in its plan: `editableText` bound to `data.value`/`data.formula`/`data.computed`, letter/number headers) and renders through the same viewport; a calendar proof plan reuses those presentations with `eventCard`. Earlier-morph removal and replacement replay dependents with step-indexed conflict reports (`removeMorphAt`, `replaceMorphAt`); candidate morphs are tested against the exact state (`checkMorphState`: bounds, presence, collisions) and chains read in human terms (`describeChain`); a save publishes the full chain only when it still replays, otherwise an honest snapshot checkpoint (`chainForSave`); absent or content-free inverse data throws so undo falls back to the snapshot instead of guessing; inverse frames are re-derived from the replay on load and after chain surgery (`recaptureFrames`); unknown `$schema` versions are rejected and malformed bases report errors without throwing. Spreadsheet undo pops applied morphs via their inverses (`sheet.setCell`, `sheet.clearCell` in `src/framework/morphs/sheet.ts`); the snapshot history stack remains as the fallback for steps no morph covers. Morphs that cannot invert declare `invertible: false` and use the snapshot path (the Q4 policy).

## 10. Reconciliation log

| Conflict in the sources | Resolution |
| --- | --- |
| “Paramorphic” versus “parametric” used interchangeably | Paramorphic is the approach and parametric is the parameters (section 1) |
| Two different lists of family members | One family defined in section 4 |
| Timeline listed as a component and also built as a Grid configuration | Timeline is a Grid configuration (section 7) |
| Network and Spatial Structures named but never developed | Folded into Graph and Protocol, or deferred (section 4) |
| Logic’s base described as an untyped relation graph while Graph is unspecified | Added a Graph kernel; Logic’s triples are its edges |
| Tree says it needs no Path and vice versa, yet both are graph-like | Kept as first-class components over a shared kernel |
| Grid has Occupants, Tree has Node Occupant, Path has none | One shared Occupant (section 5) |
| Different sections per component | Single template (section 3) |
| Data-versus-interpretation rule stated only under Path | Promoted to a principle |
| Three opening sections restating the same thesis | Merged into section 1 |
| Grid assumed square rows and columns, while the notes also use hex grids for layouts, controls and painting | Tiling is a Grid parameter with a defined interface, and spans and rules are written against it (section 6.1a) |
| Composition was one short section (cells holding trees, nodes holding paths), with no rules for overlap, stacking or expansion | Operators and six conventions defined once for every component (section 8.1) |
| A generic network or graph was described as both a state machine and an application scene graph | Both are roles of one Graph: the state machine selects and the scene graph hosts (section 8.2) |
| Checkers and chess described as nearly the same program | Restated: they share grid, occupants and turn structure, and differ in setup, move rules and end conditions; the rule-set shape is defined once (section 1.2) |

## 11. Open questions

1. Is the Graph kernel public (a user-facing component) or an internal layer only?
2. Is the morph plan written in Ocelot XML, a YAML-style format, or both, with one as a view of the other? Decided for stored plans: JSON files, the only lossless serializer; YAML stays display-only (§9.0). Ocelot XML remains open as a possible interchange format.
3. Which morphs ship as stock, and how are third-party morphs published?
4. How strictly must morphs be reversible when rules interact (for example removing a gravity rule after pieces have already fallen)?
5. Does Protocol need a streaming-time dimension that Grid does not have, and if so does it share anything with timeline snapping?
6. Proof of concept: can one grid kernel plus plans express Tic-Tac-Toe, Checkers and Chess with a shared kernel and only different setups, rules and end conditions, and can the hex painter run on a square grid by swapping only the tiling? An early demo suggests it can; the validation ladder in section 11.1 turns that into a measured test.
7. Is the tiling a parameter of the Grid substrate, as written, or a separate component the Grid consumes? Does the existing hex base code expose neighbors, distance and point-to-cell conversion so it can be wrapped as a tiling?
8. Does “horizontal” and “vertical” hex mean offset rows and offset columns (commonly called pointy-top and flat-top)? Section 6.1a assumes so.
9. Should overlapping structures coincide by default, with sharing declared as merge (section 8.1), or merge by default?
10. Do draw order, input routing, rule evaluation and data reads each get their own policy per layer, or is a single z-order enough to start?
11. Is repeated self-similar expansion (a cell expanding into a copy of its own structure, as the Luoshu does) a first-class operator with a depth limit, or just repeated nesting?
12. Should the Luoshu be written up as a worked example beside the NLE case in section 7?
13. What did the early demo cover: which components, which apps, and how much custom code remained? Recording it gives the validation ladder a baseline.
14. Where does the runtime live: a library per platform, one interpreter that replays plans, or both?

### 11.1 Validation: build it

The framework is not finished until it has built real apps. An early demo showed the approach works, and the ladder below turns that into a measured test.

| Step | Build | What it proves |
| --- | --- | --- |
| 1 | Tic-Tac-Toe, then Checkers, then Chess | One grid, occupant and turn kernel; differences confined to setup, rules and end conditions |
| 2 | The hex painter on hex and square tilings | The tiling is swappable by parameter |
| 3 | A store-and-browse app (photo album or notes) | Logic, Grid and Tree cover non-game apps |
| 4 | A networked app (chat or sync) | Protocol composes with the rest |
| 5 | A composite: the timeline editor, or the scene graph plus state machine skeleton | Hosting, stacking and nesting work at app scale |

Measures for every step: share of code shared across apps, size of each plan versus any custom code, time from outline to first working draft, first-try validity of AI-written plans, and review effort. An app that needs more than a small custom morph is a finding to feed back into the components, not a failure of the app.

**Results so far**, from a source review of build v3 (read, not run):

| Finding | Steps | Consequence for the framework |
| --- | --- | --- |
| One engine ran tic-tac-toe, checkers and a simplified chess from rule data, and the hex painter ran across all four tilings | 1, 2 (partial) | The rule-set shape holds for setup, moves and turns |
| Outcomes, promotion, gravity and placement were special-cased per game, and end conditions were text, not executable | 1 | Outcomes and end conditions must be predicates over regions (section 8.1) |
| The knight had no moves, because named directions cannot express jumps | 1 | The tiling interface gains offset moves (section 6.1a) |
| The flat-top hex reused the pointy-top direction names | 2 | Direction names belong to the tiling (section 6.1a) |
| Span and guest went unused, so multi-cell occupants were untested | 1 | Validation needs a multi-cell case such as Tetris or sequencer notes |
| Graph, Tree, Path, Protocol, Logic and composition were illustrative mockups, and plans were export-only | 3 to 5 | Graph etc. still mockups; the plans half is superseded — stored plan files now load through `loadPlan` (§9.0, §11.2), though AI-authored plans driving the runtime (§9.1) remain future work |

### 11.2 Generic additions implemented

The missing demo capabilities from §11.1 were added as mechanism, never as app-shaped components. The line held throughout: mechanism in framework, vocabulary in plans.

| Addition | Generic home | Files |
| --- | --- | --- |
| Substrate traversal (playhead cursor, trigger hits) | Kernel convention (§8.3): ordered walk plus `collectTriggers`; time supplied by the caller | `src/framework/traversal.ts` |
| Occupant data editing | Behavior morph alongside toggling: immutable `updateOccupantData` / `upsertOccupant` / `removeOccupant` | `src/framework/editing.ts` |
| Derived data recalculation | Mechanism only: topological order plus cycle detection (`orderForRecalc`, `recomputeDerived`) | `src/framework/derivation.ts` |
| Spreadsheet formulas (`=A1+B2`, `SUM(A1:A8)`, `AVG`/`MIN`/`MAX`) | Morph-library vocabulary over the derivation mechanism; `A1` addressing and missing-cell-reads-zero are the vocabulary choices | `src/framework/morphs/formulas.ts` |
| Sounding a traversal | Platform adapter (layer 5): `createToneTrigger` turns frequencies into WebAudio tones; which datum means which pitch is plan data (`PitchMapping`) | `src/framework/adapters/audio.ts` |
| Stored plans as light modules | Convention (§9.0): one JSON file per app in `morph-plans/`, registry in `morph-plans/index.ts`, validated on load by `loadPlan`, applied by `applyPlan` | `morph-plans/`, `src/framework/plan.ts` |
| Formula recalc with quarantine | Spreadsheet revealed the morph: `applyFormulas` recomputes `data.formula` cells in DAG order into `data.computed`; a cycle quarantines only its cells and dependents (Kahn's algorithm), never the sheet | `src/framework/morphs/formulas.ts` |
| Framing without transport | Chat revealed the split: the length-prefix codec (`encodeFrame`/`decodeStream`, partial frames buffered) is framework vocabulary; delivery stays a platform adapter, still deferred | `src/framework/morphs/framing.ts` |
| Renderer selection by interpretation | Three apps, one Grid: `interpretation.view` picks the renderer (sheet, player, chat), the concrete case of data-apart-from-interpretation; sustained notes fall out of span+triggers composing, no sustain code | `morph-plans/*.json`, `src/views/`, `GridViewport` presentation branch |
| Player note vocabulary | Morph-library vocabulary over the editing mechanism: `player.placeNote`/`player.removeNote` validate note-shaped data (finite pitch, 0..1 velocity); the player app records, undoes and replays through it, never through grid/sheet morphs | `src/framework/morphs/player.ts`, `apps/player/` |
| Cursor as carried field (not an independent state) | Carried `PlanState.cursor` on Grid state: rides along opaquely (grid morphs preserve it by spread), seeks undo when recorded via `cursor.seekTo`, files never persist it — the player shell leaves seeks unrecorded as transport position. `PlanState` stays `{ occupants, width, height, cursor? }` | `src/framework/morphs/cursor.ts`, `src/framework/history.ts` |
| State-carrying history | Snapshots are whole plan states, not occupant lists, so later shapes undo through the same contract; placement checks shared by every occupant vocabulary (`checkPlacement`) | `src/framework/history.ts`, `src/framework/editing.ts` |
| Tree vocabulary (vocabulary independence, Grid-hosted) | Hierarchy over the same occupants with invariants grids lack: unique ids, childless-only removal, cycle-rejecting reparent; replay, undo, redo and file load run unchanged. Not a disjoint-state proof: nodes are still `Occupant`s with `anchor {q,r}` in `width x height` bounds | `src/framework/morphs/tree.ts` |
| Disjoint TreeState + scoped registries | `TreeState` is `{ nodes }` only — no width/height/occupants/anchor/span. `tree2.*` runs the same validate/check/replay/invert/file-load contract through an isolated `createMorphRegistry()` scope; same names can coexist in two scopes and unknown-morph errors stay in scope | `src/framework/tree-state.ts`, `src/framework/morphs/scoped.ts`, `src/framework/morphs/tree2.ts` |
| Unified morph core + keyboard proof | `scoped.ts` is the single implementation (chain surgery and save-publication included); the Grid registry, the generic `createHistory<S>` factory, and `buildAppSave` are its instances. Keyboard: 15×5 grid, 47 keys from a 47-morph `key.define` chain, rendered by the shared `GridViewport` (`mergeSpans`, plan-driven `stagger`, tap overrides); 78 lines of vocabulary over the untouched core | `src/framework/save.ts`, `src/framework/morphs/keys.ts`, `src/framework/components/GridViewport.tsx`, `apps/keyboard/` |
| Cell presentations + calendar proof | `interpretation.grid` selects a cell presentation (`editableText`, `readOnly`, `eventCard`) plus `data.<field>` bindings and letter/number headers; the spreadsheet and a 7×5 calendar plan (4 events) render through the same `GridViewport` branch, and both custom grid views are deleted | `src/framework/presentations.ts`, `morph-plans/calendar.json`, `apps/spreadsheet/` |

WebAudio specifics live behind an adapter, while formula and pitch vocabularies live in shared framework modules. The spreadsheet and player currently combine plans, shared framework code, and app-specific shells; their plans do not yet describe every behavior.

## 12. Source cleanup checklist

- Delete the stray fragment “user interface: grid of buttons / keyboard:” and the empty “Summary of Applicability” heading.
- Remove the shared-chat link and the image-hosting links in the Path section.
- Fix typos such as “turles” and “specifc”, and the sentence that reads “you anything that can start out from a grid”.
- Retitle “Parametric Customizations” per the terminology decision.
- Replace the three opening sections with section 1 of this document.
- Move the NLE material into a worked-example appendix and convert the pasted markdown tables so they render consistently.
