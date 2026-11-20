// ---------- Operations binding: Graph (README §8.7, §6.2) ----------
// The seven verbs over the graph kernel's state (graph-kernel.ts):
// nodes and edges are both elements, addressed by id. Insert carries a
// node as content with no position, or an edge as content with a
// { from, to } position; Move rewires an edge — and declines a node,
// because a graph node has no position to change (the substrate's own
// parameters refuse, §8.7; rewire its edges instead). Delete's fallout
// default is detach: a removed node's incident edges go with it, unless
// the binding says refuse (block while wired) — cascade reads the same
// at node grain, and promote has no graph meaning and is declined.
import type { Graph, GraphEdge, GraphNode } from "./graph-kernel";
import type { FalloutPolicy, SubstrateAdapter } from "./operations";

type EdgePosition = { from: string; to: string };

const isEdgeRef = (state: Graph, ref: string) => state.edges.some(e => e.id === ref);
const isNodeRef = (state: Graph, ref: string) => state.nodes.some(n => n.id === ref);

export const graphOperations: SubstrateAdapter<Graph> = {
  name: "graph",
  defaultFallout: "detach",

  refs: state => [...state.nodes.map(n => n.id), ...state.edges.map(e => e.id)],

  content: (state, ref) => {
    const node = state.nodes.find(n => n.id === ref);
    if (node) return { ...node };
    const edge = state.edges.find(e => e.id === ref)!;
    const { from: _f, to: _t, ...rest } = edge;
    return { ...rest };
  },

  position: (state, ref) => {
    const edge = state.edges.find(e => e.id === ref);
    if (edge) return { from: edge.from, to: edge.to } satisfies EdgePosition;
    return null;
  },

  refOfContent: content => (content as { id: string }).id,

  checkInsert: (state, position, content) => {
    const c = content as { id?: unknown };
    if (!c || typeof c.id !== "string" || !c.id) return ["inserted element needs a non-empty id"];
    if (isNodeRef(state, c.id) || isEdgeRef(state, c.id)) return [`element "${c.id}" already exists`];
    const pos = position as EdgePosition | null;
    if (pos !== null && pos !== undefined) {
      const errors: string[] = [];
      if (!isNodeRef(state, pos.from)) errors.push(`edge "${c.id}" from-node "${pos.from}" is not present`);
      if (!isNodeRef(state, pos.to)) errors.push(`edge "${c.id}" to-node "${pos.to}" is not present`);
      return errors;
    }
    return [];
  },

  insert: (state, position, content) => {
    const pos = position as EdgePosition | null;
    if (pos !== null && pos !== undefined) {
      const edge = { ...(content as Omit<GraphEdge, "from" | "to">), from: pos.from, to: pos.to };
      return { nodes: state.nodes, edges: [...state.edges, edge] };
    }
    return { nodes: [...state.nodes, { ...(content as GraphNode) }], edges: state.edges };
  },

  checkDelete: (state, ref, fallout) => {
    if (!isNodeRef(state, ref) && !isEdgeRef(state, ref)) return [`element "${ref}" is not present`];
    if (isEdgeRef(state, ref)) return [];
    if (fallout === "promote") {
      return [`the graph binding does not support "promote" fallout; bind "detach" or "refuse"`];
    }
    if (fallout === "refuse") {
      const incident = state.edges.filter(e => e.from === ref || e.to === ref);
      if (incident.length > 0) {
        return [`node "${ref}" has ${incident.length} incident edge(s); rewire or remove them first`];
      }
    }
    return [];
  },

  remove: (state, ref, _fallout: FalloutPolicy) => {
    if (isEdgeRef(state, ref)) {
      return { nodes: state.nodes, edges: state.edges.filter(e => e.id !== ref) };
    }
    return {
      nodes: state.nodes.filter(n => n.id !== ref),
      edges: state.edges.filter(e => e.from !== ref && e.to !== ref),
    };
  },

  checkReplace: (state, ref, content) => {
    if (!isNodeRef(state, ref) && !isEdgeRef(state, ref)) return [`element "${ref}" is not present`];
    const c = content as { id?: unknown };
    if (!c || c.id !== ref) {
      return [`replace content must carry the target's id ("${ref}") — wiring changes through Move, identity through Insert`];
    }
    return [];
  },

  replace: (state, ref, content) => {
    if (isNodeRef(state, ref)) {
      return {
        nodes: state.nodes.map(n => (n.id === ref ? { ...(content as GraphNode) } : n)),
        edges: state.edges,
      };
    }
    return {
      nodes: state.nodes,
      edges: state.edges.map(e => (e.id === ref ? { ...e, ...(content as Partial<GraphEdge>), from: e.from, to: e.to } : e)),
    };
  },

  checkMove: (state, ref, position) => {
    if (!isNodeRef(state, ref) && !isEdgeRef(state, ref)) return [`element "${ref}" is not present`];
    if (isNodeRef(state, ref)) {
      return [`node "${ref}" has no position to change in a graph; rewire its edges instead`];
    }
    const pos = position as EdgePosition | null;
    if (!pos || typeof pos.from !== "string" || typeof pos.to !== "string") {
      return [`moving an edge needs a { from, to } position`];
    }
    const errors: string[] = [];
    if (!isNodeRef(state, pos.from)) errors.push(`from-node "${pos.from}" is not present`);
    if (!isNodeRef(state, pos.to)) errors.push(`to-node "${pos.to}" is not present`);
    return errors;
  },

  move: (state, ref, position) => {
    const pos = position as EdgePosition;
    return {
      nodes: state.nodes,
      edges: state.edges.map(e => (e.id === ref ? { ...e, from: pos.from, to: pos.to } : e)),
    };
  },

  equalContent: (a, b) => JSON.stringify(a) === JSON.stringify(b),
  equalPosition: (a, b) => JSON.stringify(a) === JSON.stringify(b),
};
