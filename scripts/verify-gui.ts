// GUI builder verification: control registry completeness, GUI document
// validation, pure layout resolvers (absolute chains, stack distributions,
// grid spans, springs & struts), framework history over gui.* morphs, the
// plan save/load round trip (chain + checkpoint paths), and the seeded
// starter document. Bare node asserts, one summary line — same idiom as
// verify-sheet-ops.ts.
import assert from "node:assert/strict";
import {
  applyGuiMorph,
  applySpringsStruts,
  chainForGuiSave,
  getControlDef,
  gridLayout,
  guiHistory,
  guiRegistry,
  listControlData,
  listControlDefs,
  loadGuiDocument,
  loadGuiPlan,
  missingComponents,
  resolvedRects,
  stackLayout,
  validateGuiDocument,
  type GuiDocument,
  type GuiNode,
  type ScopedAppliedMorph,
} from "../src/framework";
import { starterDocument } from "../apps/gui-builder/src/starter";
import { buildGuiSave, exportSourceJson, parseGuiSave } from "../apps/gui-builder/src/save";

let checks = 0;
const ok = (cond: unknown, msg: string) => { checks++; assert.ok(cond, msg); };
const eq = (a: unknown, b: unknown, msg: string) => { checks++; assert.deepEqual(a, b, msg); };

const R = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });
const rects3 = (r: { x: number; y: number; w: number; h: number }) => ({ desktop: r, tablet: { ...r }, phone: { ...r } });
function mkNode(id: string, type: string, parentId: string | null, r: { x: number; y: number; w: number; h: number }, extra: Partial<GuiNode> = {}): GuiNode {
  return { id, type, parentId, props: { ...(getControlDef(type)?.defaultProps ?? {}) }, layouts: rects3(r), ...extra };
}
const docOf = (nodes: GuiNode[]): GuiDocument => ({ schema: "paramorphic-gui/1", device: "desktop", separateLayouts: true, nodes });

// ---------- registry ----------
eq(missingComponents(), [], "every registered control type has a component");
ok(listControlDefs().length >= 40, `registry holds the merged catalogue (${listControlDefs().length} controls)`);
for (const def of listControlDefs()) {
  ok(typeof def.component === "function", `${def.type} has a component`);
  ok(def.defaultSize.w > 0 && def.defaultSize.h > 0, `${def.type} has a default size`);
  ok(Array.isArray(def.propSchema), `${def.type} has a prop schema`);
  const data = listControlData().find(d => d.type === def.type)!;
  for (const [k, v] of Object.entries(data.defaultProps)) {
    const field = data.propSchema.find(f => f.key === k);
    if (field) ok(validateKind(field.kind, v), `${def.type}.${k} default matches schema kind ${field.kind}`);
  }
}
function validateKind(kind: string, v: unknown): boolean {
  switch (kind) {
    case "text": case "select": case "color": return typeof v === "string";
    case "number": case "slider": return typeof v === "number";
    case "boolean": return typeof v === "boolean";
    case "stringList": return Array.isArray(v);
    default: return true;
  }
}
for (const t of ["pro-button", "segmented-control", "knob", "fader-bank", "xy-pad", "step-sequencer", "adsr-editor", "eq-curve", "mod-matrix", "panel", "stack", "grid-container"]) {
  ok(getControlDef(t), `palette resolves ${t}`);
}

// ---------- document validation ----------
const good = docOf([mkNode("p", "panel", null, R(0, 0, 200, 100)), mkNode("s", "slider", "p", R(8, 8, 120, 30))]);
eq(validateGuiDocument(good), [], "a valid document validates");
ok(loadGuiDocument(JSON.parse(JSON.stringify(good))).ok, "valid document loads");
const badCases: Array<[string, unknown]> = [
  ["duplicate id", docOf([mkNode("a", "slider", null, R(0, 0, 10, 10)), mkNode("a", "slider", null, R(0, 0, 10, 10))])],
  ["orphan parent", docOf([mkNode("a", "slider", "ghost", R(0, 0, 10, 10))])],
  ["cycle", docOf([mkNode("a", "panel", "b", R(0, 0, 10, 10)), mkNode("b", "panel", "a", R(0, 0, 10, 10))])],
  ["unknown type", docOf([mkNode("a", "no-such-control", null, R(0, 0, 10, 10))])],
  ["bad prop kind", docOf([{ ...mkNode("a", "slider", null, R(0, 0, 10, 10)), props: { value: "loud" } }])],
  ["bad rect", docOf([mkNode("a", "slider", null, R(0, 0, -5, 10))])],
  ["non-container parent", docOf([mkNode("a", "slider", null, R(0, 0, 10, 10)), mkNode("b", "slider", "a", R(0, 0, 10, 10))])],
  ["wrong schema", { schema: "other/9", nodes: [] }],
];
for (const [name, data] of badCases) {
  const res = loadGuiDocument(data);
  ok(!res.ok && res.errors.length > 0, `invalid document rejected: ${name}`);
}

// ---------- layout resolvers ----------
const nested = docOf([
  mkNode("outer", "panel", null, R(100, 50, 300, 200)),
  mkNode("inner", "panel", "outer", R(20, 30, 100, 80)),
  mkNode("leaf", "slider", "inner", R(5, 6, 60, 20)),
]);
const abs = resolvedRects(nested, "desktop");
eq([abs.get("leaf")!.absX, abs.get("leaf")!.absY], [125, 86], "absolute rects resolve through the parent chain");

// stack: leading + spaceBetween + fill
const kids = [{ id: "a", w: 50, h: 20 }, { id: "b", w: 50, h: 30 }, { id: "c", w: 50, h: 10 }];
const lead = stackLayout(kids, { direction: "vertical", spacing: 5, distribution: "leading", alignment: "top" }, R(0, 0, 100, 200));
eq([lead[0].y, lead[1].y, lead[2].y], [0, 25, 60], "stack leading packs from the start");
const between = stackLayout(kids, { direction: "vertical", spacing: 0, distribution: "spaceBetween", alignment: "top" }, R(0, 0, 100, 200));
eq([between[0].y, between[2].y + between[2].h], [0, 200], "stack spaceBetween spans the container");
const fill = stackLayout(kids, { direction: "vertical", spacing: 0, distribution: "fill", alignment: "top" }, R(0, 0, 100, 90));
eq(fill.map(r => r.h), [30, 30, 30], "stack fill shares the main axis equally");
const centered = stackLayout(kids, { direction: "horizontal", spacing: 0, distribution: "center", alignment: "center" }, R(0, 0, 200, 100));
eq([centered[0].x, centered[0].y], [25, 40], "stack center centres both axes");
const baseline = stackLayout(kids, { direction: "vertical", spacing: 2, spacingBaselineUnits: true, distribution: "leading", alignment: "top" }, R(0, 0, 100, 200), 8);
eq(baseline[1].y, 20 + 16, "stack spacing honours baseline units");

// grid spans
const gridKids = [{ colStart: 0, colSpan: 2, rowStart: 0, rowSpan: 1 }, { colStart: 2, colSpan: 2, rowStart: 1, rowSpan: 2 }];
const gr = gridLayout(gridKids, { columns: 4, gutter: 10, rowHeight: 20, rowGutter: 5 }, { w: 430, h: 200 });
eq([gr[0].w, gr[1].x, gr[1].y, gr[1].h], [210, 220, 25, 45], "grid layout resolves spans, gutters and row heights");

// springs & struts
const pinned = applySpringsStruts(R(10, 10, 50, 20), { w: 100, h: 100 }, { w: 200, h: 150 }, { top: true, bottom: false, left: true, right: false, hSpring: false, vSpring: false });
eq(pinned, R(10, 10, 50, 20), "pinned top-left child does not move on resize");
const rightPinned = applySpringsStruts(R(40, 10, 50, 20), { w: 100, h: 100 }, { w: 200, h: 150 }, { top: true, bottom: false, left: false, right: true, hSpring: false, vSpring: false });
eq(rightPinned.x, 140, "right-pinned child follows the right edge");
const sprung = applySpringsStruts(R(10, 10, 50, 20), { w: 100, h: 100 }, { w: 200, h: 150 }, { top: false, bottom: false, left: false, right: false, hSpring: true, vSpring: true });
eq([sprung.w, sprung.h], [150, 70], "springs absorb the container delta");

// resolvedRects honours stack/grid container modes
const stackDoc = docOf([
  mkNode("box", "panel", null, R(0, 0, 200, 200), { layoutMode: "stack", stack: { direction: "vertical", spacing: 10, distribution: "leading", alignment: "top" } }),
  mkNode("k1", "slider", "box", R(0, 0, 100, 20)),
  mkNode("k2", "slider", "box", R(0, 0, 100, 20)),
]);
eq(resolvedRects(stackDoc, "desktop").get("k2")!.y, 30, "resolvedRects lays stack children out via the resolver");
const gridDoc = docOf([
  mkNode("g", "grid-container", null, R(10, 10, 430, 200), { layoutMode: "grid", gridCfg: { columns: 4, gutter: 10, rowHeight: 20, rowGutter: 5, baselineUnit: 8 } }),
  mkNode("gc", "pro-button", "g", R(0, 0, 10, 10), { grid: { colStart: 1, colSpan: 1, rowStart: 0, rowSpan: 1 } }),
]);
eq(resolvedRects(gridDoc, "desktop").get("gc")!.absX, 120, "resolvedRects lays grid children out via the resolver");

// ---------- morphs + history ----------
const empty = docOf([]);
const added = applyGuiMorph(empty, { name: "gui.addNode", params: { node: mkNode("x", "knob", null, R(0, 0, 64, 72)) } });
ok(added.ok && added.doc.nodes.length === 1, "gui.addNode applies");
const setProps = applyGuiMorph(added.doc, { name: "gui.setProps", params: { id: "x", props: { value: 42 } } });
ok(setProps.ok && setProps.doc.nodes[0].props.value === 42, "gui.setProps patches props");
const invertedDoc = guiRegistry.invertMorph(setProps.doc, setProps.applied);
ok(invertedDoc !== null && invertedDoc.nodes[0].props.value === 65, "gui.setProps inverse restores the prior value (knob default 65)");
const badMorph = applyGuiMorph(empty, { name: "gui.addNode", params: { node: mkNode("y", "mystery", null, R(0, 0, 1, 1)) } });
ok(!badMorph.ok, "a morph producing an invalid document is refused");

let histPast: import("../src/framework").GuiHistoryStep[] = [];
const step1 = guiHistory.push(histPast, empty, added.applied); histPast = step1;
const undone = guiHistory.undo(histPast, [], added.doc);
ok(undone.undone && undone.state.nodes.length === 0, "history undo restores the pre-edit snapshot");
const redone = guiHistory.redo(undone.past, undone.future, undone.state);
ok(redone.redone && redone.state.nodes.length === 1, "history redo replays the edit");

// ---------- save / load round trip ----------
const starter = starterDocument();
eq(validateGuiDocument(starter), [], "the starter document validates");
const starterRects = resolvedRects(starter, "desktop");
ok(starterRects.size === starter.nodes.length, "the starter document resolves every node");
ok(starter.nodes.some(n => n.layoutMode === "stack") && starter.nodes.some(n => n.layoutMode === "grid") && starter.nodes.some(n => n.layoutMode === "absolute"), "starter exercises stack, grid and absolute containers");
ok(starter.nodes.some(n => n.type === "fader-bank") && starter.nodes.some(n => n.type === "xy-pad") && starter.nodes.some(n => n.type === "adsr-editor"), "starter includes audio-lab controls");

const chain: ScopedAppliedMorph[] = [];
let cur = starter;
for (const m of [
  { name: "gui.setProps", params: { id: "ch-slider", props: { value: 77 } } },
  { name: "gui.setLayout", params: { id: "faders", device: "desktop" as const, rect: R(700, 64, 220, 140), separate: true } },
  { name: "gui.addNode", params: { node: mkNode("extra", "toggle", null, R(500, 480, 54, 28)) } },
]) {
  const res = applyGuiMorph(cur, m); ok(res.ok, `chain morph applies: ${m.name}`); if (res.ok) { cur = res.doc; chain.push(res.applied); }
}
const chainedSave = chainForGuiSave({ base: starter, chain, current: cur });
ok(!chainedSave.checkpointed && chainedSave.morphs.length === 3, "save publishes the morph chain when replay reconstructs the document");
const reopened = loadGuiPlan(chainedSave);
ok(reopened.ok && JSON.stringify(reopened.doc) === JSON.stringify(cur), "the chained plan replays to the exact document");
eq(reopened.ok ? reopened.chain.length : -1, 3, "the reopened plan carries its chain");

const snapshotOnly = buildGuiSave({ base: starter, chain: [], current: cur });
ok(snapshotOnly.checkpointed, "an unreconstructable state checkpoints honestly instead of faking a chain");
const reopenedSnap = parseGuiSave(JSON.stringify(snapshotOnly));
ok(reopenedSnap.ok && JSON.stringify(reopenedSnap.doc) === JSON.stringify(cur), "the checkpointed plan still round-trips the document");
ok(!parseGuiSave("{not json").ok, "a malformed save file is rejected with errors");
ok(!parseGuiSave(JSON.stringify({ schema: "paramorphic-gui/1", nodes: [{ id: "a" }] })).ok, "an invalid document inside a save is rejected, never partially applied");
const exported = JSON.parse(exportSourceJson(cur));
ok(exported.device === "desktop" && Array.isArray(exported.widgets) && exported.widgets.length === cur.nodes.length, "source-compatible export carries device + widgets");

console.log(`verify-gui: ${checks} checks passed (${listControlDefs().length} controls, starter ${starter.nodes.length} nodes)`);
