// ---------- Rule-set validation, cloning, and comparison ----------
// Pure shape checks shared by plan loading (`validatePlan`) and the rule
// morph vocabulary (`morphs/rules`). Extracted verbatim from the plan
// loader so every message stays identical whichever entry point reports it.
import type { MoveKind, MoveRule, OutcomeCondition, Region, RuleSet, TilingDef, TurnRule } from "./types";
import { TILINGS, getTiling } from "./tilings";

export const OUTCOME_KINDS = [
  "line",
  "captureAll",
  "noMoves",
  "kingCaptured",
  "reachRow",
  "boardFull",
  "fillRegions",
  "topReached",
];

export const TURN_TYPES = ["alternating", "free", "samePlayerIfCapture"];

export const END_CONDITIONS = ["anyOutcome", "manual", "none"];

export const END_ACTIONS = ["stop", "none"];

export function validateMoveKind(mk: any, path: string, tiling: TilingDef | null): string[] {
  if (mk.type === "step" || mk.type === "slide") {
    if (!mk.dir) return [`${path} missing dir`];
    if (tiling && !tiling.directionMap[mk.dir]) {
      return [
        `direction ${mk.dir} not defined in tiling ${tiling.id}, available: ${tiling.directions.map(d => d.name).join(",")}`,
      ];
    }
    return [];
  }
  if (mk.type === "pawn") {
    const errors: string[] = [];
    const forwards = Array.isArray(mk.forward) ? mk.forward : [mk.forward];
    forwards.forEach((f: string) => {
      if (tiling && !tiling.directionMap[f]) {
        errors.push(`pawn forward direction ${f} not defined in tiling ${tiling.id}`);
      }
    });
    (mk.captureDirs || []).forEach((cd: string) => {
      if (tiling && !tiling.directionMap[cd]) {
        errors.push(`pawn capture dir ${cd} not defined in tiling ${tiling.id}`);
      }
    });
    return errors;
  }
  if (mk.type === "leap") {
    if (!Array.isArray(mk.offsets)) return [`${path} leap missing offsets array`];
    const errors: string[] = [];
    mk.offsets.forEach((off: any, k: number) => {
      if (typeof off?.dq !== "number" || typeof off?.dr !== "number") {
        errors.push(`${path}.offsets[${k}] needs numeric dq/dr`);
      }
    });
    return errors;
  }
  if (mk.type === "leapRef") {
    if (mk.ref !== "knight") return [`${path} unknown leap ref "${mk.ref}" (available: knight)`];
    if (tiling && tiling.leaps.offsets.length === 0) {
      return [`tiling ${tiling.id} defines no leap offsets for ref "knight"`];
    }
    return [];
  }
  if (mk.type === "place") {
    // no direction to check
    return [];
  }
  return [`${path} unknown move type "${mk.type}" (available: step, slide, leap, leapRef, pawn, place)`];
}

export function validateMoveRule(mr: MoveRule, idx: number, tiling: TilingDef | null): string[] {
  const errors: string[] = [];
  if (!mr.pieceType) errors.push(`moves[${idx}] missing pieceType`);
  if (!Array.isArray((mr as any).moves)) errors.push(`moves[${idx}].moves must be array`);
  else {
    (mr.moves as MoveKind[]).forEach((mk: any, j: number) => {
      for (const e of validateMoveKind(mk, `moves[${idx}].moves[${j}]`, tiling)) errors.push(e);
    });
  }
  const capture = (mr as any).capture;
  if (capture !== undefined && capture !== "move" && capture !== "captureOnly" && capture !== "both") {
    errors.push(`moves[${idx}] capture "${capture}" unknown (available: move, captureOnly, both)`);
  }
  return errors;
}

export function validateTurns(turns: any): string[] {
  if (!turns) return ["ruleSet.turns missing"];
  if (!TURN_TYPES.includes(turns.type)) {
    return [`ruleSet.turns.type "${turns.type}" unknown (available: ${TURN_TYPES.join(", ")})`];
  }
  const errors: string[] = [];
  if ((turns.type === "alternating" || turns.type === "samePlayerIfCapture") && turns.order !== undefined) {
    if (!Array.isArray(turns.order) || turns.order.some((p: any) => typeof p !== "string" || !p)) {
      errors.push("ruleSet.turns.order must be an array of non-empty player names");
    }
  }
  return errors;
}

export function validateOutcome(o: any, idx: number, regionIds: Set<string>): string[] {
  const path = `outcomes[${idx}]`;
  if (!OUTCOME_KINDS.includes(o.kind)) {
    return [`${path} unknown kind "${o.kind}" (available: ${OUTCOME_KINDS.join(", ")})`];
  }
  const errors: string[] = [];
  if (o.kind === "reachRow" && !o.regionId) errors.push(`${path} reachRow missing regionId`);
  else if (o.kind === "reachRow" && !regionIds.has(o.regionId)) {
    errors.push(`${path} region "${o.regionId}" not found in regions`);
  }
  if (o.kind === "line" && o.regions && o.regions !== "all" && Array.isArray(o.regions)) {
    o.regions.forEach((rid: string) => {
      if (!regionIds.has(rid)) errors.push(`${path} region "${rid}" not found in regions`);
    });
  }
  return errors;
}

export function validateRegion(r: any, idx: number): string[] {
  const path = `regions[${idx}]`;
  if (!r || typeof r !== "object") return [`${path} must be an object`];
  const errors: string[] = [];
  if (typeof r.id !== "string" || !r.id) errors.push(`${path} missing id`);
  if (!Array.isArray(r.cells)) errors.push(`${path} cells must be an array`);
  else {
    r.cells.forEach((c: any, k: number) => {
      if (typeof c?.q !== "number" || typeof c?.r !== "number") {
        errors.push(`${path}.cells[${k}] needs numeric {q,r}`);
      }
    });
  }
  return errors;
}

export function validateEnd(end: any): string[] {
  if (end === undefined) return [];
  if (!end || typeof end !== "object") return ["ruleSet.end must be an object"];
  const errors: string[] = [];
  if (end.condition !== undefined && !END_CONDITIONS.includes(end.condition)) {
    errors.push(`ruleSet.end.condition "${end.condition}" unknown (available: ${END_CONDITIONS.join(", ")})`);
  }
  if (end.action !== undefined && !END_ACTIONS.includes(end.action)) {
    errors.push(`ruleSet.end.action "${end.action}" unknown (available: ${END_ACTIONS.join(", ")})`);
  }
  return errors;
}

/** Full ruleSet check for rule bases and replayed results. */
export function validateRuleSet(rs: any, tiling: TilingDef | null): string[] {
  const errors: string[] = [];
  if (!rs || typeof rs !== "object") return ["ruleSet must be an object"];
  if (!rs.id) errors.push("ruleSet.id missing");
  if (!Array.isArray(rs.moves)) errors.push("ruleSet.moves must be array");
  else rs.moves.forEach((mr: MoveRule, idx: number) => {
    for (const e of validateMoveRule(mr, idx, tiling)) errors.push(e);
  });
  for (const e of validateTurns(rs.turns)) errors.push(e);
  if (!Array.isArray(rs.outcomes)) errors.push("ruleSet.outcomes must be array");
  else {
    const regionIds = new Set<string>([
      ...(Array.isArray(rs.regions) ? rs.regions.map((r: any) => r?.id).filter((id: any) => typeof id === "string") : []),
    ]);
    rs.outcomes.forEach((o: any, i: number) => {
      for (const e of validateOutcome(o, i, regionIds)) errors.push(e);
    });
  }
  if (rs.regions !== undefined) {
    if (!Array.isArray(rs.regions)) errors.push("ruleSet.regions must be an array");
    else {
      const seen = new Set<string>();
      rs.regions.forEach((r: any, i: number) => {
        for (const e of validateRegion(r, i)) errors.push(e);
        if (r && typeof r.id === "string" && r.id) {
          if (seen.has(r.id)) errors.push(`duplicate region "${r.id}"`);
          else seen.add(r.id);
        }
      });
    }
  }
  for (const e of validateEnd(rs.end)) errors.push(e);
  return errors;
}

/** Deep clone: rule morphs never mutate their input. */
export function cloneRuleSet(rs: RuleSet): RuleSet {
  return JSON.parse(JSON.stringify(rs));
}

/** Canonical JSON with sorted keys; array order is significant and kept. */
function canonicalize(v: any): any {
  if (Array.isArray(v)) return v.map(canonicalize);
  if (v && typeof v === "object") {
    const out: Record<string, any> = {};
    for (const k of Object.keys(v).sort()) out[k] = canonicalize(v[k]);
    return out;
  }
  return v;
}

/** Compare two rule sets, order-insensitively for fields. Null means equal. */
export function ruleSetsEqual(a: RuleSet, b: RuleSet): string | null {
  const sa = JSON.stringify(canonicalize(a));
  const sb = JSON.stringify(canonicalize(b));
  if (sa === sb) return null;
  const ka = Object.keys(a ?? {});
  const kb = Object.keys(b ?? {});
  const onlyA = ka.filter(k => !kb.includes(k));
  const onlyB = kb.filter(k => !ka.includes(k));
  if (onlyA.length > 0 || onlyB.length > 0) {
    return `rule fields differ (only in replayed: ${onlyA.join(",") || "none"}; only in cached: ${onlyB.join(",") || "none"})`;
  }
  for (const k of ka) {
    if (JSON.stringify(canonicalize((a as any)[k])) !== JSON.stringify(canonicalize((b as any)[k]))) {
      return `rule field "${k}" differs from cached snapshot`;
    }
  }
  return "rules differ from cached snapshot";
}

/**
 * Resolve a tiling for rule validation; null skips direction-name checks.
 * Unknown ids resolve to null (never to a fallback tiling's directions).
 */
export function tilingForRules(tilingId: unknown): TilingDef | null {
  if (typeof tilingId !== "string" || !tilingId) return null;
  if (!(tilingId in TILINGS)) return null;
  return getTiling(tilingId);
}

// NOTE: shared domain types (MoveRule, RuleSet, ...) stay exported from
// ./types only; re-exporting them here would make them ambiguous through
// the framework index's `export *` surface.
