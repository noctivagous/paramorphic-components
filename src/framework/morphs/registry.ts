// ---------- Morph registry: named, reversible plan transformations ----------
// Runtime from README 9.1. A stored plan is still loadable as a state
// snapshot, but the principled form is a base plus a morph sequence, replayed
// here. Each morph is pure (never mutates its input) and either invertible or
// explicitly marked otherwise; non-invertible morphs carry the sub-state they
// need inside the undo frame (see AppliedMorph.inverse).
import type { Occupant } from "../types";
import type { TraversalCursor } from "../traversal";

export type PlanState = {
  occupants: Occupant[];
  width: number;
  height: number;
  /**
   * Second state shape: a traversal cursor rides along opaquely. Grid
   * morphs preserve it untouched via spread; cursor morphs own it. History
   * snapshots carry it, so recorded seeks undo like any morph; plan files
   * never persist it — load resets it to the path start.
   */
  cursor?: TraversalCursor | null;
};

export type MorphContext = {
  tilingId?: string;
  width?: number;
  height?: number;
};

export type MorphDef<P = unknown> = {
  name: string;
  describe: string;
  /** False when popping this morph must fall back to a snapshot restore. */
  invertible: boolean;
  validate: (params: P, ctx: MorphContext) => string[];
  /**
   * State-dependent applicability: does this morph make sense against this
   * exact state (anchor in bounds, target occupant present)? Used when
   * testing a candidate morph and when replaying dependent steps after an
   * earlier morph is removed or replaced. Absent means always applicable
   * once validated.
   */
  check?: (state: PlanState, params: P, ctx: MorphContext) => string[];
  /**
   * Capture the inverse frame for applying these params to this state, so a
   * later undo restores exactly the pre-step sub-state. Used to re-derive
   * frames after chain surgery and on plan load, where stored frames may be
   * stale or hand-written. Absent means frames cannot be re-derived.
   */
  capture?: (state: PlanState, params: P) => unknown;
  apply: (state: PlanState, params: P) => PlanState;
  /**
   * Only called when invertible. undoCtx is AppliedMorph.inverse. Throw when
   * the undo frame is absent or unusable so the caller falls back to a
   * snapshot restore instead of guessing — a faulty inverse must never
   * silently claim success.
   */
  invert: (state: PlanState, params: P, undoCtx: unknown) => PlanState;
};

export type AppliedMorph<P = unknown> = {
  name: string;
  params: P;
  /** Sub-state captured at apply time for a faithful inverse (Q4 policy). */
  inverse?: unknown;
};

/**
 * Shared strict frame reader: an absent or content-free undo frame is a
 * failure, never a guess. In particular `{}` carries no `prev` key and must
 * not be read as "nothing was there" — that reading can delete a replaced
 * occupant. Throw so the caller falls back to a snapshot restore.
 */
export function needPrevFrame<T>(undoCtx: unknown, morph: string): { prev?: T | null } {
  if (!undoCtx || typeof undoCtx !== "object" || !("prev" in (undoCtx as Record<string, unknown>))) {
    throw new Error(`${morph} has no inverse data; cannot invert`);
  }
  return undoCtx as { prev?: T | null };
}

const REGISTRY = new Map<string, MorphDef<any>>();

export function registerMorph<P>(def: MorphDef<P>): void {
  if (REGISTRY.has(def.name)) throw new Error(`Morph "${def.name}" already registered`);
  REGISTRY.set(def.name, def as MorphDef<any>);
}

export function getMorph(name: string): MorphDef<any> | undefined {
  return REGISTRY.get(name);
}

/** Introspection: what can be morphed next (README 9.1, principle 5). */
export function listMorphs(): MorphDef<any>[] {
  return [...REGISTRY.values()];
}

/** Introspection: what has been morphed so far, in human terms. */
export function describeChain(chain: AppliedMorph[]): string[] {
  return chain.map((m, i) => {
    const def = REGISTRY.get(m.name);
    return `${i + 1}. ${def ? def.describe : m.name} ${JSON.stringify(m.params)}`;
  });
}

/** Validate a stored morph sequence without running it. AI-actionable errors. */
export function validateChain(chain: unknown, ctx: MorphContext = {}): string[] {
  if (!Array.isArray(chain)) return ["plan.morphs must be an array"];
  const errors: string[] = [];
  chain.forEach((m: any, i: number) => {
    if (!m || typeof m.name !== "string") {
      errors.push(`morphs[${i}] missing name`);
      return;
    }
    const def = REGISTRY.get(m.name);
    if (!def) {
      errors.push(
        `morphs[${i}] unknown morph "${m.name}" (available: ${[...REGISTRY.keys()].join(", ") || "none"})`
      );
      return;
    }
    for (const e of def.validate(m.params, ctx)) errors.push(`morphs[${i}] (${m.name}): ${e}`);
  });
  return errors;
}

export function applyMorph(
  state: PlanState,
  applied: AppliedMorph,
  ctx: MorphContext = {}
): { ok: true; state: PlanState } | { ok: false; errors: string[] } {
  const def = REGISTRY.get(applied.name);
  if (!def) {
    return {
      ok: false,
      errors: [`unknown morph "${applied.name}" (available: ${[...REGISTRY.keys()].join(", ") || "none"})`],
    };
  }
  const errs = def.validate(applied.params, ctx);
  if (errs.length > 0) return { ok: false, errors: errs };
  return { ok: true, state: def.apply(state, applied.params) };
}

/** Replay a morph sequence over a base state. Pure; base is never mutated. */
export function replayMorphs(
  base: PlanState,
  chain: AppliedMorph[],
  ctx: MorphContext = {}
): { ok: true; state: PlanState } | { ok: false; errors: string[] } {
  let state: PlanState = { occupants: [...base.occupants], width: base.width, height: base.height };
  for (let i = 0; i < chain.length; i++) {
    const res = applyMorph(state, chain[i], ctx);
    if (!res.ok) return { ok: false, errors: res.errors.map(e => `morphs[${i}]: ${e}`) };
    state = res.state;
  }
  return { ok: true, state };
}

/**
 * True paramorphic undo: pop one applied morph via its inverse. Returns null
 * when the morph is unknown or not invertible, so the caller can fall back to
 * a snapshot restore (the pragmatic stand-in, kept deliberately).
 */
export function invertMorph(state: PlanState, applied: AppliedMorph): PlanState | null {
  const def = REGISTRY.get(applied.name);
  if (!def || !def.invertible) return null;
  try {
    return def.invert(state, applied.params, applied.inverse);
  } catch {
    return null;
  }
}

/**
 * Is a candidate morph applicable to this exact state? Reports the unknown
 * morph, the parameter errors, and the state-dependent errors together, so a
 * human or AI can act on the message. An empty array means applicable.
 */
export function checkMorphState(
  name: string,
  state: PlanState,
  params: unknown,
  ctx: MorphContext = {}
): string[] {
  const def = REGISTRY.get(name);
  if (!def) {
    return [`unknown morph "${name}" (available: ${[...REGISTRY.keys()].join(", ") || "none"})`];
  }
  const errors = def.validate(params, ctx).map(e => `${name}: ${e}`);
  if (errors.length > 0) return errors;
  if (def.check) {
    for (const e of def.check(state, params, ctx)) errors.push(`${name}: ${e}`);
  }
  return errors;
}

/**
 * Replay with per-step state checks: each step must validate AND apply to
 * the exact intermediate state. This is the load path — ordinary replay
 * without checks is not sufficient to accept a stored chain.
 */
export function replayMorphsChecked(
  base: PlanState,
  chain: AppliedMorph[],
  ctx: MorphContext = {}
): { ok: true; state: PlanState } | { ok: false; errors: string[] } {
  let state: PlanState = { occupants: [...base.occupants], width: base.width, height: base.height };
  for (let i = 0; i < chain.length; i++) {
    const stepErrors = checkMorphState(chain[i].name, state, chain[i].params, ctx);
    if (stepErrors.length > 0) {
      return { ok: false, errors: stepErrors.map(e => `morphs[${i}]: ${e}`) };
    }
    const def = REGISTRY.get(chain[i].name);
    if (!def) return { ok: false, errors: [`morphs[${i}]: unknown morph "${chain[i].name}"`] };
    state = def.apply(state, chain[i].params);
  }
  return { ok: true, state };
}

/**
 * Re-derive every step's inverse frame by walking the chain from the base.
 * After surgery (or on load, where frames may be hand-written), a stored
 * frame can describe a pre-step state that no longer occurs — and undo would
 * silently restore it. Steps whose morph cannot capture drop their frame so
 * undo falls back to the snapshot instead of trusting a stale one.
 */
export function recaptureFrames(
  base: PlanState,
  chain: AppliedMorph[],
  _ctx: MorphContext = {}
): AppliedMorph[] {
  let state: PlanState = { occupants: [...base.occupants], width: base.width, height: base.height };
  return chain.map((m) => {
    const def = REGISTRY.get(m.name);
    let inverse: unknown = undefined;
    if (def?.capture) {
      try {
        inverse = def.capture(state, m.params);
      } catch {
        inverse = undefined;
      }
    } else if (!def) {
      inverse = m.inverse;
    }
    if (def) {
      try {
        state = def.apply(state, m.params);
      } catch {
        // Leave the state as-is; the checked replay reports the failure.
      }
    }
    return { ...m, inverse };
  });
}

/**
 * Remove an earlier morph and replay the dependent steps over the base.
 * A later step that no longer applies (for example it removes the occupant
 * the deleted step created) is reported as a conflict with its step index —
 * the chain is left unchanged for the caller to resolve.
 */
export function removeMorphAt(
  base: PlanState,
  chain: AppliedMorph[],
  index: number,
  ctx: MorphContext = {}
): { ok: true; state: PlanState; chain: AppliedMorph[] } | { ok: false; errors: string[] } {
  if (!Number.isInteger(index) || index < 0 || index >= chain.length) {
    return { ok: false, errors: [`no morph at index ${index} (chain has ${chain.length})`] };
  }
  const next = recaptureFrames(base, chain.filter((_, i) => i !== index), ctx);
  const replayed = replayMorphsChecked(base, next, ctx);
  if (!replayed.ok) {
    return {
      ok: false,
      errors: [`removing morphs[${index}] (${chain[index].name}) breaks dependents:`, ...replayed.errors],
    };
  }
  return { ok: true, state: replayed.state, chain: next };
}

/**
 * Replace an earlier morph and replay the dependent steps. Same conflict
 * reporting as removal when a later step stops applying.
 */
export function replaceMorphAt(
  base: PlanState,
  chain: AppliedMorph[],
  index: number,
  replacement: AppliedMorph,
  ctx: MorphContext = {}
): { ok: true; state: PlanState; chain: AppliedMorph[] } | { ok: false; errors: string[] } {
  if (!Number.isInteger(index) || index < 0 || index >= chain.length) {
    return { ok: false, errors: [`no morph at index ${index} (chain has ${chain.length})`] };
  }
  if (!replacement || typeof replacement.name !== "string") {
    return { ok: false, errors: ["replacement morph needs a name"] };
  }
  if (!REGISTRY.get(replacement.name)) {
    return { ok: false, errors: [`unknown morph "${replacement.name}"`] };
  }
  const next = recaptureFrames(base, chain.map((m, i) => (i === index ? replacement : m)), ctx);
  const replayed = replayMorphsChecked(base, next, ctx);
  if (!replayed.ok) {
    return {
      ok: false,
      errors: [`replacing morphs[${index}] with ${replacement.name} breaks dependents:`, ...replayed.errors],
    };
  }
  return { ok: true, state: replayed.state, chain: next };
}
