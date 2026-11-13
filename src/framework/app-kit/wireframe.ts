/**
 * GUI wireframe snapshots: layout analysis and SVG rendering primitives.
 * SPDX-License-Identifier: Apache-2.0
 *
 * Provenance: copied from ai-live-web-editor `src/layout/layoutSnapshot.ts`
 * (itself vendored from wireframe-chrome-devtools-mcp/web-layout-utils) and
 * adapted to the gui document model, 2026-11-06. Only the pure core came
 * over — the box format, `buildLayoutAnalysis`, `renderSvgWireframe`, and
 * `summarizeWireframeSnapshot`. The upstream CDP/DOM capture half did not:
 * paramorphic resolves layout purely (`resolvedRects`), so the snapshot is
 * produced from the document by `snapshotGuiDocument` instead of measured
 * from a live page.
 *
 * Adaptations vs upstream:
 *  - Element identity is the gui node id (`stableId`); the DOM label
 *    (tag#id.class) becomes control `type` + `props.title`.
 *  - Ancestor checks walk `parentStableId` (the document tree is explicit)
 *    instead of a CDP node-index map.
 *  - Clipping upstream required computed `overflow` styles; gui documents
 *    have no overflow concept, so clipping here means "child rect exceeds
 *    its direct parent's rect" — the class the builder cares about.
 *  - The renderer's `showSpacing` overlay read CSS margins/padding from
 *    computed styles, which don't exist here; it is accepted for option
 *    compatibility but draws nothing in this version. Sibling spacing is
 *    surfaced by the gap analysis instead.
 */
import type { GuiDocument, GuiNode } from "./gui-document";
import { resolvedRects } from "./gui-layout";
import type { Device } from "./controls/types";

export type WireframeRect = {
  x: number;
  y: number;
  width: number;
  height: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
};

function rectFromEdges(left: number, top: number, right: number, bottom: number): WireframeRect {
  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
    left,
    top,
    right,
    bottom,
  };
}

function rectArea(rect: WireframeRect): number {
  return Math.max(0, rect.width) * Math.max(0, rect.height);
}

function rectIntersection(a: WireframeRect, b: WireframeRect): WireframeRect | undefined {
  const left = Math.max(a.left, b.left);
  const right = Math.min(a.right, b.right);
  const top = Math.max(a.top, b.top);
  const bottom = Math.min(a.bottom, b.bottom);
  if (right <= left || bottom <= top) {
    return undefined;
  }
  return rectFromEdges(left, top, right, bottom);
}

// ---------- snapshot shape (trimmed WireframeSnapshotOutput) ----------

export type GuiBoxElement = {
  stableId: string;
  /** Parent gui node id; absent for root nodes. An addition vs upstream,
   *  whose snapshot implied the tree through CDP node indices. */
  parentStableId?: string;
  depth: number;
  /** Control type (upstream: tagName). */
  type: string;
  /** `props.title` when the node carries one. */
  title?: string;
  textSnippet?: string;
  rect: WireframeRect;
};

export type GuiBoxAnalysis = {
  overlaps?: Array<{
    a: string;
    b: string;
    area: number;
    rect: WireframeRect;
    overlapRatioA: number;
    overlapRatioB: number;
  }>;
  gaps?: Array<{
    a: string;
    b: string;
    axis: 'x' | 'y';
    gap: number;
    rect: WireframeRect;
  }>;
  clipping?: Array<{
    target: string;
    clippedBy: string;
    elementRect: WireframeRect;
    clipRect: WireframeRect;
    clippedRects: WireframeRect[];
    excess: {left: number; right: number; top: number; bottom: number};
  }>;
  meta?: {
    overlapPairsChecked?: number;
    overlapPairsTruncated?: boolean;
    gapPairsChecked?: number;
    gapPairsTruncated?: boolean;
    clippingSkipped?: boolean;
  };
};

export type GuiBoxSnapshot = {
  schemaVersion: number;
  device: Device;
  page: {
    viewport: {width: number; height: number};
  };
  elements: GuiBoxElement[];
  truncated: boolean;
  layoutAssertions?: {
    overflowXOffenders: Array<{stableId: string; right: number; excess: number}>;
    overflowYOffenders: Array<{stableId: string; bottom: number; excess: number}>;
  };
  analysis?: GuiBoxAnalysis;
};

// ---------- adapter: gui document -> snapshot ----------

/** Canvas widths per device class — mirrors apps/gui-builder DEVICE_W. */
export const GUI_DEVICE_WIDTH: Record<Device, number> = { desktop: 960, tablet: 768, phone: 390 };
/** The builder canvas's minimum height (it grows to fit content). */
export const GUI_CANVAS_MIN_HEIGHT = 560;

export function defaultGuiCanvas(device: Device): { w: number; h: number } {
  return { w: GUI_DEVICE_WIDTH[device], h: GUI_CANVAS_MIN_HEIGHT };
}

function depthOf(node: GuiNode, byId: Map<string, GuiNode>): number {
  let depth = 0;
  let cur = node.parentId;
  while (cur) {
    depth++;
    cur = byId.get(cur)?.parentId ?? null;
  }
  return depth;
}

/**
 * Snapshot a gui document at one device: elements in document order with
 * rects from `resolvedRects`, plus layout analysis and viewport overflow
 * assertions. Pure and deterministic — same document, byte-identical
 * snapshot JSON and SVG.
 */
export function snapshotGuiDocument(
  doc: GuiDocument,
  device: Device,
  canvas: { w: number; h: number } = defaultGuiCanvas(device),
  analysisOptions: LayoutAnalysisOptions = {},
): GuiBoxSnapshot {
  const byId = new Map(doc.nodes.map(n => [n.id, n]));
  const rects = resolvedRects(doc, device);
  const elements: GuiBoxElement[] = [];
  for (const node of doc.nodes) {
    if (node.visible === false) continue;
    const r = rects.get(node.id);
    if (!r) continue;
    const title = typeof node.props.title === "string" && node.props.title ? node.props.title : undefined;
    elements.push({
      stableId: node.id,
      ...(node.parentId ? { parentStableId: node.parentId } : {}),
      depth: depthOf(node, byId),
      type: node.type,
      ...(title ? { title, textSnippet: title } : {}),
      rect: rectFromEdges(r.absX, r.absY, r.absX + r.w, r.absY + r.h),
    });
  }
  const overflowXOffenders = elements
    .filter(el => el.rect.right > canvas.w)
    .map(el => ({ stableId: el.stableId, right: el.rect.right, excess: el.rect.right - canvas.w }));
  const overflowYOffenders = elements
    .filter(el => el.rect.bottom > canvas.h)
    .map(el => ({ stableId: el.stableId, bottom: el.rect.bottom, excess: el.rect.bottom - canvas.h }));
  const snapshot: GuiBoxSnapshot = {
    schemaVersion: 1,
    device,
    page: { viewport: { width: canvas.w, height: canvas.h } },
    elements,
    truncated: false,
    layoutAssertions: { overflowXOffenders, overflowYOffenders },
  };
  snapshot.analysis = buildLayoutAnalysis(elements, analysisOptions);
  return snapshot;
}

// ---------- analysis (copy-adapted from upstream buildLayoutAnalysis) ----------

export type LayoutAnalysisOptions = {
  includeOverlapAnalysis?: boolean;
  includeGapAnalysis?: boolean;
  includeClippingAnalysis?: boolean;
  maxPairs?: number;
  maxFindings?: number;
  minOverlapArea?: number;
  minGap?: number;
  axis?: 'x' | 'y' | 'both';
  skipAncestorOverlaps?: boolean;
};

export function buildLayoutAnalysis(
  elements: GuiBoxElement[],
  options: LayoutAnalysisOptions = {},
): GuiBoxAnalysis | undefined {
  const input = {
    includeOverlapAnalysis: options.includeOverlapAnalysis ?? true,
    includeGapAnalysis: options.includeGapAnalysis ?? true,
    includeClippingAnalysis: options.includeClippingAnalysis ?? true,
    maxPairs: options.maxPairs ?? 5000,
    maxFindings: options.maxFindings ?? 20,
    minOverlapArea: options.minOverlapArea ?? 4,
    minGap: options.minGap ?? 4,
    axis: options.axis ?? 'both',
    skipAncestorOverlaps: options.skipAncestorOverlaps ?? true,
  };
  const byId = new Map(elements.map(el => [el.stableId, el]));
  const isAncestorId = (ancestorId: string, id: string): boolean => {
    let cur = byId.get(id)?.parentStableId;
    while (cur) {
      if (cur === ancestorId) return true;
      cur = byId.get(cur)?.parentStableId;
    }
    return false;
  };

  const analysis: GuiBoxAnalysis = {};
  const meta: NonNullable<GuiBoxAnalysis['meta']> = {};

  if (input.includeOverlapAnalysis) {
    const overlaps: NonNullable<GuiBoxAnalysis['overlaps']> = [];
    let pairsChecked = 0;
    let truncated = false;
    for (let i = 0; i < elements.length; i++) {
      const a = elements[i];
      const aArea = rectArea(a.rect);
      if (!a.stableId || aArea <= 0) {
        continue;
      }
      for (let j = i + 1; j < elements.length; j++) {
        if (pairsChecked >= input.maxPairs) {
          truncated = true;
          break;
        }
        pairsChecked++;
        const b = elements[j];
        const bArea = rectArea(b.rect);
        if (!b.stableId || bArea <= 0) {
          continue;
        }
        if (
          input.skipAncestorOverlaps &&
          (isAncestorId(a.stableId, b.stableId) || isAncestorId(b.stableId, a.stableId))
        ) {
          continue;
        }
        const intersection = rectIntersection(a.rect, b.rect);
        if (!intersection) {
          continue;
        }
        const area = rectArea(intersection);
        if (area < input.minOverlapArea) {
          continue;
        }
        overlaps.push({
          a: a.stableId,
          b: b.stableId,
          area,
          rect: intersection,
          overlapRatioA: aArea ? area / aArea : 0,
          overlapRatioB: bArea ? area / bArea : 0,
        });
      }
      if (truncated) {
        break;
      }
    }
    overlaps.sort((left, right) => right.area - left.area);
    analysis.overlaps = overlaps.slice(0, input.maxFindings);
    meta.overlapPairsChecked = pairsChecked;
    meta.overlapPairsTruncated = truncated;
  }

  if (input.includeGapAnalysis) {
    const gaps: NonNullable<GuiBoxAnalysis['gaps']> = [];
    let pairsChecked = 0;
    let truncated = false;
    const axes: Array<'x' | 'y'> =
      input.axis === 'both' ? ['x', 'y'] : [input.axis];

    // Sibling groups keyed by parent ("" = root level), upstream's
    // childrenByParent over CDP node indices.
    const groups = new Map<string, GuiBoxElement[]>();
    for (const el of elements) {
      const key = el.parentStableId ?? '';
      const group = groups.get(key) ?? [];
      group.push(el);
      groups.set(key, group);
    }
    for (const kids of groups.values()) {
      if (!kids || kids.length < 2) {
        continue;
      }
      const entries = kids.filter(el => !!el.stableId);
      if (entries.length < 2) {
        continue;
      }
      for (const axis of axes) {
        entries.sort((left, right) =>
          axis === 'x' ? left.rect.left - right.rect.left : left.rect.top - right.rect.top,
        );
        for (let i = 0; i + 1 < entries.length; i++) {
          if (pairsChecked >= input.maxPairs) {
            truncated = true;
            break;
          }
          pairsChecked++;
          const a = entries[i];
          const b = entries[i + 1];
          if (!a.stableId || !b.stableId) {
            continue;
          }
          if (axis === 'x') {
            const overlap = Math.min(a.rect.bottom, b.rect.bottom) - Math.max(a.rect.top, b.rect.top);
            const gap = b.rect.left - a.rect.right;
            if (gap < input.minGap || overlap <= 0) {
              continue;
            }
            gaps.push({
              a: a.stableId,
              b: b.stableId,
              axis: 'x',
              gap,
              rect: rectFromEdges(
                a.rect.right,
                Math.max(a.rect.top, b.rect.top),
                b.rect.left,
                Math.min(a.rect.bottom, b.rect.bottom),
              ),
            });
          } else {
            const overlap = Math.min(a.rect.right, b.rect.right) - Math.max(a.rect.left, b.rect.left);
            const gap = b.rect.top - a.rect.bottom;
            if (gap < input.minGap || overlap <= 0) {
              continue;
            }
            gaps.push({
              a: a.stableId,
              b: b.stableId,
              axis: 'y',
              gap,
              rect: rectFromEdges(
                Math.max(a.rect.left, b.rect.left),
                a.rect.bottom,
                Math.min(a.rect.right, b.rect.right),
                b.rect.top,
              ),
            });
          }
        }
        if (truncated) {
          break;
        }
      }
      if (truncated) {
        break;
      }
    }
    gaps.sort((left, right) => right.gap - left.gap);
    analysis.gaps = gaps.slice(0, input.maxFindings);
    meta.gapPairsChecked = pairsChecked;
    meta.gapPairsTruncated = truncated;
  }

  if (input.includeClippingAnalysis) {
    // Adaptation: no computed overflow styles exist in a gui document, so
    // every element is checked against its direct parent's rect — a child
    // exceeding its container is the finding the builder acts on.
    const clipping: NonNullable<GuiBoxAnalysis['clipping']> = [];
    for (const el of elements) {
      if (!el.stableId || !el.parentStableId) {
        continue;
      }
      const parent = byId.get(el.parentStableId);
      if (!parent?.stableId) {
        continue;
      }
      const clipRect = parent.rect;
      const elementRect = el.rect;
      const excessLeft = Math.max(0, clipRect.left - elementRect.left);
      const excessRight = Math.max(0, elementRect.right - clipRect.right);
      const excessTop = Math.max(0, clipRect.top - elementRect.top);
      const excessBottom = Math.max(0, elementRect.bottom - clipRect.bottom);
      if (excessLeft || excessRight || excessTop || excessBottom) {
        const clippedRects: WireframeRect[] = [];
        if (excessLeft) {
          clippedRects.push(
            rectFromEdges(elementRect.left, elementRect.top, elementRect.left + excessLeft, elementRect.bottom),
          );
        }
        if (excessRight) {
          clippedRects.push(
            rectFromEdges(clipRect.right, elementRect.top, elementRect.right, elementRect.bottom),
          );
        }
        if (excessTop) {
          clippedRects.push(
            rectFromEdges(elementRect.left, elementRect.top, elementRect.right, elementRect.top + excessTop),
          );
        }
        if (excessBottom) {
          clippedRects.push(
            rectFromEdges(elementRect.left, clipRect.bottom, elementRect.right, elementRect.bottom),
          );
        }
        clipping.push({
          target: el.stableId,
          clippedBy: parent.stableId,
          elementRect,
          clipRect,
          clippedRects,
          excess: {
            left: excessLeft,
            right: excessRight,
            top: excessTop,
            bottom: excessBottom,
          },
        });
      }
    }
    clipping.sort((left, right) => {
      const leftArea = left.clippedRects.reduce((sum, rect) => sum + rectArea(rect), 0);
      const rightArea = right.clippedRects.reduce((sum, rect) => sum + rectArea(rect), 0);
      return rightArea - leftArea;
    });
    analysis.clipping = clipping.slice(0, input.maxFindings);
  }

  if (Object.keys(meta).length) {
    analysis.meta = meta;
  }

  return Object.keys(analysis).length ? analysis : undefined;
}

// ---------- SVG rendering (copy-adapted from upstream renderSvgWireframe) ----------

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function elementLabel(el: GuiBoxElement): string {
  // Upstream: tag#id.class from the DOM. Here: control type + title.
  return el.title ? `${el.type} "${el.title}"` : el.type;
}

export type SvgWireframeOptions = {
  scale?: number;
  background?: 'transparent' | 'white' | 'black';
  showLabels?: boolean;
  showDimensions?: boolean;
  /** Accepted for upstream compatibility; draws nothing (no computed
   *  styles exist in a gui document — see the header note). */
  showSpacing?: boolean;
  showOverlaps?: boolean;
  showGaps?: boolean;
  showClipping?: boolean;
  strokeWidth?: number;
  fillOpacity?: number;
  highlightChanged?: boolean;
  previous?: GuiBoxSnapshot;
};

export function renderSvgWireframe(
  snapshot: GuiBoxSnapshot,
  options: SvgWireframeOptions = {},
): string {
  const opts = {
    scale: options.scale ?? 1,
    background: options.background ?? 'white',
    showLabels: options.showLabels ?? true,
    showDimensions: options.showDimensions ?? false,
    showSpacing: options.showSpacing ?? false,
    showOverlaps: options.showOverlaps ?? false,
    showGaps: options.showGaps ?? false,
    showClipping: options.showClipping ?? false,
    strokeWidth: options.strokeWidth ?? 1,
    fillOpacity: options.fillOpacity ?? 0.12,
    highlightChanged: options.highlightChanged ?? false,
    previous: options.previous,
  };
  const viewportW = snapshot.page.viewport.width;
  const viewportH = snapshot.page.viewport.height;
  const scale = opts.scale;

  const viewBox = `0 0 ${viewportW} ${viewportH}`;

  const bg =
    opts.background === 'transparent'
      ? 'none'
      : opts.background === 'white'
        ? '#ffffff'
        : '#000000';

  const prevByKey = new Map<string, GuiBoxElement>();
  if (opts.previous) {
    for (const el of opts.previous.elements) {
      if (el.stableId && !prevByKey.has(el.stableId)) {
        prevByKey.set(el.stableId, el);
      }
    }
  }

  const rects: string[] = [];
  const labels: string[] = [];
  const dims: string[] = [];
  const overlapOverlays: string[] = [];
  const gapOverlays: string[] = [];
  const clippingOverlays: string[] = [];

  for (let idx = 0; idx < snapshot.elements.length; idx++) {
    const el = snapshot.elements[idx];
    const r = el.rect;
    if (!Number.isFinite(r.x) || !Number.isFinite(r.y)) {
      continue;
    }
    if (r.width <= 0 || r.height <= 0) {
      continue;
    }

    // Stable-ish color: hash from index.
    const hue = (idx * 37) % 360;
    const stroke = `hsl(${hue} 80% 45%)`;
    const fill = `hsl(${hue} 80% 45% / ${clamp(opts.fillOpacity, 0, 1)})`;

    const prev = prevByKey.get(el.stableId);
    const changed =
      !!prev &&
      (Math.abs(prev.rect.x - r.x) > 0.5 ||
        Math.abs(prev.rect.y - r.y) > 0.5 ||
        Math.abs(prev.rect.width - r.width) > 0.5 ||
        Math.abs(prev.rect.height - r.height) > 0.5);

    const isHighlighted = opts.highlightChanged && changed;
    const strokeColor = isHighlighted ? '#ff3b30' : stroke;
    const strokeDash = isHighlighted ? '6 4' : '';

    rects.push(
      `<rect x="${r.x}" y="${r.y}" width="${r.width}" height="${r.height}" ` +
        `fill="${fill}" stroke="${strokeColor}" stroke-width="${opts.strokeWidth}"` +
        (strokeDash ? ` stroke-dasharray="${strokeDash}"` : '') +
        ` />`,
    );

    if (opts.showLabels) {
      const text = elementLabel(el);
      if (text) {
        const x = r.x + 2;
        const y = r.y + 12;
        labels.push(
          `<text x="${x}" y="${y}" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" ` +
            `font-size="11" fill="${opts.background === 'black' ? '#ffffff' : '#111111'}">` +
            `${escapeXml(text)}` +
            `</text>`,
        );
      }
    }

    if (opts.showDimensions) {
      const text = `${Math.round(r.width)}×${Math.round(r.height)}`;
      const x = r.x + 2;
      const y = r.y + Math.min(r.height, 16) - 2;
      dims.push(
        `<text x="${x}" y="${y}" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" ` +
          `font-size="10" fill="${opts.background === 'black' ? '#ffffff' : '#111111'}">` +
          `${escapeXml(text)}` +
          `</text>`,
      );
    }

    // Optional: draw previous rect as faint outline.
    if (opts.highlightChanged && changed && prev) {
      const pr = prev.rect;
      rects.push(
        `<rect x="${pr.x}" y="${pr.y}" width="${pr.width}" height="${pr.height}" ` +
          `fill="none" stroke="#34c759" stroke-width="${opts.strokeWidth}" stroke-dasharray="2 3" />`,
      );
    }
  }

  if (opts.showOverlaps && snapshot.analysis?.overlaps?.length) {
    for (const overlap of snapshot.analysis.overlaps) {
      const r = overlap.rect;
      overlapOverlays.push(
        `<rect class="wf-overlap" x="${r.x}" y="${r.y}" width="${r.width}" height="${r.height}" ` +
          `fill="rgba(255,59,48,0.2)" stroke="#ff3b30" stroke-width="1" />`,
      );
    }
  }

  if (opts.showGaps && snapshot.analysis?.gaps?.length) {
    for (const gap of snapshot.analysis.gaps) {
      const r = gap.rect;
      gapOverlays.push(
        `<rect class="wf-gap" x="${r.x}" y="${r.y}" width="${r.width}" height="${r.height}" ` +
          `fill="rgba(255,167,38,0.15)" stroke="#ffa726" stroke-width="1" stroke-dasharray="3 2" />`,
      );
    }
  }

  if (opts.showClipping && snapshot.analysis?.clipping?.length) {
    for (const clip of snapshot.analysis.clipping) {
      const c = clip.clipRect;
      clippingOverlays.push(
        `<rect class="wf-clip-bound" x="${c.x}" y="${c.y}" width="${c.width}" height="${c.height}" ` +
          `fill="none" stroke="#9b59b6" stroke-width="1" stroke-dasharray="4 3" />`,
      );
      for (const r of clip.clippedRects) {
        clippingOverlays.push(
          `<rect class="wf-clip" x="${r.x}" y="${r.y}" width="${r.width}" height="${r.height}" ` +
            `fill="rgba(155,89,182,0.2)" stroke="#9b59b6" stroke-width="1" />`,
        );
      }
    }
  }

  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<svg xmlns="http://www.w3.org/2000/svg" width="${viewportW * scale}" height="${viewportH * scale}" viewBox="${viewBox}">` +
    `<rect x="0" y="0" width="${viewportW}" height="${viewportH}" fill="${bg}" />` +
    `<g>` +
    rects.join('') +
    `</g>` +
    (labels.length ? `<g>` + labels.join('') + `</g>` : '') +
    (dims.length ? `<g>` + dims.join('') + `</g>` : '') +
    (overlapOverlays.length ? `<g>` + overlapOverlays.join('') + `</g>` : '') +
    (gapOverlays.length ? `<g>` + gapOverlays.join('') + `</g>` : '') +
    (clippingOverlays.length ? `<g>` + clippingOverlays.join('') + `</g>` : '') +
    `</svg>`
  );
}

export function summarizeWireframeSnapshot(output: GuiBoxSnapshot) {
  return {
    schemaVersion: output.schemaVersion,
    device: output.device,
    elementCount: output.elements.length,
    truncated: output.truncated,
    viewport: output.page.viewport,
    overlaps: output.analysis?.overlaps?.length ?? 0,
    gaps: output.analysis?.gaps?.length ?? 0,
    clipping: output.analysis?.clipping?.length ?? 0,
    overflowX: output.layoutAssertions?.overflowXOffenders.length ?? 0,
    overflowY: output.layoutAssertions?.overflowYOffenders.length ?? 0,
  };
}

/** Bounded, agent-readable finding lines (gate format) for one snapshot. */
export function layoutFindingLines(snapshot: GuiBoxSnapshot): string[] {
  const lines: string[] = [];
  const label = (id: string) => {
    const el = snapshot.elements.find(e => e.stableId === id);
    return el ? `${id} (${elementLabel(el)})` : id;
  };
  for (const o of snapshot.analysis?.overlaps ?? []) {
    lines.push(
      `overlap: ${label(o.a)} x ${label(o.b)} — ${Math.round(o.rect.width)}x${Math.round(o.rect.height)} ` +
      `(${Math.round(o.area)}px^2, ${Math.round(o.overlapRatioA * 100)}% of a, ${Math.round(o.overlapRatioB * 100)}% of b)`,
    );
  }
  for (const c of snapshot.analysis?.clipping ?? []) {
    const parts = (['left', 'right', 'top', 'bottom'] as const)
      .filter(k => c.excess[k] > 0)
      .map(k => `${k} ${Math.round(c.excess[k])}px`);
    lines.push(`clipping: ${label(c.target)} exceeds ${label(c.clippedBy)} — ${parts.join(', ')}`);
  }
  for (const o of snapshot.layoutAssertions?.overflowXOffenders ?? []) {
    lines.push(`overflow-x: ${label(o.stableId)} right edge ${Math.round(o.right)} exceeds canvas width ${snapshot.page.viewport.width} by ${Math.round(o.excess)}px`);
  }
  for (const o of snapshot.layoutAssertions?.overflowYOffenders ?? []) {
    lines.push(`overflow-y: ${label(o.stableId)} bottom edge ${Math.round(o.bottom)} exceeds canvas height ${snapshot.page.viewport.height} by ${Math.round(o.excess)}px`);
  }
  return lines;
}
