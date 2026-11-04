// ---------- Sheet morph vocabulary: the spreadsheet's actual edits ----------
// First vocabulary over the morph registry. Covers the cell writes the undo
// stack records (see commitCellText in presentations.ts + App push). Resize, file open
// and reload clear the chain instead: they replace the base, so there is no
// morph to pop and the snapshot path owns them.
import type { Occupant } from "../types";
import { checkPlacement, removeOccupant, upsertOccupant } from "../editing";
import { needPrevFrame, registerMorph, type MorphContext, type PlanState } from "./registry";

type CellRef = { id: string };
type SetCellParams = { occ: Occupant };

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

registerMorph<SetCellParams>({
  name: "sheet.setCell",
  describe: "Write or replace one cell occupant",
  invertible: true,
  validate: (p, _ctx: MorphContext) => {
    if (!p || typeof p !== "object") return ["params must be { occ }"];
    return validateOcc((p as SetCellParams).occ);
  },
  check: (state, p) => checkPlacement(state, p.occ),
  capture: (state, p) => capturePrev(state, p.occ.id),
  apply: (state: PlanState, p: SetCellParams) => ({
    ...state,
    occupants: upsertOccupant(state.occupants, p.occ),
  }),
  invert: (state: PlanState, p: SetCellParams, undoCtx: unknown) => {
    const { prev } = needFrame(undoCtx, "sheet.setCell");
    if (prev) return { ...state, occupants: upsertOccupant(state.occupants, prev) };
    return { ...state, occupants: removeOccupant(state.occupants, p.occ.id) };
  },
});

registerMorph<CellRef>({
  name: "sheet.clearCell",
  describe: "Remove one cell occupant",
  invertible: true,
  validate: (p, _ctx: MorphContext) => {
    if (!p || typeof (p as CellRef).id !== "string" || !(p as CellRef).id) {
      return ["params must be { id }"];
    }
    return [];
  },
  check: (state, p) =>
    state.occupants.some(o => o.id === p.id) ? [] : [`occupant "${p.id}" is not present`],
  capture: (state, p) => capturePrev(state, p.id),
  apply: (state: PlanState, p: CellRef) => ({
    ...state,
    occupants: removeOccupant(state.occupants, p.id),
  }),
  invert: (state: PlanState, _p: CellRef, undoCtx: unknown) => {
    const { prev } = needFrame(undoCtx, "sheet.clearCell");
    if (!prev) return state;
    return { ...state, occupants: upsertOccupant(state.occupants, prev) };
  },
});
