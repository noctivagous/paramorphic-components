// ---------- Key morph vocabulary: the keyboard's layout edits ----------
// The keyboard shell records layout changes through these morphs — never
// through grid.* or sheet.* — so a keyboard plan reads as key definitions.
// Wide keys (Space, Shift, Enter, Tab) are multi-cell occupants via span;
// staggered rows are a view-only offset (GridViewport stagger), never state.
// Live presses are session feedback (flash + tone) and are not recorded,
// saved, or undone — exactly like player seeks. Registered on the shared
// PlanState grid scope, so validation, replay, undo, and chain surgery run
// through the same scoped core as every other Grid app.
import type { Occupant } from "../types";
import { checkPlacement, removeOccupant, upsertOccupant } from "../editing";
import { needPrevFrame, registerMorph, type MorphContext, type PlanState } from "./registry";

const isPos = (v: unknown): v is { q: number; r: number } =>
  !!v && typeof (v as any).q === "number" && typeof (v as any).r === "number";

function validateKey(o: unknown): string[] {
  const occ = o as Occupant;
  if (!occ || typeof occ.id !== "string" || !occ.id) return ["occ.id must be a non-empty string"];
  if (occ.type !== "key") return [`occ "${occ.id}" must be type "key" (got "${(occ as any).type}")`];
  if (!isPos(occ.anchor)) return [`occ "${occ.id}" needs a numeric anchor {q,r}`];
  const data = (occ.data ?? {}) as Record<string, unknown>;
  if (typeof data.label !== "string" || !data.label) return [`occ "${occ.id}" needs a label`];
  return [];
}

function needFrame(undoCtx: unknown, morph: string): { prev?: Occupant | null } {
  return needPrevFrame<Occupant>(undoCtx, morph);
}

function capturePrev(state: PlanState, id: string): { prev: Occupant | null } {
  return { prev: state.occupants.find(o => o.id === id) ?? null };
}

registerMorph<{ occ: Occupant }>({
  name: "key.define",
  describe: "Define or replace one keyboard key",
  invertible: true,
  validate: (p, _ctx: MorphContext) => {
    if (!p || typeof p !== "object") return ["params must be { occ }"];
    return validateKey((p as { occ: Occupant }).occ);
  },
  check: (state, p) => checkPlacement(state, p.occ),
  capture: (state, p) => capturePrev(state, p.occ.id),
  apply: (state: PlanState, p: { occ: Occupant }) => ({
    ...state,
    occupants: upsertOccupant(state.occupants, p.occ),
  }),
  invert: (state: PlanState, p: { occ: Occupant }, undoCtx: unknown) => {
    const { prev } = needFrame(undoCtx, "key.define");
    if (prev) return { ...state, occupants: upsertOccupant(state.occupants, prev) };
    return { ...state, occupants: removeOccupant(state.occupants, p.occ.id) };
  },
});

registerMorph<{ id: string }>({
  name: "key.remove",
  describe: "Remove one keyboard key",
  invertible: true,
  validate: (p, _ctx: MorphContext) => {
    if (!p || typeof (p as { id: string }).id !== "string" || !(p as { id: string }).id) {
      return ["params must be { id }"];
    }
    return [];
  },
  check: (state, p) =>
    state.occupants.some(o => o.id === p.id) ? [] : [`key "${p.id}" is not present`],
  capture: (state, p) => capturePrev(state, p.id),
  apply: (state: PlanState, p: { id: string }) => ({
    ...state,
    occupants: removeOccupant(state.occupants, p.id),
  }),
  invert: (state: PlanState, _p: { id: string }, undoCtx: unknown) => {
    const { prev } = needFrame(undoCtx, "key.remove");
    if (!prev) return state;
    return { ...state, occupants: upsertOccupant(state.occupants, prev) };
  },
});
