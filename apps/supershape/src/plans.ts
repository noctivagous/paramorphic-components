// The supershape app as plan data: one control occupant carrying the port
// values, one preview occupant hosting a Path guest, and ONE relation
// binding between them. The app builds its occupants from the current
// values and re-derives the outline through evaluatePlanRelations — the
// sliders, the binding and the preview are all generated/framework pieces.
import { getRelationDef, type Occupant, type Pos, type RelationBinding } from "../../../src/framework";

export const CTL_ID = "ctl";
export const PREVIEW_ID = "preview";
export const BINDING_ID = "shape";
export const RIDER_ID = "rider";

// R4: the rider occupant carries t (driven by a TraversalCursor over the
// sampled outline); path.ride turns (points, t) into its position. The
// binding depends on the shape binding through preview.guest.points.
export const RIDE_BINDING: RelationBinding = {
  id: "ride",
  def: "path.ride",
  in: { points: `${PREVIEW_ID}.guest.points`, t: `${RIDER_ID}.data.t` },
  out: { point: `${RIDER_ID}.data.point` },
};

export function riderOccupant(t: number): Occupant {
  return { id: RIDER_ID, anchor: { q: 0, r: 0 }, span: [], type: "rider", data: { t }, tags: [] };
}

/** Trigger occupants standing on the outline at quarter/half/three-quarter cells. */
export function gateOccupants(cells: Pos[]): Occupant[] {
  const gates: Occupant[] = [];
  const seen = new Set<string>();
  for (const f of [0.25, 0.5, 0.75]) {
    const cell = cells[Math.floor(f * (cells.length - 1))];
    if (!cell) continue;
    const key = `${cell.q},${cell.r}`;
    if (seen.has(key)) continue;
    seen.add(key);
    gates.push({ id: `gate-${gates.length + 1}`, anchor: cell, span: [], type: "gate", data: {}, tags: [] });
  }
  return gates;
}

export type SupershapeValues = { m: number; n1: number; n2: number; n3: number; a: number; b: number };

export const DEFAULT_VALUES: SupershapeValues = (() => {
  const out: Record<string, number> = {};
  for (const p of getRelationDef("supershape.polar")!.inputs) out[p.name] = p.default as number;
  return out as SupershapeValues;
})();

export const SUPERSHAPE_BINDING: RelationBinding = {
  id: BINDING_ID,
  def: "supershape.polar",
  in: {
    m: `${CTL_ID}.data.m`, n1: `${CTL_ID}.data.n1`, n2: `${CTL_ID}.data.n2`,
    n3: `${CTL_ID}.data.n3`, a: `${CTL_ID}.data.a`, b: `${CTL_ID}.data.b`,
  },
  out: { points: `${PREVIEW_ID}.guest.points` },
  sample: { count: 180 },
};

export function supershapeOccupants(values: SupershapeValues): Occupant[] {
  return [
    { id: CTL_ID, anchor: { q: 0, r: 0 }, span: [], type: "controls", data: { ...values }, tags: [] },
    { id: PREVIEW_ID, anchor: { q: 1, r: 0 }, span: [], type: "preview", data: {}, tags: [], guest: { kind: "Path", state: { points: [] } } },
  ];
}

export const PRESETS: { name: string; values: SupershapeValues }[] = [
  { name: "Circle", values: { m: 5, n1: 1, n2: 2, n3: 2, a: 1, b: 1 } },
  { name: "Star", values: { m: 5, n1: 1, n2: 1.7, n3: 1.7, a: 1, b: 1 } },
  { name: "Flower", values: { m: 7, n1: 2, n2: 3, n3: 3, a: 1, b: 1 } },
  { name: "Square-ish", values: { m: 4, n1: 8, n2: 8, n3: 8, a: 1, b: 1 } },
  { name: "Cushion", values: { m: 4, n1: 1, n2: 0.8, n3: 0.8, a: 1, b: 1 } },
];

/** The whole app as a stored plan (validated by loadPlan on open). */
export function supershapePlanData(values: SupershapeValues): unknown {
  return {
    $schema: "paramorphic-plan/1",
    component: "Grid",
    tilingId: "square8",
    presetId: "supershape",
    width: 2,
    height: 1,
    ruleSet: {
      id: "supershape",
      setup: { width: 2, height: 1, description: "Supershape: port-generated sliders drive a Path guest through one relation binding" },
      moves: [],
      turns: { type: "free", order: [], first: "planner" },
      outcomes: [],
      end: { condition: "none", action: "none" },
      regions: [],
    },
    occupants: supershapeOccupants(values),
    relations: [SUPERSHAPE_BINDING],
  };
}
