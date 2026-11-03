// ---------- Grid morph vocabulary: generic occupant + dimension edits ----------
// Mechanism, not app vocabulary: any Grid app (spreadsheet, sequencer/player,
// chat) assembles its occupants through these morphs, so a stored plan's
// morph chain replays to the same board in every shell. App-specific aliases
// (e.g. sheet.setCell) remain for history readability; they share the same
// upsert/remove semantics.
import type { Occupant } from "../types";
import { checkPlacement, removeOccupant, upsertOccupant } from "../editing";
import { needPrevFrame, registerMorph, type MorphContext, type PlanState } from "./registry";

const isPos = (v: unknown): v is { q: number; r: number } =>
  !!v && typeof (v as any).q === "number" && typeof (v as any).r === "number";

function validateOcc(o: unknown): string[] {
  const occ = o as Occupant;
  if (!occ || typeof occ.id !== "string" || !occ.id) return ["occ.id must be a non-empty string"];
  if (!isPos(occ.anchor)) return [`occ "${occ.id}" needs a numeric anchor {q,r}`];
  return [];
}



function needFrame(undoCtx: unknown, morph: string): { prev?: Occupant | null } {
  return needPrevFrame<Occupant>(undoCtx, morph);
}

function capturePrev(state: PlanState, id: string): { prev: Occupant | null } {
  return { prev: state.occupants.find(o => o.id === id) ?? null };
}

registerMorph<{ occ: Occupant }>({
  name: "grid.upsertOccupant",
  describe: "Place or replace one grid occupant",
  invertible: true,
  validate: (p, _ctx: MorphContext) => {
    if (!p || typeof p !== "object") return ["params must be { occ }"];
    return validateOcc((p as { occ: Occupant }).occ);
  },
  check: (state, p) => checkPlacement(state, p.occ),
  capture: (state, p) => capturePrev(state, p.occ.id),
  apply: (state: PlanState, p: { occ: Occupant }) => ({
    ...state,
    occupants: upsertOccupant(state.occupants, p.occ),
  }),
  invert: (state: PlanState, p: { occ: Occupant }, undoCtx: unknown) => {
    const { prev } = needFrame(undoCtx, "grid.upsertOccupant");
    if (prev) return { ...state, occupants: upsertOccupant(state.occupants, prev) };
    return { ...state, occupants: removeOccupant(state.occupants, p.occ.id) };
  },
});

registerMorph<{ id: string }>({
  name: "grid.removeOccupant",
  describe: "Remove one grid occupant",
  invertible: true,
  validate: (p, _ctx: MorphContext) => {
    if (!p || typeof (p as { id: string }).id !== "string" || !(p as { id: string }).id) {
      return ["params must be { id }"];
    }
    return [];
  },
  check: (state, p) =>
    state.occupants.some(o => o.id === p.id) ? [] : [`occupant "${p.id}" is not present`],
  capture: (state, p) => capturePrev(state, p.id),
  apply: (state: PlanState, p: { id: string }) => ({
    ...state,
    occupants: removeOccupant(state.occupants, p.id),
  }),
  invert: (state: PlanState, _p: { id: string }, undoCtx: unknown) => {
    const { prev } = needFrame(undoCtx, "grid.removeOccupant");
    if (!prev) return state;
    return { ...state, occupants: upsertOccupant(state.occupants, prev) };
  },
});

registerMorph<{ width: number; height: number }>({
  name: "grid.resize",
  describe: "Resize the grid dimensions",
  invertible: true,
  validate: (p, _ctx: MorphContext) => {
    if (!p || typeof p !== "object") return ["params must be { width, height }"];
    const { width, height } = p as { width: number; height: number };
    const errs: string[] = [];
    if (!Number.isInteger(width) || width < 1 || width > 64)
      errs.push("width must be an integer in 1..64");
    if (!Number.isInteger(height) || height < 1 || height > 64)
      errs.push("height must be an integer in 1..64");
    return errs;
  },
  apply: (state: PlanState, p: { width: number; height: number }) => ({
    ...state,
    width: p.width,
    height: p.height,
  }),
  capture: (state) => ({ prevWidth: state.width, prevHeight: state.height }),
  invert: (state: PlanState, _p: { width: number; height: number }, undoCtx: unknown) => {
    const prev = undoCtx as { prevWidth?: number; prevHeight?: number } | undefined;
    if (typeof prev?.prevWidth !== "number" || typeof prev?.prevHeight !== "number") {
      throw new Error("grid.resize has no inverse data; cannot invert");
    }
    return { ...state, width: prev.prevWidth, height: prev.prevHeight };
  },
});
