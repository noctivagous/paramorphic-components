// ---------- Rule morph vocabulary: game rules as replayable construction ----------
// Moves, turns, outcomes, regions, and end conditions used to travel beside
// the morph chain as static configuration, so replay never constructed them.
// This vocabulary registers into its own scoped registry over AppState
// ({ board, rules }), following the TreeState precedent: same validate /
// check / capture / apply / invert / checked-replay contract, no Grid
// fields. One MoveRule per pieceType keeps replacement and removal
// unambiguous; the engine already matches every rule for a piece.
import { createMorphRegistry, type MorphRegistry, type ScopedAppliedMorph } from "./scoped";
import { createHistory } from "../history";
import type { MorphContext, PlanState } from "./registry";
import type { MoveRule, OutcomeCondition, Region, RuleSet, TurnRule } from "../types";
import {
  cloneRuleSet,
  OUTCOME_KINDS,
  ruleSetsEqual,
  tilingForRules,
  validateEnd,
  validateMoveRule,
  validateOutcome,
  validateRegion,
  validateRuleSet,
  validateTurns,
} from "../rule-sets";

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

export const rulesRegistry: MorphRegistry<AppState> = createMorphRegistry<AppState>();

function tilingIdOf(ctx: unknown): string | undefined {
  return (ctx as MorphContext | undefined)?.tilingId;
}

function regionIdsOf(rules: RuleSet): Set<string> {
  return new Set((rules.regions ?? []).map(r => r.id));
}

/** Tiling-aware move validation; direction names resolve only with tiling context. */
function checkMoveAgainstTiling(rule: MoveRule, ctx: unknown): string[] {
  const tiling = tilingForRules(tilingIdOf(ctx));
  return validateMoveRule(rule, 0, tiling);
}

function withRules(state: AppState, rules: RuleSet): AppState {
  return { board: state.board, rules };
}

function needFrame<T>(undoCtx: unknown, morph: string, key: string): T {
  const frame = undoCtx as Record<string, unknown> | undefined;
  if (!frame || !(key in frame)) throw new Error(`${morph} has no inverse data; cannot invert`);
  return frame[key] as T;
}

rulesRegistry.register<{ rule: MoveRule }>({
  name: "rule.addMove",
  describe: "Add one piece move rule",
  invertible: true,
  validate: p => {
    if (!p || typeof p !== "object") return ["params must be { rule }"];
    return validateMoveRule((p as { rule: MoveRule }).rule, 0, null);
  },
  check: (state, p, ctx) => {
    if (state.rules.moves.some(m => m.pieceType === p.rule.pieceType)) {
      return [`move rule for "${p.rule.pieceType}" already exists (replace or remove it first)`];
    }
    const errs = checkMoveAgainstTiling(p.rule, ctx);
    if (p.rule.onMove?.ifInRegion && !regionIdsOf(state.rules).has(p.rule.onMove.ifInRegion)) {
      errs.push(`rule.onMove.ifInRegion region "${p.rule.onMove.ifInRegion}" not found in regions`);
    }
    return errs;
  },
  capture: () => ({ prev: null }),
  apply: (state, p) => withRules(state, { ...state.rules, moves: [...state.rules.moves, p.rule] }),
  invert: (state, p, undoCtx) => {
    needFrame<null>(undoCtx, "rule.addMove", "prev");
    return withRules(state, {
      ...state.rules,
      moves: state.rules.moves.filter(m => m.pieceType !== p.rule.pieceType),
    });
  },
});

rulesRegistry.register<{ pieceType: string }>({
  name: "rule.removeMove",
  describe: "Remove one piece move rule",
  invertible: true,
  validate: p => {
    if (!p || typeof (p as { pieceType: string }).pieceType !== "string" || !(p as { pieceType: string }).pieceType) {
      return ["params must be { pieceType }"];
    }
    return [];
  },
  check: (state, p) =>
    state.rules.moves.some(m => m.pieceType === p.pieceType)
      ? []
      : [`move rule for "${p.pieceType}" is not present`],
  capture: (state, p) => ({
    prev: state.rules.moves.find(m => m.pieceType === p.pieceType) ?? null,
    index: state.rules.moves.findIndex(m => m.pieceType === p.pieceType),
  }),
  apply: (state, p) => withRules(state, {
    ...state.rules,
    moves: state.rules.moves.filter(m => m.pieceType !== p.pieceType),
  }),
  invert: (state, _p, undoCtx) => {
    const prev = needFrame<MoveRule | null>(undoCtx, "rule.removeMove", "prev");
    if (!prev) return state;
    const index = needFrame<number>(undoCtx, "rule.removeMove", "index");
    const moves = [...state.rules.moves];
    moves.splice(Math.max(0, Math.min(index, moves.length)), 0, prev);
    return withRules(state, { ...state.rules, moves });
  },
});

rulesRegistry.register<{ rule: MoveRule }>({
  name: "rule.replaceMove",
  describe: "Replace one piece move rule",
  invertible: true,
  validate: p => {
    if (!p || typeof p !== "object") return ["params must be { rule }"];
    return validateMoveRule((p as { rule: MoveRule }).rule, 0, null);
  },
  check: (state, p, ctx) => {
    if (!state.rules.moves.some(m => m.pieceType === p.rule.pieceType)) {
      return [`move rule for "${p.rule.pieceType}" is not present`];
    }
    const errs = checkMoveAgainstTiling(p.rule, ctx);
    if (p.rule.onMove?.ifInRegion && !regionIdsOf(state.rules).has(p.rule.onMove.ifInRegion)) {
      errs.push(`rule.onMove.ifInRegion region "${p.rule.onMove.ifInRegion}" not found in regions`);
    }
    return errs;
  },
  capture: (state, p) => ({
    prev: state.rules.moves.find(m => m.pieceType === p.rule.pieceType) ?? null,
    index: state.rules.moves.findIndex(m => m.pieceType === p.rule.pieceType),
  }),
  apply: (state, p) => withRules(state, {
    ...state.rules,
    moves: state.rules.moves.map(m => (m.pieceType === p.rule.pieceType ? p.rule : m)),
  }),
  invert: (state, _p, undoCtx) => {
    const prev = needFrame<MoveRule | null>(undoCtx, "rule.replaceMove", "prev");
    if (!prev) return state;
    const index = needFrame<number>(undoCtx, "rule.replaceMove", "index");
    const moves = [...state.rules.moves];
    const at = moves.findIndex(m => m.pieceType === prev.pieceType);
    if (at >= 0) moves[at] = prev;
    else moves.splice(Math.max(0, Math.min(index, moves.length)), 0, prev);
    return withRules(state, { ...state.rules, moves });
  },
});

rulesRegistry.register<{ turns: TurnRule }>({
  name: "rule.setTurns",
  describe: "Replace the turn order policy",
  invertible: true,
  validate: p => {
    if (!p || typeof p !== "object") return ["params must be { turns }"];
    return validateTurns((p as { turns: TurnRule }).turns);
  },
  check: () => [],
  capture: state => ({ prev: state.rules.turns }),
  apply: (state, p) => withRules(state, { ...state.rules, turns: p.turns }),
  invert: (state, _p, undoCtx) => {
    const prev = needFrame<TurnRule>(undoCtx, "rule.setTurns", "prev");
    return withRules(state, { ...state.rules, turns: prev });
  },
});

rulesRegistry.register<{ outcome: OutcomeCondition }>({
  name: "rule.addOutcome",
  describe: "Add one win/loss/draw condition",
  invertible: true,
  validate: p => {
    if (!p || typeof p !== "object") return ["params must be { outcome }"];
    const o = (p as { outcome: OutcomeCondition }).outcome;
    if (!o || typeof o !== "object") return ["outcome must be an object"];
    if (!OUTCOME_KINDS.includes((o as any).kind)) {
      return [`outcome kind "${(o as any).kind}" unknown (available: ${OUTCOME_KINDS.join(", ")})`];
    }
    return [];
  },
  check: (state, p) => validateOutcome(p.outcome, 0, regionIdsOf(state.rules)),
  capture: state => ({ prev: [...state.rules.outcomes] }),
  apply: (state, p) => withRules(state, { ...state.rules, outcomes: [...state.rules.outcomes, p.outcome] }),
  invert: (state, _p, undoCtx) => {
    const prev = needFrame<OutcomeCondition[]>(undoCtx, "rule.addOutcome", "prev");
    return withRules(state, { ...state.rules, outcomes: prev });
  },
});

rulesRegistry.register<{ index: number }>({
  name: "rule.removeOutcome",
  describe: "Remove one win/loss/draw condition by index",
  invertible: true,
  validate: p => {
    if (!p || !Number.isInteger((p as { index: number }).index)) return ["params must be { index }"];
    return [];
  },
  check: (state, p) =>
    p.index < 0 || p.index >= state.rules.outcomes.length
      ? [`outcome index ${p.index} out of range (0..${state.rules.outcomes.length - 1})`]
      : [],
  capture: state => ({ prev: [...state.rules.outcomes] }),
  apply: (state, p) => withRules(state, {
    ...state.rules,
    outcomes: state.rules.outcomes.filter((_, i) => i !== p.index),
  }),
  invert: (state, _p, undoCtx) => {
    const prev = needFrame<OutcomeCondition[]>(undoCtx, "rule.removeOutcome", "prev");
    return withRules(state, { ...state.rules, outcomes: prev });
  },
});

rulesRegistry.register<{ region: Region }>({
  name: "rule.addRegion",
  describe: "Define one named region",
  invertible: true,
  validate: p => {
    if (!p || typeof p !== "object") return ["params must be { region }"];
    return validateRegion((p as { region: Region }).region, 0);
  },
  check: (state, p) =>
    (state.rules.regions ?? []).some(r => r.id === p.region.id)
      ? [`region "${p.region.id}" already exists`]
      : [],
  capture: state => ({ prev: [...(state.rules.regions ?? [])] }),
  apply: (state, p) => withRules(state, {
    ...state.rules,
    regions: [...(state.rules.regions ?? []), p.region],
  }),
  invert: (state, _p, undoCtx) => {
    const prev = needFrame<Region[]>(undoCtx, "rule.addRegion", "prev");
    return withRules(state, { ...state.rules, regions: prev });
  },
});

rulesRegistry.register<{ id: string }>({
  name: "rule.removeRegion",
  describe: "Remove one named region",
  invertible: true,
  validate: p => {
    if (!p || typeof (p as { id: string }).id !== "string" || !(p as { id: string }).id) {
      return ["params must be { id }"];
    }
    return [];
  },
  check: (state, p) => {
    if (!(state.rules.regions ?? []).some(r => r.id === p.id)) return [`region "${p.id}" is not present`];
    const users: string[] = [];
    state.rules.outcomes.forEach((o: any, i: number) => {
      if (o.kind === "reachRow" && o.regionId === p.id) users.push(`outcomes[${i}]`);
      if (o.kind === "line" && Array.isArray(o.regions) && o.regions.includes(p.id)) users.push(`outcomes[${i}]`);
    });
    if (users.length > 0) {
      return [`region "${p.id}" is referenced by ${users.join(", ")} (update them first)`];
    }
    return [];
  },
  capture: state => ({ prev: [...(state.rules.regions ?? [])] }),
  apply: (state, p) => withRules(state, {
    ...state.rules,
    regions: (state.rules.regions ?? []).filter(r => r.id !== p.id),
  }),
  invert: (state, _p, undoCtx) => {
    const prev = needFrame<Region[]>(undoCtx, "rule.removeRegion", "prev");
    return withRules(state, { ...state.rules, regions: prev });
  },
});

rulesRegistry.register<{ end: { condition: string; action: string } }>({
  name: "rule.setEnd",
  describe: "Replace the termination policy",
  invertible: true,
  validate: p => {
    if (!p || typeof p !== "object") return ["params must be { end }"];
    return validateEnd((p as { end: unknown }).end);
  },
  check: () => [],
  capture: state => ({ prev: state.rules.end }),
  apply: (state, p) => withRules(state, { ...state.rules, end: p.end as RuleSet["end"] }),
  invert: (state, _p, undoCtx) => {
    const prev = needFrame<RuleSet["end"]>(undoCtx, "rule.setEnd", "prev");
    return withRules(state, { ...state.rules, end: prev });
  },
});

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
