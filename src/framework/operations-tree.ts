// ---------- Operations binding: Tree (README §8.7, §6.3) ----------
// The seven verbs over the disjoint TreeState (tree-state.ts). This is
// the same ground the tree vocabulary (morphs/tree2.ts) covers as
// morphs — tree.addNode is Insert, tree.removeNode is Delete with the
// fallout slot bound to refuse, tree.reparent is Move — reconciled
// here as operations, not re-invented: the checks below state the same
// rules in the adapter's terms, and verify:operations runs the same
// scenarios through both and compares the resulting states.
// A text document is this binding's first reading: a folder is a
// section, a file is a paragraph or sentence, the label is its text.
import type { TreeNode, TreeState } from "./tree-state";
import type { FalloutPolicy, SubstrateAdapter } from "./operations";

export type TreePosition = { parent: string | null; index?: number };
type TreeContent = { id: string; kind: TreeNode["kind"]; label: string };

function siblings(state: TreeState, parent: string | null): TreeNode[] {
  return state.nodes.filter(n => n.parent === parent);
}

function isDescendant(state: TreeState, nodeId: string, ancestorId: string): boolean {
  let cur = state.nodes.find(n => n.id === nodeId);
  const seen = new Set<string>();
  while (cur) {
    if (cur.parent === ancestorId) return true;
    if (!cur.parent || seen.has(cur.parent)) return false;
    seen.add(cur.parent);
    cur = state.nodes.find(n => n.id === cur!.parent!);
  }
  return false;
}

function descendants(state: TreeState, id: string): string[] {
  const out: string[] = [];
  const walk = (parent: string) => {
    for (const n of state.nodes) if (n.parent === parent) { out.push(n.id); walk(n.id); }
  };
  walk(id);
  return out;
}

/** Place `node` into the array so it becomes the index-th sibling under
 *  its parent (appended among siblings when index is absent or past the
 *  end). The array order among siblings IS the tree's sibling order. */
function placeAmongSiblings(nodes: TreeNode[], node: TreeNode, index?: number): TreeNode[] {
  const sibs = nodes.filter(n => n.parent === node.parent);
  if (index === undefined || index >= sibs.length) {
    const lastSib = sibs[sibs.length - 1];
    if (!lastSib) return [...nodes, node];
    const at = nodes.indexOf(lastSib);
    return [...nodes.slice(0, at + 1), node, ...nodes.slice(at + 1)];
  }
  const before = sibs[index];
  const at = nodes.indexOf(before);
  return [...nodes.slice(0, at), node, ...nodes.slice(at)];
}

export const treeOperations: SubstrateAdapter<TreeState> = {
  name: "tree",
  defaultFallout: "refuse",

  refs: state => state.nodes.map(n => n.id),

  content: (state, ref) => {
    const n = state.nodes.find(x => x.id === ref)!;
    return { id: n.id, kind: n.kind, label: n.label } satisfies TreeContent;
  },

  position: (state, ref) => {
    const n = state.nodes.find(x => x.id === ref)!;
    return { parent: n.parent, index: siblings(state, n.parent).indexOf(n) } satisfies TreePosition;
  },

  refOfContent: content => (content as TreeContent).id,

  checkInsert: (state, position, content) => {
    const errors: string[] = [];
    const c = content as TreeContent;
    const pos = (position ?? {}) as TreePosition;
    if (!c || typeof c.id !== "string" || !c.id) errors.push("inserted node needs a non-empty id");
    if (c && c.kind !== "folder" && c.kind !== "file") errors.push(`node "${c?.id}" must have kind "folder" or "file"`);
    if (c && (typeof c.label !== "string" || !c.label)) errors.push(`node "${c?.id}" needs a label`);
    if (errors.length > 0) return errors;
    if (state.nodes.some(n => n.id === c.id)) errors.push(`node "${c.id}" already exists`);
    if (pos.parent !== null && pos.parent !== undefined) {
      const target = state.nodes.find(n => n.id === pos.parent);
      if (!target) errors.push(`parent "${pos.parent}" is not present`);
      else if (target.kind !== "folder") errors.push(`parent "${pos.parent}" is a ${target.kind}, not a folder`);
    }
    if (pos.index !== undefined && (!Number.isInteger(pos.index) || pos.index < 0)) {
      errors.push(`index must be a non-negative integer`);
    }
    return errors;
  },

  insert: (state, position, content) => {
    const c = content as TreeContent;
    const pos = (position ?? {}) as TreePosition;
    const node: TreeNode = { id: c.id, kind: c.kind, label: c.label, parent: pos.parent ?? null };
    return { nodes: placeAmongSiblings(state.nodes, node, pos.index) };
  },

  checkDelete: (state, ref, fallout) => {
    if (!state.nodes.some(n => n.id === ref)) return [`node "${ref}" is not present`];
    if (fallout === "detach") {
      return [`the tree binding does not support "detach" fallout; bind "promote" or "cascade"`];
    }
    if (fallout === "refuse") {
      const kids = state.nodes.filter(n => n.parent === ref);
      if (kids.length > 0) return [`node "${ref}" has ${kids.length} children; remove or reparent them first`];
    }
    return [];
  },

  remove: (state, ref, fallout: FalloutPolicy) => {
    const node = state.nodes.find(n => n.id === ref)!;
    if (fallout === "cascade") {
      const gone = new Set([ref, ...descendants(state, ref)]);
      return { nodes: state.nodes.filter(n => !gone.has(n.id)) };
    }
    if (fallout === "promote") {
      return {
        nodes: state.nodes
          .filter(n => n.id !== ref)
          .map(n => (n.parent === ref ? { ...n, parent: node.parent } : n)),
      };
    }
    return { nodes: state.nodes.filter(n => n.id !== ref) };
  },

  checkReplace: (state, ref, content) => {
    const node = state.nodes.find(n => n.id === ref);
    if (!node) return [`node "${ref}" is not present`];
    const c = content as TreeContent;
    if (!c || c.id !== ref) return [`replace content must carry the target's id ("${ref}") — position and identity change through Move and Insert, not Replace`];
    if (c.kind !== "folder" && c.kind !== "file") return [`node "${ref}" must have kind "folder" or "file"`];
    if (typeof c.label !== "string" || !c.label) return [`node "${ref}" needs a label`];
    return [];
  },

  replace: (state, ref, content) => {
    const c = content as TreeContent;
    return { nodes: state.nodes.map(n => (n.id === ref ? { ...n, kind: c.kind, label: c.label } : n)) };
  },

  checkMove: (state, ref, position) => {
    const node = state.nodes.find(n => n.id === ref);
    if (!node) return [`node "${ref}" is not present`];
    const pos = (position ?? {}) as TreePosition;
    if (pos.parent !== null && pos.parent !== undefined) {
      const target = state.nodes.find(n => n.id === pos.parent);
      if (!target) return [`parent "${pos.parent}" is not present`];
      if (target.kind !== "folder") return [`parent "${pos.parent}" is a ${target.kind}, not a folder`];
      if (pos.parent === ref) return [`node "${ref}" cannot parent itself`];
      if (isDescendant(state, pos.parent, ref)) {
        return [`reparenting "${ref}" under "${pos.parent}" would form a cycle`];
      }
    }
    if (pos.index !== undefined && (!Number.isInteger(pos.index) || pos.index < 0)) {
      return [`index must be a non-negative integer`];
    }
    return [];
  },

  move: (state, ref, position) => {
    const pos = (position ?? {}) as TreePosition;
    const node = state.nodes.find(n => n.id === ref)!;
    const moved: TreeNode = { ...node, parent: pos.parent ?? node.parent };
    const rest = state.nodes.filter(n => n.id !== ref);
    return { nodes: placeAmongSiblings(rest, moved, pos.index) };
  },

  equalContent: (a, b) => JSON.stringify(a) === JSON.stringify(b),
  equalPosition: (a, b) => JSON.stringify(a) === JSON.stringify(b),
};
