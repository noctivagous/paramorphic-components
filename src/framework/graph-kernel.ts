// ---------- Graph kernel (internal shared substrate) ----------
// README 4 / 6.2: Tree, Path and Logic are first-class components, but all
// three build on one graph substrate (nodes + edges) instead of each
// reimplementing adjacency, traversal and cycle/parent checks. This module is
// the internal kernel; the public Graph component surface grows here later.

export type GraphNode = { id: string; data?: any; tags?: string[] };
export type GraphEdge = { id: string; from: string; to: string; label?: string; data?: any };
export type Graph = { nodes: GraphNode[]; edges: GraphEdge[] };

export function buildAdjacency(graph: Graph): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  for (const n of graph.nodes) adj.set(n.id, []);
  for (const e of graph.edges) {
    if (!adj.has(e.from)) adj.set(e.from, []);
    if (!adj.has(e.to)) adj.set(e.to, []);
    adj.get(e.from)!.push(e.to);
  }
  return adj;
}

export function neighbors(graph: Graph, nodeId: string): string[] {
  return buildAdjacency(graph).get(nodeId) || [];
}

export function bfsOrder(graph: Graph, startId: string): string[] {
  const adj = buildAdjacency(graph);
  const seen = new Set<string>([startId]);
  const order: string[] = [];
  const queue = [startId];
  while (queue.length) {
    const cur = queue.shift()!;
    order.push(cur);
    for (const nxt of adj.get(cur) || []) {
      if (!seen.has(nxt)) { seen.add(nxt); queue.push(nxt); }
    }
  }
  return order;
}

export function hasCycle(graph: Graph): boolean {
  const adj = buildAdjacency(graph);
  const visiting = new Set<string>();
  const done = new Set<string>();
  const visit = (id: string): boolean => {
    if (done.has(id)) return false;
    if (visiting.has(id)) return true;
    visiting.add(id);
    for (const nxt of adj.get(id) || []) {
      if (visit(nxt)) return true;
    }
    visiting.delete(id);
    done.add(id);
    return false;
  };
  return graph.nodes.some(n => visit(n.id));
}

// Single-parent check: the future Tree component validates through this.
// Returns the ids that have more than one incoming edge.
export function singleParentViolations(graph: Graph): string[] {
  const parents = new Map<string, number>();
  for (const e of graph.edges) parents.set(e.to, (parents.get(e.to) || 0) + 1);
  return [...parents.entries()].filter(([, n]) => n > 1).map(([id]) => id);
}
