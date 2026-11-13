# AGENTS.md

Project: Paramorphic Components — a general Grid component progressively shaped
(morphed) into apps (games, sheets, keyboards, players, browsers). See
[README.md](README.md) for vocabulary and runtime status, [TASKS.md](TASKS.md)
for the roadmap and evidence log.

## Commands

- `npm test` — Node test runner (boundary regressions, metrics, replay/browser
  verifications). Run alongside typechecking and builds.
- `npm run typecheck` — `tsc --noEmit`. Must pass.
- `npm run lint:boundaries` — core framework import boundaries (TypeScript
  resolution). Must pass.
- `npm run lint:rules` — rejects direct `ruleSet.id` branches in game rules.
- `npm run metrics` / `npm run metrics -- --json` — shared vs app-specific
  code report; `measurements/README.md` defines timing/review measures.
- `npm run build`, `build:spreadsheet`, `build:player`, `build:keyboard`,
  `build:browser`, `build:gui-builder`, `build:supershape` — per-app Vite builds.
- `npm run verify:<name>` — `replay`, `browser`, `tilings`, `rules`, `turns`,
  `games`, `selection`, `sheet`, `gui`, `relations`, `export`, `manifests`. Each bundles its
  script with esbuild to `/tmp` then runs node. Prefer these over ad-hoc scripts.
- `npm run gen:plans` — regenerate game plans. `npm run export -- ...` — one-way
  export fork (see TASKS §6).

CI runs: `lint:boundaries`, `lint:rules`, `test`, `typecheck`, `metrics`, all
app builds listed in [.github/workflows/ci.yml](.github/workflows/ci.yml).

## Architecture

- Shared machinery lives in [src/framework](src/framework): `GridViewport.tsx`
  renderer, `morphs/` registry + vocabularies, `plan.ts` (load/validate/replay),
  `history.ts` (generic `createHistory<S>`), `save.ts`, `app-kit/`, `adapters/`.
- Each app owns its directory under [apps/](apps) (e.g.
  `apps/spreadsheet/`): `index.html`, `vite.config.ts`, `morph-plans/*.json`,
  `src/main.tsx`, `App.tsx`, `plans.ts`, `save.ts`.
- Plans are versioned contracts: configuration + base state + ordered morph
  chain. Load validates and replays the chain against its base before applying;
  never partially apply an invalid plan. Save must produce a complete replayable
  plan; never publish a partial chain as complete.
- Vocabulary supplies meanings/behaviors; registry + runtime execute them. Keep
  app vocabulary outside core mechanism (`scoped.ts` per-scope maps;
  `history.ts` generic factory). Core must not import non-core — enforced by
  `lint:boundaries` (core = framework minus `index.ts`, `presets.ts`,
  `plan-kits/`, `app-kit/`, `adapters/`, and `morphs/` except `registry.ts` /
  `scoped.ts`).
- Naming: component = structure; substrate = underlying arrangement;
  occupant = thing placed on it; morph = named parameterized transformation;
  replay = apply chain in order to base; history may hold morphs + snapshots
  and is not the construction plan.

## Working conventions

- Keep [README.md](README.md) runtime status and [TASKS.md](TASKS.md) evidence
  current as behavior changes. Distinguish working behavior from mockups.
- Apply schema/API changes directly; no legacy migrations, shims, or data
  migration scripts unless explicitly requested.
- Game rules: use shared turn helpers and parameterized rule checks; never
  branch on `ruleSet.id` directly (see `lint:rules`).
- Grid selection is transient UI state, separate from plan cell data and morph
  history.
- Export is a one-way fork with a manifest (emitted / vendored / template /
  unsupported); exported projects must not import Paramorphic Components.
- No absolute URLs in the repo unless necessary.
