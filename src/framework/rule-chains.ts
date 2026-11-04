// ---------- Rule chains: AppState orchestration (core) ----------
// The registry instance, history, and load/save/replay orchestration for
// game rules live here in core. The rule.* morph DEFINITIONS live in
// morphs/rules.ts (a vocabulary, non-core by the import boundary) and
// register into this instance; plan.ts drives construction through these
// core functions without importing any vocabulary.
import { createMorphRegistry, type MorphRegistry, type ScopedAppliedMorph } from "./morphs/scoped";
import { createHistory } from "./history";
import type { MorphContext, PlanState } from "./morphs/registry";
import type { RuleSet } from "./types";
import { cloneRuleSet, ruleSetsEqual, tilingForRules, validateRuleSet } from "./rule-sets";

export type AppState = {
  board: PlanState;
  rules: RuleSet;
};

export function cloneAppState(s: AppState): AppState {
  return {
    board: { ...s.board, occupants: [...s.board.occupants] },
    rules: cloneRuleSet(s.rules),
  };
}

/** Compare two app states: board dims + occupants, then rules. Null means equal. */
export function appStatesEqual(a: AppState, b: AppState): string | null {
  if (a.board.width !== b.board.width || a.board.height !== b.board.height) {
    return `replayed dimensions ${a.board.width}x${a.board.height} do not match cached ${b.board.width}x${b.board.height}`;
  }
  const key = (o: { id: string }) => o.id;
  const ra = [...a.board.occupants].sort((x, y) => (key(x) < key(y) ? -1 : 1));
  const rb = [...b.board.occupants].sort((x, y) => (key(x) < key(y) ? -1 : 1));
  if (ra.length !== rb.length) {
    return `replayed ${ra.length} occupants but cached snapshot has ${rb.length}`;
  }
  for (let i = 0; i < ra.length; i++) {
    if (JSON.stringify(ra[i]) !== JSON.stringify(rb[i])) {
      return `replayed occupant "${key(ra[i])}" differs from cached snapshot`;
    }
  }
  return ruleSetsEqual(a.rules, b.rules);
}

/** The AppState-scope registry; rule.* definitions register into it. */
export const rulesRegistry: MorphRegistry<AppState> = createMorphRegistry<AppState>();

export type RuleChainStep = ScopedAppliedMorph;

/** History over AppState through the rule registry; the Grid-shell contract unchanged. */
export const appHistory = createHistory<AppState>({
  apply: (state, morph) => rulesRegistry.applyMorph(state, morph),
  invert: (state, morph) => rulesRegistry.invertMorph(state, morph),
});

export type AppPlanRuleFile = {
  ruleBase?: RuleSet;
  ruleMorphs?: RuleChainStep[];
};

function checkAppBoard(board: unknown): string[] {
  if (!board || typeof board !== "object") return ["board must be { occupants, width, height }"];
  const b = board as PlanState;
  if (!Array.isArray(b.occupants)) return ["board.occupants must be an array"];
  if (typeof b.width !== "number" || typeof b.height !== "number") {
    return ["board needs numeric width and height"];
  }
  return [];
}

/**
 * Replay a rule chain over an AppState base. Mirrors the board load path:
 * base validation (never a throw), param validation, checked replay step by
 * step, and full ruleSet validation of the result.
 */
export function loadRuleChain(
  base: AppState,
  chain: unknown,
  ctx: MorphContext = {}
): { ok: true; rules: RuleSet; chain: RuleChainStep[] } | { ok: false; errors: string[] } {
  if (!base || typeof base !== "object" || !base.rules || typeof base.rules !== "object") {
    return { ok: false, errors: ["ruleBase must be { board, rules }"] };
  }
  const boardErrors = checkAppBoard(base.board);
  if (boardErrors.length > 0) {
    return { ok: false, errors: boardErrors.map(e => `ruleBase.${e}`) };
  }
  const errors: string[] = [];
  const tiling = tilingForRules(ctx?.tilingId);
  for (const e of validateRuleSet(base.rules, tiling)) errors.push(`ruleBase.${e}`);
  let steps: RuleChainStep[] = [];
  if (chain !== undefined) {
    if (!Array.isArray(chain)) return { ok: false, errors: ["plan.ruleMorphs must be an array"] };
    steps = chain;
    for (const e of rulesRegistry.validateChain(steps, ctx)) errors.push(e);
  }
  if (errors.length > 0) return { ok: false, errors };
  const replayed = rulesRegistry.replayMorphsChecked(base, steps, ctx, cloneAppState);
  if (!replayed.ok) return { ok: false, errors: replayed.errors };
  for (const e of validateRuleSet(replayed.state.rules, tiling)) errors.push(`replayed.${e}`);
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    rules: replayed.state.rules,
    chain: rulesRegistry.recaptureFrames(base, steps, cloneAppState),
  };
}

/**
 * Save-publication for rule chains, mirroring chainForTreeSave: publish the
 * full base + chain only when the loader itself would accept it and the
 * replayed state matches; otherwise checkpoint an honest snapshot. An invalid
 * current state is an error, never a file its own loader rejects.
 */
export function chainForRuleSave(
  base: AppState,
  chain: RuleChainStep[],
  current: AppState,
  ctx: MorphContext = {}
): { ok: true; base: AppState; morphs: RuleChainStep[]; checkpointed: boolean } | { ok: false; errors: string[] } {
  const tiling = tilingForRules(ctx?.tilingId);
  const baseOk =
    !!base &&
    typeof base === "object" &&
    checkAppBoard(base.board).length === 0 &&
    validateRuleSet(base.rules, tiling).length === 0;
  const currentErrors = [
    ...checkAppBoard(current?.board).map(e => `current.${e}`),
    ...(current && typeof current === "object" && current.rules
      ? validateRuleSet(current.rules, tiling).map(e => `current.${e}`)
      : ["current.rules must be an object"]),
  ];
  if (currentErrors.length > 0) return { ok: false, errors: currentErrors };
  const chainValid = Array.isArray(chain) && rulesRegistry.validateChain(chain, ctx).length === 0;
  // Guard the replay on a valid base: cloning an invalid base throws, and a
  // valid current state must checkpoint instead of throwing.
  const replayed =
    baseOk && chainValid
      ? rulesRegistry.replayMorphsChecked(base, chain, ctx, cloneAppState)
      : ({ ok: false, errors: [] } as const);
  const matches = replayed.ok && appStatesEqual(replayed.state, current) === null;
  if (rulesRegistry.publishesFullChain(baseOk, chainValid, replayed.ok, matches)) {
    return { ok: true, base, morphs: chain, checkpointed: false };
  }
  return { ok: true, base: cloneAppState(current), morphs: [], checkpointed: true };
}

/** Chain surgery for rule chains through the same scoped core. */
export function removeRuleMorphAt(
  base: AppState,
  chain: RuleChainStep[],
  index: number,
  ctx: MorphContext = {}
): { ok: true; state: AppState; chain: RuleChainStep[] } | { ok: false; errors: string[] } {
  return rulesRegistry.removeAt(base, chain, index, ctx, cloneAppState);
}

export function replaceRuleMorphAt(
  base: AppState,
  chain: RuleChainStep[],
  index: number,
  replacement: RuleChainStep,
  ctx: MorphContext = {}
): { ok: true; state: AppState; chain: RuleChainStep[] } | { ok: false; errors: string[] } {
  return rulesRegistry.replaceAt(base, chain, index, replacement, ctx, cloneAppState);
}
