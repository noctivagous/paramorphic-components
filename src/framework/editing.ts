// ---------- Editing: generic occupant-data morph ----------
// Data edits are a behavior like toggling or dragging, not an app feature:
// a spreadsheet cell, a Logic triple field and a sequencer velocity all
// change occupant data through these helpers, which never mutate in place.
import type { Occupant } from "./types";

export function updateOccupantData(
  occupants: Occupant[],
  id: string,
  patch: Record<string, unknown>
): Occupant[] {
  return occupants.map(o =>
    o.id === id ? { ...o, data: { ...o.data, ...patch } } : o
  );
}

export function upsertOccupant(occupants: Occupant[], occ: Occupant): Occupant[] {
  const i = occupants.findIndex(o => o.id === occ.id);
  if (i < 0) return [...occupants, occ];
  return occupants.map(o => (o.id === occ.id ? occ : o));
}

export function removeOccupant(occupants: Occupant[], id: string): Occupant[] {
  return occupants.filter(o => o.id !== id);
}

/** Every cell an occupant covers: its anchor plus its span offsets. */
export function cellsOf(o: Occupant): { q: number; r: number }[] {
  return [o.anchor, ...(o.span || []).map(s => ({ q: o.anchor.q + s.q, r: o.anchor.r + s.r }))];
}
