// ---------- Player morph vocabulary: sequencer notes as own terms ----------
// The player records, undoes and replays notes through these morphs — never
// through grid.* or sheet.* — so a player plan reads as player actions and
// validates note-shaped data (pitch/velocity ranges). Built with registerMorph
// alone: the registry, history and plan validation needed no changes for a
// new occupant vocabulary, which is the §3 item-1 attempt recorded as
// succeeding. (The core edits this session — shared placement checks,
// state-carrying snapshots — were driven by the cursor item, not by this one.)
import type { Occupant } from "../types";
import { checkPlacement, removeOccupant, upsertOccupant } from "../editing";
import { needPrevFrame, registerMorph, type MorphContext, type PlanState } from "./registry";

type PlaceNoteParams = { occ: Occupant };

const isPos = (v: unknown): v is { q: number; r: number } =>
  !!v && typeof (v as any).q === "number" && typeof (v as any).r === "number";

const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function validateNote(o: unknown): string[] {
  const occ = o as Occupant;
  if (!occ || typeof occ.id !== "string" || !occ.id) return ["occ.id must be a non-empty string"];
  if (occ.type !== "note") return [`occ "${occ.id}" must be type "note" (got "${(occ as any).type}")`];
  if (!isPos(occ.anchor)) return [`occ "${occ.id}" needs a numeric anchor {q,r}`];
  const data = (occ.data ?? {}) as Record<string, unknown>;
  if (data.pitch !== undefined && !isFiniteNumber(data.pitch)) {
    return [`occ "${occ.id}" pitch must be a finite number`];
  }
  if (data.vel !== undefined && (!isFiniteNumber(data.vel) || (data.vel as number) < 0 || (data.vel as number) > 1)) {
    return [`occ "${occ.id}" vel must be within 0..1`];
  }
  return [];
}

function needFrame(undoCtx: unknown, morph: string): { prev?: Occupant | null } {
  return needPrevFrame<Occupant>(undoCtx, morph);
}

function capturePrev(state: PlanState, id: string): { prev: Occupant | null } {
  return { prev: state.occupants.find(o => o.id === id) ?? null };
}

registerMorph<PlaceNoteParams>({
  name: "player.placeNote",
  describe: "Place or replace one sequencer note",
  invertible: true,
  validate: (p, _ctx: MorphContext) => {
    if (!p || typeof p !== "object") return ["params must be { occ }"];
    return validateNote((p as PlaceNoteParams).occ);
  },
  check: (state, p) => checkPlacement(state, p.occ),
  capture: (state, p) => capturePrev(state, p.occ.id),
  apply: (state: PlanState, p: PlaceNoteParams) => ({
    ...state,
    occupants: upsertOccupant(state.occupants, p.occ),
  }),
  invert: (state: PlanState, p: PlaceNoteParams, undoCtx: unknown) => {
    const { prev } = needFrame(undoCtx, "player.placeNote");
    if (prev) return { ...state, occupants: upsertOccupant(state.occupants, prev) };
    return { ...state, occupants: removeOccupant(state.occupants, p.occ.id) };
  },
});

registerMorph<{ id: string }>({
  name: "player.removeNote",
  describe: "Remove one sequencer note",
  invertible: true,
  validate: (p, _ctx: MorphContext) => {
    if (!p || typeof (p as { id: string }).id !== "string" || !(p as { id: string }).id) {
      return ["params must be { id }"];
    }
    return [];
  },
  check: (state, p) =>
    state.occupants.some(o => o.id === p.id) ? [] : [`note "${p.id}" is not present`],
  capture: (state, p) => capturePrev(state, p.id),
  apply: (state: PlanState, p: { id: string }) => ({
    ...state,
    occupants: removeOccupant(state.occupants, p.id),
  }),
  invert: (state: PlanState, _p: { id: string }, undoCtx: unknown) => {
    const { prev } = needFrame(undoCtx, "player.removeNote");
    if (!prev) return state;
    return { ...state, occupants: upsertOccupant(state.occupants, prev) };
  },
});
