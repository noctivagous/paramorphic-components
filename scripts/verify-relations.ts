// Relations verification: the ordered/quarantine engine, plan-binding
// evaluation (ordering, dependents-only recompute, DomainError and cycle
// quarantine), loadPlan binding validation, and the sheet.formula bridge
// conformance — running synthesized bindings through the binding layer must
// reproduce applyFormulas exactly. Bare node asserts, one summary line —
// same idiom as verify-gui.ts / verify-sheet-ops.ts. Later slices extend
// this file (bézier, supershape, riding).
import assert from "node:assert/strict";
import {
  DomainError,
  applyFormulas,
  evaluateItems,
  evaluatePlanRelations,
  evaluateRelations,
  formatCellRef,
  getRelationDef,
  listRelationDefs,
  loadPlan,
  occupantStore,
  registerRelationDef,
  sheetCellStore,
  sheetFormulaBindings,
  type Occupant,
  type RelationBinding,
} from "../src/framework";

let checks = 0;
const ok = (cond: unknown, msg: string) => { checks++; assert.ok(cond, msg); };
const eq = (a: unknown, b: unknown, msg: string) => { checks++; assert.deepEqual(a, b, msg); };

const occ = (id: string, q: number, r: number, data: any = {}, guest?: Occupant["guest"]): Occupant =>
  ({ id, anchor: { q, r }, span: [], type: "cell", data, tags: [], ...(guest ? { guest } : {}) });

// ---------- test defs ----------
registerRelationDef({
  id: "test.double", label: "Double",
  inputs: [{ name: "x", type: "number" }],
  outputs: [{ name: "y", type: "number" }],
  evaluate: i => ({ y: (i.x as number) * 2 }),
});
registerRelationDef({
  id: "test.addConst", label: "Add constant",
  inputs: [{ name: "x", type: "number" }, { name: "k", type: "number", default: 10 }],
  outputs: [{ name: "y", type: "number" }],
  evaluate: i => ({ y: (i.x as number) + (i.k as number) }),
});
registerRelationDef({
  id: "test.recip", label: "Reciprocal",
  inputs: [{ name: "x", type: "number" }],
  outputs: [{ name: "y", type: "number" }],
  evaluate: i => {
    if ((i.x as number) === 0) throw new DomainError("reciprocal of zero");
    return { y: 1 / (i.x as number) };
  },
});
ok(listRelationDefs().some(d => d.id === "sheet.formula"), "sheet.formula bridge def is registered");
ok(getRelationDef("sheet.formula")?.dynamic === true, "sheet.formula is a dynamic (generated-ports) def");

// ---------- evaluateItems: ordering + quarantine semantics ----------
{
  const out = evaluateItems<number>([
    { id: "c", dependsOn: ["b"], compute: get => (get("b") ?? 0) + 1 },
    { id: "a", dependsOn: [], compute: () => 1 },
    { id: "b", dependsOn: ["a"], compute: get => (get("a") ?? 0) + 1 },
  ]);
  eq(out.order, ["a", "b", "c"], "evaluateItems orders by dependency, not declaration");
  eq(out.values.get("c"), 3, "values flow through the chain");
  eq(out.failed.size, 0, "no failures in a clean graph");
}
{
  const out = evaluateItems<number>([
    { id: "boom", dependsOn: [], compute: () => { throw new Error("kapow"); } },
    { id: "down", dependsOn: ["boom"], compute: () => 1 },
    { id: "free", dependsOn: [], compute: () => 7 },
  ]);
  eq(out.failed.get("boom"), { kind: "error", message: "kapow" }, "a throwing compute is quarantined with its message");
  eq(out.failed.get("down")?.kind, "dependency", "a dependent of a failure is quarantined without computing");
  eq(out.values.get("free"), 7, "unrelated items still evaluate");
}
{
  const out = evaluateItems<number>([
    { id: "x", dependsOn: ["y"], compute: () => 1 },
    { id: "y", dependsOn: ["x"], compute: () => 2 },
    { id: "z", dependsOn: ["x"], compute: () => 3 },
  ]);
  eq(out.cyclic.sort(), ["x", "y", "z"], "cycle members and their dependents are all unprocessed");
  ok((out.cycleLoop ?? []).join("->").includes("x") && (out.cycleLoop ?? []).includes("y"), "the concrete loop is reported");
  eq(out.values.size, 0, "nothing in a cycle computes");
}

// ---------- evaluateRelations over occupants ----------
function chainOccupants() {
  return [
    occ("ctl", 0, 0, { x: 3 }),
    occ("mid", 1, 0, {}),
    occ("out", 2, 0, {}),
    occ("free", 3, 0, { x: 5, y: 0 }),
  ];
}
const chainBindings: RelationBinding[] = [
  { id: "b1", def: "test.double", in: { x: "ctl.data.x" }, out: { y: "mid.data.y" } },
  { id: "b2", def: "test.addConst", in: { x: "mid.data.y" }, out: { y: "out.data.z" } },
  { id: "b3", def: "test.double", in: { x: "free.data.x" }, out: { y: "free.data.y" } },
];
{
  const res = evaluatePlanRelations(chainOccupants(), chainBindings);
  eq([...res.evaluated].sort(), ["b1", "b2", "b3"], "all bindings evaluate");
  ok(res.evaluated.indexOf("b1") < res.evaluated.indexOf("b2"), "a binding evaluates only after the binding producing its input");
  eq(res.quarantined.size, 0, "clean chain: nothing quarantined");
  const byId = new Map(res.occupants.map(o => [o.id, o]));
  eq(byId.get("mid")!.data.y, 6, "b1 wrote mid.data.y = 2*3");
  eq(byId.get("out")!.data.z, 16, "b2 read the derived value and applied its default k=10");
  eq(byId.get("free")!.data.y, 10, "independent binding evaluated too");
}
{
  // Dependents-only: changing ctl.data.x re-evaluates b1 and b2, not b3.
  const first = evaluatePlanRelations(chainOccupants(), chainBindings);
  const changed = first.occupants.map(o => (o.id === "ctl" ? { ...o, data: { x: 4 } } : o));
  const res = evaluatePlanRelations(changed, chainBindings, { changedRefs: new Set(["ctl.data.x"]) });
  eq(res.evaluated, ["b1", "b2"], "changedRefs scopes recompute to dependents only");
  const byId = new Map(res.occupants.map(o => [o.id, o]));
  eq(byId.get("out")!.data.z, 18, "scoped recompute still propagates to the end of the chain");
  eq(byId.get("free")!.data.y, 10, "out-of-scope binding kept its previous output");
}
{
  // DomainError quarantine + dependent quarantine + the rest stays live.
  const occupants = [occ("src", 0, 0, { x: 0 }), occ("mid", 1, 0, {}), occ("end", 2, 0, {}), occ("ok", 3, 0, { x: 2, y: 0 })];
  const bindings: RelationBinding[] = [
    { id: "r1", def: "test.recip", in: { x: "src.data.x" }, out: { y: "mid.data.y" } },
    { id: "r2", def: "test.double", in: { x: "mid.data.y" }, out: { y: "end.data.y" } },
    { id: "r3", def: "test.double", in: { x: "ok.data.x" }, out: { y: "ok.data.y" } },
  ];
  const res = evaluatePlanRelations(occupants, bindings);
  eq(res.quarantined.get("r1"), "reciprocal of zero", "DomainError quarantines with its message");
  ok((res.quarantined.get("r2") ?? "").includes("depends on quarantined binding \"r1\""), "dependent binding quarantined with the reason chain");
  eq(res.evaluated, ["r3"], "unrelated binding stays live");
  const byId = new Map(res.occupants.map(o => [o.id, o]));
  eq(byId.get("ok")!.data.y, 4, "live binding wrote its output");
  eq(byId.get("mid")!.data.y, undefined, "quarantined binding wrote nothing");
}
{
  // Cross-binding cycle: both quarantined, reason names the cycle.
  const occupants = [occ("a", 0, 0, { x: 1, y: 0 }), occ("b", 1, 0, { x: 1, y: 0 })];
  const bindings: RelationBinding[] = [
    { id: "ca", def: "test.double", in: { x: "b.data.y" }, out: { y: "a.data.y" } },
    { id: "cb", def: "test.double", in: { x: "a.data.y" }, out: { y: "b.data.y" } },
  ];
  const res = evaluatePlanRelations(occupants, bindings);
  eq(res.evaluated, [], "a cross-binding cycle evaluates nothing");
  ok((res.quarantined.get("ca") ?? "").startsWith("cycle:"), "cycle quarantine reason names the loop");
  eq(res.quarantined.size, 2, "both bindings in the cycle are quarantined");
}
{
  // The occupant store never mutates its input.
  const src = chainOccupants();
  const { store } = occupantStore(src);
  store.set("ctl.data.x", 99);
  eq(src[0].data.x, 3, "occupantStore writes copy, never mutate the input list");
  eq(store.get("ctl.anchor"), { x: 0, y: 0 }, "anchor reads as a point");
}

// ---------- loadPlan validation ----------
const ruleSet = {
  id: "custom",
  setup: { width: 4, height: 4, description: "relations verify" },
  moves: [], turns: { type: "alternating", order: ["white", "black"], first: "white" },
  outcomes: [], end: { condition: "anyOutcome", action: "stop" }, regions: [],
};
function planData(relations: unknown) {
  return {
    component: "Grid", tilingId: "square8", presetId: "custom", ruleSet,
    width: 4, height: 4,
    occupants: [occ("ctl", 0, 0, { x: 3 }), occ("mid", 1, 0, {})],
    ...(relations !== undefined ? { relations } : {}),
  };
}
function loadErrs(relations: unknown): string[] {
  const res = loadPlan({ data: planData(relations), errors: [] }, null);
  return res.ok ? [] : res.errors;
}
{
  const res = loadPlan({ data: planData([{ id: "b1", def: "test.double", in: { x: "ctl.data.x" }, out: { y: "mid.data.y" } }]), errors: [] }, null);
  ok(res.ok, "a valid relations plan loads");
  if (res.ok) eq(res.plan.relations?.length, 1, "bindings are carried on the LoadedPlan");
  const plain = loadPlan({ data: planData(undefined), errors: [] }, null);
  ok(plain.ok && plain.plan.relations === undefined, "plans without relations load exactly as before");
}
ok(loadErrs("nope").some(e => e.includes("must be an array")), "non-array relations rejected");
ok(loadErrs([{ id: "b", def: "nope.def", in: {}, out: {} }]).some(e => e.includes("unknown relation def")), "unknown def rejected");
ok(loadErrs([{ id: "b", def: "test.double", in: { zzz: "ctl.data.x" }, out: { y: "mid.data.y" } }]).some(e => e.includes("unknown input port")), "unknown input port rejected");
ok(loadErrs([{ id: "b", def: "test.double", in: {}, out: { y: "mid.data.y" } }]).some(e => e.includes("unwired")), "unwired required input rejected");
ok(loadErrs([{ id: "b", def: "test.double", in: { x: { const: "three" } }, out: { y: "mid.data.y" } }]).some(e => e.includes("does not match port type")), "const type mismatch rejected");
ok(loadErrs([{ id: "b", def: "test.double", in: { x: "ctl.data.x" }, out: { y: "mid.anchor" } }]).some(e => e.includes("read-only")), "anchor as output rejected (non-writable target)");
ok(loadErrs([{ id: "b", def: "test.double", in: { x: "ghost.data.x" }, out: { y: "mid.data.y" } }]).some(e => e.includes("unknown occupant")), "ref to unknown occupant rejected");
ok(loadErrs([{ id: "b", def: "test.double", in: { x: "ctl..x" }, out: { y: "mid.data.y" } }]).some(e => e.includes("not a valid entity ref")), "malformed entity ref rejected");
ok(loadErrs([
  { id: "b", def: "test.double", in: { x: "ctl.data.x" }, out: { y: "mid.data.y" } },
  { id: "b", def: "test.double", in: { x: "ctl.data.x" }, out: { y: "mid.data.y" } },
]).some(e => e.includes("duplicates binding id")), "duplicate binding ids rejected");

// ---------- Formula conformance: applyFormulas + the binding bridge ----------
function sheetOccupants(): Occupant[] {
  return [
    occ("c00", 0, 0, { value: 2 }),
    occ("c10", 1, 0, { value: 3 }),
    occ("c20", 2, 0, { formula: "=A1+B1" }),
    occ("c01", 0, 1, { formula: "=C1*10" }),
    occ("c11", 1, 1, { formula: "=SUM(A1:B1)" }),
    occ("c21", 2, 1, { value: "text" }),
    occ("c02", 0, 2, { formula: "=B2&\"!\"" }),
  ];
}
function computedByRef(occupants: Occupant[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const o of occupants) {
    if ((o.data as any)?.computed !== undefined) out[formatCellRef(o.anchor.q, o.anchor.r)] = (o.data as any).computed;
  }
  return out;
}
{
  const direct = applyFormulas(sheetOccupants());
  eq(direct.errors, [], "conformance sheet: no errors");
  eq(computedByRef(direct.occupants), { C1: 5, A2: 50, B2: 5, A3: "5!" }, "applyFormulas computes the chain, the range SUM and the concatenation");
  const bindings = sheetFormulaBindings(sheetOccupants());
  eq(bindings.length, 4, "one synthesized binding per formula cell");
  const { store, computed } = sheetCellStore(sheetOccupants());
  const res = evaluateRelations(bindings, store);
  eq(res.quarantined.size, 0, "bridge: nothing quarantined on a clean sheet");
  eq(Object.fromEntries(computed), computedByRef(direct.occupants), "bridge bindings reproduce applyFormulas exactly");
}
{
  // Cycle: identical surface through both paths.
  const cyclic = [
    occ("a", 0, 0, { formula: "=B1" }),
    occ("b", 1, 0, { formula: "=A1" }),
    occ("c", 2, 0, { value: 9 }),
  ];
  const direct = applyFormulas(cyclic);
  eq(direct.errors.length, 1, "cycle: exactly one error");
  ok(direct.errors[0].startsWith("[framework] derivation cycle detected:"), "cycle error surface unchanged");
  eq(computedByRef(direct.occupants), {}, "cyclic cells get no computed value");
  const { store } = sheetCellStore(cyclic);
  const res = evaluateRelations(sheetFormulaBindings(cyclic), store);
  eq(res.quarantined.size, 2, "bridge: both cyclic bindings quarantined");
  ok([...res.quarantined.values()].every(r => r.startsWith("cycle:")), "bridge: cycle reasons match the engine's quarantine form");
}
{
  // Division by zero: error entry, no computed value, dependents flagged.
  const divSheet = [
    occ("a", 0, 0, { formula: "=1/0" }),
    occ("b", 1, 0, { formula: "=A1+1" }),
    occ("c", 2, 0, { formula: "=40+2" }),
  ];
  const direct = applyFormulas(divSheet);
  ok(direct.errors.some(e => e.includes("division by zero")), "div0 error surface unchanged");
  ok(direct.errors.some(e => e === "b: depends on failed cell a"), "dependent-of-failure error surface unchanged");
  eq(computedByRef(direct.occupants), { C1: 42 }, "unrelated formula still computes through the failure");
}

// ---------- R2: bézier defs + the demo plan ----------
import { cubicPoint, cubicPointDeCasteljau, sampleCubic } from "../src/framework";
import bezierPlanData from "../morph-plans/bezier.json";

const P = [{ x: 1, y: 6 }, { x: 3, y: 1 }, { x: 7, y: 1 }, { x: 8, y: 6 }] as const;
{
  eq(cubicPoint(P[0], P[1], P[2], P[3], 0), { x: 1, y: 6 }, "bézier hits P0 exactly at t=0");
  eq(cubicPoint(P[0], P[1], P[2], P[3], 1), { x: 8, y: 6 }, "bézier hits P3 exactly at t=1");
  for (const t of [0, 0.25, 0.5, 0.75, 1]) {
    const a = cubicPoint(P[0], P[1], P[2], P[3], t);
    const b = cubicPointDeCasteljau(P[0], P[1], P[2], P[3], t);
    ok(Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9, `de Casteljau matches the polynomial form at t=${t}`);
  }
  const pts = sampleCubic(P[0], P[1], P[2], P[3], 33);
  eq(pts.length, 33, "sampling honors the binding's count");
  eq(pts[0], { x: 1, y: 6 }, "first sampled point is P0");
  eq(pts[32], { x: 8, y: 6 }, "last sampled point is P3");
}
{
  // The shipped demo plan: loads (bindings validate), evaluates, and the
  // preview guest ends up holding the curve.
  const loaded = loadPlan({ data: bezierPlanData, errors: [] }, null);
  ok(loaded.ok, "bezier demo plan loads with its bindings validated");
  if (loaded.ok) {
    const res = evaluatePlanRelations(loaded.plan.occupants ?? [], loaded.plan.relations ?? []);
    eq(res.quarantined.size, 0, "demo plan: nothing quarantined");
    const preview = res.occupants.find(o => o.id === "preview")!;
    ok(preview.guest?.kind === "Path", "preview occupant hosts a Path guest");
    const pts = preview.guest?.kind === "Path" ? preview.guest.state.points : [];
    eq(pts.length, 33, "curve binding sampled 33 points into the guest");
    eq(pts[0], { x: 1, y: 6 }, "guest curve starts at handle h0's anchor");
    eq(pts[pts.length - 1], { x: 8, y: 6 }, "guest curve ends at handle h3's anchor");
    const chord = Math.hypot(8 - 1, 6 - 6);
    ok((preview.data as any).length > chord, "sampled arc length exceeds the chord");
    const marker = (preview.data as any).marker;
    const expect = cubicPoint(P[0], P[1], P[2], P[3], 0.5);
    ok(Math.abs(marker.x - expect.x) < 1e-9 && Math.abs(marker.y - expect.y) < 1e-9, "pointAt marker sits at t=0.5 on the curve");
    const bbox = (preview.data as any).bbox;
    ok(bbox.minX >= 1 && bbox.maxX <= 8 && bbox.minY >= 1 && bbox.maxY <= 6, "bbox output is written and sane");
  }
}
{
  // Quarantine: a handle whose wired field is not a point.
  const occupants = [
    occ("h0", 0, 0, { pt: { x: 0, y: 0 } }),
    occ("h1", 1, 0, { pt: "not-a-point" }),
    occ("h2", 2, 0, { pt: { x: 2, y: 2 } }),
    occ("h3", 3, 0, { pt: { x: 3, y: 0 } }),
    occ("pv", 4, 0, {}, { kind: "Path", state: { points: [{ x: 9, y: 9 }] } }),
  ];
  const bindings: RelationBinding[] = [
    { id: "curve", def: "bezier.cubic", in: { p0: "h0.data.pt", p1: "h1.data.pt", p2: "h2.data.pt", p3: "h3.data.pt" }, out: { points: "pv.guest.points" }, sample: { count: 9 } },
  ];
  const res = evaluatePlanRelations(occupants, bindings);
  ok((res.quarantined.get("curve") ?? "").includes("not a finite point"), "invalid point input quarantines the bézier binding");
  const pv = res.occupants.find(o => o.id === "pv")!;
  ok(pv.guest?.kind === "Path" && pv.guest.state.points.length === 0, "quarantined guest points are emptied");
  ok(pv.guest?.kind === "Path" && typeof pv.guest.state.quarantine === "string", "quarantine reason is recorded in guest state for renderers");
}

// ---------- R3: supershape def, port-generated schema, the app plan ----------
import { portsToSchemaFields, supershapePoints } from "../src/framework";
import { DEFAULT_VALUES, SUPERSHAPE_BINDING, supershapeOccupants } from "../apps/supershape/src/plans";
import { buildSupershapeSave, parseSupershapeSave } from "../apps/supershape/src/save";

{
  const def = getRelationDef("supershape.polar")!;
  // Circle identity: n2=n3=2, a=b=1 makes cos²+sin²=1, so r=1 for any m, n1.
  for (const [m, n1] of [[0, 1], [3, 0.5], [5, 1], [8, 4], [12, 17]] as const) {
    const out = def.evaluate({ m, n1, n2: 2, n3: 2, a: 1, b: 1 }, { sampleCount: 72, bindingId: "t" });
    const pts = out.points as { x: number; y: number }[];
    eq(pts.length, 72, `circle case m=${m}: sample count honored`);
    ok(pts.every(p => Math.abs(Math.hypot(p.x, p.y) - 1) < 1e-6), `circle identity holds for m=${m}, n1=${n1}`);
  }
  for (const bad of [{ n1: 0 }, { n1: -2 }, { a: 0 }, { b: 0 }]) {
    const input = { m: 5, n1: 1, n2: 1.7, n3: 1.7, a: 1, b: 1, ...bad };
    assert.throws(() => def.evaluate(input, { bindingId: "t" }), DomainError, `domain violation ${JSON.stringify(bad)} raises DomainError`);
    checks++;
  }
  // Through the binding layer, the same violations quarantine the guest.
  const badValues = { ...DEFAULT_VALUES, n1: 0 };
  const res = evaluatePlanRelations(supershapeOccupants(badValues), [SUPERSHAPE_BINDING]);
  ok((res.quarantined.get(SUPERSHAPE_BINDING.id) ?? "").includes("n1 must be > 0"), "app binding quarantines on n1=0");
  const pv = res.occupants.find(o => o.id === "preview")!;
  ok(pv.guest?.kind === "Path" && pv.guest.state.points.length === 0, "quarantined supershape guest is empty");
}
{
  // Port -> schema generation covers every input port of both showcase defs.
  for (const defId of ["supershape.polar", "bezier.cubic"]) {
    const def = getRelationDef(defId)!;
    const fields = portsToSchemaFields(def);
    eq(fields.map(f => f.key), def.inputs.map(p => p.name), `${defId}: schema fields cover every input port, in order`);
  }
  const shapeFields = portsToSchemaFields(getRelationDef("supershape.polar")!);
  ok(shapeFields.every(f => f.kind === "slider"), "ranged number ports become sliders");
  eq(shapeFields.find(f => f.key === "m")?.max, 20, "port ranges survive into the schema");
}
{
  // The app's own plan wiring: default values produce the full outline, and
  // the save file round-trips through loadPlan validation.
  const res = evaluatePlanRelations(supershapeOccupants(DEFAULT_VALUES), [SUPERSHAPE_BINDING]);
  eq(res.quarantined.size, 0, "app defaults: nothing quarantined");
  const pv = res.occupants.find(o => o.id === "preview")!;
  eq(pv.guest?.kind === "Path" ? pv.guest.state.points.length : 0, 180, "app binding samples 180 outline points");
  const round = parseSupershapeSave(buildSupershapeSave({ ...DEFAULT_VALUES, m: 9 }));
  ok(round.ok && round.values.m === 9, "save/open round trip preserves port values");
  const pts = supershapePoints(DEFAULT_VALUES, 36);
  eq(pts.length, 36, "supershapePoints honors its count");
}

// ---------- R4: path.ride + traversal-cursor riding with triggers ----------
import { advanceCursor, cellsAlongPoints, collectTriggers, createCursor, pointAlongPoints } from "../src/framework";
import { RIDE_BINDING, gateOccupants, riderOccupant } from "../apps/supershape/src/plans";

{
  const line = [{ x: 0, y: 0 }, { x: 10, y: 0 }];
  eq(pointAlongPoints(line, 0), { x: 0, y: 0 }, "ride: t=0 is the first point");
  eq(pointAlongPoints(line, 1), { x: 10, y: 0 }, "ride: t=1 is the last point");
  eq(pointAlongPoints(line, 0.5), { x: 5, y: 0 }, "ride: t interpolates between samples");
  assert.throws(() => pointAlongPoints([], 0.5), DomainError, "ride: empty point list is a DomainError");
  checks++;
  assert.throws(() => pointAlongPoints(line, 1.5), DomainError, "ride: t outside [0,1] is a DomainError");
  checks++;
}
{
  // A full pass: cursor finishes at the last cell; gates standing on cells
  // the path visits exactly once fire exactly once.
  const circle = supershapePoints({ m: 5, n1: 1, n2: 2, n3: 2, a: 1, b: 1 }, 180);
  const cells = cellsAlongPoints(circle, 24);
  ok(cells.length > 20, `outline sampled to a walkable cell path (${cells.length} cells)`);
  const counts = new Map<string, number>();
  for (const c of cells) counts.set(`${c.q},${c.r}`, (counts.get(`${c.q},${c.r}`) ?? 0) + 1);
  const uniqueIdx = [0.25, 0.5, 0.75].map(f => {
    let i = Math.floor(f * (cells.length - 1));
    while (i < cells.length - 1 && counts.get(`${cells[i].q},${cells[i].r}`) !== 1) i++;
    return i;
  });
  const gates: Occupant[] = uniqueIdx.map((ci, gi) => occ(`gate-${gi + 1}`, cells[ci].q, cells[ci].r, {}));
  let cursor = createCursor({ cells });
  const fired = new Map<string, number>();
  let enteredTotal = 0;
  let guard = 0;
  while (!cursor.finished && guard++ < 10000) {
    const step = advanceCursor(cursor);
    cursor = step.cursor;
    enteredTotal += step.entered.length;
    for (const hit of collectTriggers(gates, step.entered)) {
      fired.set(hit.occupantId, (fired.get(hit.occupantId) ?? 0) + 1);
    }
  }
  ok(cursor.finished, "cursor finishes the pass");
  eq(cursor.index, cells.length - 1, "cursor ends on the final point's cell");
  eq(enteredTotal, cells.length, "every cell is entered exactly once across the pass");
  for (const g of gates) eq(fired.get(g.id), 1, `${g.id} fired exactly once per pass`);
}
{
  // The app's gate placement stands on the path, and the ride binding puts
  // the rider on the first sampled point at t=0.
  const values = { m: 5, n1: 1, n2: 2, n3: 2, a: 1, b: 1 };
  const cells = cellsAlongPoints(supershapePoints(values, 180), 24);
  const gates = gateOccupants(cells);
  ok(gates.length >= 2, `app places gate occupants on the outline (${gates.length})`);
  ok(gates.every(g => cells.some(c => c.q === g.anchor.q && c.r === g.anchor.r)), "every gate anchor is a path cell");
  const res = evaluatePlanRelations([...supershapeOccupants(values), riderOccupant(0)], [SUPERSHAPE_BINDING, RIDE_BINDING]);
  eq(res.quarantined.size, 0, "ride chain: nothing quarantined");
  const pv = res.occupants.find(o => o.id === "preview")!;
  const pts = pv.guest?.kind === "Path" ? pv.guest.state.points : [];
  const riderPt = (res.occupants.find(o => o.id === "rider")!.data as any).point;
  eq(riderPt, pts[0], "rider position at t=0 equals the first sampled point");
  const resEnd = evaluatePlanRelations([...supershapeOccupants(values), riderOccupant(1)], [SUPERSHAPE_BINDING, RIDE_BINDING]);
  const riderEnd = (resEnd.occupants.find(o => o.id === "rider")!.data as any).point;
  eq(riderEnd, pts[pts.length - 1], "rider position at t=1 equals the last sampled point");
}

// ---------- D6a: save -> load round trip carries relation bindings ----------
// The root shell holds bindings in state and publishes them through
// serializePlan; buildAppSave is the shared stored-plan assembly for the
// Grid app shells. Both serializers must carry the bindings a loaded plan
// holds. Before the fix, serializePlan had no relations argument at all and
// buildAppSave no relations field — bindings vanished on save, and reloading
// the original file was the only way they survived.
import { buildAppSave, getTiling, parsePlan, serializePlan } from "../src/framework";

{
  const loaded = loadPlan({ data: bezierPlanData, errors: [] }, null);
  ok(loaded.ok, "round trip: demo plan loads");
  if (loaded.ok) {
    const plan = loaded.plan;
    const bindings = plan.relations ?? [];
    eq(bindings.length, 2, "round trip: demo plan holds two bindings");
    const before = evaluatePlanRelations(plan.occupants ?? [], bindings);

    // The shell's own save path: serializePlan in JSON mode (the only
    // round-trippable of its three modes; YAML/XML are display summaries).
    const text = serializePlan({
      component: plan.component ?? "Grid",
      tiling: getTiling(plan.tilingId ?? "square8"),
      tilingId: plan.tilingId ?? "square8",
      presetId: plan.presetId,
      ruleSet: plan.ruleSet,
      occupants: plan.occupants ?? [],
      width: plan.width,
      height: plan.height,
      regions: plan.regions ?? [],
      toggles: { gravity: false, diagonal: false, sliding: true, wrapping: false, chainCapture: true },
      planMode: "json",
      relations: bindings,
    });
    const parsed = parsePlan(text);
    eq(parsed.errors, [], "round trip: serialized text parses");
    const reloaded = loadPlan({ data: parsed.data, errors: parsed.errors }, null);
    ok(reloaded.ok, "round trip: serialized plan reloads");
    if (reloaded.ok) {
      eq(reloaded.plan.relations, bindings, "round trip: bindings survive serializePlan -> loadPlan intact");
      const after = evaluatePlanRelations(reloaded.plan.occupants ?? [], reloaded.plan.relations ?? []);
      eq(after.quarantined.size, 0, "round trip: reloaded bindings evaluate clean");
      eq(after.occupants, before.occupants, "round trip: reloaded plan evaluates identically");
    }

    // The shared stored-plan assembly: buildAppSave with relations.
    const saved = buildAppSave({
      settings: {
        tilingId: plan.tilingId ?? "square8",
        presetId: plan.presetId,
        ruleSet: plan.ruleSet,
        regions: plan.regions ?? [],
        interpretation: plan.interpretation ?? null,
      },
      size: { w: plan.width, h: plan.height },
      occupants: plan.occupants ?? [],
      base: plan.base,
      adopted: plan.morphs,
      past: [],
      relations: bindings,
    });
    ok(saved.ok, "round trip: buildAppSave accepts a relations-carrying plan");
    if (saved.ok) {
      const re2 = loadPlan({ data: saved.plan, errors: [] }, null);
      ok(re2.ok, "round trip: buildAppSave output reloads");
      if (re2.ok) eq(re2.plan.relations, bindings, "round trip: bindings survive buildAppSave -> loadPlan intact");
    }
  }
}

console.log(`verify:relations — ${checks} checks passed`);
