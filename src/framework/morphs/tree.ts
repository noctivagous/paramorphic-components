// ---------- Tree morph vocabulary: the non-Grid proof ----------
// Hierarchy over the same occupant substrate, with invariants no grid morph
// has: ids are unique, removals require childlessness, reparents must target
// an existing folder without forming a cycle. Registered in isolation like
// every vocabulary — replay, undo, redo and serialization run through the
// shared contract unchanged, which is what makes this the §3 non-Grid proof.
import type { Occupant } from "../types";
import { removeOccupant, upsertOccupant } from "../editing";
import { needPrevFrame, registerMorph, type MorphContext, type PlanState } from "./registry";

const isPos = (v: unknown): v is { q: number; r: number } =>
  !!v && typeof (v as any).q === "number" && typeof (v as any).r === "number";

const parentOf = (o: Occupant): string | null =>
  typeof (o.data as any)?.parent === "string" ? (o.data as any).parent : null;

function validateNode(o: unknown): string[] {
  const occ = o as Occupant;
  if (!occ || typeof occ.id !== "string" || !occ.id) return ["occ.id must be a non-empty string"];
  if (occ.type !== "folder" && occ.type !== "file") {
    return [`occ "${occ.id}" must be type "folder" or "file" (got "${(occ as any).type}")`];
  }
  if (!isPos(occ.anchor)) return [`occ "${occ.id}" needs a numeric anchor {q,r}`];
  const data = (occ.data ?? {}) as Record<string, unknown>;
  if (typeof data.label !== "string" || !data.label) return [`occ "${occ.id}" needs a label`];
  if (data.parent !== undefined && data.parent !== null && typeof data.parent !== "string") {
    return [`occ "${occ.id}" parent must be a node id or null`];
  }
  return [];
}

/** True when ancestorId appears on node's parent chain (cycle detection). */
function isDescendantOf(occupants: Occupant[], nodeId: string, ancestorId: string): boolean {
  let cur = occupants.find(o => o.id === nodeId);
  const seen = new Set<string>();
  while (cur) {
    const p = parentOf(cur);
    if (p === ancestorId) return true;
    if (!p || seen.has(p)) return false;
    seen.add(p);
    cur = occupants.find(o => o.id === p);
  }
  return false;
}

function needFrame(undoCtx: unknown, morph: string): { prev?: Occupant | null } {
  return needPrevFrame<Occupant>(undoCtx, morph);
}

function capturePrev(state: PlanState, id: string): { prev: Occupant | null } {
  return { prev: state.occupants.find(o => o.id === id) ?? null };
}

registerMorph<{ occ: Occupant }>({
  name: "tree.addNode",
  describe: "Add one tree node",
  invertible: true,
  validate: (p, _ctx: MorphContext) => {
    if (!p || typeof p !== "object") return ["params must be { occ }"];
    return validateNode((p as { occ: Occupant }).occ);
  },
  check: (state, p) => {
    if (state.occupants.some(o => o.id === p.occ.id)) return [`node "${p.occ.id}" already exists`];
    const parent = parentOf(p.occ);
    if (parent !== null && !state.occupants.some(o => o.id === parent)) {
      return [`parent "${parent}" is not present`];
    }
    return [];
  },
  capture: (state, p) => capturePrev(state, p.occ.id),
  apply: (state: PlanState, p: { occ: Occupant }) => ({
    ...state,
    occupants: upsertOccupant(state.occupants, p.occ),
  }),
  invert: (state: PlanState, p: { occ: Occupant }, undoCtx: unknown) => {
    const { prev } = needFrame(undoCtx, "tree.addNode");
    if (prev) return { ...state, occupants: upsertOccupant(state.occupants, prev) };
    return { ...state, occupants: removeOccupant(state.occupants, p.occ.id) };
  },
});

registerMorph<{ id: string }>({
  name: "tree.removeNode",
  describe: "Remove one childless tree node",
  invertible: true,
  validate: (p, _ctx: MorphContext) => {
    if (!p || typeof (p as { id: string }).id !== "string" || !(p as { id: string }).id) {
      return ["params must be { id }"];
    }
    return [];
  },
  check: (state, p) => {
    if (!state.occupants.some(o => o.id === p.id)) return [`node "${p.id}" is not present`];
    const kids = state.occupants.filter(o => parentOf(o) === p.id);
    if (kids.length > 0) {
      return [`node "${p.id}" has ${kids.length} children; remove or reparent them first`];
    }
    return [];
  },
  capture: (state, p) => capturePrev(state, p.id),
  apply: (state: PlanState, p: { id: string }) => ({
    ...state,
    occupants: removeOccupant(state.occupants, p.id),
  }),
  invert: (state: PlanState, _p: { id: string }, undoCtx: unknown) => {
    const { prev } = needFrame(undoCtx, "tree.removeNode");
    if (!prev) return state;
    return { ...state, occupants: upsertOccupant(state.occupants, prev) };
  },
});

registerMorph<{ id: string; parent: string }>({
  name: "tree.reparent",
  describe: "Move one node under another folder",
  invertible: true,
  validate: (p, _ctx: MorphContext) => {
    if (!p || typeof p !== "object") return ["params must be { id, parent }"];
    const { id, parent } = p as { id: string; parent: string };
    if (typeof id !== "string" || !id) return ["id must be a non-empty string"];
    if (typeof parent !== "string" || !parent) return ["parent must be a non-empty string"];
    return [];
  },
  check: (state, p) => {
    const node = state.occupants.find(o => o.id === p.id);
    if (!node) return [`node "${p.id}" is not present`];
    const target = state.occupants.find(o => o.id === p.parent);
    if (!target) return [`parent "${p.parent}" is not present`];
    if (target.type !== "folder") return [`parent "${p.parent}" is a ${target.type}, not a folder`];
    if (p.id === p.parent) return [`node "${p.id}" cannot parent itself`];
    if (isDescendantOf(state.occupants, p.parent, p.id)) {
      return [`reparenting "${p.id}" under "${p.parent}" would form a cycle`];
    }
    return [];
  },
  capture: (state, p) => capturePrev(state, p.id),
  apply: (state: PlanState, p: { id: string; parent: string }) => {
    const node = state.occupants.find(o => o.id === p.id);
    if (!node) return state;
    return {
      ...state,
      occupants: upsertOccupant(state.occupants, { ...node, data: { ...node.data, parent: p.parent } }),
    };
  },
  invert: (state: PlanState, _p: { id: string; parent: string }, undoCtx: unknown) => {
    const { prev } = needFrame(undoCtx, "tree.reparent");
    if (!prev) return state;
    return { ...state, occupants: upsertOccupant(state.occupants, prev) };
  },
});
