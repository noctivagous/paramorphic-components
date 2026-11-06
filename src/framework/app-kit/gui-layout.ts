// ---------- GUI layout resolvers: pure functions, no DOM, no React ----------
// Three placement systems, resolved the same way by the builder canvas, the
// GuiRenderer, and the verify script:
//  1. absolute — each node carries a rect per device; children offset
//     through their parent chain.
//  2. stack — children of a stack-mode container flow along one axis per
//     StackCfg (spacing optionally in baseline units, five distributions,
//     cross-axis alignment).
//  3. grid — children of a grid-mode container sit on a column grid by
//     start/span, rows on a fixed row height + baseline rhythm.
// Springs & struts apply when an absolute-mode container changes size:
// pinned edges keep their distance, sprung axes absorb the delta.
import type { GuiDocument, GuiNode } from "./gui-document";
import type { Device, LayoutRect, StackCfg, Struts } from "./controls/types";

export type ResolvedRect = LayoutRect & { absX: number; absY: number };

export const DEFAULT_STACK: StackCfg = { direction: "vertical", spacing: 8, distribution: "leading", alignment: "top" };
export const DEFAULT_BASELINE = 8;

/** Children of a node, in document order, visible only. */
export function guiChildren(doc: GuiDocument, parentId: string | null): GuiNode[] {
  return doc.nodes.filter(n => n.parentId === parentId && n.visible !== false);
}

/** Absolute rects only: a node's own rect offset through its parent chain. */
export function absoluteRects(doc: GuiDocument, device: Device): Map<string, ResolvedRect> {
  const byId = new Map(doc.nodes.map(n => [n.id, n]));
  const out = new Map<string, ResolvedRect>();
  const resolve = (node: GuiNode): ResolvedRect => {
    const hit = out.get(node.id);
    if (hit) return hit;
    const rect = node.layouts[device];
    let absX = rect.x, absY = rect.y;
    if (node.parentId) {
      const parent = byId.get(node.parentId);
      if (parent) { const p = resolve(parent); absX += p.absX; absY += p.absY; }
    }
    const resolved: ResolvedRect = { x: rect.x, y: rect.y, w: rect.w, h: rect.h, absX, absY };
    out.set(node.id, resolved);
    return resolved;
  };
  for (const node of doc.nodes) resolve(node);
  return out;
}

/**
 * Stack layout: lay `sizes` along the stack axis inside `container`.
 * Main-axis sizes come from each child's rect; "fill" stretches children
 * equally over the free space; "spaceBetween" pins first/last to the edges.
 * Cross-axis: alignment top/center/bottom positions the child; baseline is
 * treated as top (text baselines are a rendering concern, not geometry).
 */
export function stackLayout(sizes: Array<{ w: number; h: number }>, cfg: StackCfg, container: { w: number; h: number }, baselineUnit = DEFAULT_BASELINE): LayoutRect[] {
  const vertical = cfg.direction === "vertical";
  const spacing = cfg.spacingBaselineUnits ? cfg.spacing * baselineUnit : cfg.spacing;
  const mainOf = (s: { w: number; h: number }) => vertical ? s.h : s.w;
  const crossOf = (s: { w: number; h: number }) => vertical ? s.w : s.h;
  const mainTotal = vertical ? container.h : container.w;
  const crossTotal = vertical ? container.w : container.h;
  const n = sizes.length;
  if (n === 0) return [];
  const content = sizes.reduce((a, s) => a + mainOf(s), 0) + spacing * (n - 1);
  let start = 0, gap = spacing, mains = sizes.map(mainOf);
  switch (cfg.distribution) {
    case "center": start = (mainTotal - content) / 2; break;
    case "trailing": start = mainTotal - content; break;
    case "spaceBetween": gap = n > 1 ? (mainTotal - sizes.reduce((a, s) => a + mainOf(s), 0)) / (n - 1) : 0; break;
    case "fill": { const each = Math.max(0, (mainTotal - spacing * (n - 1)) / n); mains = sizes.map(() => each); break; }
    default: break; // leading
  }
  const rects: LayoutRect[] = [];
  let cursor = start;
  sizes.forEach((s, i) => {
    const main = mains[i];
    const crossSize = crossOf(s);
    let cross = 0;
    if (cfg.alignment === "center") cross = (crossTotal - crossSize) / 2;
    else if (cfg.alignment === "bottom") cross = crossTotal - crossSize;
    rects.push(vertical ? { x: cross, y: cursor, w: crossSize, h: main } : { x: cursor, y: cross, w: main, h: crossSize });
    cursor += main + gap;
  });
  return rects;
}

/** Grid layout: start/span placements on a column grid inside `container`. */
export function gridLayout(placements: Array<{ colStart: number; colSpan: number; rowStart: number; rowSpan: number }>, cfg: { columns: number; gutter: number; rowHeight: number; rowGutter: number }, container: { w: number; h: number }): LayoutRect[] {
  const colW = (container.w - (cfg.columns - 1) * cfg.gutter) / cfg.columns;
  return placements.map(p => ({
    x: p.colStart * (colW + cfg.gutter),
    y: p.rowStart * (cfg.rowHeight + cfg.rowGutter),
    w: p.colSpan * colW + (p.colSpan - 1) * cfg.gutter,
    h: p.rowSpan * cfg.rowHeight + (p.rowSpan - 1) * cfg.rowGutter,
  }));
}

/**
 * Springs & struts for one child when its container resizes from old to new:
 * both edges pinned -> size fixed unless the axis has a spring (then it
 * stretches); one edge pinned -> keeps that distance; neither pinned and no
 * spring -> the offset scales-free (child keeps its position, classic
 * behaviour when only springs move it is covered by hSpring/vSpring).
 */
export function applySpringsStruts(child: LayoutRect, oldC: { w: number; h: number }, newC: { w: number; h: number }, struts: Struts): LayoutRect {
  const dw = newC.w - oldC.w, dh = newC.h - oldC.h;
  let { x, y, w, h } = child;
  // Horizontal axis.
  if (struts.left && struts.right && struts.hSpring) w += dw;
  else if (!struts.left && struts.right) x += dw;
  else if (!struts.left && !struts.right && struts.hSpring) { w += dw; }
  // Vertical axis.
  if (struts.top && struts.bottom && struts.vSpring) h += dh;
  else if (!struts.top && struts.bottom) y += dh;
  else if (!struts.top && !struts.bottom && struts.vSpring) { h += dh; }
  return { x, y, w: Math.max(0, w), h: Math.max(0, h) };
}

/**
 * Full resolution: absolute roots; children of stack/grid containers placed
 * by their container's resolver (their stored rect supplies intrinsic size);
 * children of absolute containers offset through the parent. A container's
 * content box is its own rect (controls render their own padding).
 */
export function resolvedRects(doc: GuiDocument, device: Device): Map<string, ResolvedRect> {
  const byId = new Map(doc.nodes.map(n => [n.id, n]));
  const out = new Map<string, ResolvedRect>();
  const place = (node: GuiNode, parentAbs: { x: number; y: number } | null, placed: LayoutRect | null) => {
    const own = placed ?? node.layouts[device];
    const absX = (parentAbs?.x ?? 0) + own.x;
    const absY = (parentAbs?.y ?? 0) + own.y;
    const resolved: ResolvedRect = { x: own.x, y: own.y, w: own.w, h: own.h, absX, absY };
    out.set(node.id, resolved);
    const kids = guiChildren(doc, node.id);
    if (kids.length === 0) return;
    const mode = node.layoutMode ?? "absolute";
    if (mode === "stack") {
      const rects = stackLayout(kids.map(k => k.layouts[device]), node.stack ?? DEFAULT_STACK, { w: own.w, h: own.h });
      kids.forEach((k, i) => place(k, { x: absX, y: absY }, rects[i]));
    } else if (mode === "grid") {
      const cfg = node.gridCfg ?? { columns: 6, gutter: 8, rowHeight: 32, rowGutter: 8, baselineUnit: DEFAULT_BASELINE };
      const rects = gridLayout(kids.map(k => k.grid ?? { colStart: 0, colSpan: 1, rowStart: 0, rowSpan: 1 }), cfg, { w: own.w, h: own.h });
      kids.forEach((k, i) => place(k, { x: absX, y: absY }, rects[i]));
    } else {
      kids.forEach(k => place(k, { x: absX, y: absY }, null));
    }
  };
  for (const root of guiChildren(doc, null)) place(root, null, null);
  return out;
}

/** The device class for a canvas width (builder preview switching). */
export function deviceForWidth(width: number): Device {
  return width <= 480 ? "phone" : width <= 900 ? "tablet" : "desktop";
}

/** Subtree ids (node + all descendants), document order. */
export function subtreeIds(doc: GuiDocument, id: string): string[] {
  const out: string[] = [];
  const walk = (cur: string) => { out.push(cur); for (const k of guiChildren(doc, cur)) walk(k.id); };
  if (doc.nodes.some(n => n.id === id)) walk(id);
  return out;
}
