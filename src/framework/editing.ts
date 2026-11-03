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

export type DimState = { width: number; height: number; occupants: Occupant[] };

/**
 * Shared placement rule for every occupant vocabulary (grid, sheet, player,
 * tree): the anchor lands inside the board, and no covered cell belongs to a
 * different occupant. Replacing the same id is fine.
 */
export function checkPlacement(state: DimState, o: Occupant): string[] {
  const { q, r } = o.anchor;
  if (q < 0 || r < 0 || q >= state.width || r >= state.height) {
    return [`occ "${o.id}" anchor (${q},${r}) is outside ${state.width}x${state.height}`];
  }
  const mine = new Set(cellsOf(o).map(c => `${c.q},${c.r}`));
  for (const other of state.occupants) {
    if (other.id === o.id) continue;
    for (const c of cellsOf(other)) {
      if (mine.has(`${c.q},${c.r}`)) {
        return [`occ "${o.id}" collides with "${other.id}" at ${c.q},${c.r}`];
      }
    }
  }
  return [];
}
