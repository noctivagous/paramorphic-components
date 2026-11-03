// Disjoint TreeState: hierarchy with no Grid fields.
// Unlike `tree.*` (nodes stored as Grid Occupants with anchor/span inside
// width x height), this state carries only nodes. There is no width, height,
// occupants list, anchor, or span anywhere in the shape.
export type TreeNode = {
  id: string;
  kind: "folder" | "file";
  parent: string | null;
  label: string;
};

export type TreeState = {
  nodes: TreeNode[];
};

export const cloneTreeState = (s: TreeState): TreeState => ({
  nodes: s.nodes.map(n => ({ ...n })),
});

export function treeNodesEqual(a: TreeState, b: TreeState): string | null {
  const key = (n: TreeNode) => n.id;
  const ra = [...a.nodes].sort((x, y) => (key(x) < key(y) ? -1 : 1));
  const rb = [...b.nodes].sort((x, y) => (key(x) < key(y) ? -1 : 1));
  if (ra.length !== rb.length) {
    return `replayed ${ra.length} nodes but cached snapshot has ${rb.length}`;
  }
  for (let i = 0; i < ra.length; i++) {
    if (JSON.stringify(ra[i]) !== JSON.stringify(rb[i])) {
      return `replayed node "${key(ra[i])}" differs from cached snapshot`;
    }
  }
  return null;
}
