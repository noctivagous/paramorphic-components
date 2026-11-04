// ---------- Rule morph vocabulary: game rule definitions ----------
// Non-core vocabulary: these definitions register into the AppState-scope
// registry owned by ../rule-chains.ts (core). plan.ts and shells drive
// construction through that core module and never import this file; the
// framework index imports it once for its registration side effect.
import { rulesRegistry, type AppState } from "../rule-chains";
import type { MorphContext } from "./registry";
import type { MoveRule, OutcomeCondition, Region, RuleSet, TurnRule } from "../types";
import {
  OUTCOME_KINDS,
  tilingForRules,
  validateEnd,
  validateMoveRule,
  validateOutcome,
  validateRegion,
  validateTurns,
} from "../rule-sets";

// Re-surface the orchestration owned by core so consumers keep one import.
export * from "../rule-chains";

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
