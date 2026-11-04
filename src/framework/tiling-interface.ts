import type { Pos, TilingDef } from './types';
import { addPosByDir, axialToOffset, hexDistance, offsetToAxial, rotateSpan, squareDistance } from './tilings';

export type Point = { x: number; y: number };
export type TilingGeometry = {
  neighbors(cell: Pos, width: number, height: number): Pos[];
  cellToPoint(cell: Pos): Point;
  pointToCell(point: Point): Pos;
  rotate(offsets: Pos[], steps: number): Pos[];
  distance(a: Pos, b: Pos): number;
};

function roundAxial(q: number, r: number) {
  const x = q, z = r, y = -x - z;
  let rx = Math.round(x), ry = Math.round(y), rz = Math.round(z);
  const dx = Math.abs(rx - x), dy = Math.abs(ry - y), dz = Math.abs(rz - z);
  if (dx > dy && dx > dz) rx = -ry - rz;
  else if (dy > dz) ry = -rx - rz;
  else rz = -rx - ry;
  return { q: rx, r: rz };
}
/** Geometry in normalized units; positions use the tiling's offset coordinates. */
export function createTilingGeometry(tiling: TilingDef): TilingGeometry {
  return {
    neighbors: (cell, width, height) => tiling.directions.map(d => addPosByDir(cell, d.name, 1, tiling, width, height, false)).filter((v): v is Pos => v !== null),
    cellToPoint: cell => {
      if (tiling.shape === 'square') return { x: cell.q, y: cell.r };
      const { q, r } = offsetToAxial(cell, tiling.id);
      return tiling.id === 'hexH' ? { x: Math.sqrt(3) * (q + r / 2), y: 1.5 * r } : { x: 1.5 * q, y: Math.sqrt(3) * (r + q / 2) };
    },
    pointToCell: point => {
      if (tiling.shape === 'square') return { q: Math.round(point.x), r: Math.round(point.y) };
      const axial = tiling.id === 'hexH' ? roundAxial(point.x / Math.sqrt(3) - point.y / 3, 2 * point.y / 3) : roundAxial(2 * point.x / 3, point.y / Math.sqrt(3) - point.x / 3);
      return axialToOffset(axial, tiling.id);
    },
    rotate: (offsets, steps) => rotateSpan(offsets, steps, tiling),
    distance: (a, b) => tiling.shape === 'square' ? squareDistance(a, b, tiling.id === 'square4' ? 'manhattan' : 'chebyshev') : hexDistance(offsetToAxial(a, tiling.id), offsetToAxial(b, tiling.id)),
  };
}
