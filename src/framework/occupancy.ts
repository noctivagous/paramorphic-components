import type { Occupant, Pos, Region } from "./types";

export function getOccupiedCells(occ: Occupant): Pos[] {
  return [{ q: occ.anchor.q, r: occ.anchor.r }, ...occ.span.map(s => ({ q: occ.anchor.q + s.q, r: occ.anchor.r + s.r }))];
}

export function buildOccupancyMap(occupants: Occupant[]): Map<string, Occupant> {
  const m = new Map<string, Occupant>();
  occupants.forEach(o => {
    getOccupiedCells(o).forEach(c => m.set(`${c.q},${c.r}`, o));
  });
  return m;
}

export function occupantAtCell(pos: Pos, occupants: Occupant[]): Occupant | null {
  for (const o of occupants) {
    const cells = getOccupiedCells(o);
    if (cells.some(c => c.q === pos.q && c.r === pos.r)) return o;
  }
  return null;
}

export function isCellOccupied(pos: Pos, occupants: Occupant[]): boolean {
  return !!occupantAtCell(pos, occupants);
}

// ---------- Regions ----------
export function makeEdgeRegions(width: number, height: number): Region[] {
  const top: Region = { id: "edge-top", cells: Array.from({ length: width }, (_, q) => ({ q, r: 0 })), type: "edge" };
  const bottom: Region = { id: "edge-bottom", cells: Array.from({ length: width }, (_, q) => ({ q, r: height - 1 })), type: "edge" };
  const left: Region = { id: "edge-left", cells: Array.from({ length: height }, (_, r) => ({ q: 0, r })), type: "edge" };
  const right: Region = { id: "edge-right", cells: Array.from({ length: height }, (_, r) => ({ q: width - 1, r })), type: "edge" };
  return [top, bottom, left, right];
}

export function makeSudokuRegions(): Region[] {
  const regions: Region[] = [];
  for (let r = 0; r < 9; r++) regions.push({ id: `row-${r}`, cells: Array.from({ length: 9 }, (_, c) => ({ q: c, r })), type: "row" });
  for (let c = 0; c < 9; c++) regions.push({ id: `col-${c}`, cells: Array.from({ length: 9 }, (_, rr) => ({ q: c, r: rr })), type: "col" });
  for (let br = 0; br < 3; br++) for (let bc = 0; bc < 3; bc++) {
    const cells: Pos[] = [];
    for (let dr = 0; dr < 3; dr++) for (let dc = 0; dc < 3; dc++) cells.push({ q: bc * 3 + dc, r: br * 3 + dr });
    regions.push({ id: `box-${br}-${bc}`, cells, type: "box" });
  }
  return regions;
}

export function makeTrackRegions(width: number, height: number): Region[] {
  return Array.from({ length: height }, (_, r) => ({ id: `track-${r}`, cells: Array.from({ length: width }, (_, q) => ({ q, r })), type: "track" }));
}

export function isPosInRegion(pos: Pos, region: Region): boolean {
  return region.cells.some(c => c.q === pos.q && c.r === pos.r);
}

export function basePieceType(t: string): string {
  const i = t.indexOf("_");
  return i < 0 ? t : t.slice(0, i);
}
export function pieceMatchesRule(rulePiece: string, occ: Occupant): boolean {
  if (rulePiece === "*") return true;
  if (rulePiece === occ.type) return true;
  if (occ.data?.group && rulePiece === occ.data.group) return true;
  if (rulePiece === basePieceType(occ.type)) return true;
  if (occ.type.startsWith(rulePiece) && occ.type[rulePiece.length] === "_") return true;
  return false;
}
