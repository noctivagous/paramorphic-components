// ---------- Traversal: generic substrate walk + trigger hooks ----------
// A playhead is a cursor over an ordered cell list, nothing more. Time lives
// outside this module: the caller advances the cursor on each tick (an
// interval in the demo shell, a transport adapter on hardware). The same
// operator serves sequencer steps, timeline rulers and path animation.
import type { Occupant, Pos, TilingDef } from "./types";
import { lineCells } from "./tilings";
import { buildOccupancyMap } from "./occupancy";

export type TraversalPath = { cells: Pos[] };

export function linePath(
  tiling: TilingDef,
  start: Pos,
  dir: string,
  count: number,
  width: number,
  height: number
): TraversalPath {
  return { cells: lineCells(start, dir, count, tiling, width, height) };
}

export type TraversalCursor = {
  path: TraversalPath;
  index: number; // last entered position; -1 = before the start
  loop: boolean;
  finished: boolean;
};

export function createCursor(
  path: TraversalPath,
  opts?: { loop?: boolean; start?: number }
): TraversalCursor {
  return { path, index: (opts?.start ?? -1), loop: opts?.loop ?? false, finished: false };
}

export function advanceCursor(cursor: TraversalCursor): {
  cursor: TraversalCursor;
  entered: Pos[];
} {
  if (cursor.finished) return { cursor, entered: [] };
  let next = cursor.index + 1;
  if (next >= cursor.path.cells.length) {
    if (cursor.loop && cursor.path.cells.length > 0) {
      next = 0;
    } else {
      return { cursor: { ...cursor, finished: true }, entered: [] };
    }
  }
  return { cursor: { ...cursor, index: next }, entered: [cursor.path.cells[next]] };
}

export type TriggerHit = { occupantId: string; cell: Pos };

export function collectTriggers(occupants: Occupant[], cells: Pos[]): TriggerHit[] {
  const map = buildOccupancyMap(occupants);
  const hits: TriggerHit[] = [];
  for (const cell of cells) {
    const occ = map.get(`${cell.q},${cell.r}`);
    if (occ) hits.push({ occupantId: occ.id, cell });
  }
  return hits;
}
