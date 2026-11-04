// ---------- History: one stack where snapshot and morph travel together ----------
// Undo used to keep two parallel stacks (snapshots and morphs) that could
// diverge: a step with no morph left the morph stack short, so a later undo
// inverted the wrong morph. Steps now travel together, which makes that
// misalignment unrepresentable: every entry holds the pre-step snapshot and
// the morph that produced the step, or null when no morph covers it.
// Snapshots are whole states: the cursor (or any later state shape) travels
// with the board, so its morphs undo through the same contract. The generic
// factory below is the single implementation; the PlanState functions are its
// Grid-scope instance. Pure functions, so shells stay thin and the divergence
// case is testable.
import { applyMorph, invertMorph, type AppliedMorph, type PlanState } from "./morphs/registry";
import type { ScopedAppliedMorph } from "./morphs/scoped";

export type GenericHistoryStep<S, M = ScopedAppliedMorph> = { snapshot: S; morph: M | null };

/**
 * Single history implementation shared by every state scope. The Grid scope
 * instantiates it over PlanState below; disjoint scopes (TreeState) reuse it
 * with their own apply/invert. Snapshot fallback on missing or stale inverse
 * frames is the shared Q4 policy.
 */
export function createHistory<S, M extends ScopedAppliedMorph = ScopedAppliedMorph>(opts: {
  apply: (state: S, morph: M) => { ok: true; state: S } | { ok: false; errors: string[] };
  invert: (state: S, morph: M) => S | null;
  cap?: number;
}) {
  const cap = opts.cap ?? 50;
  type Step = GenericHistoryStep<S, M>;
  return {
    push(past: Step[], snapshot: S, morph: M | null, capOverride?: number): Step[] {
      const c = capOverride ?? cap;
      return [...past.slice(-(c - 1)), { snapshot, morph }];
    },
    undo(
      past: Step[],
      future: Step[],
      current: S
    ): { state: S; past: Step[]; future: Step[]; undone: boolean } {
      const top = past[past.length - 1];
      if (!top) return { state: current, past, future, undone: false };
      const inverted = top.morph ? opts.invert(current, top.morph) : null;
      return {
        state: inverted ?? top.snapshot,
        past: past.slice(0, -1),
        future: [{ snapshot: current, morph: top.morph }, ...future].slice(0, cap),
        undone: true,
      };
    },
    redo(
      past: Step[],
      future: Step[],
      current: S
    ): { state: S; past: Step[]; future: Step[]; redone: boolean } {
      const [top, ...rest] = future;
      if (!top) return { state: current, past, future, redone: false };
      const res = top.morph ? opts.apply(current, top.morph) : null;
      if (res && res.ok) {
        return {
          state: res.state,
          past: this.push(past, current, top.morph),
          future: rest,
          redone: true,
        };
      }
      // Morph no longer applies (or the step was snapshot-only): restore the snapshot.
      return {
        state: top.snapshot,
        past: this.push(past, current, null),
        future: rest,
        redone: true,
      };
    },
  };
}

const planHistory = createHistory<PlanState, AppliedMorph>({
  apply: (state, morph) => applyMorph(state, morph),
  invert: (state, morph) => invertMorph(state, morph),
});

export type HistoryStep = GenericHistoryStep<PlanState, AppliedMorph>;

export function pushHistory(
  past: HistoryStep[],
  snapshot: PlanState,
  morph: AppliedMorph | null,
  cap = 50
): HistoryStep[] {
  return planHistory.push(past, snapshot, morph, cap);
}

export type UndoOutcome = {
  state: PlanState;
  past: HistoryStep[];
  future: HistoryStep[];
  undone: boolean;
};

export function undoHistory(
  past: HistoryStep[],
  future: HistoryStep[],
  current: PlanState
): UndoOutcome {
  return planHistory.undo(past, future, current);
}

export type RedoOutcome = {
  state: PlanState;
  past: HistoryStep[];
  future: HistoryStep[];
  redone: boolean;
};

export function redoHistory(
  past: HistoryStep[],
  future: HistoryStep[],
  current: PlanState
): RedoOutcome {
  return planHistory.redo(past, future, current);
}
