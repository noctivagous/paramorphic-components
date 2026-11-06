// ---------- Relation definitions (morph library) ----------
// The functions that register into the relations registry. Mechanism lives
// in framework/relations.ts; definitions live here, per derivation.ts's
// split. A plan names a def id and wires its ports — never code.
import {
  DomainError,
  registerRelationDef,
  type RelationBBox,
  type RelationPoint,
  type PortDef,
  type RelationBinding,
  type RelationDef,
  type RelationStore,
} from "../relations";
import type { PropSchemaField } from "../app-kit/controls/types";
import type { Occupant } from "../types";
import {
  evaluateFormulaValue,
  formatCellRef,
  formulaRefTokens,
  parseCellRef,
  type FormulaValue,
  type RawLookup,
  type RawValue,
} from "./formulas";

/**
 * Map a relation input port to an app-kit schema field, so any def's ports
 * generate their own editor grid (the Inspector pattern) with no per-def
 * UI code: number with a range becomes a slider, boolean a toggle, string
 * a text field, enumerated a select. Point/points/range ports edit as
 * encoded text for now.
 */
export function portToSchemaField(port: PortDef): PropSchemaField {
  const base = { key: port.name, label: port.label ?? port.name, min: port.min, max: port.max, step: port.step, options: port.options, default: port.default };
  switch (port.type) {
    case "number":
      return { ...base, kind: port.min !== undefined && port.max !== undefined ? "slider" : "number" };
    case "boolean":
      return { ...base, kind: "boolean" };
    case "string":
      return { ...base, kind: port.options && port.options.length > 0 ? "select" : "text" };
    default:
      return { ...base, kind: "text" };
  }
}

export function portsToSchemaFields(def: RelationDef): PropSchemaField[] {
  return def.inputs.map(portToSchemaField);
}

// ---------- sheet.formula: the spreadsheet conformance bridge ----------
// Each formula cell is a binding of this one def. Its input ports are
// generated from the formula's reference tokens (a range ref is one
// `range` port); its evaluate IS the formula evaluator, fed by a lookup
// assembled from the port values. The def is dynamic: ports come from the
// binding's params.formula, not from a fixed list.

export function sheetFormulaPorts(formula: string): PortDef[] {
  return formulaRefTokens(formula).map(t =>
    t.kind === "cell"
      ? { name: t.ref, type: "number" as const, label: t.ref }
      : { name: t.ref, type: "range" as const, label: t.ref }
  );
}

function lookupFromPorts(formula: string, inputs: Record<string, unknown>): RawLookup {
  const tokens = formulaRefTokens(formula);
  const cells = new Map<string, RawValue>();
  const ranges: { c0: number; r0: number; c1: number; r1: number; grid: unknown }[] = [];
  for (const t of tokens) {
    if (t.kind === "cell") {
      const v = inputs[t.ref];
      cells.set(`${t.col},${t.row}`, typeof v === "number" || typeof v === "string" || typeof v === "boolean" ? v : null);
    } else {
      ranges.push({ c0: t.c0, r0: t.r0, c1: t.c1, r1: t.r1, grid: inputs[t.ref] });
    }
  }
  return (c, r) => {
    const key = `${c},${r}`;
    if (cells.has(key)) return cells.get(key)!;
    for (const rg of ranges) {
      if (c >= rg.c0 && c <= rg.c1 && r >= rg.r0 && r <= rg.r1) {
        const grid = rg.grid as RawValue[][] | undefined;
        const v = grid?.[r - rg.r0]?.[c - rg.c0];
        return typeof v === "number" || typeof v === "string" || typeof v === "boolean" ? v : null;
      }
    }
    return null;
  };
}

export const sheetFormulaDef: RelationDef = {
  id: "sheet.formula",
  label: "Spreadsheet formula",
  dynamic: true,
  inputs: [],
  outputs: [{ name: "value", type: "number", label: "Computed value" }],
  evaluate: (inputs, ctx) => {
    const formula = ctx.params?.formula;
    if (typeof formula !== "string") {
      throw new DomainError("sheet.formula binding needs params.formula (the cell's formula text)");
    }
    return { value: evaluateFormulaValue(formula, lookupFromPorts(formula, inputs)) };
  },
};
registerRelationDef(sheetFormulaDef);

// ---------- bezier.cubic / bezier.pointAt: the Path showcase defs ----------
// A cubic bézier is a Path under its bézier interpretation (README §6.4):
// the sampled points ARE a Path guest's state. Handles are ordinary
// occupant data (anchors or point fields); forward-only — handle mirroring
// (smooth joins) is a two-way constraint and stays out.

function asPoint(v: unknown, name: string): RelationPoint {
  const p = v as { x?: unknown; y?: unknown } | null;
  if (!p || typeof p !== "object" || typeof p.x !== "number" || typeof p.y !== "number" || !Number.isFinite(p.x) || !Number.isFinite(p.y)) {
    throw new DomainError(`bezier: input "${name}" is not a finite point`);
  }
  return { x: p.x, y: p.y };
}

const bezierInputs: PortDef[] = [
  { name: "p0", type: "point", label: "P0 (start)" },
  { name: "p1", type: "point", label: "P1 (control)" },
  { name: "p2", type: "point", label: "P2 (control)" },
  { name: "p3", type: "point", label: "P3 (end)" },
];

/** Cubic bézier point, polynomial (Bernstein) form. */
export function cubicPoint(p0: RelationPoint, p1: RelationPoint, p2: RelationPoint, p3: RelationPoint, t: number): RelationPoint {
  const u = 1 - t;
  const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  return {
    x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
    y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
  };
}

/** Cubic bézier point, de Casteljau subdivision — the test oracle. */
export function cubicPointDeCasteljau(p0: RelationPoint, p1: RelationPoint, p2: RelationPoint, p3: RelationPoint, t: number): RelationPoint {
  const lerp = (a: RelationPoint, b: RelationPoint): RelationPoint => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  const a = lerp(p0, p1), b = lerp(p1, p2), c = lerp(p2, p3);
  const d = lerp(a, b), e = lerp(b, c);
  return lerp(d, e);
}

export function sampleCubic(p0: RelationPoint, p1: RelationPoint, p2: RelationPoint, p3: RelationPoint, count: number): RelationPoint[] {
  const pts: RelationPoint[] = [];
  for (let i = 0; i < count; i++) pts.push(cubicPoint(p0, p1, p2, p3, count === 1 ? 0 : i / (count - 1)));
  return pts;
}

export const bezierCubicDef: RelationDef = {
  id: "bezier.cubic",
  label: "Cubic bézier",
  inputs: bezierInputs,
  outputs: [
    { name: "points", type: "points", label: "Sampled points" },
    { name: "length", type: "number", label: "Arc length (sampled)" },
    { name: "bbox", type: "bbox", label: "Bounding box" },
  ],
  evaluate: (inputs, ctx) => {
    const p0 = asPoint(inputs.p0, "p0"), p1 = asPoint(inputs.p1, "p1");
    const p2 = asPoint(inputs.p2, "p2"), p3 = asPoint(inputs.p3, "p3");
    const count = Math.max(2, Math.floor(ctx.sampleCount ?? 33));
    const points = sampleCubic(p0, p1, p2, p3, count);
    let length = 0;
    for (let i = 1; i < points.length; i++) length += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    const bbox: RelationBBox = {
      minX: Math.min(...points.map(p => p.x)), maxX: Math.max(...points.map(p => p.x)),
      minY: Math.min(...points.map(p => p.y)), maxY: Math.max(...points.map(p => p.y)),
    };
    return { points, length, bbox };
  },
};
registerRelationDef(bezierCubicDef);

export const bezierPointAtDef: RelationDef = {
  id: "bezier.pointAt",
  label: "Point on cubic bézier",
  inputs: [...bezierInputs, { name: "t", type: "number", label: "t", min: 0, max: 1, step: 0.01, default: 0 }],
  outputs: [{ name: "point", type: "point", label: "Point at t" }],
  evaluate: inputs => {
    const t = inputs.t;
    if (typeof t !== "number" || !Number.isFinite(t) || t < 0 || t > 1) {
      throw new DomainError(`bezier.pointAt: t must be in [0, 1], got ${String(t)}`);
    }
    return { point: cubicPoint(asPoint(inputs.p0, "p0"), asPoint(inputs.p1, "p1"), asPoint(inputs.p2, "p2"), asPoint(inputs.p3, "p3"), t) };
  },
};
registerRelationDef(bezierPointAtDef);

// ---------- supershape.polar ----------
// The Gielis superformula: one polar radius per angle, sampled into a Path
// guest's points. Ports carry their ranges, so a control grid generates
// itself from the def (portsToSchemaFields) — no per-def UI.

export type SupershapeParams = { m: number; n1: number; n2: number; n3: number; a: number; b: number };

export function supershapeRadius(phi: number, p: SupershapeParams): number {
  const t1 = Math.pow(Math.abs(Math.cos((p.m * phi) / 4) / p.a), p.n2);
  const t2 = Math.pow(Math.abs(Math.sin((p.m * phi) / 4) / p.b), p.n3);
  return Math.pow(t1 + t2, -1 / p.n1);
}

export function supershapePoints(p: SupershapeParams, count: number): RelationPoint[] {
  const pts: RelationPoint[] = [];
  for (let i = 0; i < count; i++) {
    const phi = (i / count) * Math.PI * 2;
    const r = supershapeRadius(phi, p);
    pts.push({ x: r * Math.cos(phi), y: r * Math.sin(phi) });
  }
  return pts;
}

const num = (inputs: Record<string, unknown>, name: string): number => {
  const v = inputs[name];
  if (typeof v !== "number" || !Number.isFinite(v)) throw new DomainError(`supershape: input "${name}" is not a finite number`);
  return v;
};

export const supershapeDef: RelationDef = {
  id: "supershape.polar",
  label: "Supershape (polar)",
  inputs: [
    { name: "m", type: "number", label: "m (symmetry)", min: 0, max: 20, step: 0.1, default: 5 },
    { name: "n1", type: "number", label: "n1", min: 0.1, max: 20, step: 0.1, default: 1 },
    { name: "n2", type: "number", label: "n2", min: 0.1, max: 20, step: 0.1, default: 1.7 },
    { name: "n3", type: "number", label: "n3", min: 0.1, max: 20, step: 0.1, default: 1.7 },
    { name: "a", type: "number", label: "a", min: 0.1, max: 3, step: 0.05, default: 1 },
    { name: "b", type: "number", label: "b", min: 0.1, max: 3, step: 0.05, default: 1 },
  ],
  outputs: [{ name: "points", type: "points", label: "Outline points" }],
  evaluate: (inputs, ctx) => {
    const p: SupershapeParams = {
      m: num(inputs, "m"), n1: num(inputs, "n1"), n2: num(inputs, "n2"),
      n3: num(inputs, "n3"), a: num(inputs, "a"), b: num(inputs, "b"),
    };
    if (p.n1 <= 0) throw new DomainError(`supershape: n1 must be > 0, got ${p.n1}`);
    if (p.a === 0) throw new DomainError("supershape: a must be non-zero");
    if (p.b === 0) throw new DomainError("supershape: b must be non-zero");
    return { points: supershapePoints(p, Math.max(8, Math.floor(ctx.sampleCount ?? 180))) };
  },
};
registerRelationDef(supershapeDef);

// ---------- path.ride: a point travelling a sampled path ----------
// Inputs are a sampled point list plus t in [0, 1]; the output is the
// interpolated point. Hosts drive t from a TraversalCursor over the same
// points (cellsAlongPoints -> createCursor), so the rider's position is a
// relation output while the cursor stays the framework's one playhead.

export function pointAlongPoints(points: RelationPoint[], t: number): RelationPoint {
  if (points.length === 0) throw new DomainError("path.ride: no points to ride");
  if (typeof t !== "number" || !Number.isFinite(t) || t < 0 || t > 1) {
    throw new DomainError(`path.ride: t must be in [0, 1], got ${String(t)}`);
  }
  if (points.length === 1) return { ...points[0] };
  const pos = t * (points.length - 1);
  const i = Math.min(points.length - 2, Math.floor(pos));
  const f = pos - i;
  return {
    x: points[i].x + (points[i + 1].x - points[i].x) * f,
    y: points[i].y + (points[i + 1].y - points[i].y) * f,
  };
}

export const pathRideDef: RelationDef = {
  id: "path.ride",
  label: "Ride a sampled path",
  inputs: [
    { name: "points", type: "points", label: "Sampled points" },
    { name: "t", type: "number", label: "t", min: 0, max: 1, step: 0.01, default: 0 },
  ],
  outputs: [{ name: "point", type: "point", label: "Rider position" }],
  evaluate: inputs => {
    const pts = inputs.points;
    if (!Array.isArray(pts)) throw new DomainError("path.ride: points input is not a point list");
    return { point: pointAlongPoints(pts as RelationPoint[], inputs.t as number) };
  },
};
registerRelationDef(pathRideDef);

// ---------- A RelationStore over spreadsheet cells ----------
// Entity refs here are `sheet.<A1>` (a cell's value) and `sheet.<A1:B2>`
// (a range, read as a row-major grid). Writes land in the computed layer,
// mirroring applyFormulas: a formula cell's computed result wins over its
// stored value; text cells read as text; absent cells read as empty.

export type SheetFields = { value: string; formula: string; computed: string };
export const DEFAULT_SHEET_FIELDS: SheetFields = { value: "value", formula: "formula", computed: "computed" };

export function sheetCellStore(occupants: Occupant[], fields: SheetFields = DEFAULT_SHEET_FIELDS): {
  store: RelationStore;
  computed: Map<string, FormulaValue>;
} {
  const byRef = new Map<string, Occupant>();
  for (const o of occupants) byRef.set(formatCellRef(o.anchor.q, o.anchor.r), o);
  const computed = new Map<string, FormulaValue>();
  const rawOf = (ref: string): RawValue => {
    if (computed.has(ref)) return computed.get(ref)!;
    const o = byRef.get(ref);
    const v = (o?.data as any)?.[fields.value];
    return typeof v === "number" || typeof v === "string" || typeof v === "boolean" ? v : null;
  };
  const store: RelationStore = {
    get(ref) {
      if (!ref.startsWith("sheet.")) return undefined;
      const addr = ref.slice("sheet.".length);
      if (addr.includes(":")) {
        const [a, b] = addr.split(":");
        const pa = parseCellRef(a);
        const pb = parseCellRef(b);
        if (!pa || !pb) return undefined;
        const grid: RawValue[][] = [];
        for (let r = Math.min(pa[1], pb[1]); r <= Math.max(pa[1], pb[1]); r++) {
          const row: RawValue[] = [];
          for (let c = Math.min(pa[0], pb[0]); c <= Math.max(pa[0], pb[0]); c++) row.push(rawOf(formatCellRef(c, r)));
          grid.push(row);
        }
        return grid;
      }
      const v = rawOf(addr);
      return v === null ? undefined : v;
    },
    set(ref, value) {
      if (!ref.startsWith("sheet.")) throw new Error(`sheet store: bad ref "${ref}"`);
      computed.set(ref.slice("sheet.".length), value as FormulaValue);
    },
    has(ref) {
      return store.get(ref) !== undefined;
    },
  };
  return { store, computed };
}

/**
 * Synthesize the sheet.formula binding for every formula cell: one binding
 * per cell, ports wired to `sheet.<ref>` entities, the formula carried in
 * params. Running these through evaluateRelations + sheetCellStore must
 * reproduce applyFormulas exactly — that is the conformance claim, and
 * verify:relations checks it.
 */
export function sheetFormulaBindings(occupants: Occupant[], fields: SheetFields = DEFAULT_SHEET_FIELDS): RelationBinding[] {
  const bindings: RelationBinding[] = [];
  for (const o of occupants) {
    const formula = (o.data as any)?.[fields.formula];
    if (typeof formula !== "string") continue;
    const selfRef = formatCellRef(o.anchor.q, o.anchor.r);
    const input: Record<string, string> = {};
    for (const t of formulaRefTokens(formula)) input[t.ref] = `sheet.${t.ref}`;
    bindings.push({
      id: `sheet-formula-${o.id}`,
      def: "sheet.formula",
      in: input,
      out: { value: `sheet.${selfRef}` },
      params: { formula },
    });
  }
  return bindings;
}
