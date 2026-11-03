// ---------- History: one stack where snapshot and morph travel together ----------
// Undo used to keep two parallel stacks (snapshots and morphs) that could
// diverge: a step with no morph left the morph stack short, so a later undo
// inverted the wrong morph. Steps now travel together, which makes that
// misalignment unrepresentable: every entry holds the pre-step snapshot and
// the morph that produced the step, or null when no morph covers it.
// Pure functions, so the shell stays thin and the divergence case is testable.
import type { Occupant } from "./types";
import { applyMorph, invertMorph, type AppliedMorph } from "./morphs/registry";

export type HistoryStep = { snapshot: Occupant[]; morph: AppliedMorph | null };

export function pushHistory(
  past: HistoryStep[],
  snapshot: Occupant[],
  morph: AppliedMorph | null,
  cap = 50
): HistoryStep[] {
  return [...past.slice(-(cap - 1)), { snapshot, morph }];
}

export type UndoOutcome = {
  occupants: Occupant[];
  past: HistoryStep[];
  future: HistoryStep[];
  undone: boolean;
};

export function undoHistory(
  past: HistoryStep[],
  future: HistoryStep[],
  current: Occupant[],
  dims: { width: number; height: number }
): UndoOutcome {
  const top = past[past.length - 1];
  if (!top) return { occupants: current, past, future, undone: false };
  const inverted = top.morph ? invertMorph({ occupants: current, ...dims }, top.morph) : null;
  return {
    occupants: inverted ? inverted.occupants : top.snapshot,
    past: past.slice(0, -1),
    future: [{ snapshot: current, morph: top.morph }, ...future].slice(0, 50),
    undone: true,
  };
}

export type RedoOutcome = {
  occupants: Occupant[];
  past: HistoryStep[];
  future: HistoryStep[];
  redone: boolean;
};

export function redoHistory(
  past: HistoryStep[],
  future: HistoryStep[],
  current: Occupant[],
  dims: { width: number; height: number }
): RedoOutcome {
  const [top, ...rest] = future;
  if (!top) return { occupants: current, past, future, redone: false };
  const res = top.morph ? applyMorph({ occupants: current, ...dims }, top.morph) : null;
  if (res && res.ok) {
    return {
      occupants: res.state.occupants,
      past: pushHistory(past, current, top.morph),
      future: rest,
      redone: true,
    };
  }
  // Morph no longer applies (or the step was snapshot-only): restore the snapshot.
  return {
    occupants: top.snapshot,
    past: pushHistory(past, current, null),
    future: rest,
    redone: true,
  };
}
