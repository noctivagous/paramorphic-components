// Canvas drag math for the GUI Builder: pure (document in, gui.* morphs
// out) so verify-gui can exercise the exact code the canvas runs.
//
// The subtlety: children of stack/grid containers are layout-managed —
// resolvedRects() places them from the container's stack/grid config and
// ignores their stored x/y. Writing a dragged position into the stored
// rect therefore does nothing and the node bounces back on drop. So:
//  - a drag starts from the node's *resolved* rect (what is on screen),
//    not its stored rect (which for grid children is just (0,0) + size);
//  - dropping a layout-managed child with no drop target frees it: it is
//    reparented to the root at the absolute position where it was dropped;
//  - resizing a grid child changes its col/row span, the size the grid
//    resolver actually reads;
//  - a press with no displacement produces no morphs at all, so a plain
//    click to select never writes a history step, detaches a managed
//    child, or reparents a node that merely overlaps a container.
import {
  applySpringsStruts,
  getControlDef,
  guiChildren,
  resolvedRects,
  subtreeIds,
  type Device,
  type GuiDocument,
  type GuiNode,
  type LayoutRect,
  type ScopedAppliedMorph,
} from "../../../src/framework";

export type CanvasDrag = {
  id: string;
  mode: "move" | "resize";
  /** Resolved rect when the drag started (see dragStartRect). */
  orig: LayoutRect;
  /** Current rect, in the same parent-relative space as orig. */
  cur: LayoutRect;
};

const sameRect = (a: LayoutRect, b: LayoutRect) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;

/** The rect a drag should start from: the resolved (on-screen) rect. */
export function dragStartRect(doc: GuiDocument, device: Device, id: string): LayoutRect | null {
  const r = resolvedRects(doc, device).get(id);
  return r ? { x: r.x, y: r.y, w: r.w, h: r.h } : null;
}

/** Convert a canvas-absolute drop point into a new child's parent-relative rect origin. */
export function parentRelativePoint(doc: GuiDocument, device: Device, parentId: string | null, at: { x: number; y: number }): { x: number; y: number } {
  if (!parentId) return { x: Math.round(at.x), y: Math.round(at.y) };
  const parent = resolvedRects(doc, device).get(parentId);
  if (!parent) return { x: Math.round(at.x), y: Math.round(at.y) };
  return { x: Math.round(at.x - parent.absX), y: Math.round(at.y - parent.absY) };
}

const setLayout = (doc: GuiDocument, device: Device, id: string, rect: LayoutRect): ScopedAppliedMorph =>
  ({ name: "gui.setLayout", params: { id, device, rect, separate: doc.separateLayouts } });

/** Morphs that finish a canvas drag, or [] when the drag changed nothing. */
export function canvasDragMorphs(doc: GuiDocument, device: Device, drag: CanvasDrag): ScopedAppliedMorph[] {
  const node = doc.nodes.find(n => n.id === drag.id);
  if (!node || sameRect(drag.cur, drag.orig)) return [];
  const rects = resolvedRects(doc, device);
  const resolved = rects.get(node.id);
  if (!resolved) return [];
  const parent: GuiNode | null = node.parentId ? doc.nodes.find(n => n.id === node.parentId) ?? null : null;
  const parentMode = parent?.layoutMode ?? "absolute";
  const managed = !!parent && parentMode !== "absolute";

  if (drag.mode === "resize") {
    if (managed && parentMode === "grid" && parent) {
      // Grid children get their size from col/row span, not the stored rect.
      const cfg = parent.gridCfg ?? { columns: 6, gutter: 8, rowHeight: 32, rowGutter: 8, baselineUnit: 8 };
      const parentRect = rects.get(parent.id)!;
      const colW = (parentRect.w - (cfg.columns - 1) * cfg.gutter) / cfg.columns;
      const grid = node.grid ?? { colStart: 0, colSpan: 1, rowStart: 0, rowSpan: 1 };
      const colSpan = Math.max(1, Math.min(cfg.columns - grid.colStart, Math.round((drag.cur.w + cfg.gutter) / (colW + cfg.gutter))));
      const rowSpan = Math.max(1, Math.round((drag.cur.h + cfg.rowGutter) / (cfg.rowHeight + cfg.rowGutter)));
      if (colSpan === grid.colSpan && rowSpan === grid.rowSpan) return [];
      return [{ name: "gui.setNode", params: { node: { ...node, grid: { ...grid, colSpan, rowSpan } } } }];
    }
    const morphs: ScopedAppliedMorph[] = [setLayout(doc, device, node.id, drag.cur)];
    if (getControlDef(node.type)?.container && (node.layoutMode ?? "absolute") === "absolute") {
      for (const child of guiChildren(doc, node.id)) {
        if (!child.struts) continue;
        const next = applySpringsStruts(child.layouts[device], { w: drag.orig.w, h: drag.orig.h }, { w: drag.cur.w, h: drag.cur.h }, child.struts);
        if (JSON.stringify(next) !== JSON.stringify(child.layouts[device])) morphs.push(setLayout(doc, device, child.id, next));
      }
    }
    return morphs;
  }

  // Move: drop onto a container (smallest one under the node's centre that
  // is not the node itself, its descendant, or its current parent) parents it.
  let morphs: ScopedAppliedMorph[] = [setLayout(doc, device, node.id, drag.cur)];
  const centre = {
    x: resolved.absX + drag.cur.x - resolved.x + drag.cur.w / 2,
    y: resolved.absY + drag.cur.y - resolved.y + drag.cur.h / 2,
  };
  const descendants = new Set(subtreeIds(doc, node.id));
  const candidates = doc.nodes.filter(n => getControlDef(n.type)?.container && !descendants.has(n.id) && n.id !== node.parentId)
    .map(n => ({ n, r: rects.get(n.id)! })).filter(({ r }) => r && centre.x >= r.absX && centre.x <= r.absX + r.w && centre.y >= r.absY && centre.y <= r.absY + r.h)
    .sort((a, b) => a.r.w * a.r.h - b.r.w * b.r.h);
  const target = candidates[0];
  if (target) {
    const rel: LayoutRect = { ...drag.cur, x: Math.round(centre.x - target.r.absX - drag.cur.w / 2), y: Math.round(centre.y - target.r.absY - drag.cur.h / 2) };
    morphs[0] = setLayout(doc, device, node.id, rel);
    morphs.push({ name: "gui.reparent", params: { id: node.id, parentId: target.n.id } });
  } else if (managed) {
    // No container claimed it: free the child at the dropped position so a
    // stack/grid-managed node stays where the user put it instead of
    // snapping back to its resolver-computed slot.
    const freed: LayoutRect = {
      x: Math.round(resolved.absX + drag.cur.x - resolved.x),
      y: Math.round(resolved.absY + drag.cur.y - resolved.y),
      w: drag.cur.w, h: drag.cur.h,
    };
    morphs = [setLayout(doc, device, node.id, freed), { name: "gui.reparent", params: { id: node.id, parentId: null } }];
  }
  return morphs;
}
