// ---------- Morph registry: the Grid-scope instance of the shared core ----------
// The single implementation lives in `./scoped.ts` (`createMorphRegistry<S>`).
// This module is the PlanState scope instance over that core — one scoped map
// for every Grid vocabulary (grid, sheet, player, cursor, Grid-hosted tree).
// Disjoint scopes (TreeState in `tree2.ts`) create their own instance from the
// same factory, so registration, validation, replay, undo, and chain surgery
// share one contract. The exported names here are unchanged, so shells and
// the verify script keep working while running on the shared machinery.
import { createMorphRegistry } from "./scoped";
import type { ScopedMorphDef } from "./scoped";
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

export type MorphDef<P = unknown> = Omit<ScopedMorphDef<PlanState, P>, "validate" | "check" | "capture" | "apply" | "invert"> & {
  validate: (params: P, ctx: MorphContext) => string[];
  check?: (state: PlanState, params: P, ctx: MorphContext) => string[];
  capture?: (state: PlanState, params: P) => unknown;
  apply: (state: PlanState, params: P) => PlanState;
  invert: (state: PlanState, params: P, undoCtx: unknown) => PlanState;
};

export type AppliedMorph<P = unknown> = {
  name: string;
  params: P;
  /** Sub-state captured at apply time for a faithful inverse (Q4 policy). */
  inverse?: unknown;
};

export const clonePlanState = (s: PlanState): PlanState => ({
  ...s,
  occupants: [...s.occupants],
});

/** The shared Grid-scope registry all Grid vocabularies register into. */
export const gridRegistry = createMorphRegistry<PlanState>();

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

export function registerMorph<P>(def: MorphDef<P>): void {
  gridRegistry.register(def as ScopedMorphDef<PlanState, P>);
}

export function getMorph(name: string): MorphDef<any> | undefined {
  return gridRegistry.get(name) as MorphDef<any> | undefined;
}

/** Introspection: what can be morphed next (README 9.1, principle 5). */
export function listMorphs(): MorphDef<any>[] {
  return gridRegistry.list() as MorphDef<any>[];
}

/** Introspection: what has been applied so far, in human terms. */
export function describeChain(chain: AppliedMorph[]): string[] {
  return gridRegistry.describeChain(chain);
}

/** Validate a stored morph sequence without running it. AI-actionable errors. */
export function validateChain(chain: unknown, ctx: MorphContext = {}): string[] {
  return gridRegistry.validateChain(chain, ctx);
}

export function applyMorph(
  state: PlanState,
  applied: AppliedMorph,
  ctx: MorphContext = {}
): { ok: true; state: PlanState } | { ok: false; errors: string[] } {
  return gridRegistry.applyMorph(state, applied, ctx);
}

/** Replay a morph sequence over a base state. Pure; base is never mutated. */
export function replayMorphs(
  base: PlanState,
  chain: AppliedMorph[],
  ctx: MorphContext = {}
): { ok: true; state: PlanState } | { ok: false; errors: string[] } {
  return gridRegistry.replayMorphs(base, chain, ctx, clonePlanState);
}

/**
 * True paramorphic undo: pop one applied morph via its inverse. Returns null
 * when the morph is unknown or not invertible, so the caller can fall back to
 * a snapshot restore (the pragmatic stand-in, kept deliberately).
 */
export function invertMorph(state: PlanState, applied: AppliedMorph): PlanState | null {
  return gridRegistry.invertMorph(state, applied);
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
  return gridRegistry.checkMorphState(name, state, params, ctx);
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
  return gridRegistry.replayMorphsChecked(base, chain, ctx, clonePlanState);
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
  return gridRegistry.recaptureFrames(base, chain, clonePlanState);
}

/**
 * Remove an earlier morph and replay the dependent steps over the base.
 * Shared chain surgery from the scoped core; conflicts report the step index
 * and leave the chain unchanged for the caller to resolve.
 */
export function removeMorphAt(
  base: PlanState,
  chain: AppliedMorph[],
  index: number,
  ctx: MorphContext = {}
): { ok: true; state: PlanState; chain: AppliedMorph[] } | { ok: false; errors: string[] } {
  return gridRegistry.removeAt(base, chain, index, ctx, clonePlanState);
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
  return gridRegistry.replaceAt(base, chain, index, replacement, ctx, clonePlanState);
}
