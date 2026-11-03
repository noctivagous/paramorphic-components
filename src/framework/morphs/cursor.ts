// ---------- Cursor morph vocabulary: the second state shape ----------
// A traversal cursor is framework state, not a grid occupant: seeking moves
// the playhead without touching the board. Seeks are undoable when recorded
// (inverse restores the exact previous index) and fall back to the snapshot
// when the frame is missing — the same history contract as occupant morphs.
// The player shell deliberately does not record seeks: transport position is
// session state, reset on load like the turn and the step display.
import { registerMorph, type MorphContext, type PlanState } from "./registry";

type SeekParams = { index: number };

registerMorph<SeekParams>({
  name: "cursor.seekTo",
  describe: "Move the traversal cursor to a path position",
  invertible: true,
  validate: (p, _ctx: MorphContext) => {
    if (!p || typeof p !== "object") return ["params must be { index }"];
    if (!Number.isInteger((p as SeekParams).index) || (p as SeekParams).index < 0) {
      return ["index must be a non-negative integer"];
    }
    return [];
  },
  check: (state, p) => {
    if (!state.cursor) return ["no cursor in state"];
    if (p.index >= state.cursor.path.cells.length) {
      return [`index ${p.index} is beyond path length ${state.cursor.path.cells.length}`];
    }
    return [];
  },
  capture: (state) => ({
    prevIndex: state.cursor?.index ?? -1,
    prevFinished: state.cursor?.finished ?? false,
  }),
  apply: (state: PlanState, p: SeekParams) => {
    if (!state.cursor) return state;
    return { ...state, cursor: { ...state.cursor, index: p.index, finished: false } };
  },
  invert: (state: PlanState, _p: SeekParams, undoCtx: unknown) => {
    const frame = undoCtx as { prevIndex?: number; prevFinished?: boolean } | undefined;
    if (typeof frame?.prevIndex !== "number" || typeof frame?.prevFinished !== "boolean") {
      throw new Error("cursor.seekTo has no inverse data; cannot invert");
    }
    if (!state.cursor) return state;
    return { ...state, cursor: { ...state.cursor, index: frame.prevIndex, finished: frame.prevFinished } };
  },
});
