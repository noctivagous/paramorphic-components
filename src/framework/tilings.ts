import type { Axial, Pos, TilingDef, TilingDir } from "./types";

// DEBT (README 11.1): flat-top hex reuses pointy-top direction names;
// direction names belong to the tiling, so hexV must gain its own N/S set.
// ---------- Tiling helpers ----------
export function oddROffsetToAxial(col: number, row: number): Axial {
  const q = col - ((row - (row & 1)) >> 1);
  const r = row;
  return { q, r };
}
export function axialToOddROffset(q: number, r: number): Pos {
  const col = q + ((r - (r & 1)) >> 1);
  const row = r;
  return { q: col, r: row };
}
export function oddQOffsetToAxial(col: number, row: number): Axial {
  const q = col;
  const r = row - ((col - (col & 1)) >> 1);
  return { q, r };
}
export function axialToOddQOffset(q: number, r: number): Pos {
  const col = q;
  const row = r + ((q - (q & 1)) >> 1);
  return { q: col, r: row };
}
export function offsetToAxial(pos: Pos, tilingId: string): Axial {
  if (tilingId === "hexH") return oddROffsetToAxial(pos.q, pos.r);
  if (tilingId === "hexV") return oddQOffsetToAxial(pos.q, pos.r);
  return { q: pos.q, r: pos.r };
}
export function axialToOffset(ax: Axial, tilingId: string): Pos {
  if (tilingId === "hexH") return axialToOddROffset(ax.q, ax.r);
  if (tilingId === "hexV") return axialToOddQOffset(ax.q, ax.r);
  return { q: ax.q, r: ax.r };
}
export function hexDistance(a: Axial, b: Axial) {
  return (Math.abs(a.q - b.q) + Math.abs(a.q + a.r - b.q - b.r) + Math.abs(a.r - b.r)) / 2;
}
export function squareDistance(a: Pos, b: Pos, kind: "manhattan" | "chebyshev"): number {
  const dx = Math.abs(a.q - b.q), dy = Math.abs(a.r - b.r);
  return kind === "manhattan" ? dx + dy : Math.max(dx, dy);
}
// Base piece group: "pawn_w" -> "pawn", "king_b" -> "king". Lets Logic triples
// written for "pawn" match "pawn_w"/"pawn_b" without duplicating triples.
export function makeId() { return Math.random().toString(36).slice(2, 9); }

// ---------- Build tilings ----------
export function buildTilings(): Record<string, TilingDef> {
  const square4Dirs: TilingDir[] = [
    { name: "N", dq: 0, dr: -1, axial: { q: 0, r: -1 }, angle: 0, isOrthogonal: true },
    { name: "S", dq: 0, dr: 1, axial: { q: 0, r: 1 }, angle: 180, isOrthogonal: true },
    { name: "E", dq: 1, dr: 0, axial: { q: 1, r: 0 }, angle: 90, isOrthogonal: true },
    { name: "W", dq: -1, dr: 0, axial: { q: -1, r: 0 }, angle: 270, isOrthogonal: true },
  ];
  const square8Dirs: TilingDir[] = [
    ...square4Dirs,
    { name: "NE", dq: 1, dr: -1, axial: { q: 1, r: -1 }, angle: 45, isDiagonal: true },
    { name: "NW", dq: -1, dr: -1, axial: { q: -1, r: -1 }, angle: 315, isDiagonal: true },
    { name: "SE", dq: 1, dr: 1, axial: { q: 1, r: 1 }, angle: 135, isDiagonal: true },
    { name: "SW", dq: -1, dr: 1, axial: { q: -1, r: 1 }, angle: 225, isDiagonal: true },
  ];
  // hexH pointy-top odd-r: true E/W exists
  const hexHDirs: TilingDir[] = [
    { name: "E", dq: 1, dr: 0, axial: { q: 1, r: 0 }, angle: 0, isOrthogonal: true },
    { name: "W", dq: -1, dr: 0, axial: { q: -1, r: 0 }, angle: 180, isOrthogonal: true },
    { name: "NE", dq: 1, dr: -1, axial: { q: 1, r: -1 }, angle: 60, isDiagonal: true },
    { name: "NW", dq: 0, dr: -1, axial: { q: 0, r: -1 }, angle: 300, isDiagonal: true },
    { name: "SE", dq: 0, dr: 1, axial: { q: 0, r: 1 }, angle: 120, isDiagonal: true },
    { name: "SW", dq: -1, dr: 1, axial: { q: -1, r: 1 }, angle: 240, isDiagonal: true },
  ];
  // hexV flat-top odd-q: true N/S, no E/W — correct geometry
  const hexVDirs: TilingDir[] = [
    { name: "N", dq: 0, dr: -1, axial: { q: 0, r: -1 }, angle: 0, isOrthogonal: true },
    { name: "S", dq: 0, dr: 1, axial: { q: 0, r: 1 }, angle: 180, isOrthogonal: true },
    { name: "NE", dq: 1, dr: -1, axial: { q: 1, r: -1 }, angle: 45, isDiagonal: true },
    { name: "SE", dq: 1, dr: 0, axial: { q: 1, r: 0 }, angle: 135, isDiagonal: true },
    { name: "SW", dq: -1, dr: 1, axial: { q: -1, r: 1 }, angle: 225, isDiagonal: true },
    { name: "NW", dq: -1, dr: 0, axial: { q: -1, r: 0 }, angle: 315, isDiagonal: true },
  ];

  const squareKnightOffsets = [
    { dq: 2, dr: 1, axial: { q: 2, r: 1 } }, { dq: 1, dr: 2, axial: { q: 1, r: 2 } },
    { dq: -1, dr: 2, axial: { q: -1, r: 2 } }, { dq: -2, dr: 1, axial: { q: -2, r: 1 } },
    { dq: -2, dr: -1, axial: { q: -2, r: -1 } }, { dq: -1, dr: -2, axial: { q: -1, r: -2 } },
    { dq: 1, dr: -2, axial: { q: 1, r: -2 } }, { dq: 2, dr: -1, axial: { q: 2, r: -1 } },
  ];
  // Hex "knight": bent ring at axial distance 2 only (6 cells). The 6 straight-line
  // distance-2 cells (2,0),(0,2),... are excluded by design: a knight jump must bend.
  const hexKnightOffsets: { dq: number; dr: number; axial: Axial }[] = [
    { dq: 0, dr: 0, axial: { q: 2, r: -1 } }, { dq: 0, dr: 0, axial: { q: 1, r: -2 } },
    { dq: 0, dr: 0, axial: { q: -1, r: -1 } }, { dq: 0, dr: 0, axial: { q: -2, r: 1 } },
    { dq: 0, dr: 0, axial: { q: -1, r: 2 } }, { dq: 0, dr: 0, axial: { q: 1, r: 1 } },
  ].map(o => ({ dq: 0, dr: 0, axial: o.axial })); // dq/dr unused for hex, axial matters

  const mk = (id: any, name: string, shape: any, style: any, dirs: TilingDir[], leaps: any): TilingDef => {
    const map: Record<string, TilingDir> = {};
    dirs.forEach(d => map[d.name] = d);
    return { id, name, shape, style, directions: dirs, directionMap: map, leaps: { name: "knight", offsets: leaps } };
  };

  return {
    square4: mk("square4", "SQUARE-4 (von Neumann)", "square", "2color", square4Dirs, squareKnightOffsets),
    square8: mk("square8", "SQUARE-8 (Moore)", "square", "2color", square8Dirs, squareKnightOffsets),
    hexH: mk("hexH", "HEX-H pointy-top odd-r — true E/W", "hex", "3color", hexHDirs, hexKnightOffsets),
    hexV: mk("hexV", "HEX-V flat-top odd-q — true N/S, no E/W", "hex", "3color", hexVDirs, hexKnightOffsets),
  };
}
export const TILINGS = buildTilings();
export const TILINGS_LIST = Object.values(TILINGS);

// ---------- Tiling utils ----------
export function getTiling(id: string): TilingDef { return (TILINGS as any)[id] || TILINGS.square8; }

export function addPosByDir(pos: Pos, dirName: string, steps: number, tiling: TilingDef, width: number, height: number, wrapping: boolean): Pos | null {
  const d = tiling.directionMap[dirName];
  if (!d) return null;
  if (tiling.shape === "square") {
    let nq = pos.q + d.dq * steps;
    let nr = pos.r + d.dr * steps;
    if (wrapping) { nq = ((nq % width) + width) % width; nr = ((nr % height) + height) % height; }
    else if (nq < 0 || nq >= width || nr < 0 || nr >= height) return null;
    return { q: nq, r: nr };
  } else {
    const ax = offsetToAxial(pos, tiling.id);
    const nAx = { q: ax.q + d.axial.q * steps, r: ax.r + d.axial.r * steps };
    const off = axialToOffset(nAx, tiling.id);
    let nq = off.q, nr = off.r;
    if (wrapping) { nq = ((nq % width) + width) % width; nr = ((nr % height) + height) % height; }
    else if (nq < 0 || nq >= width || nr < 0 || nr >= height) return null;
    return { q: nq, r: nr };
  }
}

export function applyOffset(pos: Pos, off: { dq: number; dr: number; axial?: Axial }, tiling: TilingDef, width: number, height: number, wrapping: boolean): Pos | null {
  if (tiling.shape === "square") {
    let nq = pos.q + off.dq;
    let nr = pos.r + off.dr;
    if (wrapping) { nq = ((nq % width) + width) % width; nr = ((nr % height) + height) % height; }
    else if (nq < 0 || nq >= width || nr < 0 || nr >= height) return null;
    return { q: nq, r: nr };
  } else {
    const ax = offsetToAxial(pos, tiling.id);
    const add = off.axial || { q: off.dq, r: off.dr };
    const nAx = { q: ax.q + add.q, r: ax.r + add.r };
    const offPos = axialToOffset(nAx, tiling.id);
    let nq = offPos.q, nr = offPos.r;
    if (wrapping) { nq = ((nq % width) + width) % width; nr = ((nr % height) + height) % height; }
    else if (nq < 0 || nq >= width || nr < 0 || nr >= height) return null;
    return { q: nq, r: nr };
  }
}

export function lineCells(start: Pos, dirName: string, count: number, tiling: TilingDef, width: number, height: number): Pos[] {
  const cells: Pos[] = [start];
  let cur = start;
  for (let i = 1; i < count; i++) {
    const nxt = addPosByDir(cur, dirName, 1, tiling, width, height, false);
    if (!nxt) break;
    cells.push(nxt);
    cur = nxt;
  }
  return cells;
}

export function rotateSpan(span: Pos[], steps: number, tiling: TilingDef): Pos[] {
  if (steps === 0) return span;
  if (tiling.shape === "square") {
    // 90 deg rotation
    let cur = span;
    for (let s = 0; s < ((steps % 4 + 4) % 4); s++) {
      cur = cur.map(p => ({ q: -p.r, r: p.q }));
    }
    return cur;
  } else {
    // hex 60 deg rotation using axial
    return span.map(p => {
      // p as offset from anchor, convert to axial, rotate
      const ax = offsetToAxial({ q: p.q, r: p.r }, tiling.id);
      // axial rotation 60 deg: (q,r) -> (-r, q+r)
      let q = ax.q, r = ax.r;
      for (let i = 0; i < ((steps % 6 + 6) % 6); i++) {
        const nq = -r;
        const nr = q + r;
        q = nq; r = nr;
      }
      const off = axialToOffset({ q, r }, tiling.id);
      return { q: off.q, r: off.r };
    });
  }
}
