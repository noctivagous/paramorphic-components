// DomTreeState: the JIT mirror of an external document tree (README §8.6).
// A disjoint tree state in the tree-state.ts sense — no Grid fields — but
// the node record is the generalized one the JIT plan specifies: mirror id,
// parent, tag, policy-filtered attrs, direct text, an optional pruned-child
// count, and an optional rect that only a rendered host may supply.
//
// Invariant: `nodes` is kept in document order (pre-order: a node precedes
// its descendants, children appear in source order). Derivation establishes
// it; the dom.* morphs preserve it; helpers below rely on it.

export type DomRect = { x: number; y: number; width: number; height: number };

export type DomNode = {
  id: string;
  parent: string | null;
  /** Lowercased element tag, or "#text" / "#comment". */
  tag: string;
  attrs: Record<string, string>;
  /** Direct text (truncated by policy): content on "#text" nodes; a
   *  leaf-ish summary (title, heading, cell) on elements that carry one. */
  text?: string;
  /** How many child subtrees the policy cut directly under this node. */
  pruned?: number;
  /** Rendered-host geometry only; absent — never zero-filled — in a parse. */
  rect?: DomRect;
};

export type DomTreeState = {
  nodes: DomNode[];
};

export const cloneDomTreeState = (s: DomTreeState): DomTreeState => ({
  nodes: s.nodes.map(n => ({
    ...n,
    attrs: { ...n.attrs },
    ...(n.rect ? { rect: { ...n.rect } } : {}),
  })),
});

/** Order-sensitive equality: document order is part of the state's meaning. */
export function domTreesEqual(a: DomTreeState, b: DomTreeState): string | null {
  if (a.nodes.length !== b.nodes.length) {
    return `state has ${a.nodes.length} nodes but other state has ${b.nodes.length}`;
  }
  for (let i = 0; i < a.nodes.length; i++) {
    if (JSON.stringify(a.nodes[i]) !== JSON.stringify(b.nodes[i])) {
      return `node "${a.nodes[i].id}" at document position ${i} differs`;
    }
  }
  return null;
}

export function domNodeById(state: DomTreeState, id: string): DomNode | undefined {
  return state.nodes.find(n => n.id === id);
}

/** Direct children of a node, in document order (null = the roots). */
export function domChildren(state: DomTreeState, parent: string | null): DomNode[] {
  return state.nodes.filter(n => n.parent === parent);
}

/** Index of a node among its siblings (document order), or -1. */
export function domChildIndex(state: DomTreeState, id: string): number {
  const node = domNodeById(state, id);
  if (!node) return -1;
  return domChildren(state, node.parent).findIndex(n => n.id === id);
}

export function isDomDescendant(nodes: DomNode[], nodeId: string, ancestorId: string): boolean {
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

/** The node's whole subtree (itself first), in document order. */
export function domSubtree(state: DomTreeState, id: string): DomNode[] {
  const start = state.nodes.findIndex(n => n.id === id);
  if (start < 0) return [];
  const out: DomNode[] = [];
  for (let i = start; i < state.nodes.length; i++) {
    const n = state.nodes[i];
    if (i > start && !isDomDescendant(state.nodes, n.id, id)) break;
    out.push(n);
  }
  return out;
}

/** All node ids in document order — the mirror's canonical walk. */
export function domDocumentOrder(state: DomTreeState): string[] {
  return state.nodes.map(n => n.id);
}

function validateDomRect(r: unknown): string[] {
  const rect = r as DomRect;
  if (!rect || typeof rect !== "object") return ["rect must be an object"];
  for (const k of ["x", "y", "width", "height"] as const) {
    if (typeof rect[k] !== "number" || !Number.isFinite(rect[k])) {
      return [`rect.${k} must be a finite number`];
    }
  }
  if (rect.width < 0 || rect.height < 0) return ["rect width/height must be non-negative"];
  return [];
}

export function validateDomNodeShape(n: unknown): string[] {
  const node = n as DomNode;
  if (!node || typeof node !== "object") return ["node must be an object"];
  if (typeof node.id !== "string" || !node.id) return ["node.id must be a non-empty string"];
  if (typeof node.tag !== "string" || !node.tag) return [`node "${node.id}" tag must be a non-empty string`];
  if (node.parent !== null && typeof node.parent !== "string") {
    return [`node "${node.id}" parent must be a node id or null`];
  }
  if (!node.attrs || typeof node.attrs !== "object" || Array.isArray(node.attrs)) {
    return [`node "${node.id}" attrs must be a string record`];
  }
  for (const [k, v] of Object.entries(node.attrs)) {
    if (typeof v !== "string") return [`node "${node.id}" attr "${k}" must be a string`];
  }
  if (node.text !== undefined && typeof node.text !== "string") {
    return [`node "${node.id}" text must be a string`];
  }
  if (node.pruned !== undefined && (!Number.isInteger(node.pruned) || node.pruned < 0)) {
    return [`node "${node.id}" pruned must be a non-negative integer`];
  }
  if (node.rect !== undefined) {
    const errs = validateDomRect(node.rect);
    if (errs.length > 0) return errs.map(e => `node "${node.id}": ${e}`);
  }
  if ("anchor" in (node as any) || "span" in (node as any) || "children" in (node as any)) {
    return [`node "${node.id}" must not carry Grid fields or a children list (parent links only)`];
  }
  return [];
}

/** Base/snapshot validation: shape, unique ids, live parents, no cycles,
 *  nothing parented under a text node. Mirrors checkTreeNodes (tree2.ts). */
export function checkDomNodes(nodes: unknown): string[] {
  if (!Array.isArray(nodes)) return ["dom nodes must be an array"];
  const list = nodes as DomNode[];
  const errs: string[] = [];
  list.forEach((n, i) => {
    for (const e of validateDomNodeShape(n)) errs.push(`nodes[${i}]: ${e}`);
  });
  const seen = new Map<string, number>();
  list.forEach((n, i) => {
    if (n && typeof n.id === "string" && n.id) {
      if (seen.has(n.id)) errs.push(`duplicate node "${n.id}" (nodes[${seen.get(n.id)}] and nodes[${i}])`);
      else seen.set(n.id, i);
    }
  });
  const byId = new Map<string, DomNode>();
  for (const n of list) {
    if (n && typeof n.id === "string" && n.id && !byId.has(n.id)) byId.set(n.id, n);
  }
  for (const n of list) {
    if (!n || typeof n.id !== "string" || !n.id) continue;
    if (n.parent !== null && n.parent !== undefined) {
      if (typeof n.parent !== "string") continue; // shape error already reported
      const target = byId.get(n.parent);
      if (!target) errs.push(`node "${n.id}" parent "${n.parent}" is not present`);
      else if (target.tag === "#text" || target.tag === "#comment") {
        errs.push(`node "${n.id}" is parented under ${target.tag} node "${n.parent}", which cannot have children`);
      }
    }
  }
  for (const n of list) {
    if (!n || typeof n.id !== "string" || !n.id) continue;
    const visited = new Set<string>([n.id]);
    let cur: string | null | undefined = n.parent;
    while (typeof cur === "string" && cur) {
      if (visited.has(cur)) {
        errs.push(`cycle at node "${n.id}" via "${cur}"`);
        break;
      }
      visited.add(cur);
      const next = byId.get(cur);
      if (!next) break;
      cur = next.parent;
    }
  }
  return errs;
}
