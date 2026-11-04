import type { Pos } from './types';

export type SelectionMode = 'single' | 'range' | 'multiple';
export type CellRange = { anchor: Pos; active: Pos };
export type GridSelection = { ranges: CellRange[]; activeRange: number };

const clamp = (p: Pos, width: number, height: number): Pos => ({ q: Math.max(0, Math.min(width - 1, p.q)), r: Math.max(0, Math.min(height - 1, p.r)) });
export function initialGridSelection(): GridSelection { return { ranges: [{ anchor: { q: 0, r: 0 }, active: { q: 0, r: 0 } }], activeRange: 0 }; }
export function selectGridCell(previous: GridSelection, cell: Pos, width: number, height: number, mode: SelectionMode, intent: 'replace' | 'extend' | 'add' = 'replace'): GridSelection {
  const p = clamp(cell, width, height);
  if (intent === 'extend' && mode !== 'single') {
    const ranges = previous.ranges.map((range, i) => i === previous.activeRange ? { ...range, active: p } : range);
    return { ranges, activeRange: previous.activeRange };
  }
  const range = { anchor: p, active: p };
  if (intent === 'add' && mode === 'multiple') return { ranges: [...previous.ranges, range], activeRange: previous.ranges.length };
  return { ranges: [range], activeRange: 0 };
}
export function cellIsSelected(selection: GridSelection, cell: Pos): boolean {
  return selection.ranges.some(({ anchor, active }) => cell.q >= Math.min(anchor.q, active.q) && cell.q <= Math.max(anchor.q, active.q) && cell.r >= Math.min(anchor.r, active.r) && cell.r <= Math.max(anchor.r, active.r));
}
/** Counts the union of ranges, so overlapping cells are counted once. */
export function selectedCellCount(selection: GridSelection, width: number, height: number): number {
  let count = 0;
  for (let r = 0; r < height; r++) for (let q = 0; q < width; q++) if (cellIsSelected(selection, { q, r })) count++;
  return count;
}
export function clampGridSelection(selection: GridSelection, width: number, height: number): GridSelection {
  return { ranges: selection.ranges.map(range => ({ anchor: clamp(range.anchor, width, height), active: clamp(range.active, width, height) })), activeRange: selection.activeRange };
}
