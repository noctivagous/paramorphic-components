// Disjoint tree vocabulary: same contract, no Grid substrate.
// Registers into its own scoped registry (never the global REGISTRY), over
// TreeState (never PlanState). Node identity is the id string; there are no
// anchors, spans, widths, or heights to validate. Reuses the generic scoped
// contract only: validate/check/capture/apply/invert plus checked replay.
import { createMorphRegistry, type MorphRegistry } from "./scoped";
import { cloneTreeState, treeNodesEqual, type TreeNode, type TreeState } from "../tree-state";

export const treeRegistry: MorphRegistry<TreeState> = createMorphRegistry<TreeState>();

function isDescendant(nodes: TreeNode[], nodeId: string, ancestorId: string): boolean {
  let cur = nodes.find(n => n.id === nodeId);
  const seen = new Set<string>();
  while (cur) {
    if (cur.parent === ancestorId) return true;
    if (!cur.parent || seen.has(cur.parent)) return false;
    seen.add(cur.parent);
    cur = nodes.find(n => n.id === cur!.parent!);
  }
  return false;
}

function validateNodeShape(n: unknown): string[] {
  const node = n as TreeNode;
  if (!node || typeof node.id !== "string" || !node.id) return ["node.id must be a non-empty string"];
  if (node.kind !== "folder" && node.kind !== "file") {
    return [`node "${node.id}" must have kind "folder" or "file" (got "${(node as any).kind}")`];
  }
  if (typeof node.label !== "string" || !node.label) return [`node "${node.id}" needs a label`];
  if (node.parent !== null && typeof node.parent !== "string") {
    return [`node "${node.id}" parent must be a node id or null`];
  }
  if ("anchor" in (node as any) || "span" in (node as any)) {
    return [`node "${node.id}" must not carry Grid fields (anchor/span)`];
  }
  return [];
}

treeRegistry.register<{ node: TreeNode }>({
  name: "tree.addNode",
  describe: "Add one disjoint tree node",
  invertible: true,
  validate: p => {
    if (!p || typeof p !== "object") return ["params must be { node }"];
    return validateNodeShape((p as { node: TreeNode }).node);
  },
  check: (state, p) => {
    if (state.nodes.some(n => n.id === p.node.id)) return [`node "${p.node.id}" already exists`];
    if (p.node.parent !== null) {
      const target = state.nodes.find(n => n.id === p.node.parent);
      if (!target) return [`parent "${p.node.parent}" is not present`];
      if (target.kind !== "folder") return [`parent "${p.node.parent}" is a ${target.kind}, not a folder`];
    }
    return [];
  },
  capture: (state, p) => ({ prev: state.nodes.find(n => n.id === p.node.id) ?? null }),
  apply: (state, p) => ({ nodes: [...state.nodes, { ...p.node }] }),
  invert: (state, p, undoCtx) => {
    const frame = undoCtx as { prev?: TreeNode | null } | undefined;
    if (!frame || !("prev" in frame)) throw new Error("tree.addNode has no inverse data; cannot invert");
    if (frame.prev) return { nodes: state.nodes.map(n => (n.id === frame.prev!.id ? { ...frame.prev! } : n)) };
    return { nodes: state.nodes.filter(n => n.id !== p.node.id) };
  },
});

treeRegistry.register<{ id: string }>({
  name: "tree.removeNode",
  describe: "Remove one childless disjoint tree node",
  invertible: true,
  validate: p => {
    if (!p || typeof (p as { id: string }).id !== "string" || !(p as { id: string }).id) {
      return ["params must be { id }"];
    }
    return [];
  },
  check: (state, p) => {
    if (!state.nodes.some(n => n.id === p.id)) return [`node "${p.id}" is not present`];
    const kids = state.nodes.filter(n => n.parent === p.id);
    if (kids.length > 0) {
      return [`node "${p.id}" has ${kids.length} children; remove or reparent them first`];
    }
    return [];
  },
  capture: (state, p) => ({ prev: state.nodes.find(n => n.id === p.id) ?? null }),
  apply: (state, p) => ({ nodes: state.nodes.filter(n => n.id !== p.id) }),
  invert: (state, _p, undoCtx) => {
    const frame = undoCtx as { prev?: TreeNode | null } | undefined;
    if (!frame || !("prev" in frame)) throw new Error("tree.removeNode has no inverse data; cannot invert");
    if (!frame.prev) return state;
    return { nodes: [...state.nodes, { ...frame.prev }] };
  },
});

treeRegistry.register<{ id: string; parent: string }>({
  name: "tree.reparent",
  describe: "Move one disjoint node under another folder",
  invertible: true,
  validate: p => {
    if (!p || typeof p !== "object") return ["params must be { id, parent }"];
    const { id, parent } = p as { id: string; parent: string };
    if (typeof id !== "string" || !id) return ["id must be a non-empty string"];
    if (typeof parent !== "string" || !parent) return ["parent must be a non-empty string"];
    return [];
  },
  check: (state, p) => {
    const node = state.nodes.find(n => n.id === p.id);
    if (!node) return [`node "${p.id}" is not present`];
    const target = state.nodes.find(n => n.id === p.parent);
    if (!target) return [`parent "${p.parent}" is not present`];
    if (target.kind !== "folder") return [`parent "${p.parent}" is a ${target.kind}, not a folder`];
    if (p.id === p.parent) return [`node "${p.id}" cannot parent itself`];
    if (isDescendant(state.nodes, p.parent, p.id)) {
      return [`reparenting "${p.id}" under "${p.parent}" would form a cycle`];
    }
    return [];
  },
  capture: (state, p) => ({ prev: state.nodes.find(n => n.id === p.id) ?? null }),
  apply: (state, p) => ({
    nodes: state.nodes.map(n => (n.id === p.id ? { ...n, parent: p.parent } : n)),
  }),
  invert: (state, _p, undoCtx) => {
    const frame = undoCtx as { prev?: TreeNode | null } | undefined;
    if (!frame || !("prev" in frame)) throw new Error("tree.reparent has no inverse data; cannot invert");
    if (!frame.prev) return state;
    return { nodes: state.nodes.map(n => (n.id === frame.prev!.id ? { ...frame.prev! } : n)) };
  },
});

export type TreePlanFile = {
  $schema?: string;
  base: TreeState;
  morphs: { name: string; params: any; inverse?: unknown }[];
  nodes?: TreeNode[];
};

export function loadTreePlan(file: TreePlanFile): { ok: true; state: TreeState; morphs: TreePlanFile["morphs"] } | { ok: false; errors: string[] } {
  if (!file || typeof file !== "object") return { ok: false, errors: ["tree plan must be an object"] };
  if (!file.base || !Array.isArray(file.base.nodes)) return { ok: false, errors: ["tree plan.base must be { nodes }"] };
  if (file.$schema !== undefined && file.$schema !== "paramorphic-plan/1") {
    return { ok: false, errors: [`unsupported plan version "${file.$schema}"`] };
  }
  const morphs = Array.isArray(file.morphs) ? file.morphs : [];
  for (const e of treeRegistry.validateChain(morphs)) return { ok: false, errors: [e] };
  const replayed = treeRegistry.replayMorphsChecked(file.base, morphs, {}, cloneTreeState);
  if (!replayed.ok) return { ok: false, errors: replayed.errors };
  const expected: TreeState = file.nodes ? { nodes: file.nodes } : replayed.state;
  if (file.nodes) {
    const mismatch = treeNodesEqual(replayed.state, expected);
    if (mismatch) return { ok: false, errors: [`tree plan replay mismatch: ${mismatch}`] };
  }
  return { ok: true, state: replayed.state, morphs: treeRegistry.recaptureFrames(file.base, morphs, cloneTreeState) };
}

export function chainForTreeSave(
  base: TreeState,
  chain: TreePlanFile["morphs"],
  current: TreeState
): { base: TreeState; morphs: TreePlanFile["morphs"]; checkpointed: boolean } {
  const replayed = treeRegistry.replayMorphs(base, chain, {}, cloneTreeState);
  if (replayed.ok && treeNodesEqual(replayed.state, current) === null) {
    return { base, morphs: chain, checkpointed: false };
  }
  return { base: { nodes: current.nodes.map(n => ({ ...n })) }, morphs: [], checkpointed: true };
}
