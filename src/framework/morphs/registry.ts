// ---------- Morph registry: named, reversible plan transformations ----------
// Runtime from README 9.1. A stored plan is still loadable as a state
// snapshot, but the principled form is a base plus a morph sequence, replayed
// here. Each morph is pure (never mutates its input) and either invertible or
// explicitly marked otherwise; non-invertible morphs carry the sub-state they
// need inside the undo frame (see AppliedMorph.inverse).
import type { Occupant } from "../types";

export type PlanState = {
  occupants: Occupant[];
  width: number;
  height: number;
};

export type MorphContext = {
  tilingId?: string;
};

export type MorphDef<P = unknown> = {
  name: string;
  describe: string;
  /** False when popping this morph must fall back to a snapshot restore. */
  invertible: boolean;
  validate: (params: P, ctx: MorphContext) => string[];
  apply: (state: PlanState, params: P) => PlanState;
  /** Only called when invertible. undoCtx is AppliedMorph.inverse. */
  invert: (state: PlanState, params: P, undoCtx: unknown) => PlanState;
};

export type AppliedMorph<P = unknown> = {
  name: string;
  params: P;
  /** Sub-state captured at apply time for a faithful inverse (Q4 policy). */
  inverse?: unknown;
};

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
