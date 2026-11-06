# Theme as a paramorphic plan — design note

Status: design only (not built). Recorded 2026-11-05. Slices T1–T3 below;
the CSS pass on branch `feat/classic-desktop-css` anticipates T1's look with
hard-coded CSS and is not this design.

## User direction (2026-11-05)

The default theme is a late-2000s desktop-application look: light classic
chrome, larger type, high contrast. The previous dark theme was criticised
for type that is too small and insufficient contrast. The theme must be
user-configurable later; what ships now is only the default.

## Fit

A theme is a presentation-layer plan. A theme document is a set of named
tokens — colours, font family, base font size, spacing unit, border and
bevel metrics — and nothing else. `AppShell` resolves the active theme to
CSS custom properties at the shell root; chrome, controls and apps consume
variables only, never literals. This is the same separation the framework
already keeps elsewhere: plans describe structure, presentations describe
appearance, and a theme is the presentation of the shell itself.

Because the theme is data, it inherits the properties of every other plan:

- **Inspectable** — the active theme can be read, diffed and reviewed like
  a morph plan.
- **Saveable** — a theme is a file, versioned with the repo or kept by the
  user.
- **Swappable** — selecting another theme document re-skins every app at
  once. User configurability later requires no new mechanism: it comes
  from the theme never having been compiled in.

## Derivational structure

Late-2000s desktop chrome is mostly derived, not enumerated. One
button-face colour generates the bevel ramp (highlight, light, shadow,
dark shadow); a title bar is a gradient between two stops; readable text
on an arbitrary face is a contrast choice. A theme document therefore
stores a small set of base tokens plus relation bindings that derive the
rest. Proposed `theme.*` relation defs:

- `theme.ramp(face)` → `{ highlight, light, shadow, darkShadow }`
- `theme.gradientStops(base)` → active/inactive title-bar gradient stops
- `theme.contrastText(surface)` → black or white text for a surface

Scrubbing a base token re-derives the whole chrome, the way scrubbing a
supershape parameter re-derives its outline. The registry entry, port
types and evaluation reuse the Relations engine (`src/framework/relations.ts`)
unchanged.

## Layering

- An **app-kit theme module** owns the token registry (name, type,
  default) and the resolver that turns a theme document into CSS
  variables. The registry's defaults are the classic desktop theme.
- An app may carry a **partial theme** merged over the default — the same
  base-plus-ordered-changes shape as a morph plan: base theme, then token
  overrides. Apps restyle by naming tokens, not by writing CSS.
- Per-cell/per-node style bindings (presentation `data.style`) sit below
  the theme: they override individual elements, the theme supplies every
  value they do not name.

## The editor, and R3b

A theme editor can itself be a GUI-builder document: colour fields and
sliders whose targets are theme tokens, with the `theme.*` bindings
re-deriving chrome live while the user scrubs. That requires relations to
write into document state — the open **R3b** design question (GUI node
props as relation write targets). The theme may be the easier first case
for R3b: its write targets are a flat token map, not a tree of nodes, so
binding, undo and save are all simpler. Worth attempting R3b against the
theme before attempting it against arbitrary GUI documents.

## Exporter note

An exported app inlines its resolved theme as a plain CSS file — the
token values after derivation, no runtime. Theme-as-data exports like
everything else in the exporter design (`refs` and README §8.5); no
special case needed.

## Slices

- **T1 — token consolidation + classic default.** Move every hard-coded
  colour/size in shell, controls and apps onto CSS variables; ship the
  classic desktop theme as the default values. (The
  `feat/classic-desktop-css` pass does the visual half of this with
  hard-coded CSS; T1 proper replaces the literals with the token layer.)
- **T2 — theme as a plan.** Theme document format (base tokens +
  `theme.*` bindings), load/save, token morphs with undo, per-app partial
  themes merged over the default.
- **T3 — editor surface.** A theme picker plus a scrub editor (likely a
  GUI-builder document), which is where the R3b write-target design gets
  its first concrete case.

## Non-goals

- No per-app CSS files as a theming mechanism — apps consume variables.
- No dark/light mode toggle as a substitute for themes; a dark theme is
  just another theme document under this design.
