// ---------- GUI documents: the builder's plan-shaped document ----------
// A GUI document is a flat list of nodes (a tree via parentId) where each
// node names a registered control type, carries its props, and carries one
// layout rect per device class. Documents validate like shell plans:
// loadGuiDocument never partially applies — every problem comes back as an
// actionable error string.
//
// Edits are gui.* morphs on a scoped registry over GuiDocument, following
// the tree2.ts precedent, so saves publish a replayable base + chain when
// the chain reconstructs the current document (the scoped registry's
// publishesFullChain rule), and a snapshot checkpoint otherwise. Undo/redo
// in the builder run through the generic createHistory factory over the
// same apply/invert pair.
import { createHistory } from "../history";
import { createMorphRegistry, type ScopedAppliedMorph } from "../morphs/scoped";
import { DEVICES, type Device, type GridCfg, type LayoutRect, type PropSchemaField, type StackCfg, type Struts } from "./controls/types";
import { getControlData } from "./controls/registry-data";

export type GuiLayoutMode = "absolute" | "stack" | "grid";

export type GuiNode = {
  id: string;
  type: string;
  parentId: string | null;
  props: Record<string, unknown>;
  layouts: Record<Device, LayoutRect>;
  /** Placement inside a grid-mode container. */
  grid?: { colStart: number; colSpan: number; rowStart: number; rowSpan: number };
  /** Container behaviour (only meaningful on container control types). */
  layoutMode?: GuiLayoutMode;
  stack?: StackCfg;
  gridCfg?: GridCfg;
  struts?: Struts;
  locked?: boolean;
  visible?: boolean;
};

export type GuiDocument = {
  schema: "paramorphic-gui/1";
  /** Device the document was last edited/previewed as (source-compatible export). */
  device: Device;
  /** When false, editing one device's rect mirrors it to the others. */
  separateLayouts: boolean;
  nodes: GuiNode[];
};

export type GuiPlanFile = {
  schema: "paramorphic-gui-plan/1";
  base: GuiDocument;
  morphs: ScopedAppliedMorph[];
  snapshot: GuiDocument;
  checkpointed?: boolean;
};

export const emptyGuiDocument = (): GuiDocument => ({ schema: "paramorphic-gui/1", device: "desktop", separateLayouts: true, nodes: [] });
export const cloneGuiDocument = (doc: GuiDocument): GuiDocument => JSON.parse(JSON.stringify(doc));

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

function rectErrors(rect: unknown, where: string): string[] {
  if (!isRecord(rect)) return [`${where} must be a rect {x,y,w,h}`];
  const errors: string[] = [];
  for (const k of ["x", "y", "w", "h"] as const) {
    if (typeof rect[k] !== "number" || !Number.isFinite(rect[k] as number)) errors.push(`${where}.${k} must be a finite number`);
  }
  if (typeof rect.w === "number" && (rect.w as number) < 0) errors.push(`${where}.w must be >= 0`);
  if (typeof rect.h === "number" && (rect.h as number) < 0) errors.push(`${where}.h must be >= 0`);
  return errors;
}

function propKindErrors(field: PropSchemaField, value: unknown, where: string): string[] {
  switch (field.kind) {
    case "text": case "color": return typeof value === "string" ? [] : [`${where} must be a string (${field.kind})`];
    case "number": case "slider": return typeof value === "number" && Number.isFinite(value) ? [] : [`${where} must be a finite number`];
    case "boolean": return typeof value === "boolean" ? [] : [`${where} must be a boolean`];
    case "select": return typeof value === "string" && (!field.options || field.options.includes(value)) ? [] : [`${where} must be one of ${field.options?.join(", ") ?? "its options"}`];
    case "stringList": return Array.isArray(value) && value.every(v => typeof v === "string") ? [] : [`${where} must be an array of strings`];
    default: return [];
  }
}

/** Validate a GUI document. Empty result means loadable. */
export function validateGuiDocument(data: unknown): string[] {
  if (!isRecord(data)) return ["GUI document must be an object"];
  const doc = data as GuiDocument;
  const errors: string[] = [];
  if (doc.schema !== "paramorphic-gui/1") errors.push(`schema must be "paramorphic-gui/1"`);
  if (!DEVICES.includes(doc.device)) errors.push(`device must be one of ${DEVICES.join(", ")}`);
  if (typeof doc.separateLayouts !== "boolean") errors.push("separateLayouts must be a boolean");
  if (!Array.isArray(doc.nodes)) return [...errors, "nodes must be an array"];
  const ids = new Set<string>();
  doc.nodes.forEach((node, i) => {
    const where = `nodes[${i}]${node && typeof node.id === "string" ? ` ("${node.id}")` : ""}`;
    if (!isRecord(node)) { errors.push(`${where} must be an object`); return; }
    if (typeof node.id !== "string" || !node.id) errors.push(`${where}.id must be a non-empty string`);
    else if (ids.has(node.id)) errors.push(`duplicate node id "${node.id}"`);
    else ids.add(node.id);
    const def = typeof node.type === "string" ? getControlData(node.type) : undefined;
    if (!def) errors.push(`${where}.type "${String(node.type)}" is not a registered control type`);
    if (node.parentId !== null && typeof node.parentId !== "string") errors.push(`${where}.parentId must be a string or null`);
    if (!isRecord(node.props)) errors.push(`${where}.props must be an object`);
    else if (def) {
      for (const field of def.propSchema) {
        const v = node.props[field.key];
        if (v !== undefined) errors.push(...propKindErrors(field, v, `${where}.props.${field.key}`));
      }
    }
    if (!isRecord(node.layouts)) errors.push(`${where}.layouts must hold one rect per device`);
    else for (const d of DEVICES) errors.push(...rectErrors(node.layouts[d], `${where}.layouts.${d}`));
    if (node.grid !== undefined) {
      const g = node.grid as Record<string, unknown>;
      if (!isRecord(g) || ["colStart", "colSpan", "rowStart", "rowSpan"].some(k => typeof g[k] !== "number" || !Number.isInteger(g[k]))) errors.push(`${where}.grid needs integer colStart/colSpan/rowStart/rowSpan`);
    }
    if (node.layoutMode !== undefined && !["absolute", "stack", "grid"].includes(node.layoutMode)) errors.push(`${where}.layoutMode must be absolute, stack or grid`);
    if (node.layoutMode !== undefined && def && !def.container) errors.push(`${where} sets layoutMode but "${node.type}" is not a container`);
  });
  // Parent existence + cycles.
  const byId = new Map(doc.nodes.map(n => [n.id, n]));
  for (const node of doc.nodes) {
    if (!isRecord(node) || typeof node.id !== "string") continue;
    if (node.parentId != null && !byId.has(node.parentId)) errors.push(`node "${node.id}" has missing parent "${String(node.parentId)}"`);
    const seen = new Set<string>();
    let cur: GuiNode | undefined = node;
    while (cur && cur.parentId != null) {
      if (seen.has(cur.id)) { errors.push(`parent cycle involving "${node.id}"`); break; }
      seen.add(cur.id);
      cur = byId.get(cur.parentId);
    }
    if (node.parentId != null) {
      const parent = byId.get(node.parentId);
      if (parent && !getControlData(parent.type)?.container) errors.push(`node "${node.id}" is parented to "${node.parentId}" (${parent.type}) which is not a container`);
    }
  }
  return errors;
}

export function loadGuiDocument(data: unknown): { ok: true; doc: GuiDocument } | { ok: false; errors: string[] } {
  const errors = validateGuiDocument(data);
  return errors.length ? { ok: false, errors } : { ok: true, doc: cloneGuiDocument(data as GuiDocument) };
}

// ---------- gui.* morphs (scoped registry over GuiDocument) ----------

export const guiRegistry = createMorphRegistry<GuiDocument>();
const cloneNode = (n: GuiNode): GuiNode => JSON.parse(JSON.stringify(n));
type NodeFrame = { prev: GuiNode | null };

function nodeErrors(doc: GuiDocument, node: unknown, where: string): string[] {
  const probe: GuiDocument = { ...doc, nodes: [...doc.nodes.filter(n => !isRecord(node) || n.id !== (node as GuiNode).id), node as GuiNode] };
  return validateGuiDocument(probe).map(e => `${where}: ${e}`);
}

guiRegistry.register<{ node: GuiNode }>({
  name: "gui.addNode", describe: "Add one GUI node", invertible: true,
  validate: p => !p || !isRecord((p as any).node) ? ["params must be { node }"] : [],
  check: (doc, p) => doc.nodes.some(n => n.id === p.node.id) ? [`node "${p.node.id}" already exists`] : nodeErrors(doc, p.node, "gui.addNode"),
  capture: () => ({ prev: null } as NodeFrame),
  apply: (doc, p) => ({ ...doc, nodes: [...doc.nodes, cloneNode(p.node)] }),
  invert: (doc, p) => ({ ...doc, nodes: doc.nodes.filter(n => n.id !== p.node.id) }),
});

guiRegistry.register<{ ids: string[] }>({
  name: "gui.removeNodes", describe: "Remove nodes (a subtree)", invertible: true,
  validate: p => !p || !Array.isArray((p as any).ids) || (p as any).ids.some((i: unknown) => typeof i !== "string") ? ["params must be { ids: string[] }"] : [],
  check: (doc, p) => p.ids.filter(id => !doc.nodes.some(n => n.id === id)).map(id => `node "${id}" is not present`),
  capture: (doc, p) => ({ prevNodes: doc.nodes.filter(n => p.ids.includes(n.id)).map(cloneNode) }),
  apply: (doc, p) => ({ ...doc, nodes: doc.nodes.filter(n => !p.ids.includes(n.id)) }),
  invert: (doc, _p, frame) => {
    const prev = (frame as { prevNodes?: GuiNode[] } | undefined)?.prevNodes;
    if (!prev) throw new Error("Missing or invalid inverse frame");
    return { ...doc, nodes: [...doc.nodes, ...prev.map(cloneNode)] };
  },
});

guiRegistry.register<{ id: string; props: Record<string, unknown> }>({
  name: "gui.setProps", describe: "Merge a prop patch into one node", invertible: true,
  validate: p => !p || typeof (p as any).id !== "string" || !isRecord((p as any).props) ? ["params must be { id, props }"] : [],
  check: (doc, p) => doc.nodes.some(n => n.id === p.id) ? [] : [`node "${p.id}" is not present`],
  capture: (doc, p) => ({ prev: doc.nodes.find(n => n.id === p.id) ?? null } as NodeFrame),
  apply: (doc, p) => ({ ...doc, nodes: doc.nodes.map(n => n.id === p.id ? { ...n, props: { ...n.props, ...p.props } } : n) }),
  invert: (doc, _p, frame) => {
    const prev = (frame as NodeFrame | undefined)?.prev;
    if (!prev) throw new Error("Missing or invalid inverse frame");
    return { ...doc, nodes: doc.nodes.map(n => n.id === prev.id ? cloneNode(prev) : n) };
  },
});

guiRegistry.register<{ id: string; device: Device; rect: LayoutRect; separate: boolean }>({
  name: "gui.setLayout", describe: "Set one node's rect for a device (mirrored when not separate)", invertible: true,
  validate: p => !p || typeof (p as any).id !== "string" || !DEVICES.includes((p as any).device) || rectErrors((p as any).rect, "rect").length > 0 ? ["params must be { id, device, rect, separate }"] : [],
  check: (doc, p) => doc.nodes.some(n => n.id === p.id) ? [] : [`node "${p.id}" is not present`],
  capture: (doc, p) => ({ prev: doc.nodes.find(n => n.id === p.id) ?? null } as NodeFrame),
  apply: (doc, p) => ({
    ...doc,
    nodes: doc.nodes.map(n => {
      if (n.id !== p.id) return n;
      const layouts = { ...n.layouts };
      if (p.separate) layouts[p.device] = { ...p.rect };
      else for (const d of DEVICES) layouts[d] = { ...p.rect };
      return { ...n, layouts };
    }),
  }),
  invert: (doc, _p, frame) => {
    const prev = (frame as NodeFrame | undefined)?.prev;
    if (!prev) throw new Error("Missing or invalid inverse frame");
    return { ...doc, nodes: doc.nodes.map(n => n.id === prev.id ? cloneNode(prev) : n) };
  },
});

guiRegistry.register<{ id: string; parentId: string | null }>({
  name: "gui.reparent", describe: "Move one node under a new parent (or the root)", invertible: true,
  validate: p => !p || typeof (p as any).id !== "string" || ((p as any).parentId !== null && typeof (p as any).parentId !== "string") ? ["params must be { id, parentId }"] : [],
  check: (doc, p) => {
    const errors: string[] = [];
    if (!doc.nodes.some(n => n.id === p.id)) errors.push(`node "${p.id}" is not present`);
    if (p.parentId != null) {
      const parent = doc.nodes.find(n => n.id === p.parentId);
      if (!parent) errors.push(`parent "${p.parentId}" is not present`);
      else if (!getControlData(parent.type)?.container) errors.push(`parent "${p.parentId}" is not a container`);
      let cur = parent;
      while (cur) { if (cur.id === p.id) { errors.push("reparent would create a cycle"); break; } cur = doc.nodes.find(n => n.id === cur!.parentId) as GuiNode | undefined; }
    }
    return errors;
  },
  capture: (doc, p) => ({ prev: doc.nodes.find(n => n.id === p.id) ?? null } as NodeFrame),
  apply: (doc, p) => ({ ...doc, nodes: doc.nodes.map(n => n.id === p.id ? { ...n, parentId: p.parentId } : n) }),
  invert: (doc, _p, frame) => {
    const prev = (frame as NodeFrame | undefined)?.prev;
    if (!prev) throw new Error("Missing or invalid inverse frame");
    return { ...doc, nodes: doc.nodes.map(n => n.id === prev.id ? cloneNode(prev) : n) };
  },
});

guiRegistry.register<{ node: GuiNode }>({
  name: "gui.setNode", describe: "Replace one node wholesale (layout mode, grid placement, struts, flags)", invertible: true,
  validate: p => !p || !isRecord((p as any).node) ? ["params must be { node }"] : [],
  check: (doc, p) => doc.nodes.some(n => n.id === p.node.id) ? nodeErrors(doc, p.node, "gui.setNode") : [`node "${p.node.id}" is not present`],
  capture: (doc, p) => ({ prev: doc.nodes.find(n => n.id === p.node.id) ?? null } as NodeFrame),
  apply: (doc, p) => ({ ...doc, nodes: doc.nodes.map(n => n.id === p.node.id ? cloneNode(p.node) : n) }),
  invert: (doc, _p, frame) => {
    const prev = (frame as NodeFrame | undefined)?.prev;
    if (!prev) throw new Error("Missing or invalid inverse frame");
    return { ...doc, nodes: doc.nodes.map(n => n.id === prev.id ? cloneNode(prev) : n) };
  },
});

guiRegistry.register<{ device?: Device; separateLayouts?: boolean }>({
  name: "gui.setDocument", describe: "Set document-level fields (device, separateLayouts)", invertible: true,
  validate: p => !p || typeof p !== "object" ? ["params must be an object"] : [],
  capture: doc => ({ prevDoc: { device: doc.device, separateLayouts: doc.separateLayouts } }),
  apply: (doc, p) => ({ ...doc, ...(p.device ? { device: p.device } : {}), ...(p.separateLayouts !== undefined ? { separateLayouts: p.separateLayouts } : {}) }),
  invert: (doc, _p, frame) => {
    const prev = (frame as { prevDoc?: { device: Device; separateLayouts: boolean } } | undefined)?.prevDoc;
    if (!prev) throw new Error("Missing or invalid inverse frame");
    return { ...doc, ...prev };
  },
});

export type GuiMorph = ScopedAppliedMorph;
export const guiHistory = createHistory<GuiDocument, ScopedAppliedMorph>({
  apply: (state, morph) => guiRegistry.applyMorph(state, morph),
  invert: (state, morph) => guiRegistry.invertMorph(state, morph),
});
export type GuiHistoryStep = { snapshot: GuiDocument; morph: ScopedAppliedMorph | null };

/** Apply one gui morph with registry validation + checked state rules. */
export function applyGuiMorph(doc: GuiDocument, morph: ScopedAppliedMorph): { ok: true; doc: GuiDocument; applied: ScopedAppliedMorph } | { ok: false; errors: string[] } {
  const checkErrors = guiRegistry.checkMorphState(morph.name, doc, morph.params);
  if (checkErrors.length) return { ok: false, errors: checkErrors };
  const def = guiRegistry.get(morph.name);
  const applied: ScopedAppliedMorph = { ...morph, inverse: def?.capture ? def.capture(doc, morph.params) : morph.inverse };
  const res = guiRegistry.applyMorph(doc, applied);
  return res.ok ? { ok: true, doc: res.state, applied } : { ok: false, errors: res.errors };
}

/**
 * Save publication, following chainForSave's rule: publish the full
 * replayable chain only when a checked replay of base + chain lands exactly
 * on the current document; otherwise checkpoint the snapshot as the base.
 */
export function chainForGuiSave(args: { base: GuiDocument; chain: ScopedAppliedMorph[]; current: GuiDocument }): GuiPlanFile {
  const { base, chain, current } = args;
  const recaptured = guiRegistry.recaptureFrames(base, chain, cloneGuiDocument);
  const replayed = guiRegistry.replayMorphsChecked(base, recaptured, {}, cloneGuiDocument);
  const validBase = validateGuiDocument(base).length === 0;
  const full = guiRegistry.publishesFullChain(validBase, guiRegistry.validateChain(recaptured).length === 0, replayed.ok, replayed.ok && JSON.stringify(replayed.state) === JSON.stringify(current));
  if (full && replayed.ok) return { schema: "paramorphic-gui-plan/1", base: cloneGuiDocument(base), morphs: recaptured, snapshot: cloneGuiDocument(current) };
  return { schema: "paramorphic-gui-plan/1", base: cloneGuiDocument(current), morphs: [], snapshot: cloneGuiDocument(current), checkpointed: true };
}

/** Load a saved GUI plan file: validate base + snapshot, replay the chain, compare. */
export function loadGuiPlan(data: unknown): { ok: true; doc: GuiDocument; base: GuiDocument; chain: ScopedAppliedMorph[]; checkpointed: boolean } | { ok: false; errors: string[] } {
  if (!isRecord(data)) return { ok: false, errors: ["GUI plan must be an object"] };
  // A bare document is also loadable (it is its own snapshot).
  if ((data as GuiDocument).schema === "paramorphic-gui/1") {
    const doc = loadGuiDocument(data);
    return doc.ok ? { ok: true, doc: doc.doc, base: cloneGuiDocument(doc.doc), chain: [], checkpointed: true } : doc;
  }
  const file = data as GuiPlanFile;
  if (file.schema !== "paramorphic-gui-plan/1") return { ok: false, errors: ['Unsupported GUI plan version (expected "paramorphic-gui-plan/1" or a "paramorphic-gui/1" document)'] };
  const base = loadGuiDocument(file.base);
  if (!base.ok) return { ok: false, errors: base.errors.map(e => `base: ${e}`) };
  const snap = loadGuiDocument(file.snapshot);
  if (!snap.ok) return { ok: false, errors: snap.errors.map(e => `snapshot: ${e}`) };
  const chainErrors = guiRegistry.validateChain(file.morphs);
  if (chainErrors.length) return { ok: false, errors: chainErrors };
  const replayed = guiRegistry.replayMorphsChecked(base.doc, file.morphs, {}, cloneGuiDocument);
  if (!replayed.ok) return { ok: false, errors: replayed.errors };
  if (JSON.stringify(replayed.state) !== JSON.stringify(snap.doc)) return { ok: false, errors: ["Replayed chain does not match the saved snapshot"] };
  return { ok: true, doc: snap.doc, base: base.doc, chain: file.morphs, checkpointed: file.checkpointed === true };
}
