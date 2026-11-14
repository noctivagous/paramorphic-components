// The `dom` scoped vocabulary (README §8.6): morphs over a DomTreeState
// mirror. Sibling of tree2.ts, same scoped contract (validate / check /
// capture / apply / invert through the scoped registry), with the DOM
// differences the JIT plan specifies: removeNode takes a whole subtree as
// one morph (children implied); there are attribute and text writes; and
// every apply preserves the state's document-order invariant (nodes stay
// in pre-order, children in source order).
import { createMorphRegistry, type MorphRegistry } from "./scoped";
import {
  domChildIndex,
  domChildren,
  domNodeById,
  domSubtree,
  isDomDescendant,
  validateDomNodeShape,
  type DomNode,
  type DomTreeState,
} from "../dom-state";

export const domRegistry: MorphRegistry<DomTreeState> = createMorphRegistry<DomTreeState>();

const isLeafTag = (tag: string) => tag === "#text" || tag === "#comment";

/** Array index at which a child of `parent` at child-position `index`
 *  must be inserted to preserve document order. */
function insertIndexForChild(state: DomTreeState, parent: string | null, index: number): number {
  const children = domChildren(state, parent);
  if (index < children.length) return state.nodes.indexOf(children[index]);
  if (parent === null) return state.nodes.length;
  const parentNode = domNodeById(state, parent);
  if (!parentNode) return state.nodes.length;
  return state.nodes.indexOf(parentNode) + domSubtree(state, parent).length;
}

function moveBlock(state: DomTreeState, id: string, parent: string | null, index: number): DomTreeState {
  const block = domSubtree(state, id);
  const blockIds = new Set(block.map(n => n.id));
  const rest = state.nodes.filter(n => !blockIds.has(n.id));
  const reduced: DomTreeState = { nodes: rest };
  const at = insertIndexForChild(reduced, parent, index);
  const moved = block.map(n => (n.id === id ? { ...n, parent } : n));
  return { nodes: [...rest.slice(0, at), ...moved, ...rest.slice(at)] };
}

domRegistry.register<{ node: DomNode }>({
  name: "dom.addNode",
  describe: "Add one mirror node as its parent's last child",
  invertible: true,
  validate: p => {
    if (!p || typeof p !== "object") return ["params must be { node }"];
    return validateDomNodeShape((p as { node: DomNode }).node);
  },
  check: (state, p) => {
    if (state.nodes.some(n => n.id === p.node.id)) return [`node "${p.node.id}" already exists`];
    if (p.node.parent !== null) {
      const target = domNodeById(state, p.node.parent);
      if (!target) return [`parent "${p.node.parent}" is not present`];
      if (isLeafTag(target.tag)) return [`parent "${p.node.parent}" is a ${target.tag} node, which cannot have children`];
    }
    return [];
  },
  capture: (state, p) => ({ prev: state.nodes.find(n => n.id === p.node.id) ?? null }),
  apply: (state, p) => {
    const at = insertIndexForChild(state, p.node.parent, domChildren(state, p.node.parent).length);
    const nodes = [...state.nodes];
    nodes.splice(at, 0, { ...p.node, attrs: { ...p.node.attrs } });
    return { nodes };
  },
  invert: (state, p, undoCtx) => {
    const frame = undoCtx as { prev?: DomNode | null } | undefined;
    if (!frame || !("prev" in frame)) throw new Error("dom.addNode has no inverse data; cannot invert");
    if (frame.prev) {
      return { nodes: state.nodes.map(n => (n.id === frame.prev!.id ? { ...frame.prev! } : n)) };
    }
    return { nodes: state.nodes.filter(n => n.id !== p.node.id) };
  },
});

domRegistry.register<{ id: string }>({
  name: "dom.removeNode",
  describe: "Remove one mirror node and its whole subtree",
  invertible: true,
  validate: p => {
    if (!p || typeof (p as { id: string }).id !== "string" || !(p as { id: string }).id) {
      return ["params must be { id }"];
    }
    return [];
  },
  check: (state, p) => {
    if (!state.nodes.some(n => n.id === p.id)) return [`node "${p.id}" is not present`];
    return [];
  },
  capture: (state, p) => {
    const block = domSubtree(state, p.id);
    return {
      nodes: block.map(n => ({ ...n, attrs: { ...n.attrs } })),
      index: block.length > 0 ? state.nodes.indexOf(block[0]) : state.nodes.length,
    };
  },
  apply: (state, p) => {
    const ids = new Set(domSubtree(state, p.id).map(n => n.id));
    return { nodes: state.nodes.filter(n => !ids.has(n.id)) };
  },
  invert: (state, _p, undoCtx) => {
    const frame = undoCtx as { nodes?: DomNode[]; index?: number } | undefined;
    if (!frame || !Array.isArray(frame.nodes) || typeof frame.index !== "number") {
      throw new Error("dom.removeNode has no inverse data; cannot invert");
    }
    const at = Math.min(frame.index, state.nodes.length);
    const restored = frame.nodes.map(n => ({ ...n, attrs: { ...n.attrs } }));
    return { nodes: [...state.nodes.slice(0, at), ...restored, ...state.nodes.slice(at)] };
  },
});

domRegistry.register<{ id: string; attrs: Record<string, string | null> }>({
  name: "dom.setAttrs",
  describe: "Patch one mirror node's attributes (null value removes the attribute)",
  invertible: true,
  validate: p => {
    if (!p || typeof p !== "object") return ["params must be { id, attrs }"];
    const { id, attrs } = p as { id: string; attrs: Record<string, string | null> };
    if (typeof id !== "string" || !id) return ["id must be a non-empty string"];
    if (!attrs || typeof attrs !== "object" || Array.isArray(attrs)) return ["attrs must be a record"];
    for (const [k, v] of Object.entries(attrs)) {
      if (!k) return ["attr names must be non-empty strings"];
      if (v !== null && typeof v !== "string") return [`attr "${k}" must be a string or null`];
    }
    return [];
  },
  check: (state, p) => {
    if (!state.nodes.some(n => n.id === p.id)) return [`node "${p.id}" is not present`];
    return [];
  },
  capture: (state, p) => {
    const node = domNodeById(state, p.id);
    const prev: Record<string, string | null> = {};
    for (const k of Object.keys(p.attrs)) prev[k] = node && k in node.attrs ? node.attrs[k] : null;
    return { prev };
  },
  apply: (state, p) => ({
    nodes: state.nodes.map(n => {
      if (n.id !== p.id) return n;
      const attrs = { ...n.attrs };
      for (const [k, v] of Object.entries(p.attrs)) {
        if (v === null) delete attrs[k];
        else attrs[k] = v;
      }
      return { ...n, attrs };
    }),
  }),
  invert: (state, p, undoCtx) => {
    const frame = undoCtx as { prev?: Record<string, string | null> } | undefined;
    if (!frame || !frame.prev) throw new Error("dom.setAttrs has no inverse data; cannot invert");
    return {
      nodes: state.nodes.map(n => {
        if (n.id !== p.id) return n;
        const attrs = { ...n.attrs };
        for (const [k, v] of Object.entries(frame.prev!)) {
          if (v === null) delete attrs[k];
          else attrs[k] = v;
        }
        return { ...n, attrs };
      }),
    };
  },
});

domRegistry.register<{ id: string; text: string | null }>({
  name: "dom.setText",
  describe: "Set or clear (null) one mirror node's text",
  invertible: true,
  validate: p => {
    if (!p || typeof p !== "object") return ["params must be { id, text }"];
    const { id, text } = p as { id: string; text: string | null };
    if (typeof id !== "string" || !id) return ["id must be a non-empty string"];
    if (text !== null && typeof text !== "string") return ["text must be a string or null"];
    return [];
  },
  check: (state, p) => {
    if (!state.nodes.some(n => n.id === p.id)) return [`node "${p.id}" is not present`];
    return [];
  },
  capture: (state, p) => {
    const node = domNodeById(state, p.id);
    return { prev: node?.text ?? null, had: !!node && "text" in node };
  },
  apply: (state, p) => ({
    nodes: state.nodes.map(n => {
      if (n.id !== p.id) return n;
      const next = { ...n };
      if (p.text === null) delete next.text;
      else next.text = p.text;
      return next;
    }),
  }),
  invert: (state, p, undoCtx) => {
    const frame = undoCtx as { prev?: string | null; had?: boolean } | undefined;
    if (!frame || !("prev" in frame)) throw new Error("dom.setText has no inverse data; cannot invert");
    return {
      nodes: state.nodes.map(n => {
        if (n.id !== p.id) return n;
        const next = { ...n };
        if (frame.had) next.text = frame.prev as string;
        else delete next.text;
        return next;
      }),
    };
  },
});

domRegistry.register<{ id: string; parent: string | null; index: number }>({
  name: "dom.moveNode",
  describe: "Move one mirror node (with its subtree) under a new parent at a child index",
  invertible: true,
  validate: p => {
    if (!p || typeof p !== "object") return ["params must be { id, parent, index }"];
    const { id, parent, index } = p as { id: string; parent: string | null; index: number };
    if (typeof id !== "string" || !id) return ["id must be a non-empty string"];
    if (parent !== null && (typeof parent !== "string" || !parent)) {
      return ["parent must be a node id or null"];
    }
    if (!Number.isInteger(index) || index < 0) return ["index must be a non-negative integer"];
    return [];
  },
  check: (state, p) => {
    const node = domNodeById(state, p.id);
    if (!node) return [`node "${p.id}" is not present`];
    if (p.parent !== null) {
      const target = domNodeById(state, p.parent);
      if (!target) return [`parent "${p.parent}" is not present`];
      if (isLeafTag(target.tag)) return [`parent "${p.parent}" is a ${target.tag} node, which cannot have children`];
      if (p.parent === p.id) return [`node "${p.id}" cannot parent itself`];
      if (isDomDescendant(state.nodes, p.parent, p.id)) {
        return [`moving "${p.id}" under "${p.parent}" would form a cycle`];
      }
    }
    const siblings = domChildren(state, p.parent).filter(n => n.id !== p.id);
    if (p.index > siblings.length) {
      return [`index ${p.index} is past the ${siblings.length} children of ${p.parent ?? "the root level"}`];
    }
    return [];
  },
  capture: (state, p) => {
    const node = domNodeById(state, p.id);
    return { prevParent: node?.parent ?? null, prevIndex: domChildIndex(state, p.id) };
  },
  apply: (state, p) => moveBlock(state, p.id, p.parent, p.index),
  invert: (state, p, undoCtx) => {
    const frame = undoCtx as { prevParent?: string | null; prevIndex?: number } | undefined;
    if (!frame || typeof frame.prevIndex !== "number") {
      throw new Error("dom.moveNode has no inverse data; cannot invert");
    }
    return moveBlock(state, p.id, frame.prevParent ?? null, frame.prevIndex);
  },
});
