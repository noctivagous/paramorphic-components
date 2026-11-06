// ---------- Sheet morph vocabulary: the spreadsheet's actual edits ----------
// First vocabulary over the morph registry. Covers the cell writes the undo
// stack records (see commitCellText in presentations.ts + App push). Resize, file open
// and reload clear the chain instead: they replace the base, so there is no
// morph to pop and the snapshot path owns them.
import type { Occupant } from "../types";
import { checkPlacement, removeOccupant, upsertOccupant } from "../editing";
import {
  deleteCols,
  deleteRows,
  insertCols,
  insertRows,
  type SheetGridState,
} from "./sheet-ops";
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

// ---------- Bulk + grid-shape vocabulary (spreadsheet adaptation) ----------
// sheet.setCells is the one-undo-step form of many setCell/clearCell edits
// (fill, paste, sort, style, clear-range). Its inverse frame is a snapshot
// of the previous occupant list — the same snapshot-fallback policy the
// registry documents, made explicit because a bulk step's per-cell frames
// would be larger and easier to get wrong.
// The axis morphs wrap the pure sheet-ops insert/delete functions: they
// change width/height as well as occupants, and their frames snapshot the
// whole previous grid state for the same reason.

type SetCellsParams = { set: Occupant[]; clear: string[] };

registerMorph<SetCellsParams>({
  name: "sheet.setCells",
  describe: "Write and/or clear many cell occupants as one step",
  invertible: true,
  validate: (p, _ctx: MorphContext) => {
    if (!p || typeof p !== "object") return ["params must be { set, clear }"];
    const errors: string[] = [];
    if (!Array.isArray(p.set)) errors.push("set must be an array of occupants");
    else for (const o of p.set) errors.push(...validateOcc(o));
    if (!Array.isArray(p.clear) || p.clear.some(id => typeof id !== "string" || !id)) {
      errors.push("clear must be an array of occupant ids");
    }
    return errors;
  },
  check: (state, p) => {
    const setIds = new Set(p.set.map(o => o.id));
    const clearIds = new Set(p.clear);
    let sim: PlanState = {
      ...state,
      occupants: state.occupants.filter(o => !setIds.has(o.id) && !clearIds.has(o.id)),
    };
    const errors: string[] = [];
    for (const occ of p.set) {
      errors.push(...checkPlacement(sim, occ));
      sim = { ...sim, occupants: upsertOccupant(sim.occupants, occ) };
    }
    return errors;
  },
  capture: (state, _p) => ({ prev: state.occupants }),
  apply: (state: PlanState, p: SetCellsParams) => {
    const setIds = new Set(p.set.map(o => o.id));
    const clearIds = new Set(p.clear);
    let occupants = state.occupants.filter(o => !setIds.has(o.id) && !clearIds.has(o.id));
    for (const occ of p.set) occupants = upsertOccupant(occupants, occ);
    return { ...state, occupants };
  },
  invert: (state: PlanState, _p: SetCellsParams, undoCtx: unknown) => {
    const { prev } = needPrevFrame<Occupant[]>(undoCtx, "sheet.setCells");
    if (!prev) return state;
    return { ...state, occupants: prev };
  },
});

type AxisParams = { at: number; count: number };

function registerAxisMorph(
  name: string,
  describe: string,
  applyFn: (at: number, count: number, state: SheetGridState) => SheetGridState,
  axis: "row" | "col",
  kind: "insert" | "delete"
) {
  registerMorph<AxisParams>({
    name,
    describe,
    invertible: true,
    validate: (p, _ctx: MorphContext) => {
      if (!p || typeof p !== "object") return ["params must be { at, count }"];
      const errors: string[] = [];
      if (!Number.isInteger(p.at) || p.at < 0) errors.push("at must be a non-negative integer");
      if (!Number.isInteger(p.count) || p.count < 1) errors.push("count must be a positive integer");
      return errors;
    },
    check: (state, p) => {
      const dim = axis === "row" ? state.height : state.width;
      if (kind === "insert") return p.at <= dim ? [] : [`at ${p.at} is past the last ${axis} (${dim})`];
      if (dim <= 1) return [`cannot delete the last ${axis}`];
      return p.at < dim ? [] : [`at ${p.at} is past the last ${axis} (${dim})`];
    },
    capture: (state, _p) => ({
      prev: { occupants: state.occupants, width: state.width, height: state.height },
    }),
    apply: (state: PlanState, p: AxisParams) => ({
      ...state,
      ...applyFn(p.at, p.count, { occupants: state.occupants, width: state.width, height: state.height }),
    }),
    invert: (state: PlanState, _p: AxisParams, undoCtx: unknown) => {
      const { prev } = needPrevFrame<SheetGridState>(undoCtx, name);
      if (!prev) return state;
      return { ...state, occupants: prev.occupants, width: prev.width, height: prev.height };
    },
  });
}

registerAxisMorph("sheet.insertRows", "Insert empty rows, shifting occupants and rewriting formulas", insertRows, "row", "insert");
registerAxisMorph("sheet.insertCols", "Insert empty columns, shifting occupants and rewriting formulas", insertCols, "col", "insert");
registerAxisMorph("sheet.deleteRows", "Delete rows, dropping occupants and rewriting formulas", deleteRows, "row", "delete");
registerAxisMorph("sheet.deleteCols", "Delete columns, dropping occupants and rewriting formulas", deleteCols, "col", "delete");
